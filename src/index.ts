import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ActivityStore } from './activity'
import { Config, normalizeConfig } from './config'
import type { Config as ConfigShape } from './config'
import { PLUGIN_NAME, renderDelta } from './delta'
import type { SessionEvent } from './delta'
import { addTasks, completeGoal, setGoal } from './goal-tasks'
import type { GoalService } from './goal-tasks'
import { RPC_CHANNEL, registerConfigRpc } from './rpc'

export const name = PLUGIN_NAME
// `settings` backs the live config scope; `goals` is the native same-session
// goal service the keeper creates goals through. `connection` is deliberately
// NOT listed: it is an OPTIONAL service (absent in headless profiles), and a
// missing inject name would strand this whole fiber. registerConfigRpc probes
// `ctx.connection` at runtime and no-ops when it is absent.
export const inject = ['agents', 'llm', 'settings', 'goals']

// Re-export the schema so the loader can validate this plugin's config.
export { Config }
export { RPC_CHANNEL }

/**
 * Settings namespace: pinned to the original 'dsh-mini-advisor' literal even
 * though the plugin was renamed to dsh-goal-keeper, so existing saved settings
 * (provider/model overrides) are not orphaned by the rename.
 */
export const SETTINGS_NAMESPACE = 'dsh-mini-advisor'

/**
 * Harness mechanics the advisor must not get wrong. The advisor model reviews a
 * dsh transcript but has no dsh knowledge of its own, so without these it invents
 * plausible-sounding remedies — e.g. recommending `job_output <subagent_id>` to
 * drain a continuable subagent, which is not a job and has no job output. Wrong
 * advice delivered confidently is worse than silence, so state the few mechanics
 * that advisories most often turn on.
 */
const HARNESS_FACTS = [
  'Facts about this harness — advise within them, and never invent a tool or capability not listed here:',
  '- Subagents and jobs are different things. `subagent` / `subagent_fork` / `delegate_*` create continuable SUBAGENTS, observed with `list_agents` and `peek_subagent`. `job_output` / `job_list` work only on dsh JOBS (background bash, background-mode runs) and do NOT work on subagents — never advise draining a subagent with `job_output`.',
  '- `send_message` QUEUES a turn on a subagent: it is delivered only after the child\'s current turn ends, so it cannot redirect work already underway.',
  '- `interrupt_agent` cancels a child\'s CURRENT turn only. It does not extract a final report, and queued messages stay parked. A child given no stopping condition may never emit a report at all — the fix is to re-delegate with a hard tool-call budget, not to nudge or interrupt again.',
  '- `peek_subagent` is a passive read. A rising event count means the child is alive, not that it is progressing.',
  '- Ending a turn while subagents run is CORRECT: the runtime wakes the agent with a settlement notice. Waiting is a legitimate action; never advise polling in a loop to stay busy.',
].join('\n')

const SYSTEM_PROMPT_TAIL = [
  'You are a goal-keeper watching the latest slice of a coding-agent transcript below.',
  'Your job is to keep the primary agent on track toward its objective until it is genuinely done.',
  'The tools below are independent and more than one kind can fire in the same review (e.g. `advise` plus `update_tasks`) — but call `advise` at most once: pick the single most important thing and say only that, rather than bundling several concerns into one note.',
  'When something matters — a bug, a security hole, a wrong turn, or a premature "done" — call the `advise` tool with a short, concrete note and a severity (nit | concern | blocker).',
  'If nothing needs any tool, reply "ok".',
  '',
  HARNESS_FACTS,
].join('\n')

const ADVISE_TOOL = {
  name: 'advise',
  description: 'Hand one concrete advisory note to the primary agent. Call at most once per review.',
  parameters: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['nit', 'concern', 'blocker'], description: 'How much this matters.' },
      note: { type: 'string', description: 'The concrete advice, one or two sentences.' },
    },
    required: ['severity', 'note'],
    additionalProperties: false,
  },
} as const

