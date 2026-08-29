// Transcript delta rendering: turn the durable session log past a cursor into
// the incremental markdown update the advisor model reviews. Source of truth is
// the session's durable event list (rebuilt via `agent.session`), so the
// renderer walks events past an index cursor and never re-reads history twice.

export const PLUGIN_NAME = 'dsh-goal-keeper'

/** Bound for one rendered field so a huge tool result cannot flood the advisor. */
const TEXT_PREVIEW_LIMIT = 2000
const ARGS_PREVIEW_LIMIT = 400

export interface SessionEvent {
  type: string
  data?: unknown
}

export interface RenderedDelta {
  /** Markdown update body (empty string when nothing renderable happened). */
  text: string
  /** Event index to continue from (exclusive). */
  nextCursor: number
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`
}

/** Extract plain text from a message content block list. */
function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: string; text?: unknown }
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
  }
  return parts.join('\n')
}

function isOwnPluginMessage(data: unknown): boolean {
  const source = (data as { source?: { kind?: string; plugin?: string } } | undefined)?.source
  return source?.kind === 'plugin' && source?.plugin === PLUGIN_NAME
}

/** A rendered chunk plus the tool it belongs to, so identical runs can collapse. */
interface Section {
  text: string
  /** Tool name when this chunk is a tool call/result; undefined for prose. */
  tool?: string
}

/** Chunks kept per tool before the rest are elided into one summary line. */
const COLLAPSE_KEEP_PER_TOOL = 4

/**
 * Elide repetitive tool chatter, keeping the first few chunks per tool.
 *
 * A poll loop otherwise fills the delta with near-identical chunks: expensive to
 * send, and the repetition hides the very pattern worth advising on. Collapsing
 * *adjacent* runs is not enough — measured against a real 56-step poll loop, 94
 * `peek_subagent` calls produced ZERO adjacent runs longer than 5, because the
 * agent alternated between two children and narrated between calls. So the budget
 * is per tool across the whole delta, not per consecutive run: the first few
 * chunks of each tool survive, the rest become one counted summary. Prose is
 * never elided, and every other tool keeps its own independent budget.
 */
function collapseRuns(sections: readonly Section[]): string[] {
  const total = new Map<string, number>()
  for (const section of sections) {
    if (section.tool !== undefined) total.set(section.tool, (total.get(section.tool) ?? 0) + 1)
  }

  const out: string[] = []
  const seen = new Map<string, number>()
  for (const section of sections) {
    const tool = section.tool
    if (tool === undefined) {
      out.push(section.text)
      continue
    }
    const count = (seen.get(tool) ?? 0) + 1
    seen.set(tool, count)
    const totalForTool = total.get(tool) ?? 0
    if (count <= COLLAPSE_KEEP_PER_TOOL) {
      out.push(section.text)
    } else if (count === COLLAPSE_KEEP_PER_TOOL + 1 && totalForTool > COLLAPSE_KEEP_PER_TOOL) {
      out.push(
        `### … ${tool} repeated — ${totalForTool} chunks total in this update, ${totalForTool - COLLAPSE_KEEP_PER_TOOL} further occurrences elided …`,
      )
    }
  }
  return out
}

/** Render session events in `[cursor, events.length)` as one advisor update. */
export function renderDelta(events: readonly SessionEvent[], cursor: number, updateIndex: number): RenderedDelta {
  const sections: Section[] = []
  const toolNames = new Map<string, string>()
  let index = Math.max(0, cursor)

  for (; index < events.length; index++) {
    const event = events[index]
    if (!event || typeof event.type !== 'string') continue
    const data = (event.data ?? event) as Record<string, unknown>

    switch (event.type) {
      case 'user/message': {
        if (isOwnPluginMessage(data)) break // never re-review our own advisories
        const text = blocksToText(data.content)
        if (text.trim()) sections.push({ text: `### User\n${truncate(text, TEXT_PREVIEW_LIMIT)}` })
        break
      }
      case 'assistant/message': {
        const message = data.message as { content?: unknown } | undefined
        const text = blocksToText(message?.content)
        if (text.trim()) sections.push({ text: `### Assistant\n${truncate(text, TEXT_PREVIEW_LIMIT)}` })
        break
      }
      case 'tool/call': {
        const name = typeof data.name === 'string' ? data.name : 'tool'
        if (typeof data.callId === 'string') toolNames.set(data.callId, name)
        let argsPreview = ''
        const args = data.arguments
        if (typeof args === 'string' && args.trim() && args.trim() !== '{}') {
          argsPreview = `\n\`\`\`json\n${truncate(args, ARGS_PREVIEW_LIMIT)}\n\`\`\``
        }
        sections.push({ text: `### Tool call: ${name}${argsPreview}`, tool: name })
        break
      }
      case 'tool/result': {
        const message = data.message as { content?: Array<{ toolCallId?: string; content?: unknown }> } | undefined
        const callId = typeof message?.content?.[0]?.toolCallId === 'string' ? message.content[0].toolCallId : undefined
        const name = (callId && toolNames.get(callId)) || 'tool'
        const text = blocksToText(message?.content?.[0]?.content ?? message?.content)
        const isError = data.error !== undefined
        const status = isError ? ' (error)' : ''
        const body = text.trim() ? truncate(text, TEXT_PREVIEW_LIMIT) : '(no output)'
        sections.push({ text: `### Tool result: ${name}${status}\n${body}`, tool: name })
        break
      }
      default:
        break // turn/step boundaries, chunks, headers: structure only
    }
  }

  if (sections.length === 0) return { text: '', nextCursor: index }
  return { text: `## Update ${updateIndex}\n\n${collapseRuns(sections).join('\n\n')}`, nextCursor: index }
}
