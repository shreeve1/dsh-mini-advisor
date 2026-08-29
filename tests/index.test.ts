import { describe, expect, it } from 'vitest'
import { ActivityStore } from '../src/activity'
import { renderDelta } from '../src/delta'
import { readAdviceFromBlocks } from '../src/index'

describe('renderDelta', () => {
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'add a login route' }] } },
    { type: 'tool/call', data: { name: 'bash', callId: 'c1', arguments: '{"cmd":"ls"}' } },
    { type: 'tool/result', data: { message: { content: [{ toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } },
    { type: 'turn/end', data: {} },
  ]

  it('renders events past the cursor into one markdown update', () => {
    const { text, nextCursor } = renderDelta(events, 0, 1)
    expect(text).toContain('## Update 1')
    expect(text).toContain('### User')
    expect(text).toContain('### Tool call: bash')
    expect(text).toContain('### Tool result: bash')
    expect(text).toContain('### Assistant')
    expect(nextCursor).toBe(events.length)
  })

  it('renders nothing when the cursor is already at the end', () => {
    const { text, nextCursor } = renderDelta(events, events.length, 2)
    expect(text).toBe('')
    expect(nextCursor).toBe(events.length)
  })

  it('elides repeated chunks of one tool into a counted summary', () => {
    // A poll loop otherwise fills the delta with near-identical chunks, which is
    // both expensive and hides the very pattern most worth advising on.
    const poll = []
    for (let i = 0; i < 20; i++) {
      poll.push({ type: 'tool/call', data: { name: 'peek_subagent', callId: `p${i}`, arguments: '{"childId":"abc"}' } })
    }
    const { text } = renderDelta(poll, 0, 1)
    expect(text).toContain('peek_subagent repeated — 20 chunks total')
    expect(text).toContain('16 further occurrences elided')
    expect(text.match(/### Tool call: peek_subagent/g)).toHaveLength(4)
  })

  it('elides a poll loop even when the calls are not adjacent', () => {
    // The real failure shape, measured from a live session: the agent alternates
    // between two children and narrates between calls, so NO run of identical
    // adjacent calls ever forms. A per-run collapse misses this entirely — 94
    // peeks produced zero adjacent runs longer than 5 — so the budget is per
    // tool across the whole update.
    const interleaved = []
    for (let i = 0; i < 12; i++) {
      interleaved.push({ type: 'tool/call', data: { name: 'peek_subagent', callId: `a${i}` } })
      interleaved.push({ type: 'tool/call', data: { name: 'peek_subagent', callId: `b${i}` } })
      interleaved.push({
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'still waiting' }] } },
      })
    }
    const { text } = renderDelta(interleaved, 0, 1)
    expect(text).toContain('peek_subagent repeated — 24 chunks total')
    // Narration is never elided — it is where the agent's intent shows.
    expect(text.match(/### Assistant/g)).toHaveLength(12)
  })

  it('leaves a small number of chunks fully expanded', () => {
    const few = [
      { type: 'tool/call', data: { name: 'read', callId: 'a', arguments: '{"p":"1"}' } },
      { type: 'tool/call', data: { name: 'read', callId: 'b', arguments: '{"p":"2"}' } },
    ]
    const { text } = renderDelta(few, 0, 1)
    expect(text).not.toContain('elided')
    expect(text.match(/### Tool call: read/g)).toHaveLength(2)
  })

  it('budgets each tool independently', () => {
    // Ten reads must not consume the budget bash chunks need.
    const mixed = []
    for (let i = 0; i < 10; i++) {
      mixed.push({ type: 'tool/call', data: { name: i % 2 === 0 ? 'read' : 'bash', callId: `m${i}` } })
    }
    const { text } = renderDelta(mixed, 0, 1)
    expect(text.match(/### Tool call: read/g)).toHaveLength(4)
    expect(text.match(/### Tool call: bash/g)).toHaveLength(4)
    expect(text.match(/repeated —/g)).toHaveLength(2)
  })

  it('skips the keeper plugin own messages so it never re-reviews itself', () => {
    const own = [
      {
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'note' }], source: { kind: 'plugin', plugin: 'dsh-goal-keeper' } },
      },
    ]
    expect(renderDelta(own, 0, 1).text).toBe('')
  })
})

describe('readAdviceFromBlocks', () => {
  it('extracts a valid advise tool call', () => {
    const blocks = [{ type: 'tool-call', name: 'advise', arguments: '{"severity":"blocker","note":"parameterize the SQL"}' }]
    expect(readAdviceFromBlocks(blocks)).toEqual({ severity: 'blocker', note: 'parameterize the SQL' })
  })

  it('returns undefined when no advise call is present', () => {
    expect(readAdviceFromBlocks([{ type: 'text', text: 'ok' }])).toBeUndefined()
  })

  it('ignores malformed tool arguments instead of throwing', () => {
    const blocks = [{ type: 'tool-call', name: 'advise', arguments: '{not json' }]
    expect(readAdviceFromBlocks(blocks)).toBeUndefined()
  })

  it('defaults severity when omitted', () => {
    const blocks = [{ type: 'tool-call', name: 'advise', arguments: '{"note":"consider tests"}' }]
    expect(readAdviceFromBlocks(blocks)).toEqual({ severity: 'concern', note: 'consider tests' })
  })
})

describe('ActivityStore', () => {
  it('tracks reviews, advice, and a bounded newest-first feed', () => {
    const store = new ActivityStore()
    store.reviewRan('s1')
    store.reviewRan('s1')
    store.adviceIssued('s1', 'concern', 'first')
    store.adviceIssued('s1', 'blocker', 'second')
    const snap = store.snapshot('s1')
    expect(snap.reviews).toBe(2)
    expect(snap.advice).toBe(2)
    expect(snap.advisories[0].note).toBe('second') // newest first
    expect(snap.advisories[1].note).toBe('first')
  })

  it('returns an empty shell for an unknown session', () => {
    const snap = new ActivityStore().snapshot('nope')
    expect(snap).toEqual({ sessionId: 'nope', reviews: 0, advice: 0, goals: 0, tasks: 0, advisories: [], creations: [] })
  })

  it('sets and clears lastError, and drops a session', () => {
    const store = new ActivityStore()
    store.setLastError('s2', 'boom')
    expect(store.snapshot('s2').lastError).toBe('boom')
    store.setLastError('s2', undefined)
    expect(store.snapshot('s2').lastError).toBeUndefined()
    store.reviewRan('s2')
    store.drop('s2')
    expect(store.all()).toHaveLength(0)
  })

  it('caps retained advisories at 50', () => {
    const store = new ActivityStore()
    for (let i = 0; i < 60; i++) store.adviceIssued('s3', 'nit', `n${i}`)
    expect(store.snapshot('s3').advisories).toHaveLength(50)
    expect(store.snapshot('s3').advice).toBe(60) // counter is not capped
  })
})

import { addTasks, currentTodos } from '../src/goal-tasks'
import { readCompleteFromBlocks, readGoalFromBlocks, readTasksFromBlocks } from '../src/index'

describe('goal/task block readers', () => {
  it('reads a set_goal objective', () => {
    const blocks = [{ type: 'tool-call', name: 'set_goal', arguments: '{"objective":"ship the login flow"}' }]
    expect(readGoalFromBlocks(blocks)).toBe('ship the login flow')
  })
  it('returns undefined when no goal call', () => {
    expect(readGoalFromBlocks([{ type: 'text', text: 'ok' }])).toBeUndefined()
  })
  it('reads update_tasks task lines and drops non-strings/blanks', () => {
    const blocks = [{ type: 'tool-call', name: 'update_tasks', arguments: '{"tasks":["a","",2,"b"]}' }]
    expect(readTasksFromBlocks(blocks)).toEqual(['a', 'b'])
  })
  it('detects a complete_goal call', () => {
    const blocks = [{ type: 'tool-call', name: 'complete_goal', arguments: '{}' }]
    expect(readCompleteFromBlocks(blocks)).toBe(true)
  })
  it('returns false when no complete_goal call', () => {
    expect(readCompleteFromBlocks([{ type: 'text', text: 'ok' }])).toBe(false)
  })
})

describe('addTasks merge', () => {
  it('folds the latest todo/write list', () => {
    const agent = { session: { events: [{ type: 'todo/write', data: { todos: [{ content: 'x', status: 'pending' }] } }] } }
    expect(currentTodos(agent as any)).toEqual([{ content: 'x', status: 'pending' }])
  })

  it('appends new tasks without clobbering existing, deduped by content', () => {
    const events: Array<{ type: string; data?: unknown }> = [
      { type: 'todo/write', data: { todos: [{ content: 'keep me', status: 'in_progress' }] } },
    ]
    let written: unknown = null
    const agent = {
      session: {
        events,
        append: (type: string, data: unknown) => {
          written = { type, data }
        },
      },
    }
    const merged = addTasks(agent as any, ['keep me', 'new task'])
    expect(merged).toEqual([
      { content: 'keep me', status: 'in_progress' },
      { content: 'new task', status: 'pending' },
    ])
    expect(written).toEqual({ type: 'todo/write', data: { todos: merged } })
  })

  it('does not write when all tasks already exist', () => {
    const events = [{ type: 'todo/write', data: { todos: [{ content: 'dup', status: 'pending' }] } }]
    let written = false
    const agent = { session: { events, append: () => { written = true } } }
    addTasks(agent as any, ['dup'])
    expect(written).toBe(false)
  })
})
