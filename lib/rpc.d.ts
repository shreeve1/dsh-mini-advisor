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
import type { SessionActivity } from './activity';
import type { Config } from './config';
export declare const RPC_CHANNEL = "/dsh-goal-keeper";
/** One picker option surfaced to the Settings tab. */
export interface PickerProvider {
    provider: string;
    displayName: string;
    models: Array<{
        id: string;
        name: string;
        efforts: Array<{
            id: string;
            name: string;
        }>;
    }>;
}
export interface ConfigStore {
    get(): Config;
    update(patch: Record<string, unknown>): Config;
    /** Per-session activity: one session's when an id is given, else all sessions. */
    status(sessionId?: string): SessionActivity[];
    /** Authenticated providers with their models and per-model reasoning efforts. */
    pickers(): Promise<PickerProvider[]>;
}
interface ConnectionHost {
    get?(name: string): unknown;
}
/** Register the config RPC channel; returns a disposer (no-op if connection absent). */
export declare function registerConfigRpc(ctx: ConnectionHost, store: ConfigStore): () => void;
export {};
