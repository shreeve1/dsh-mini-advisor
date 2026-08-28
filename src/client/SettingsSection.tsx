/**
 * The "Goal Keeper" settings section: a small form over this plugin's config,
 * backed by the `/dsh-goal-keeper` RPC channel.
 *
 * Reads AND writes ride the plugin's own RPC channel instead of
 * `ctx.settingsScope`: DSH keeps settingsScope persistence loopback-only
 * (remote browsers get a process-local scope whose snapshot is permanently
 * `unavailable`, which would hide this whole section), while the channel's
 * trusted-host fence works anywhere the GUI works.
 *
 * Provider / model / reasoningEffort are LOCKED `<select>` dropdowns auto-
 * populated from the host's `pickers` endpoint, so the user can only pick
 * values the runtime can actually serve. A value the saved config still
 * holds but the host no longer authenticates is shown as a disabled-looking
 * sentinel option (no silent drop), and any select that has no real options
 * is disabled until pickers load.
 */
import * as React from 'react'
import { RPC_CHANNEL } from '../rpc'

const { useCallback, useEffect, useState } = React

interface ConfigView {
  enabled: boolean
  provider: string
  model: string
  reasoningEffort: string
  persona: string
  minDeltaChars: number
  createGoals: boolean
  createTasks: boolean
}

interface PickerModel {
  id: string
  name: string
  efforts: Array<{ id: string; name: string }>
}

interface PickerProvider {
  provider: string
  displayName: string
  models: PickerModel[]
}

interface ClientCtx {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
  }
}

type RpcResult = { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }

function unwrap<T>(response: unknown, label: string): T {
  if (!response || typeof response !== 'object') throw new Error(`${label}: malformed response`)
  const outer = response as { result?: unknown } & RpcResult
  const result = (outer.result && typeof outer.result === 'object' ? outer.result : outer) as RpcResult
  if (result.ok === false) throw new Error(`${label}: ${result.error?.message ?? 'unknown error'}`)
  return ('value' in result ? result.value : result) as T
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, maxWidth: 640 },
  row: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontWeight: 600 },
  hint: { opacity: 0.7, fontSize: 12 },
  input: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #ccc)', font: 'inherit' },
  textarea: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #ccc)', font: 'inherit', minHeight: 80, resize: 'vertical' },
  toggle: { display: 'flex', alignItems: 'center', gap: 8 },
  footer: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 },
  button: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsh-border, #ccc)', cursor: 'pointer', font: 'inherit' },
  status: { fontSize: 12, opacity: 0.8 },
}

