/**
 * The "Mini Advisor" settings section: a small form over this plugin's config,
 * backed by the `/dsh-mini-advisor` RPC channel.
 *
 * Reads AND writes ride the plugin's own RPC channel instead of
 * `ctx.settingsScope`: DSH keeps settingsScope persistence loopback-only
 * (remote browsers get a process-local scope whose snapshot is permanently
 * `unavailable`, which would hide this whole section), while the channel's
 * trusted-host fence works anywhere the GUI works.
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
  return function MiniAdvisorSettingsSection() {
    const [config, setConfig] = useState<ConfigView | null>(null)
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

    useEffect(() => {
      void load()
    }, [load])

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

    return (
      <div style={styles.root}>
        <label style={styles.toggle}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span style={styles.label}>Enabled</span>
          <span style={styles.hint}>Review each turn and inject advice.</span>
        </label>

        <div style={styles.row}>
          <span style={styles.label}>Provider</span>
          <input style={styles.input} value={config.provider} onChange={(e) => patch({ provider: e.target.value })} />
          <span style={styles.hint}>LLM provider route for the advisor model.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Model</span>
          <input style={styles.input} value={config.model} onChange={(e) => patch({ model: e.target.value })} />
          <span style={styles.hint}>Advisor model id from the DSH model list.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Reasoning effort</span>
          <input
            style={styles.input}
            value={config.reasoningEffort}
            onChange={(e) => patch({ reasoningEffort: e.target.value })}
          />
          <span style={styles.hint}>Optional; leave blank for the model default.</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Persona</span>
          <textarea style={styles.textarea} value={config.persona} onChange={(e) => patch({ persona: e.target.value })} />
          <span style={styles.hint}>The advisor's reviewing instructions.</span>
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
          <span style={styles.hint}>Let the advisor set the session goal directly.</span>
        </label>

        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={config.createTasks}
            onChange={(e) => patch({ createTasks: e.target.checked })}
          />
          <span style={styles.label}>Create tasks</span>
          <span style={styles.hint}>Let the advisor add tasks to the todo checklist.</span>
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
