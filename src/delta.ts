// Transcript delta rendering: turn the durable session log past a cursor into
// the incremental markdown update the advisor model reviews. Source of truth is
// the session's durable event list (rebuilt via `agent.session`), so the
// renderer walks events past an index cursor and never re-reads history twice.

export const PLUGIN_NAME = 'dsh-mini-advisor'

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

/** Render session events in `[cursor, events.length)` as one advisor update. */
export function renderDelta(events: readonly SessionEvent[], cursor: number, updateIndex: number): RenderedDelta {
  const sections: string[] = []
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
        if (text.trim()) sections.push(`### User\n${truncate(text, TEXT_PREVIEW_LIMIT)}`)
        break
      }
      case 'assistant/message': {
        const message = data.message as { content?: unknown } | undefined
        const text = blocksToText(message?.content)
        if (text.trim()) sections.push(`### Assistant\n${truncate(text, TEXT_PREVIEW_LIMIT)}`)
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
        sections.push(`### Tool call: ${name}${argsPreview}`)
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
        sections.push(`### Tool result: ${name}${status}\n${body}`)
        break
      }
      default:
        break // turn/step boundaries, chunks, headers: structure only
    }
  }

  if (sections.length === 0) return { text: '', nextCursor: index }
  return { text: `## Update ${updateIndex}\n\n${sections.join('\n\n')}`, nextCursor: index }
}
