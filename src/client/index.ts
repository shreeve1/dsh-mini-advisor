/**
 * dsh-goal-keeper browser half: registers the "Goal Keeper" settings section
 * and — when dsh-better-sidebar is installed — a "Goal Keeper" tab in the
 * sidebar workbench (optional runtime probe; see ./sidebar.tsx).
 * Loaded through package.json `dsh.client` (web platform) and wrapped for the
 * DSH browser ModuleLoader by build.mjs.
 */
import { createSettingsSection } from './SettingsSection'
import { mountSidebarTab } from './sidebar'

export const name = 'dsh-goal-keeper'

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
            id: 'dsh-goal-keeper',
            order: 50,
            label: () => 'Goal Keeper',
            inject: () => ({}),
          },
          createSettingsSection(ctx),
        )
      }),
    'dsh-goal-keeper: settings section',
  )

  // Optional dsh-better-sidebar tab (runtime probe, never a hard dep).
  mountSidebarTab(ctx)
}
