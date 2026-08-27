// Native DSH goal + task creation, called directly by the advisor.
//
// Goals: `ctx.goals.create(agent, { objective })` — the first-class same-session
//   goal service (dsh-goal). The goal appears in the native goal UI and drives
//   continuation via the goal-round-driver.
// Tasks: appended as a `todo/write` session event. That event is LOG-ONLY
//   (persistence-catalog: "todo/write — log-only"), so `session.append` needs no
//   SurfaceIntent, and the UI renders the latest todo/write as the checklist.
//   The list is replaced wholesale on every write, so to coexist with the
//   primary agent's todos we fold the latest list and append our tasks.

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

export interface GoalService {
  create(agent: AgentLike, request: { objective: string; maxGoalRounds?: number }): unknown
}

/** Create and arm a native same-session goal. Returns nothing model-visible. */
export function createGoal(goals: GoalService, agent: AgentLike, objective: string): void {
  goals.create(agent, { objective })
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
 * Append advisor tasks to the primary agent's todo list without clobbering it:
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
