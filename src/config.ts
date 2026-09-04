import Schema from '@deepseek-ai/schemastery'

// Tunable configuration must be a Schemastery Schema, never a plain object:
// the harness validates it at load time and fails loud on invalid values, and
// every key can be changed from cordis.yml without editing code (guide §3.6).
export interface Config {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
  /** Persona/instructions injected into the advisor's system prompt. */
  persona: string
  /** Skip a review when the rendered transcript delta is shorter than this. */
  minDeltaChars: number
  /** Also review mid-turn every N steps; 0 reviews only at turn boundaries. */
  reviewEverySteps: number
  /** Let the keeper create a native session goal directly. */
  createGoals: boolean
  /** Let the keeper add tasks to the agent's todo checklist directly. */
  createTasks: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('Whether the advisor reviews turns.'),
  provider: Schema.string().default('deepseek-official').description('LLM provider route for the advisor model.'),
  model: Schema.string().default('deepseek-v4-flash').description('Advisor model id from the DSH model list.'),
  reasoningEffort: Schema.string().default('').description('Optional reasoning effort passed to the advisor model.'),
  persona: Schema.string()
    .role('textarea')
    .default(
      'You are a rigorous goal-keeper watching a coding agent. Speak up only when something matters: a bug, a security hole, a wrong turn, or a premature "done". Keep advice concrete and short.',
    )
    .description("The advisor's persona and reviewing instructions."),
  minDeltaChars: Schema.number()
    .default(40)
    .description('Skip a review when the rendered transcript delta is shorter than this many characters.'),
  reviewEverySteps: Schema.number()
    .min(0)
    .default(12)
    .description(
      'Also review mid-turn every N agent steps, so advice can land while a long turn is still running. 0 = review only at turn boundaries.',
    ),
  createGoals: Schema.boolean()
    .default(true)
    .description('Let the keeper set, update, and complete the session goal directly (native goal service).'),
  createTasks: Schema.boolean()
    .default(true)
    .description("Let the keeper add tasks to the agent's todo checklist directly."),
})

/**
 * Coerce a raw settings snapshot into a valid Config, filling defaults. Running
 * the Schemastery schema (`Config(raw)`) applies defaults and validates; a
 * malformed value throws, which the RPC layer surfaces as a bad-request.
 */
export function normalizeConfig(raw: unknown): Config {
  // Schemastery schemas are callable validators that fill defaults from any
  // partial/unknown input at runtime; the parameter type is stricter than the
  // real contract, so pass through an unknown-accepting call signature.
  //
  // `??` only guards null/undefined; any other non-object falsy value (notably
  // `0`, but also `''` and `false`) would pass straight into the validator and
  // throw "expected object but got X". Guard on actual object-ness so runtime
  // settings snapshots that resolve to a primitive fall back to defaults.
  const safe = typeof raw === 'object' && raw !== null ? raw : {}
  return (Config as unknown as (input: unknown) => Config)(safe)
}
