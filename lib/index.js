// src/index.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// src/activity.ts
var MAX_ADVISORIES = 50;
var MAX_CREATIONS = 50;
var ActivityStore = class {
  sessions = /* @__PURE__ */ new Map();
  ensure(sessionId) {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = { sessionId, reviews: 0, advice: 0, goals: 0, tasks: 0, advisories: [], creations: [] };
      this.sessions.set(sessionId, entry);
    }
    return entry;
  }
  /** Record one goal the advisor created (newest first, bounded). */
  goalCreated(sessionId, objective) {
    const entry = this.ensure(sessionId);
    entry.goals += 1;
    entry.creations.unshift({ time: Date.now(), kind: "goal", text: objective });
    if (entry.creations.length > MAX_CREATIONS) entry.creations.length = MAX_CREATIONS;
  }
  /** Record one task the advisor added (newest first, bounded). */
  taskCreated(sessionId, content) {
    const entry = this.ensure(sessionId);
    entry.tasks += 1;
    entry.creations.unshift({ time: Date.now(), kind: "task", text: content });
    if (entry.creations.length > MAX_CREATIONS) entry.creations.length = MAX_CREATIONS;
  }
  /** Record that a review ran (whether or not it produced advice). */
  reviewRan(sessionId) {
    this.ensure(sessionId).reviews += 1;
  }
  /** Record one issued advisory (newest first, bounded). */
  adviceIssued(sessionId, severity, note) {
    const entry = this.ensure(sessionId);
    entry.advice += 1;
    entry.advisories.unshift({ time: Date.now(), severity, note });
    if (entry.advisories.length > MAX_ADVISORIES) entry.advisories.length = MAX_ADVISORIES;
  }
  /** Record the most recent review error (or clear it on success). */
  setLastError(sessionId, error) {
    this.ensure(sessionId).lastError = error;
  }
  /** One session's activity, or an empty shell when nothing has happened yet. */
  snapshot(sessionId) {
    return this.sessions.get(sessionId) ?? {
      sessionId,
      reviews: 0,
      advice: 0,
      goals: 0,
      tasks: 0,
      advisories: [],
      creations: []
    };
  }
  /** Every session with recorded activity. */
  all() {
    return [...this.sessions.values()];
  }
  drop(sessionId) {
    this.sessions.delete(sessionId);
  }
};

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  enabled: Schema.boolean().default(true).description("Whether the advisor reviews turns."),
  provider: Schema.string().default("deepseek-official").description("LLM provider route for the advisor model."),
  model: Schema.string().default("deepseek-v4-flash").description("Advisor model id from the DSH model list."),
  reasoningEffort: Schema.string().default("").description("Optional reasoning effort passed to the advisor model."),
  persona: Schema.string().role("textarea").default(
    'You are a rigorous goal-keeper watching a coding agent. Speak up only when something matters: a bug, a security hole, a wrong turn, or a premature "done". Keep advice concrete and short.'
  ).description("The advisor's persona and reviewing instructions."),
  minDeltaChars: Schema.number().default(40).description("Skip a review when the rendered transcript delta is shorter than this many characters."),
  reviewEverySteps: Schema.number().min(0).default(12).description(
    "Also review mid-turn every N agent steps, so advice can land while a long turn is still running. 0 = review only at turn boundaries."
  ),
  createGoals: Schema.boolean().default(true).description("Let the keeper set, update, and complete the session goal directly (native goal service)."),
  createTasks: Schema.boolean().default(true).description("Let the keeper add tasks to the agent's todo checklist directly.")
});
function normalizeConfig(raw) {
  const safe = typeof raw === "object" && raw !== null ? raw : {};
  return Config(safe);
}

