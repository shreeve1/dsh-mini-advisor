/**
 * dsh-mini-advisor browser half: registers the "Mini Advisor" settings section
 * and — when dsh-better-sidebar is installed — a "Mini Advisor" tab in the
 * sidebar workbench (optional runtime probe; see ./sidebar.tsx).
 * Loaded through package.json `dsh.client` (web platform) and wrapped for the
 * DSH browser ModuleLoader by build.mjs.
 */
import { createSettingsSection } from './SettingsSection'
import { mountSidebarTab } from './sidebar'

export const name = 'dsh-mini-advisor'

// Cordis SERVICE names this module consumes (NOT package names — those go in
// package.json `dsh.client.inject`). The browser fiber waits until each is
// provided in the client root context:
//   slots      ← dsh-client-runtime (SlotRegistry)
//   connection ← dsh-client-connection (the RPC transport this panel reads/writes)
export const inject = ['slots', 'connection']

interface ClientCtx {
  slots: {
    inject(name: string, gen: () => Generator<unknown>): unknown
    register(descriptor: Record<string, unknown>, component: unknown): unknown
  }
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
  effect(factory: () => unknown, label?: string): void
  logger?: { info?(...args: unknown[]): void }
  // Optional-service lookup for `betterSidebar` (see sidebar.tsx).
  get?(name: string): unknown
}

export function apply(ctx: ClientCtx): void {
  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-mini-advisor',
            order: 50,
            label: () => 'Mini Advisor',
            inject: () => ({}),
          },
          createSettingsSection(ctx),
        )
      }),
    'dsh-mini-advisor: settings section',
  )

  // Optional dsh-better-sidebar tab (runtime probe, never a hard dep).
  mountSidebarTab(ctx)
}