const SET_GOAL_TOOL = {
  name: 'set_goal',
  description:
    "Set or update the session's overarching objective when the user's ask has a clear goal the agent should be held to. Creates the goal if none exists, or revises the objective if one already does. One goal per session. Revise only to reflect what the USER has actually asked for or confirmed — never to narrow a problem the user stated into a specific solution they have not chosen, and never to bake in the agent's current approach, findings, or environment details. If the user named a problem and the objective names an implementation, that is drift: leave the objective alone. When the user's ask is to investigate, compare, or decide, the objective is the deciding — do not rewrite it into building whichever option is currently in favour.",
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'The completion objective, one sentence.' },
    },
    required: ['objective'],
    additionalProperties: false,
  },
} as const

const COMPLETE_GOAL_TOOL = {
  name: 'complete_goal',
  description:
    'Mark the session goal complete when the objective is genuinely achieved — the work is done, verified, and nothing material remains. Only call this when you are confident the goal is finished; it closes the goal and stops keeper continuation.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} as const

const UPDATE_TASKS_TOOL = {
  name: 'update_tasks',
  description:
    "Add concrete next steps to the agent's todo checklist when the work has clear steps it has not tracked. Tasks are appended to the existing list, never replacing the agent's own todos, so do not repeat steps it already tracks.",
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short imperative task lines to add.',
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
} as const

interface Agent {
  session?: {
    events?: readonly SessionEvent[]
    append?(type: string, data: unknown): unknown
  }
  inject(message: unknown): void
}

interface SettingsScope {
  get(): unknown
  watch(cb: (next: unknown, prev: unknown) => void): () => void
  update(patch: unknown): unknown
}

interface ResolvedModelInfo {
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

interface LlmInfo {
  id: string
  name: string
}

interface LlmConfigEntry {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  declared?: boolean
}

interface LlmModelInfo {
  id: string
  name: string
}

export interface HostContext {
  agents: { get(id: string): Agent | undefined }
  llm: {
    stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>
    listProviders(): LlmInfo[]
    listConfigurableProviders(): LlmConfigEntry[]
    listModels(provider: string): Promise<LlmModelInfo[]>
    resolveModelInfo(provider: string, model: string): Promise<ResolvedModelInfo>
  }
  settings: {
    register(ns: string, schema: unknown, options?: unknown): SettingsScope
    get(ns: string): unknown
  }
  // Native same-session goal service (dsh-goal), listed in `inject`.
  goals: GoalService
  // Optional-service lookup for `connection` (see rpc.ts); undefined when absent.
  get?(name: string): unknown
  logger?: {
    debug?(message: string, meta?: Record<string, unknown>): void
    info?(message: string, meta?: Record<string, unknown>): void
  }
  on(event: string, listener: (...args: unknown[]) => unknown): unknown
  effect(factory: () => unknown, label?: string): void
}

function sessionIdOf(session: unknown): string {
  return String((session as { id?: unknown })?.id ?? '')
}

/** Parse one tool-call block's JSON arguments, or undefined when malformed. */
function parseToolCall(block: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  if (block.type !== 'tool-call' || block.name !== name || typeof block.arguments !== 'string') return undefined
  try {
    const parsed = JSON.parse(block.arguments)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    // Malformed tool arguments: skip, never throw into a review.
    return undefined
  }
}

/** Extract the advise-tool call arguments from the advisor model's streamed blocks. */
export function readAdviceFromBlocks(
  blocks: Array<Record<string, unknown>>,
): { severity: string; note: string } | undefined {
  for (const block of blocks) {
    const parsed = parseToolCall(block, 'advise')
    if (parsed && typeof parsed.note === 'string' && parsed.note.trim()) {
      const severity = typeof parsed.severity === 'string' ? parsed.severity : 'concern'
      return { severity, note: parsed.note.trim() }
    }
  }
  return undefined
}

/** Extract a set_goal objective from the keeper's streamed blocks. */
export function readGoalFromBlocks(blocks: Array<Record<string, unknown>>): string | undefined {
  for (const block of blocks) {
    const parsed = parseToolCall(block, 'set_goal')
    if (parsed && typeof parsed.objective === 'string' && parsed.objective.trim()) return parsed.objective.trim()
  }
  return undefined
}

/** Detect a complete_goal call in the keeper's streamed blocks. */
export function readCompleteFromBlocks(blocks: Array<Record<string, unknown>>): boolean {
  for (const block of blocks) {
    if (parseToolCall(block, 'complete_goal')) return true
  }
  return false
}

/** Extract update_tasks task lines from the keeper's streamed blocks. */
export function readTasksFromBlocks(blocks: Array<Record<string, unknown>>): string[] {
  for (const block of blocks) {
    const parsed = parseToolCall(block, 'update_tasks')
    if (parsed && Array.isArray(parsed.tasks)) {
      return parsed.tasks.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    }
  }
  return []
}

/** One authenticated picker option surfaced through the `pickers` RPC. */
interface PickerProvider {
  provider: string
  displayName: string
  models: Array<{
    id: string
    name: string
    efforts: Array<{ id: string; name: string }>
  }>
}

/**
 * Build the ready-to-render picker set: every registered provider whose
 * authentication the credentials seam reports as configured, with each
 * provider's models and each model's selectable reasoning efforts.
 *
 * "Authenticated" mirrors the official UI's `llm.providers` predicate: a
 * provider is active iff its id is in `listProviders()` (an adapter currently
 * owns the route). Additionally, when its `llm-pi-ai` profile names a
 * credential reference (`apiKeyEnv`), the credential seam must describe it as
 * configured — otherwise the provider is omitted, since a missing key would
 * only surface as a downstream stream error. A provider that names no
 * `apiKeyEnv` is considered authenticated if it is active.
 */
async function buildPickers(ctx: HostContext): Promise<PickerProvider[]> {
  // ACTIVE ROUTE SET is authoritative: an id returned by `listProviders()` is a
  // live, registered route in this harness — registration implies a usable
  // (authenticated) route. Inactive routes (no adapter owns them yet) are still
  // excluded below. The credentials seam REFINE, not GATE: it can only REMOVE a
  // provider when it definitively returns `configured === false`; an absent,
  // throwing, or malformed probe falls through to include (active route stands).
  const registered = ctx.llm.listProviders()
  const activeIds = new Set(registered.map((p) => p.id))
  // Look up `apiKeyEnv` per provider from the resolved `llm-pi-ai` settings
  // scope (path `providers.<route>.apiKeyEnv`). The LLM types do NOT carry
  // `apiKeyEnv`, so this is the typed seam to the profile.
  const piAiRaw = ctx.settings.get('llm-pi-ai') as
    | { providers?: Record<string, { apiKeyEnv?: string }> }
    | undefined
  const piAiProviders = piAiRaw?.providers ?? {}
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  const describe = (
    credentials as { describe?: (ref: string) => Promise<{ configured: boolean }> } | undefined
  )?.describe

  const providers: PickerProvider[] = []
  for (const entry of ctx.llm.listConfigurableProviders()) {
    if (!activeIds.has(entry.provider)) continue
    const apiKeyEnv = piAiProviders[entry.provider]?.apiKeyEnv
    if (apiKeyEnv && typeof describe === 'function') {
      try {
        const info = await describe(apiKeyEnv)
        if (info && typeof info === 'object' && info.configured === false) {
          // POSITIVE proof the provider is unconfigured — the only path that
          // may remove an active route. Logged so the journal shows why.
          ctx.logger?.info?.(`${PLUGIN_NAME}: picker excludes ${entry.provider} (${apiKeyEnv} reports not-configured)`)
          continue
        }
        // describe returned undefined, malformed, or configured:true → fall
        // through and INCLUDE on active-route basis.
      } catch {
        // describe threw — can't positively prove unconfigured → INCLUDE on
        // active-route basis (logged once below if probe is absent entirely).
      }
    } else if (apiKeyEnv && typeof describe !== 'function') {
      // Credentials probe unavailable entirely; active route still stands.
      ctx.logger?.info?.(`${PLUGIN_NAME}: credentials probe unavailable, including active provider ${entry.provider} on active-route basis`)
    }
    let models: LlmModelInfo[]
    try {
      models = await ctx.llm.listModels(entry.provider)
    } catch {
      models = []
    }
    const enriched = await Promise.all(
      models.map(async (m) => {
        let efforts: Array<{ id: string; name: string }> = []
        try {
          const resolved = await ctx.llm.resolveModelInfo(entry.provider, m.id)
          efforts = (resolved.reasoning?.efforts ?? []).map((e) => ({
            id: e.id,
            name: e.name || e.id,
          }))
        } catch {
          // Adapter refused to resolve: leave the model with no efforts so the
          // picker still offers it but the effort dropdown falls back to the
          // "Default (unspecified)" option only.
        }
        return { id: m.id, name: m.name, efforts }
      }),
    )
    providers.push({ provider: entry.provider, displayName: entry.displayName, models: enriched })
  }
  return providers
}

export function apply(ctx: HostContext): void {
  // Register a live settings scope: the Settings tab writes here through the
  // RPC channel, and every review reads the current value, so config changes
  // take effect without a restart. `applies: 'live'` marks it hot-tunable.
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { applies: 'live' })
  let config: ConfigShape = normalizeConfig(scope.get())
  ctx.effect(() => scope.watch((next) => (config = normalizeConfig(next))), `${PLUGIN_NAME}: settings watch`)

  // Per-session advisor activity for the sidebar tab (monitor state only).
  const activity = new ActivityStore()

  // RPC transport for the Settings tab and the sidebar tab (trusted-host so
  // remote GUIs work).
  ctx.effect(
    () =>
      registerConfigRpc(ctx, {
        get: () => normalizeConfig(scope.get()),
        update: (patch) => {
          scope.update(patch)
          return normalizeConfig(scope.get())
        },
        status: (sessionId) =>
          sessionId ? [activity.snapshot(sessionId)] : activity.all(),
        pickers: () => buildPickers(ctx),
      }),
    `${PLUGIN_NAME}: config rpc`,
  )

  // Per-session review cursor over the durable event log, plus the ordinal of
  // the advisor's next update. A serialized in-flight flag drops overlapping
  // reviews so one session never runs two advisor calls at once.
  const cursors = new Map<string, number>()
  const updateIndexes = new Map<string, number>()
  const reviewing = new Set<string>()
  // Sessions that have been disposed. A `turn/end` can be observed as a session
  // winds down; without this guard a review would run against a disposed
  // session, incrementing the advice counter while `agent.inject` lands nowhere
  // durable (phantom advice). Reviews are skipped once a session is disposed.
  const disposed = new Set<string>()
  // Steps observed in the current turn, per session, for the in-turn trigger.
  // Reset at every turn boundary so the count is always "steps into this turn".
  const stepsThisTurn = new Map<string, number>()
  // Last advisory note injected per session, to suppress immediate repeats.
  const lastAdviceNotes = new Map<string, string>()

  const review = async (sessionId: string): Promise<void> => {
    if (!config.enabled || disposed.has(sessionId) || reviewing.has(sessionId)) return
    const agent = ctx.agents.get(sessionId)
    const events = agent?.session?.events
    if (!agent || !events) return

    const cursor = cursors.get(sessionId) ?? 0
    const updateIndex = (updateIndexes.get(sessionId) ?? 0) + 1
    const { text, nextCursor } = renderDelta(events, cursor, updateIndex)
    // Advance the cursor even when we skip, so skipped content is not replayed.
    cursors.set(sessionId, nextCursor)
    if (!text.trim() || text.trim().length < config.minDeltaChars) return
    updateIndexes.set(sessionId, updateIndex)

    reviewing.add(sessionId)
    activity.reviewRan(sessionId)
    try {
      // The advisor may also set the session goal and add tasks directly
      // through native DSH mechanisms, gated by config. The prompt tail names
      // whichever tools are enabled so the model knows what it can do.
      const tools: Array<Record<string, unknown>> = [ADVISE_TOOL]
      const extraPrompt: string[] = []
      if (config.createGoals) {
        tools.push(SET_GOAL_TOOL, COMPLETE_GOAL_TOOL)
        extraPrompt.push(
          "Call `set_goal` when the user's request implies a single overarching objective the agent should be held to across the session (e.g. build X, migrate Y, get the suite green). It creates the goal or updates the objective if one exists, so keep it current as the true objective sharpens. Skip trivial one-shot asks. Call `complete_goal` only when that objective is genuinely finished and verified.",
        )
      }
      if (config.createTasks) {
        tools.push(UPDATE_TASKS_TOOL)
        extraPrompt.push(
          "Call `update_tasks` whenever the work has concrete, separable steps the agent has not written into its own checklist. Add the missing steps as short imperative lines; they are appended, never replacing the agent's todos, so do not repeat steps it already tracks.",
        )
      }

      const request: Record<string, unknown> = {
        provider: config.provider,
        model: config.model,
        ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
        system: [config.persona, SYSTEM_PROMPT_TAIL, ...extraPrompt].join('\n\n'),
        messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: PLUGIN_NAME } })],
        tools,
      }

      const blocks: Array<Record<string, unknown>> = []
      let streamError: { code: string; message: string } | undefined
      for await (const chunk of ctx.llm.stream(request)) {
        if (chunk.type === 'block-end' && chunk.block) blocks.push(chunk.block as Record<string, unknown>)
        else if (chunk.type === 'finish') {
          // The LLM service converts adapter throws (NO_ADAPTER, etc.) into a
          // terminal `finish` chunk with kind: 'error' via adapterFailureChunk;
          // surface that into the sidebar activity so a dead advisor is visible.
          const reason = chunk.reason as { kind?: string; failure?: { code?: string; message?: string } } | undefined
          if (reason?.kind === 'error' && reason.failure) {
            const code = String(reason.failure.code ?? 'UNKNOWN')
            const message = String(reason.failure.message ?? 'unknown error')
            streamError = { code, message }
          }
        }
      }

      if (streamError) {
        activity.setLastError(sessionId, `${streamError.code}: ${streamError.message}`)
        ctx.logger?.debug?.(`${PLUGIN_NAME}: llm stream error`, { session: sessionId, ...streamError })
        return
      }
      activity.setLastError(sessionId, undefined)

      // Native goal drive (direct): set/update the objective, and complete the
      // goal when the keeper judges it done. setGoal creates when no goal
      // exists and edits the objective otherwise (no more silent no-op).
      if (config.createGoals) {
        const objective = readGoalFromBlocks(blocks)
        if (objective) {
          try {
            const view = setGoal(ctx.goals, agent, objective)
            if (view) activity.goalCreated(sessionId, objective)
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: set_goal failed`, { session: sessionId, error: String(error) })
          }
        }
        if (readCompleteFromBlocks(blocks)) {
          try {
            completeGoal(ctx.goals, agent)
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: complete_goal failed`, { session: sessionId, error: String(error) })
          }
        }
      }

      // Native task creation (direct): merge advisor tasks into the agent's
      // todo checklist without clobbering the agent's own todos.
      if (config.createTasks) {
        const tasks = readTasksFromBlocks(blocks)
        if (tasks.length > 0) {
          try {
            addTasks(agent, tasks)
            // Record what we asked to add (addTasks dedupes against existing).
            for (const task of tasks) activity.taskCreated(sessionId, task)
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: update_tasks failed`, { session: sessionId, error: String(error) })
          }
        }
      }

      const advice = readAdviceFromBlocks(blocks)
      if (!advice) return

      // If the session was disposed while this review was in flight, skip the
      // inject entirely — otherwise the advisory lands nowhere durable and the
      // counter would record phantom advice the session never received.
      if (disposed.has(sessionId)) return

      // Drop an advisory identical to the last one this session received. Reviews
      // now also run mid-turn, so a genuinely stuck agent gets reviewed several
      // times while the transcript still shows the same problem — and the advisor
      // rightly reaches the same conclusion each time. Injecting it repeatedly
      // would turn one useful warning into nagging the agent learns to ignore.
      // Comparing the note text keeps the first occurrence and suppresses echoes,
      // while any genuinely new observation still gets through.
      const noteKey = advice.note.trim()
      if (lastAdviceNotes.get(sessionId) === noteKey) return
      lastAdviceNotes.set(sessionId, noteKey)

      // The advisory is model-visible input, so it must be a logged user-role
      // message with a typed plugin source — `createUserMessage` + `inject`
      // handle the durable `user/message` event for us (guide: model-visible ⟺
      // logged). The primary agent weighs it; it is never an order. Only count
      // the advice once the inject has been issued without throwing, so the
      // sidebar counter never diverges from what actually reached the session.
      agent.inject(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: `<advisory advisor="goal-keeper" severity="${advice.severity}" guidance="weigh, don't blindly obey">\n${advice.note}\n</advisory>`,
            },
          ],
          source: { kind: 'plugin', plugin: PLUGIN_NAME },
        }),
      )
      activity.adviceIssued(sessionId, advice.severity, advice.note)
    } catch (error) {
      activity.setLastError(sessionId, String(error instanceof Error ? error.message : error))
      ctx.logger?.debug?.(`${PLUGIN_NAME}: review failed`, { session: sessionId, error: String(error) })
    } finally {
      reviewing.delete(sessionId)
    }
  }

  // Watch the durable transcript stream for turn boundaries. `session/event`
  // is the documented replay-data consumer path; a `turn/end` marks a complete
  // unit of the primary agent's work to review (agent-lifecycle.md).
  // A `turn/end` marks a complete unit of work, but a single turn can run for
  // dozens of steps — long enough for the agent to spend an entire turn stuck in
  // a loop with the keeper unable to say a word until the damage is done. So we
  // also review mid-turn, every `reviewEverySteps` steps, which is the only way
  // advice can land while a runaway turn is still running. `reviewing` already
  // serializes overlapping reviews and the cursor only moves forward, so an
  // in-turn review costs the turn/end review nothing but the events it consumed.
  ctx.on('session/event', (session: unknown, event: unknown) => {
    const type = (event as SessionEvent)?.type
    const sessionId = sessionIdOf(session)

    if (type === 'turn/start' || type === 'turn/end') {
      stepsThisTurn.delete(sessionId)
      if (type === 'turn/end') void review(sessionId)
      return
    }

    if (type !== 'step/end') return
    const every = config.reviewEverySteps
    if (every <= 0) return // 0 disables the in-turn trigger: turn/end only.
    const steps = (stepsThisTurn.get(sessionId) ?? 0) + 1
    stepsThisTurn.set(sessionId, steps)
    if (steps % every === 0) void review(sessionId)
  })

  ctx.on('session/disposed', (session: unknown) => {
    const id = sessionIdOf(session)
    disposed.add(id)
    cursors.delete(id)
    updateIndexes.delete(id)
    reviewing.delete(id)
    stepsThisTurn.delete(id)
    lastAdviceNotes.delete(id)
    activity.drop(id)
  })
}
