/**
 * Optional dsh-better-sidebar integration: registers a "Goal Keeper" tab in
 * the sidebar workbench when (and only when) dsh-better-sidebar is installed
 * and active. Shows this session's keeper status plus the feed of advisories
 * it has issued, with a tab-strip badge = advice count.
 *
 * Detection contract (never a hard dependency):
 *  - `betterSidebar` is NOT in this module's `inject` list — a name there
 *    strands the browser fiber forever when the service never appears. We probe
 *    at runtime via `ctx.get('betterSidebar')`, the sanctioned optional lookup.
 *  - Probe order: try in apply(); if not up yet, retry once a second up to 15
 *    times, then give up silently. Absent/disabled sidebar ⇒ zero UI trace.
 *  - Registration is wrapped in ctx.effect so HMR/disable disposes it.
 *
 * Data: the `/dsh-goal-keeper` `status` RPC, polled at 2s while registered.
 * A shared module-level cache feeds both the tab component and the synchronous
 * tab-strip badge, scoped to the session better-sidebar passes each tab.
 */
import * as React from 'react'
import { RPC_CHANNEL } from '../rpc'

const { useEffect, useState } = React

const TAB_ID = 'goal-keeper:advisories'
const POLL_MS = 2000
const PROBE_INTERVAL_MS = 1000
const PROBE_MAX_ATTEMPTS = 15

interface AdvisoryEntry {
  time: number
  severity: string
  note: string
}
interface CreationEntry {
  time: number
  kind: 'goal' | 'task'
  text: string
}
interface SessionActivity {
  sessionId: string
  reviews: number
  advice: number
  goals: number
  tasks: number
  lastError?: string
  advisories: AdvisoryEntry[]
  creations: CreationEntry[]
}

interface ConnectionLike {
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
}

type RpcResult = { ok?: boolean; value?: unknown; error?: { message?: string } }

function unwrap<T>(response: unknown): T {
  const outer = (response ?? {}) as { result?: unknown } & RpcResult
  const result = (outer.result && typeof outer.result === 'object' ? outer.result : outer) as RpcResult
  if (result.ok === false) throw new Error(result.error?.message ?? 'rpc error')
  return ('value' in result ? result.value : result) as T
}

/* ------------------------- shared store (badge + tab) ------------------------ */

let cache = new Map<string, SessionActivity>()
let connectionRef: ConnectionLike | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let refCount = 0
let scopeWanted: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* one broken subscriber must not stop the others */
    }
  }
}

function pollOnce(): void {
  const connection = connectionRef
  if (!connection) return
  connection.rpc
    .call(RPC_CHANNEL, 'status', scopeWanted ? { sessionId: scopeWanted } : {})
    .then((result) => {
      const { sessions } = unwrap<{ sessions: SessionActivity[] }>(result)
      const next = new Map<string, SessionActivity>()
      for (const session of sessions ?? []) next.set(session.sessionId, session)
      cache = next
      notify()
    })
    .catch(() => {
      /* keep the last good cache; the settings panel surfaces hard errors */
    })
}

function setScope(sessionId: string | null): void {
  scopeWanted = sessionId
  if (refCount > 0) pollOnce()
}

