export declare const PLUGIN_NAME = "dsh-goal-keeper";
export interface SessionEvent {
    type: string;
    data?: unknown;
}
export interface RenderedDelta {
    /** Markdown update body (empty string when nothing renderable happened). */
    text: string;
    /** Event index to continue from (exclusive). */
    nextCursor: number;
}
/** Render session events in `[cursor, events.length)` as one advisor update. */
export declare function renderDelta(events: readonly SessionEvent[], cursor: number, updateIndex: number): RenderedDelta;