// src/delta.ts
var PLUGIN_NAME = "dsh-goal-keeper";
var TEXT_PREVIEW_LIMIT = 2e3;
var ARGS_PREVIEW_LIMIT = 400;
function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
\u2026[truncated ${text.length - limit} chars]`;
}
function blocksToText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}
function isOwnPluginMessage(data) {
  const source = data?.source;
  return source?.kind === "plugin" && source?.plugin === PLUGIN_NAME;
}
var COLLAPSE_KEEP_PER_TOOL = 4;
function collapseRuns(sections) {
  const total = /* @__PURE__ */ new Map();
  for (const section of sections) {
    if (section.tool !== void 0) total.set(section.tool, (total.get(section.tool) ?? 0) + 1);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  for (const section of sections) {
    const tool = section.tool;
    if (tool === void 0) {
      out.push(section.text);
      continue;
    }
    const count = (seen.get(tool) ?? 0) + 1;
    seen.set(tool, count);
    const totalForTool = total.get(tool) ?? 0;
    if (count <= COLLAPSE_KEEP_PER_TOOL) {
      out.push(section.text);
    } else if (count === COLLAPSE_KEEP_PER_TOOL + 1 && totalForTool > COLLAPSE_KEEP_PER_TOOL) {
      out.push(
        `### \u2026 ${tool} repeated \u2014 ${totalForTool} chunks total in this update, ${totalForTool - COLLAPSE_KEEP_PER_TOOL} further occurrences elided \u2026`
      );
    }
  }
  return out;
}
function renderDelta(events, cursor, updateIndex) {
  const sections = [];
  const toolNames = /* @__PURE__ */ new Map();
  let index = Math.max(0, cursor);
  for (; index < events.length; index++) {
    const event = events[index];
    if (!event || typeof event.type !== "string") continue;
    const data = event.data ?? event;
    switch (event.type) {
      case "user/message": {
        if (isOwnPluginMessage(data)) break;
        const text = blocksToText(data.content);
        if (text.trim()) sections.push({ text: `### User
${truncate(text, TEXT_PREVIEW_LIMIT)}` });
        break;
      }
      case "assistant/message": {
        const message = data.message;
        const text = blocksToText(message?.content);
        if (text.trim()) sections.push({ text: `### Assistant
${truncate(text, TEXT_PREVIEW_LIMIT)}` });
        break;
      }
      case "tool/call": {
        const name2 = typeof data.name === "string" ? data.name : "tool";
        if (typeof data.callId === "string") toolNames.set(data.callId, name2);
        let argsPreview = "";
        const args = data.arguments;
        if (typeof args === "string" && args.trim() && args.trim() !== "{}") {
          argsPreview = `
\`\`\`json
${truncate(args, ARGS_PREVIEW_LIMIT)}
\`\`\``;
        }
        sections.push({ text: `### Tool call: ${name2}${argsPreview}`, tool: name2 });
        break;
      }
      case "tool/result": {
        const message = data.message;
        const callId = typeof message?.content?.[0]?.toolCallId === "string" ? message.content[0].toolCallId : void 0;
        const name2 = callId && toolNames.get(callId) || "tool";
        const text = blocksToText(message?.content?.[0]?.content ?? message?.content);
        const isError = data.error !== void 0;
        const status = isError ? " (error)" : "";
        const body = text.trim() ? truncate(text, TEXT_PREVIEW_LIMIT) : "(no output)";
        sections.push({ text: `### Tool result: ${name2}${status}
${body}`, tool: name2 });
        break;
      }
      default:
        break;
    }
  }
  if (sections.length === 0) return { text: "", nextCursor: index };
  return { text: `## Update ${updateIndex}

${collapseRuns(sections).join("\n\n")}`, nextCursor: index };
}

// src/goal-tasks.ts
function setGoal(goals, agent, objective) {
  const current = goals.get(agent);
  if (!current || current.phase === "complete") {
    return goals.create(agent, { objective });
  }
  if (current.objective === objective) return current;
  return goals.edit(agent, { id: current.id, revision: current.revision }, { objective });
}
function completeGoal(goals, agent) {
  const current = goals.get(agent);
  if (!current || current.phase === "complete") return void 0;
  return goals.complete(agent, { id: current.id, revision: current.revision });
}
function currentTodos(agent) {
  const events = agent.session?.events;
  if (!events) return [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== "todo/write") continue;
    const todos = event.data?.todos;
    if (Array.isArray(todos)) {
      return todos.filter((t) => !!t && typeof t.content === "string").map((t) => ({ content: t.content, status: t.status ?? "pending" }));
    }
    return [];
  }
  return [];
}
function addTasks(agent, tasks) {
  const append = agent.session?.append;
  if (typeof append !== "function") return currentTodos(agent);
  const existing = currentTodos(agent);
  const have = new Set(existing.map((t) => t.content));
  const additions = tasks.map((content) => content.trim()).filter((content) => content && !have.has(content)).map((content) => ({ content, status: "pending" }));
  if (additions.length === 0) return existing;
  const merged = [...existing, ...additions];
  append.call(agent.session, "todo/write", { todos: merged });
  return merged;
}

