/** One advisory the advisor issued into a session. */
export interface AdvisoryEntry {
    time: number;
    severity: string;
    note: string;
}
/** One goal or task the advisor created (kind distinguishes them). */
export interface CreationEntry {
    time: number;
    kind: 'goal' | 'task';
    text: string;
}
/** Live status + recent advisories/creations for one session. */
export interface SessionActivity {
    sessionId: string;
    reviews: number;
    advice: number;
    goals: number;
    tasks: number;
    lastError?: string;
    advisories: AdvisoryEntry[];
    creations: CreationEntry[];
}
export declare class ActivityStore {
    private sessions;
    private ensure;
    /** Record one goal the advisor created (newest first, bounded). */
    goalCreated(sessionId: string, objective: string): void;
    /** Record one task the advisor added (newest first, bounded). */
    taskCreated(sessionId: string, content: string): void;
    /** Record that a review ran (whether or not it produced advice). */
    reviewRan(sessionId: string): void;
    /** Record one issued advisory (newest first, bounded). */
    adviceIssued(sessionId: string, severity: string, note: string): void;
    /** Record the most recent review error (or clear it on success). */
    setLastError(sessionId: string, error: string | undefined): void;
    /** One session's activity, or an empty shell when nothing has happened yet. */
    snapshot(sessionId: string): SessionActivity;
    /** Every session with recorded activity. */
    all(): SessionActivity[];
    drop(sessionId: string): void;
}