export function createSettingsSection(ctx: ClientCtx): React.ComponentType<{ close?: () => void }> {
  return function GoalKeeperSettingsSection() {
    const [config, setConfig] = useState<ConfigView | null>(null)
    const [providers, setProviders] = useState<PickerProvider[]>([])
    const [status, setStatus] = useState('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
      try {
        const res = await ctx.connection.rpc.call(RPC_CHANNEL, 'get', {})
        const { config } = unwrap<{ config: ConfigView }>(res, 'get')
        setConfig(config)
        setStatus('')
      } catch (error) {
        setStatus(String((error as Error).message))
      }
    }, [])

    const loadPickers = useCallback(async () => {
      try {
        const res = await ctx.connection.rpc.call(RPC_CHANNEL, 'pickers', {})
        const { providers } = unwrap<{ providers: PickerProvider[] }>(res, 'pickers')
        setProviders(Array.isArray(providers) ? providers : [])
      } catch (error) {
        // Picker load failure: leave the locked selects empty; the default
        // sentinel options still display the saved value so nothing mutates.
        setProviders([])
        setStatus(`pickers: ${String((error as Error).message)}`)
      }
    }, [])

    useEffect(() => {
      void load()
      void loadPickers()
    }, [load, loadPickers])

    const save = useCallback(async () => {
      if (!config) return
      setSaving(true)
      setStatus('Saving…')
      try {
        const res = await ctx.connection.rpc.call(RPC_CHANNEL, 'update', { patch: config })
        const { config: saved } = unwrap<{ config: ConfigView }>(res, 'update')
        setConfig(saved)
        setStatus('Saved.')
      } catch (error) {
        setStatus(String((error as Error).message))
      } finally {
        setSaving(false)
      }
    }, [config])

    if (!config) {
      return <div style={styles.root}>{status ? <span style={styles.status}>{status}</span> : 'Loading…'}</div>
    }

    const patch = (next: Partial<ConfigView>): void => setConfig({ ...config, ...next })

    // The currently-saved provider/model may be unauthenticated (e.g. live value
    // points at a route whose key is gone). Show it as a disabled-looking
    // sentinel so the saved value is visible without being silently dropped.
    const authenticatedProvider = providers.find((p) => p.provider === config.provider)
    const providerOptions: Array<{ value: string; label: string; disabled?: boolean }> = []
    if (!authenticatedProvider && config.provider) {
      providerOptions.push({ value: config.provider, label: `${config.provider} (current — not authenticated)`, disabled: true })
    }
    for (const p of providers) {
      providerOptions.push({ value: p.provider, label: p.displayName })
    }

    const modelsForProvider = authenticatedProvider?.models ?? []
    const authenticatedModel = modelsForProvider.find((m) => m.id === config.model)
    const modelOptions: Array<{ value: string; label: string; disabled?: boolean }> = []
    if (!authenticatedModel && config.model) {
      modelOptions.push({
        value: config.model,
        label: authenticatedProvider
          ? `${config.model} (current — not in catalog)`
          : `${config.model} (current — provider not authenticated)`,
        disabled: true,
      })
    }
    for (const m of modelsForProvider) {
      modelOptions.push({ value: m.id, label: m.name })
    }

    const effortsForModel = authenticatedModel?.efforts ?? []
    const effortOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: '', label: 'Default (unspecified)' },
    ]
    for (const e of effortsForModel) {
      effortOptions.push({ value: e.id, label: e.name })
    }
    if (
      config.reasoningEffort &&
      !effortsForModel.some((e) => e.id === config.reasoningEffort)
    ) {
      effortOptions.push({
        value: config.reasoningEffort,
        label: `${config.reasoningEffort} (current — not supported)`,
        disabled: true,
      })
    }

    return (
      <div style={styles.root}>
        <label style={styles.toggle}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span style={styles.label}>Enabled</span>
          <span style={styles.hint}>Review each turn and inject advice.</span>
        </label>

        <div style={styles.row}>
          <span style={styles.label}>Provider</span>
          <select
            style={styles.input}
            value={config.provider}
            onChange={(e) => {
              const next = providers.find((p) => p.provider === e.target.value)
              if (!next) return
              const firstModel = next.models[0]
              patch({
                provider: next.provider,
                model: firstModel?.id ?? '',
                reasoningEffort: '',
              })
            }}
          >
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={styles.hint}>LLM provider route for the keeper model (only authenticated providers listed).</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Model</span>
          <select
            style={styles.input}
            value={config.model}
            onChange={(e) => {
              const nextModel = modelsForProvider.find((m) => m.id === e.target.value)
              if (!nextModel) return
              const efforts = nextModel.efforts.map((x) => x.id)
              patch({
                model: nextModel.id,
                reasoningEffort: efforts.includes(config.reasoningEffort) ? config.reasoningEffort : '',
              })
            }}
            disabled={!authenticatedProvider}
          >
            {modelOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={styles.hint}>Keeper model id from the DSH model list.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Reasoning effort</span>
          <select
            style={styles.input}
            value={config.reasoningEffort}
            onChange={(e) => patch({ reasoningEffort: e.target.value })}
            disabled={!authenticatedModel}
          >
            {effortOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={styles.hint}>Optional; pick the model default with “Default (unspecified)”.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Persona</span>
          <textarea style={styles.textarea} value={config.persona} onChange={(e) => patch({ persona: e.target.value })} />
          <span style={styles.hint}>The keeper's reviewing instructions.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Min delta chars</span>
          <input
            style={{ ...styles.input, maxWidth: 120 }}
            type="number"
            min={0}
            value={config.minDeltaChars}
            onChange={(e) => patch({ minDeltaChars: Math.max(0, Number(e.target.value) || 0) })}
          />
          <span style={styles.hint}>Skip a review when the transcript delta is shorter than this.</span>
        </div>

        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={config.createGoals}
            onChange={(e) => patch({ createGoals: e.target.checked })}
          />
          <span style={styles.label}>Create goals</span>
          <span style={styles.hint}>Let the keeper set, update, and complete the session goal directly.</span>
        </label>

        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={config.createTasks}
            onChange={(e) => patch({ createTasks: e.target.checked })}
          />
          <span style={styles.label}>Create tasks</span>
          <span style={styles.hint}>Let the keeper add tasks to the todo checklist directly.</span>
        </label>

        <div style={styles.footer}>
          <button style={styles.button} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button style={styles.button} onClick={() => void load()} disabled={saving}>
            Reset
          </button>
          {status ? <span style={styles.status}>{status}</span> : null}
        </div>
      </div>
    )
  }
}