// src/rpc.ts
var RPC_CHANNEL = `/${PLUGIN_NAME}`;
function asConnection(value) {
  const rpc = value?.rpc;
  return typeof rpc?.handle === "function" ? value : void 0;
}
function asRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("payload must be an object");
  return value;
}
function registerConfigRpc(ctx, store) {
  const connection = typeof ctx.get === "function" ? asConnection(ctx.get("connection")) : void 0;
  if (!connection) return () => {
  };
  return connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint, rawPayload) => {
      try {
        const payload = rawPayload == null ? {} : asRecord(rawPayload);
        switch (endpoint) {
          case "get":
            return { ok: true, value: { config: store.get() } };
          case "status": {
            const sessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId : void 0;
            return { ok: true, value: { sessions: store.status(sessionId) } };
          }
          case "update": {
            let patch;
            try {
              patch = asRecord(payload.patch);
            } catch (error) {
              return { ok: false, error: { code: "bad-request", message: String(error.message) } };
            }
            try {
              return { ok: true, value: { config: store.update(patch) } };
            } catch (error) {
              return { ok: false, error: { code: "bad-request", message: String(error.message) } };
            }
          }
          case "pickers":
            return { ok: true, value: { providers: await store.pickers() } };
          default:
            return { ok: false, error: { code: "bad-request", message: `unknown endpoint: ${endpoint}` } };
        }
      } catch (error) {
        return { ok: false, error: { code: "internal", message: String(error.message) } };
      }
    },
    { authority: "trusted-host" }
  );
}

