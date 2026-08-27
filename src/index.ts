import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ActivityStore } from './activity'
import { Config, normalizeConfig } from './config'
import type { Config as ConfigShape } from './config'
import { PLUGIN_NAME, renderDelta } from './delta'
import type { SessionEvent } from './delta'
import { addTasks, createGoal } from './goal-tasks'
import type { GoalService } from './goal-tasks'
import { RPC_CHANNEL, registerConfigRpc } from './rpc'

export const name = PLUGIN_NAME
// `settings` backs the live config scope; `goals` is the native same-session
// goal service the advisor creates goals through. `connection` is deliberately
// NOT listed: it is an OPTIONAL service (absent in headless profiles), and a
// missing inject name would strand this whole fiber. registerConfigRpc probes
// `ctx.connection` at runtime and no-ops when it is absent.
export const inject = ['agents', 'llm', 'settings', 'goals']

// Re-export the schema so the loader can validate this plugin's config.
export { Config }
export { RPC_CHANNEL }

/** Settings namespace: the key the config scope and Settings tab share. */
export const SETTINGS_NAMESPACE = PLUGIN_NAME

const SYSTEM_PROMPT_TAIL = [
  'You review the latest slice of a coding-agent transcript below.',
  'When something matters, call the `advise` tool exactly once with a short, concrete note and a severity (nit | concern | blocker).',
  'If nothing needs saying, do not call any tool — just reply "ok".',
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

const CREATE_GOAL_TOOL = {
  name: 'create_goal',
  description:
    'Set the session-level goal when the user\'s ask has a clear overarching objective the agent should be held to. Use sparingly — one goal per session. Replaces any existing goal.',
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'The completion objective, one sentence.' },
    },
    required: ['objective'],
    additionalProperties: false,
  },
} as const

const ADD_TASKS_TOOL = {
  name: 'add_tasks',
  description:
    "Add concrete tasks to the agent's todo checklist when the work has clear steps the agent has not tracked. Tasks are appended to the existing list, never replacing the agent's own todos.",
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

export interface HostContext {
  agents: { get(id: string): Agent | undefined }
  llm: { stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>> }
  settings: { register(ns: string, schema: unknown, options?: unknown): SettingsScope }
  // Native same-session goal service (dsh-goal), listed in `inject`.
  goals: GoalService
  // Optional-service lookup for `connection` (see rpc.ts); undefined when absent.
  get?(name: string): unknown
  logger?: { debug?(message: string, meta?: Record<string, unknown>): void }
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

/** Extract a create_goal objective from the advisor's streamed blocks. */
export function readGoalFromBlocks(blocks: Array<Record<string, unknown>>): string | undefined {
  for (const block of blocks) {
    const parsed = parseToolCall(block, 'create_goal')
    if (parsed && typeof parsed.objective === 'string' && parsed.objective.trim()) return parsed.objective.trim()
  }
  return undefined
}

/** Extract add_tasks task lines from the advisor's streamed blocks. */
export function readTasksFromBlocks(blocks: Array<Record<string, unknown>>): string[] {
  for (const block of blocks) {
    const parsed = parseToolCall(block, 'add_tasks')
    if (parsed && Array.isArray(parsed.tasks)) {
      return parsed.tasks.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    }
  }
  return []
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
      }),
    `${PLUGIN_NAME}: config rpc`,
  )

  // Per-session review cursor over the durable event log, plus the ordinal of
  // the advisor's next update. A serialized in-flight flag drops overlapping
  // reviews so one session never runs two advisor calls at once.
  const cursors = new Map<string, number>()
  const updateIndexes = new Map<string, number>()
  const reviewing = new Set<string>()

  const review = async (sessionId: string): Promise<void> => {
    if (!config.enabled || reviewing.has(sessionId)) return
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
        tools.push(CREATE_GOAL_TOOL)
        extraPrompt.push(
          'If the session has a clear overarching objective the agent should be held to, call `create_goal` once.',
        )
      }
      if (config.createTasks) {
        tools.push(ADD_TASKS_TOOL)
        extraPrompt.push(
          'If the work has concrete steps the agent has not tracked, call `add_tasks` to add them to its checklist.',
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
      for await (const chunk of ctx.llm.stream(request)) {
        if (chunk.type === 'block-end' && chunk.block) blocks.push(chunk.block as Record<string, unknown>)
      }

      activity.setLastError(sessionId, undefined)

      // Native goal creation (direct): set the session goal through ctx.goals.
      if (config.createGoals) {
        const objective = readGoalFromBlocks(blocks)
        if (objective) {
          try {
            createGoal(ctx.goals, agent, objective)
            activity.goalCreated(sessionId, objective)
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: create_goal failed`, { session: sessionId, error: String(error) })
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
            ctx.logger?.debug?.(`${PLUGIN_NAME}: add_tasks failed`, { session: sessionId, error: String(error) })
          }
        }
      }

      const advice = readAdviceFromBlocks(blocks)
      if (!advice) return
      activity.adviceIssued(sessionId, advice.severity, advice.note)

      // The advisory is model-visible input, so it must be a logged user-role
      // message with a typed plugin source — `createUserMessage` + `inject`
      // handle the durable `user/message` event for us (guide: model-visible ⟺
      // logged). The primary agent weighs it; it is never an order.
      agent.inject(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: `<advisory advisor="mini-advisor" severity="${advice.severity}" guidance="weigh, don't blindly obey">\n${advice.note}\n</advisory>`,
            },
          ],
          source: { kind: 'plugin', plugin: PLUGIN_NAME },
        }),
      )
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
  ctx.on('session/event', (session: unknown, event: unknown) => {
    if ((event as SessionEvent)?.type !== 'turn/end') return
    void review(sessionIdOf(session))
  })

  ctx.on('session/disposed', (session: unknown) => {
    const id = sessionIdOf(session)
    cursors.delete(id)
    updateIndexes.delete(id)
    reviewing.delete(id)
    activity.drop(id)
  })
}
