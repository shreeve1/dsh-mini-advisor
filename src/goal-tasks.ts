// Native DSH goal + task operations for the goal-keeper.
//
// Goals use the first-class same-session goal service (@deepseek-ai/dsh-goal,
// injected as `goals`). The keeper drives the goal to completion, so it needs
// more than create: it reads the current goal (`get`), creates one when none
// exists, edits the objective when one already does (instead of the old
// silent no-op), and completes it when the objective is met.
//
// Tasks are appended as a `todo/write` session event (log-only per the
// persistence catalog), folded so the keeper never clobbers the primary
// agent's own todos.

/** One todo entry — the unit of the todo/write event (session.md TodoItem). */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Minimal live-agent surface we need: its session (for todos) is enough here. */
export interface AgentLike {
  session?: {
    events?: readonly { type: string; data?: unknown }[]
    append?(type: string, data: unknown): unknown
  }
}

/** A goal reference — the revision-checked handle the service mutations need. */
export interface GoalRef {
  id: string
  revision: number
}

/** The subset of a GoalView the keeper reads. */
export interface GoalView extends GoalRef {
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
}

/**
 * The native goal service surface the keeper uses. Mirrors @deepseek-ai/dsh-goal:
 * `get` reads the current goal (undefined when none), `create` mints a fresh
 * goal (throws GOAL_ALREADY_EXISTS if a non-complete goal exists), `edit`
 * revises the objective in place, `complete` closes it.
 */
export interface GoalService {
  get(agent: AgentLike): GoalView | undefined
  create(agent: AgentLike, request: { objective: string; maxGoalRounds?: number }): GoalView
  edit(agent: AgentLike, ref: GoalRef, request: { objective?: string; maxGoalRounds?: number }): GoalView
  complete(agent: AgentLike, ref: GoalRef): GoalView
}

/**
 * Set the session objective: create a goal when none is current (or the current
 * one is already complete), otherwise edit the existing goal's objective in
 * place. This replaces the old create-only path that silently no-opped whenever
 * a goal already existed. Returns the resulting view, or undefined on no-op.
 */
export function setGoal(goals: GoalService, agent: AgentLike, objective: string): GoalView | undefined {
  const current = goals.get(agent)
  if (!current || current.phase === 'complete') {
    return goals.create(agent, { objective })
  }
  if (current.objective === objective) return current
  return goals.edit(agent, { id: current.id, revision: current.revision }, { objective })
}

/**
 * Complete the current goal when one is open. No-ops when there is no goal or it
 * is already complete. Returns the completed view, or undefined on no-op.
 */
export function completeGoal(goals: GoalService, agent: AgentLike): GoalView | undefined {
  const current = goals.get(agent)
  if (!current || current.phase === 'complete') return undefined
  return goals.complete(agent, { id: current.id, revision: current.revision })
}

/** Fold the latest `todo/write` event into the current todo list (or empty). */
export function currentTodos(agent: AgentLike): TodoItem[] {
  const events = agent.session?.events
  if (!events) return []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'todo/write') continue
    const todos = (event.data as { todos?: unknown } | undefined)?.todos
    if (Array.isArray(todos)) {
      return todos
        .filter((t): t is TodoItem => !!t && typeof (t as TodoItem).content === 'string')
        .map((t) => ({ content: t.content, status: t.status ?? 'pending' }))
    }
    return []
  }
  return []
}

/**
 * Append keeper tasks to the primary agent's todo list without clobbering it:
 * read the current list, add the new tasks (deduped by content), and write the
 * merged list back as one `todo/write` event. New tasks are `pending`.
 */
export function addTasks(agent: AgentLike, tasks: string[]): TodoItem[] {
  const append = agent.session?.append
  if (typeof append !== 'function') return currentTodos(agent)
  const existing = currentTodos(agent)
  const have = new Set(existing.map((t) => t.content))
  const additions: TodoItem[] = tasks
    .map((content) => content.trim())
    .filter((content) => content && !have.has(content))
    .map((content) => ({ content, status: 'pending' as const }))
  if (additions.length === 0) return existing
  const merged = [...existing, ...additions]
  append.call(agent.session, 'todo/write', { todos: merged })
  return merged
}