// src/index.ts
var name = PLUGIN_NAME;
var inject = ["agents", "llm", "settings", "goals", "commands"];
var SETTINGS_NAMESPACE = "dsh-mini-advisor";
var HARNESS_FACTS = [
  "Facts about this harness \u2014 advise within them, and never invent a tool or capability not listed here:",
  "- Subagents and jobs are different things. `subagent` / `subagent_fork` / `delegate_*` create continuable SUBAGENTS, observed with `list_agents` and `peek_subagent`. `job_output` / `job_list` work only on dsh JOBS (background bash, background-mode runs) and do NOT work on subagents \u2014 never advise draining a subagent with `job_output`.",
  "- `send_message` QUEUES a turn on a subagent: it is delivered only after the child's current turn ends, so it cannot redirect work already underway.",
  "- `interrupt_agent` cancels a child's CURRENT turn only. It does not extract a final report, and queued messages stay parked. A child given no stopping condition may never emit a report at all \u2014 the fix is to re-delegate with a hard tool-call budget, not to nudge or interrupt again.",
  "- `peek_subagent` is a passive read. A rising event count means the child is alive, not that it is progressing.",
  "- Ending a turn while subagents run is CORRECT: the runtime wakes the agent with a settlement notice. Waiting is a legitimate action; never advise polling in a loop to stay busy."
].join("\n");
var SYSTEM_PROMPT_TAIL = [
  "You are a goal-keeper watching the latest slice of a coding-agent transcript below.",
  "Your job is to keep the primary agent on track toward its objective until it is genuinely done.",
  "The tools below are independent and more than one kind can fire in the same review (e.g. `advise` plus `update_tasks`) \u2014 but call `advise` at most once: pick the single most important thing and say only that, rather than bundling several concerns into one note.",
  'When something matters \u2014 a bug, a security hole, a wrong turn, or a premature "done" \u2014 call the `advise` tool with a short, concrete note and a severity (nit | concern | blocker).',
  'If nothing needs any tool, reply "ok".',
  "",
  HARNESS_FACTS
].join("\n");
var ADVISE_TOOL = {
  name: "advise",
  description: "Hand one concrete advisory note to the primary agent. Call at most once per review.",
  parameters: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["nit", "concern", "blocker"], description: "How much this matters." },
      note: { type: "string", description: "The concrete advice, one or two sentences." }
    },
    required: ["severity", "note"],
    additionalProperties: false
  }
};
var SET_GOAL_TOOL = {
  name: "set_goal",
  description: "Set or update the session's overarching objective when the user's ask has a clear goal the agent should be held to. Creates the goal if none exists, or revises the objective if one already does. One goal per session. Revise only to reflect what the USER has actually asked for or confirmed \u2014 never to narrow a problem the user stated into a specific solution they have not chosen, and never to bake in the agent's current approach, findings, or environment details. If the user named a problem and the objective names an implementation, that is drift: leave the objective alone. When the user's ask is to investigate, compare, or decide, the objective is the deciding \u2014 do not rewrite it into building whichever option is currently in favour.",
  parameters: {
    type: "object",
    properties: {
      objective: { type: "string", description: "The completion objective, one sentence." }
    },
    required: ["objective"],
    additionalProperties: false
  }
};
var COMPLETE_GOAL_TOOL = {
  name: "complete_goal",
  description: "Mark the session goal complete when the objective is genuinely achieved \u2014 the work is done, verified, and nothing material remains. Only call this when you are confident the goal is finished; it closes the goal and stops keeper continuation.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};
var UPDATE_TASKS_TOOL = {
  name: "update_tasks",
  description: "Add concrete next steps to the agent's todo checklist when the work has clear steps it has not tracked. Tasks are appended to the existing list, never replacing the agent's own todos, so do not repeat steps it already tracks.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Short imperative task lines to add."
      }
    },
    required: ["tasks"],
    additionalProperties: false
  }
};
function sessionIdOf(session) {
  return String(session?.id ?? "");
}
function parseToolCall(block, name2) {
  if (block.type !== "tool-call" || block.name !== name2 || typeof block.arguments !== "string") return void 0;
  try {
    const parsed = JSON.parse(block.arguments);
    return parsed && typeof parsed === "object" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function readAdviceFromBlocks(blocks) {
  for (const block of blocks) {
    const parsed = parseToolCall(block, "advise");
    if (parsed && typeof parsed.note === "string" && parsed.note.trim()) {
      const severity = typeof parsed.severity === "string" ? parsed.severity : "concern";
      return { severity, note: parsed.note.trim() };
    }
  }
  return void 0;
}
function readGoalFromBlocks(blocks) {
  for (const block of blocks) {
    const parsed = parseToolCall(block, "set_goal");
    if (parsed && typeof parsed.objective === "string" && parsed.objective.trim()) return parsed.objective.trim();
  }
  return void 0;
}
function readCompleteFromBlocks(blocks) {
  for (const block of blocks) {
    if (parseToolCall(block, "complete_goal")) return true;
  }
  return false;
}
function readTasksFromBlocks(blocks) {
  for (const block of blocks) {
    const parsed = parseToolCall(block, "update_tasks");
    if (parsed && Array.isArray(parsed.tasks)) {
      return parsed.tasks.filter((t) => typeof t === "string" && t.trim().length > 0);
    }
  }
  return [];
}
async function buildPickers(ctx) {
  const registered = ctx.llm.listProviders();
  const activeIds = new Set(registered.map((p) => p.id));
  const piAiRaw = ctx.settings.get("llm-pi-ai");
  const piAiProviders = piAiRaw?.providers ?? {};
  const credentials = typeof ctx.get === "function" ? ctx.get("credentials") : void 0;
  const describe = credentials?.describe;
  const providers = [];
  for (const entry of ctx.llm.listConfigurableProviders()) {
    if (!activeIds.has(entry.provider)) continue;
    const apiKeyEnv = piAiProviders[entry.provider]?.apiKeyEnv;
    if (apiKeyEnv && typeof describe === "function") {
      try {
        const info = await describe(apiKeyEnv);
        if (info && typeof info === "object" && info.configured === false) {
          ctx.logger?.info?.(`${PLUGIN_NAME}: picker excludes ${entry.provider} (${apiKeyEnv} reports not-configured)`);
          continue;
        }
      } catch {
      }
    } else if (apiKeyEnv && typeof describe !== "function") {
      ctx.logger?.info?.(`${PLUGIN_NAME}: credentials probe unavailable, including active provider ${entry.provider} on active-route basis`);
    }
    let models;
    try {
      models = await ctx.llm.listModels(entry.provider);
    } catch {
      models = [];
    }
    const enriched = await Promise.all(
      models.map(async (m) => {
        let efforts = [];
        try {
          const resolved = await ctx.llm.resolveModelInfo(entry.provider, m.id);
          efforts = (resolved.reasoning?.efforts ?? []).map((e) => ({
            id: e.id,
            name: e.name || e.id
          }));
        } catch {
        }
        return { id: m.id, name: m.name, efforts };
      })
    );
    providers.push({ provider: entry.provider, displayName: entry.displayName, models: enriched });
  }
  return providers;
}
function apply(ctx) {
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { applies: "live" });
  let config = normalizeConfig(scope.get());
  ctx.effect(() => scope.watch((next) => config = normalizeConfig(next)), `${PLUGIN_NAME}: settings watch`);
  const activity = new ActivityStore();
  const enabledBySession = /* @__PURE__ */ new Map();
  const isEnabled = (sessionId) => enabledBySession.get(sessionId) ?? config.enabled;
  ctx.effect(
    () => registerConfigRpc(ctx, {
      get: () => normalizeConfig(scope.get()),
      update: (patch) => {
        scope.update(patch);
        return normalizeConfig(scope.get());
      },
      status: (sessionId) => sessionId ? [activity.snapshot(sessionId)] : activity.all(),
      pickers: () => buildPickers(ctx)
    }),
    `${PLUGIN_NAME}: config rpc`
  );
  const cursors = /* @__PURE__ */ new Map();
  const updateIndexes = /* @__PURE__ */ new Map();
  const reviewing = /* @__PURE__ */ new Set();
  const disposed = /* @__PURE__ */ new Set();
  const stepsThisTurn = /* @__PURE__ */ new Map();
  const lastAdviceNotes = /* @__PURE__ */ new Map();
  const review = async (sessionId) => {
    if (!isEnabled(sessionId) || disposed.has(sessionId) || reviewing.has(sessionId)) return;
    const agent = ctx.agents.get(sessionId);
    const events = agent?.session?.events;
    if (!agent || !events) return;
    const cursor = cursors.get(sessionId) ?? 0;
    const updateIndex = (updateIndexes.get(sessionId) ?? 0) + 1;
    const { text, nextCursor } = renderDelta(events, cursor, updateIndex);
    cursors.set(sessionId, nextCursor);
    if (!text.trim() || text.trim().length < config.minDeltaChars) return;
    updateIndexes.set(sessionId, updateIndex);
    reviewing.add(sessionId);
    activity.reviewRan(sessionId);
    try {
      const tools = [ADVISE_TOOL];
      const extraPrompt = [];
      if (config.createGoals) {
        tools.push(SET_GOAL_TOOL, COMPLETE_GOAL_TOOL);
        extraPrompt.push(
          "Call `set_goal` when the user's request implies a single overarching objective the agent should be held to across the session (e.g. build X, migrate Y, get the suite green). It creates the goal or updates the objective if one exists, so keep it current as the true objective sharpens. Skip trivial one-shot asks. Call `complete_goal` only when that objective is genuinely finished and verified."
        );
      }
      if (config.createTasks) {
        tools.push(UPDATE_TASKS_TOOL);
        extraPrompt.push(
          "Call `update_tasks` whenever the work has concrete, separable steps the agent has not written into its own checklist. Add the missing steps as short imperative lines; they are appended, never replacing the agent's todos, so do not repeat steps it already tracks."
        );
      }
      const request = {
        provider: config.provider,
        model: config.model,
        ...config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {},
        system: [config.persona, SYSTEM_PROMPT_TAIL, ...extraPrompt].join("\n\n"),
        messages: [createUserMessage({ content: [{ type: "text", text }], source: { kind: "plugin", plugin: PLUGIN_NAME } })],
        tools
      };
      const blocks = [];
      let streamError;
      for await (const chunk of ctx.llm.stream(request)) {
        if (chunk.type === "block-end" && chunk.block) blocks.push(chunk.block);
        else if (chunk.type === "finish") {
          const reason = chunk.reason;
          if (reason?.kind === "error" && reason.failure) {
            const code = String(reason.failure.code ?? "UNKNOWN");
            const message = String(reason.failure.message ?? "unknown error");
            streamError = { code, message };
          }
        }
      }
      if (streamError) {
        activity.setLastError(sessionId, `${streamError.code}: ${streamError.message}`);
        ctx.logger?.debug?.(`${PLUGIN_NAME}: llm stream error`, { session: sessionId, ...streamError });
        return;
      }
      activity.setLastError(sessionId, void 0);
      if (config.createGoals) {
        const objective = readGoalFromBlocks(blocks);
        if (objective) {
          try {
            const view = setGoal(ctx.goals, agent, objective);
            if (view) activity.goalCreated(sessionId, objective);
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: set_goal failed`, { session: sessionId, error: String(error) });
          }
        }
        if (readCompleteFromBlocks(blocks)) {
          try {
            completeGoal(ctx.goals, agent);
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: complete_goal failed`, { session: sessionId, error: String(error) });
          }
        }
      }
      if (config.createTasks) {
        const tasks = readTasksFromBlocks(blocks);
        if (tasks.length > 0) {
          try {
            addTasks(agent, tasks);
            for (const task of tasks) activity.taskCreated(sessionId, task);
          } catch (error) {
            ctx.logger?.debug?.(`${PLUGIN_NAME}: update_tasks failed`, { session: sessionId, error: String(error) });
          }
        }
      }
      const advice = readAdviceFromBlocks(blocks);
      if (!advice) return;
      if (disposed.has(sessionId)) return;
      const noteKey = advice.note.trim();
      if (lastAdviceNotes.get(sessionId) === noteKey) return;
      lastAdviceNotes.set(sessionId, noteKey);
      agent.inject(
        createUserMessage({
          content: [
            {
              type: "text",
              text: `<advisory advisor="goal-keeper" severity="${advice.severity}" guidance="weigh, don't blindly obey">
${advice.note}
</advisory>`
            }
          ],
          source: { kind: "plugin", plugin: PLUGIN_NAME }
        })
      );
      activity.adviceIssued(sessionId, advice.severity, advice.note);
    } catch (error) {
      activity.setLastError(sessionId, String(error instanceof Error ? error.message : error));
      ctx.logger?.debug?.(`${PLUGIN_NAME}: review failed`, { session: sessionId, error: String(error) });
    } finally {
      reviewing.delete(sessionId);
    }
  };
  ctx.effect(
    () => ctx.commands.register({
      name: "keeper",
      description: "Goal keeper for this session: /keeper on | off | status",
      // Declare an unstructured-input hint so capable clients (the web slash
      // bar) accept trailing arguments. Without it the web composer treats the
      // command as argument-less: `/keeper on` falls through and is sent to the
      // model as a prompt instead of dispatching. `/keeper` bare = status.
      input: { hint: "on | off | status" },
      handler: ({ agent, rawInput }) => {
        const sessionId = sessionIdOf(agent.session);
        if (!sessionId) return { kind: "error", text: "goal keeper: no session on this agent." };
        const arg = rawInput.trim().toLowerCase();
        if (arg === "" || arg === "status") {
          const state = isEnabled(sessionId) ? "on" : "off";
          const source = enabledBySession.get(sessionId) === void 0 ? "following the global default" : `session override; global default: ${config.enabled ? "on" : "off"}`;
          return { kind: "success", text: `goal keeper: ${state} (${source})` };
        }
        if (arg === "on" || arg === "off") {
          enabledBySession.set(sessionId, arg === "on");
          return {
            kind: "success",
            text: arg === "on" ? "Goal keeper on for this session \u2014 reviews, advice, goals, and tasks resume." : "Goal keeper off for this session \u2014 no reviews, advice, goals, or tasks."
          };
        }
        return { kind: "error", text: "goal keeper: use `on`, `off`, or `status`." };
      }
    }),
    `${PLUGIN_NAME}: /keeper command`
  );
  ctx.on("session/event", (session, event) => {
    const type = event?.type;
    const sessionId = sessionIdOf(session);
    if (type === "turn/start" || type === "turn/end") {
      stepsThisTurn.delete(sessionId);
      if (type === "turn/end") void review(sessionId);
      return;
    }
    if (type !== "step/end") return;
    const every = config.reviewEverySteps;
    if (every <= 0) return;
    const steps = (stepsThisTurn.get(sessionId) ?? 0) + 1;
    stepsThisTurn.set(sessionId, steps);
    if (steps % every === 0) void review(sessionId);
  });
  ctx.on("session/disposed", (session) => {
    const id = sessionIdOf(session);
    disposed.add(id);
    cursors.delete(id);
    updateIndexes.delete(id);
    reviewing.delete(id);
    stepsThisTurn.delete(id);
    lastAdviceNotes.delete(id);
    enabledBySession.delete(id);
    activity.drop(id);
  });
}
export {
  Config,
  RPC_CHANNEL,
  SETTINGS_NAMESPACE,
  apply,
  inject,
  name,
  readAdviceFromBlocks,
  readCompleteFromBlocks,
  readGoalFromBlocks,
  readTasksFromBlocks
};
