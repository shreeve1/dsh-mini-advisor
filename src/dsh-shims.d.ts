/**
 * Ambient shims for DSH runtime packages, used only for standalone
 * typechecking. At runtime the DSH host resolves the real package;
 * tsdown marks it external so it is never bundled.
 */
declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(input: {
    content: unknown[]
    source?: { kind: 'plugin'; plugin: string }
  }): unknown
}

declare module '*.md' {
  const text: string
  export default text
}
