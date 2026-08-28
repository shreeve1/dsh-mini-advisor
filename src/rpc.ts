/**
 * The `/dsh-goal-keeper` RPC channel: the transport the Settings tab and the
 * sidebar tab use. Endpoints:
 *   get     {}            -> the current normalized config
 *   update  {patch}       -> merge a partial config; returns the normalized result
 *   status  {sessionId?}  -> per-session keeper activity (one session or all)
 *   pickers {}            -> authenticated providers, their models, and per-model
 *                            reasoning efforts, ready to render locked selects
 *
 * Contract notes (dsh-client-connection):
 *  - `rpc.handle` REQUIRES the options argument; `authority` is read unguarded.
 *  - `authority: 'trusted-host'` accepts loopback plus the deployment's trusted
 *    hosts, so the Settings tab works from remote GUIs too ('loopback' 403s them).
 *  - Config writes ride THIS channel, not `ctx.settingsScope` directly, because
 *    settingsScope persistence is loopback-only by DSH policy — a remote browser
 *    gets a process-local scope whose snapshot is permanently `unavailable`.
 *  - Handlers return an RpcResult (`{ok:true,value}` / `{ok:false,error}`) and
 *    never throw: a thrown error would become an opaque HTTP 500.
 */
import type { SessionActivity } from './activity'
import type { Config } from './config'
import { PLUGIN_NAME } from './delta'

export const RPC_CHANNEL = `/${PLUGIN_NAME}`

type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

/** One picker option surfaced to the Settings tab. */
export interface PickerProvider {
  provider: string
  displayName: string
  models: Array<{
    id: string
    name: string
    efforts: Array<{ id: string; name: string }>
  }>
}

export interface ConfigStore {
  get(): Config
  update(patch: Record<string, unknown>): Config
  /** Per-session activity: one session's when an id is given, else all sessions. */
  status(sessionId?: string): SessionActivity[]
  /** Authenticated providers with their models and per-model reasoning efforts. */
  pickers(): Promise<PickerProvider[]>
}

interface ConnectionService {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>,
      options: { authority: 'trusted-host' | 'loopback' },
    ): () => void
  }
}

interface ConnectionHost {
  // Sanctioned OPTIONAL service lookup: `ctx.get(name)` returns undefined when
  // the service is absent, whereas reading `ctx.connection` without listing it
  // in `inject` throws "cannot get property without inject". `connection` is
  // optional (absent in headless profiles), so it must be probed this way.
  get?(name: string): unknown
}

function asConnection(value: unknown): ConnectionService | undefined {
  const rpc = (value as { rpc?: { handle?: unknown } } | undefined)?.rpc
  return typeof rpc?.handle === 'function' ? (value as ConnectionService) : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('payload must be an object')
  return value as Record<string, unknown>
}

/** Register the config RPC channel; returns a disposer (no-op if connection absent). */
export function registerConfigRpc(ctx: ConnectionHost, store: ConfigStore): () => void {
  const connection = typeof ctx.get === 'function' ? asConnection(ctx.get('connection')) : undefined
  if (!connection) return () => {}
  return connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint, rawPayload): Promise<RpcResult> => {
      try {
        const payload = rawPayload == null ? {} : asRecord(rawPayload)
        switch (endpoint) {
          case 'get':
            return { ok: true, value: { config: store.get() } }
          case 'status': {
            const sessionId = typeof payload.sessionId === 'string' && payload.sessionId ? payload.sessionId : undefined
            return { ok: true, value: { sessions: store.status(sessionId) } }
          }
          case 'update': {
            let patch: Record<string, unknown>
            try {
              patch = asRecord(payload.patch)
            } catch (error) {
              return { ok: false, error: { code: 'bad-request', message: String((error as Error).message) } }
            }
            try {
              return { ok: true, value: { config: store.update(patch) } }
            } catch (error) {
              // Schema validation rejection: user input error, not a 500.
              return { ok: false, error: { code: 'bad-request', message: String((error as Error).message) } }
            }
          }
          case 'pickers':
            return { ok: true, value: { providers: await store.pickers() } }
          default:
            return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}` } }
        }
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: String((error as Error).message) } }
      }
    },
    { authority: 'trusted-host' },
  )
}
