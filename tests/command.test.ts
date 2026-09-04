import { describe, expect, it } from 'vitest'
import { apply } from '../src/index'

// Guards the per-session `/keeper` switch. The input-hint assertion is the
// regression guard for the web slash-bar dispatch bug: a command without an
// unstructured-input hint is treated as argument-less by capable clients, so
// `/keeper on` is sent to the model as a prompt instead of dispatching.
// apply() is driven with a fake context that records the command registration
// and makes every service call inert, so the test stays keyless.
function captureCommandDefinition(overrides: Record<string, unknown> = {}) {
  const captured: { def?: any } = {}
  const noop = () => {}
  const fakeCtx = {
    agents: { get: () => undefined },
    llm: {
      stream: () => ({ async *[Symbol.asyncIterator]() {} }),
      listProviders: () => [],
      listConfigurableProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
    },
    settings: {
      register: () => ({ get: () => overrides, watch: () => noop, update: () => overrides }),
      get: () => undefined,
    },
    goals: {} as never,
    commands: {
      register: (def: any) => {
        captured.def = def
        return noop
      },
    },
    get: () => undefined,
    on: () => noop,
    // Run effect factories eagerly so the command registration actually happens.
    effect: (factory: () => unknown) => {
      factory()
    },
  }
  apply(fakeCtx as never)
  return captured.def
}

describe('dsh-goal-keeper /keeper command', () => {
  const session = { id: 'session-1' }
  const agent = { session } as never

  it('registers the keeper command', () => {
    const def = captureCommandDefinition()
    expect(def?.name).toBe('keeper')
    expect(typeof def?.handler).toBe('function')
  })

  it('declares an input hint so the web client accepts on|off|status arguments', () => {
    const def = captureCommandDefinition()
    expect(def?.input).toBeDefined()
    expect(typeof def?.input?.hint).toBe('string')
    expect(def?.input?.hint.trim().length).toBeGreaterThan(0)
  })

  it('reports the settings default when the session has no override', () => {
    const def = captureCommandDefinition({ enabled: true })
    const res = def.handler({ agent, rawInput: 'status' })
    expect(res.kind).toBe('success')
    expect(res.text).toContain('goal keeper: on')
    expect(res.text).toContain('following the global default')
  })

  it('turns the keeper off for this session and reports the override', () => {
    const def = captureCommandDefinition({ enabled: true })
    expect(def.handler({ agent, rawInput: 'off' }).kind).toBe('success')
    const res = def.handler({ agent, rawInput: 'status' })
    expect(res.text).toContain('goal keeper: off')
    expect(res.text).toContain('session override')
    expect(res.text).toContain('global default: on')
  })

  it('turns the keeper on for a session whose settings default is off', () => {
    const def = captureCommandDefinition({ enabled: false })
    expect(def.handler({ agent, rawInput: 'status' }).text).toContain('goal keeper: off')
    def.handler({ agent, rawInput: 'on' })
    expect(def.handler({ agent, rawInput: 'status' }).text).toContain('goal keeper: on')
  })

  it('keeps overrides independent per session', () => {
    const def = captureCommandDefinition({ enabled: true })
    def.handler({ agent, rawInput: 'off' })
    const other = { session: { id: 'session-2' } } as never
    expect(def.handler({ agent: other, rawInput: 'status' }).text).toContain('goal keeper: on')
    expect(def.handler({ agent, rawInput: 'status' }).text).toContain('goal keeper: off')
  })

  it('accepts bare invocation and mixed case as status/on/off', () => {
    const def = captureCommandDefinition({ enabled: true })
    expect(def.handler({ agent, rawInput: '' }).text).toContain('goal keeper:')
    expect(def.handler({ agent, rawInput: '  OFF  ' }).kind).toBe('success')
    expect(def.handler({ agent, rawInput: 'status' }).text).toContain('goal keeper: off')
  })

  it('rejects an unknown argument', () => {
    const def = captureCommandDefinition()
    expect(def.handler({ agent, rawInput: 'maybe' }).kind).toBe('error')
  })

  it('errors when the agent carries no session', () => {
    const def = captureCommandDefinition()
    const res = def.handler({ agent: {} as never, rawInput: 'on' })
    expect(res.kind).toBe('error')
  })
})
