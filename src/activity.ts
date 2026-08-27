// Per-session advisor activity: a bounded feed of advisories plus review
// counters, kept in memory (process-lifetime) so the sidebar tab can show what
// the advisor has been doing. This is monitor state, not durable session data —
// the advisories themselves are already logged as user/message events.

/** One advisory the advisor issued into a session. */
export interface AdvisoryEntry {
  time: number
  severity: string
  note: string
}

/** One goal or task the advisor created (kind distinguishes them). */
export interface CreationEntry {
  time: number
  kind: 'goal' | 'task'
  text: string
}

/** Live status + recent advisories/creations for one session. */
export interface SessionActivity {
  sessionId: string
  reviews: number
  advice: number
  goals: number
  tasks: number
  lastError?: string
  advisories: AdvisoryEntry[]
  creations: CreationEntry[]
}

/** Caps on retained entries per session so a long session cannot grow unbounded. */
const MAX_ADVISORIES = 50
const MAX_CREATIONS = 50

export class ActivityStore {
  private sessions = new Map<string, SessionActivity>()

  private ensure(sessionId: string): SessionActivity {
    let entry = this.sessions.get(sessionId)
    if (!entry) {
      entry = { sessionId, reviews: 0, advice: 0, goals: 0, tasks: 0, advisories: [], creations: [] }
      this.sessions.set(sessionId, entry)
    }
    return entry
  }

  /** Record one goal the advisor created (newest first, bounded). */
  goalCreated(sessionId: string, objective: string): void {
    const entry = this.ensure(sessionId)
    entry.goals += 1
    entry.creations.unshift({ time: Date.now(), kind: 'goal', text: objective })
    if (entry.creations.length > MAX_CREATIONS) entry.creations.length = MAX_CREATIONS
  }

  /** Record one task the advisor added (newest first, bounded). */
  taskCreated(sessionId: string, content: string): void {
    const entry = this.ensure(sessionId)
    entry.tasks += 1
    entry.creations.unshift({ time: Date.now(), kind: 'task', text: content })
    if (entry.creations.length > MAX_CREATIONS) entry.creations.length = MAX_CREATIONS
  }

  /** Record that a review ran (whether or not it produced advice). */
  reviewRan(sessionId: string): void {
    this.ensure(sessionId).reviews += 1
  }

  /** Record one issued advisory (newest first, bounded). */
  adviceIssued(sessionId: string, severity: string, note: string): void {
    const entry = this.ensure(sessionId)
    entry.advice += 1
    entry.advisories.unshift({ time: Date.now(), severity, note })
    if (entry.advisories.length > MAX_ADVISORIES) entry.advisories.length = MAX_ADVISORIES
  }

  /** Record the most recent review error (or clear it on success). */
  setLastError(sessionId: string, error: string | undefined): void {
    this.ensure(sessionId).lastError = error
  }

  /** One session's activity, or an empty shell when nothing has happened yet. */
  snapshot(sessionId: string): SessionActivity {
    return (
      this.sessions.get(sessionId) ?? {
        sessionId,
        reviews: 0,
        advice: 0,
        goals: 0,
        tasks: 0,
        advisories: [],
        creations: [],
      }
    )
  }

  /** Every session with recorded activity. */
  all(): SessionActivity[] {
    return [...this.sessions.values()]
  }

  drop(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}
