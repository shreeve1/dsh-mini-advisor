import Schema from '@deepseek-ai/schemastery';
export interface Config {
    enabled: boolean;
    provider: string;
    model: string;
    reasoningEffort: string;
    /** Persona/instructions injected into the advisor's system prompt. */
    persona: string;
    /** Skip a review when the rendered transcript delta is shorter than this. */
    minDeltaChars: number;
    /** Also review mid-turn every N steps; 0 reviews only at turn boundaries. */
    reviewEverySteps: number;
    /** Let the keeper create a native session goal directly. */
    createGoals: boolean;
    /** Let the keeper add tasks to the agent's todo checklist directly. */
    createTasks: boolean;
}
export declare const Config: Schema<Config>;
/**
 * Coerce a raw settings snapshot into a valid Config, filling defaults. Running
 * the Schemastery schema (`Config(raw)`) applies defaults and validates; a
 * malformed value throws, which the RPC layer surfaces as a bad-request.
 */
export declare function normalizeConfig(raw: unknown): Config;