function acquire(connection: ConnectionLike): () => void {
  connectionRef = connection
  refCount += 1
  if (refCount === 1) {
    pollOnce()
    pollTimer = setInterval(pollOnce, POLL_MS)
  }
  return () => {
    refCount = Math.max(0, refCount - 1)
    if (refCount === 0 && pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

function useCache(): Map<string, SessionActivity> {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = (): void => setTick((tick) => tick + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return cache
}

/* --------------------------------- styles ----------------------------------- */

const SEVERITY_COLORS: Record<string, string> = {
  blocker: '#dc5050',
  concern: '#e08a3c',
  nit: '#7da7d9',
}

const CREATION_COLORS: Record<'goal' | 'task', string> = {
  goal: '#9a7fd1',
  task: '#4caf7d',
}

const panel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, fontSize: 13, height: '100%', overflowY: 'auto' }
const card: React.CSSProperties = { border: '1px solid var(--dsh-border, rgba(128,128,128,0.25))', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }
const hint: React.CSSProperties = { opacity: 0.6, fontSize: 12 }
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '1px 8px', border: '1px solid var(--dsh-border, rgba(128,128,128,0.25))', fontSize: 11 }

function formatTime(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/* ------------------------------ tab component ------------------------------- */

function AdvisoriesTab(props: { scopedSessionId?: string }): React.ReactElement {
  const scoped = props.scopedSessionId
  useEffect(() => {
    setScope(scoped ?? null)
    return () => setScope(null)
  }, [scoped])

  const cacheMap = useCache()
  const session = scoped ? cacheMap.get(scoped) : undefined

  return (
    <div style={panel}>
      <div style={card}>
        <strong>Goal Keeper</strong>
        {session ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={chip}>{session.reviews} reviews</span>
            <span style={chip}>{session.advice} advice</span>
            {session.goals > 0 && <span style={{ ...chip, borderColor: CREATION_COLORS.goal, color: CREATION_COLORS.goal }}>{session.goals} goals</span>}
            {session.tasks > 0 && <span style={{ ...chip, borderColor: CREATION_COLORS.task, color: CREATION_COLORS.task }}>{session.tasks} tasks</span>}
            {session.lastError && (
              <span style={{ ...hint, color: '#dc7070' }} title={session.lastError}>
                ⚠ {session.lastError.length > 80 ? `${session.lastError.slice(0, 80)}…` : session.lastError}
              </span>
            )}
          </div>
        ) : (
          <span style={hint}>No keeper activity for this session yet. Advice appears here after the next turn.</span>
        )}
      </div>

      {session && session.creations.length > 0 && (
        <div style={card}>
          <strong>Created</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {session.creations.map((creation, index) => (
              <div key={`${creation.time}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...chip, borderColor: CREATION_COLORS[creation.kind], color: CREATION_COLORS[creation.kind] }}>
                  {creation.kind}
                </span>
                <span style={{ ...hint, fontVariantNumeric: 'tabular-nums' }}>{formatTime(creation.time)}</span>
                <span>{creation.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <strong>Advisories</strong>
        {!session || session.advisories.length === 0 ? (
          <span style={hint}>No advisories issued yet.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {session.advisories.map((advisory, index) => (
              <div key={`${advisory.time}-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...chip, borderColor: SEVERITY_COLORS[advisory.severity], color: SEVERITY_COLORS[advisory.severity] }}>
                    {advisory.severity}
                  </span>
                  <span style={{ ...hint, fontVariantNumeric: 'tabular-nums' }}>{formatTime(advisory.time)}</span>
                </div>
                <span>{advisory.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AdvisorIcon({ size }: { size: number }): React.ReactElement {
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    React.createElement('path', { d: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z' }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
  )
}

/**
 * Synchronous, cheap (runs on every sidebar render): reads the poll cache and
 * counts advisories for the scoped session; null hides the badge.
 */
function badge(...args: unknown[]): string | number | null {
  const scope = args[1] as { sessionId?: string } | undefined
  if (!scope?.sessionId) return null
  const session = cache.get(scope.sessionId)
  if (!session || session.advice === 0) return null
  if (session.lastError) return '!'
  return session.advice
}

/* -------------------------------- registration ------------------------------- */

interface BetterSidebarLike {
  registerTab(descriptor: {
    id: string
    title: string | (() => string)
    icon?: unknown
    order?: number
    single?: boolean
    badge?: (...args: unknown[]) => string | number | null | undefined
    component: (props: unknown) => React.ReactNode
  }): () => void
}

function looksLikeBetterSidebar(value: unknown): value is BetterSidebarLike {
  return typeof value === 'object' && value !== null && typeof (value as BetterSidebarLike).registerTab === 'function'
}

interface SidebarHost {
  connection?: ConnectionLike
  effect(factory: () => unknown, label?: string): void
  logger?: { info?(...args: unknown[]): void }
  get?(name: string): unknown
}

/** Probe-and-register the sidebar tab. Safe to call once from apply(). */
export function mountSidebarTab(ctx: SidebarHost): void {
  ctx.effect(() => {
    let disposed = false
    let attempts = 0
    let releasePoll: (() => void) | null = null
    let unregister: (() => void) | null = null
    let probeTimer: ReturnType<typeof setInterval> | null = null

    const tryRegister = (): boolean => {
      if (disposed) return true
      let service: unknown
      try {
        service = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : undefined
      } catch {
        return false
      }
      if (!looksLikeBetterSidebar(service)) return false
      try {
        unregister = service.registerTab({
          id: TAB_ID,
          title: () => 'Goal Keeper',
          icon: (size: number) => React.createElement(AdvisorIcon, { size }),
          order: 60,
          single: true,
          badge,
          component: (scopeProps: unknown) =>
            React.createElement(AdvisoriesTab, {
              scopedSessionId: (scopeProps as { scope?: { sessionId?: string } } | undefined)?.scope?.sessionId,
            }),
        })
        if (ctx.connection) releasePoll = acquire(ctx.connection)
        ctx.logger?.info?.('dsh-goal-keeper: registered Goal Keeper tab in dsh-better-sidebar')
      } catch (error) {
        ctx.logger?.info?.(`dsh-goal-keeper: better-sidebar registration skipped (${String((error as Error)?.message ?? error)})`)
        return true // service exists but rejected us; stop probing
      }
      return true
    }

    if (!tryRegister()) {
      probeTimer = setInterval(() => {
        attempts += 1
        if (tryRegister() || attempts >= PROBE_MAX_ATTEMPTS) {
          if (probeTimer !== null) {
            clearInterval(probeTimer)
            probeTimer = null
          }
        }
      }, PROBE_INTERVAL_MS)
    }

    return () => {
      disposed = true
      if (probeTimer !== null) clearInterval(probeTimer)
      if (releasePoll) releasePoll()
      if (unregister) {
        try {
          unregister()
        } catch {
          /* disposal is best-effort */
        }
      }
    }
  }, 'dsh-goal-keeper: better-sidebar tab')
}
