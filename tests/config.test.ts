import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config'

describe('normalizeConfig', () => {
  it('returns full defaults for undefined input', () => {
    expect(normalizeConfig(undefined)).toEqual({
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: '',
      persona: expect.any(String),
      minDeltaChars: 40,
      reviewEverySteps: 12,
      createGoals: true,
      createTasks: true,
    })
  })

  it('returns full defaults for null input', () => {
    expect(normalizeConfig(null)).toEqual({
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: '',
      persona: expect.any(String),
      minDeltaChars: 40,
      reviewEverySteps: 12,
      createGoals: true,
      createTasks: true,
    })
  })

  it('returns full defaults for 0 (regression: ?? did not guard this)', () => {
    // Before the fix this hit the Schemastery validator with `0` and threw
    // "expected object but got 0" — observed from the host apply() path.
    expect(normalizeConfig(0)).toEqual({
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: '',
      persona: expect.any(String),
      minDeltaChars: 40,
      reviewEverySteps: 12,
      createGoals: true,
      createTasks: true,
    })
  })

  it('returns full defaults for empty string', () => {
    expect(normalizeConfig('')).toEqual({
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: '',
      persona: expect.any(String),
      minDeltaChars: 40,
      reviewEverySteps: 12,
      createGoals: true,
      createTasks: true,
    })
  })

  it('returns full defaults for false', () => {
    expect(normalizeConfig(false)).toEqual({
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: '',
      persona: expect.any(String),
      minDeltaChars: 40,
      reviewEverySteps: 12,
      createGoals: true,
      createTasks: true,
    })
  })

  it('passes a partial object through and fills remaining defaults', () => {
    const out = normalizeConfig({ model: 'x' })
    expect(out.model).toBe('x')
    expect(out.enabled).toBe(true)
    expect(out.provider).toBe('deepseek-official')
    expect(out.minDeltaChars).toBe(40)
    expect(out.reviewEverySteps).toBe(12)
    expect(out.createGoals).toBe(true)
    expect(out.createTasks).toBe(true)
  })
})
