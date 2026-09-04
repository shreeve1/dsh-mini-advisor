/** One todo entry — the unit of the todo/write event (session.md TodoItem). */
export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
/** Minimal live-agent surface we need: its session (for todos) is enough here. */
export interface AgentLike {
    session?: {
        events?: readonly {
            type: string;
            data?: unknown;
        }[];
        append?(type: string, data: unknown): unknown;
    };
}
/** A goal reference — the revision-checked handle the service mutations need. */
export interface GoalRef {
    id: string;
    revision: number;
}
/** The subset of a GoalView the keeper reads. */
export interface GoalView extends GoalRef {
    objective: string;
    phase: 'active' | 'paused' | 'blocked' | 'complete';
}
/**
 * The native goal service surface the keeper uses. Mirrors @deepseek-ai/dsh-goal:
 * `get` reads the current goal (undefined when none), `create` mints a fresh
 * goal (throws GOAL_ALREADY_EXISTS if a non-complete goal exists), `edit`
 * revises the objective in place, `complete` closes it.
 */
export interface GoalService {
    get(agent: AgentLike): GoalView | undefined;
    create(agent: AgentLike, request: {
        objective: string;
        maxGoalRounds?: number;
    }): GoalView;
    edit(agent: AgentLike, ref: GoalRef, request: {
        objective?: string;
        maxGoalRounds?: number;
    }): GoalView;
    complete(agent: AgentLike, ref: GoalRef): GoalView;
}
/**
 * Set the session objective: create a goal when none is current (or the current
 * one is already complete), otherwise edit the existing goal's objective in
 * place. This replaces the old create-only path that silently no-opped whenever
 * a goal already existed. Returns the resulting view, or undefined on no-op.
 */
export declare function setGoal(goals: GoalService, agent: AgentLike, objective: string): GoalView | undefined;
/**
 * Complete the current goal when one is open. No-ops when there is no goal or it
 * is already complete. Returns the completed view, or undefined on no-op.
 */
export declare function completeGoal(goals: GoalService, agent: AgentLike): GoalView | undefined;
/** Fold the latest `todo/write` event into the current todo list (or empty). */
export declare function currentTodos(agent: AgentLike): TodoItem[];
/**
 * Append keeper tasks to the primary agent's todo list without clobbering it:
 * read the current list, add the new tasks (deduped by content), and write the
 * merged list back as one `todo/write` event. New tasks are `pending`.
 */
export declare function addTasks(agent: AgentLike, tasks: string[]): TodoItem[];
