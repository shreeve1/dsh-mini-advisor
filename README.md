# dsh-goal-keeper

A goal-keeper watchdog for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH): a second model reviews each turn and keeps the primary agent on track toward its objective — by injecting weighable advice into the next turn, driving the native session goal (create / update / **complete**), and merging tasks into the agent's todo checklist.

> Renamed from `dsh-mini-advisor`. The runtime settings namespace is still pinned to the legacy `dsh-mini-advisor` key so existing saved provider/model overrides are not orphaned by the rename.

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2`+ |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | All (plain ESM; no native code) |

Peer dependencies: `@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-llm >=0.1.0-rc.8 <0.2.0`, `@deepseek-ai/schemastery ^3.18.0`, `react ^18.0.0 || ^19.0.0`.

## What it does

On every `session/event → turn/end`, the keeper:

1. Renders a transcript delta from the current turn.
2. Calls `ctx.llm.stream` with the configured persona and up to four tools, gated by config: `advise` (always), `set_goal` and `complete_goal` (when `createGoals`), and `update_tasks` (when `createTasks`).
3. Optionally, based on which tools the model called:
   - **Injects advice** (`advise`) — appends a user-role note to the primary agent's next turn:
     ```xml
     <advisory advisor="goal-keeper" severity="…" guidance="weigh, don't blindly obey">…</advisory>
     ```
     Severity is one of `nit | concern | blocker`; the `guidance` attribute reminds the agent to weigh the advice, not blindly obey it.
   - **Sets or updates the goal** (`set_goal`) — reads the current goal via `ctx.goals.get`; if none exists (or it is already complete) calls `ctx.goals.create`, otherwise `ctx.goals.edit` to revise the objective in place. No silent no-op when a goal already exists.
   - **Completes the goal** (`complete_goal`) — calls `ctx.goals.complete` when a goal is open. This disarms goal-round continuation, so it is the keeper's explicit stop signal; the tool is meant to fire only when the objective is genuinely finished.
   - **Merges tasks** (`update_tasks`) — appends items to the agent's todo checklist via `session.append('todo/write', {…})`, deduped and non-clobbering.

Reviews shorter than `minDeltaChars` are skipped without an LLM call. If the LLM call itself fails, the error is surfaced to the activity store via `setLastError` and shown in the sidebar tab.

## Configuration

All knobs live in the Schemastery `Config` schema (`src/config.ts`) and can be edited at runtime from the **Goal Keeper** settings section. **Changes save automatically** — toggles and dropdowns commit on change, and free-text fields (persona, min delta chars) commit shortly after you stop typing, or on blur. There is no Save button; **Reload** re-reads the host value and discards local edits.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether the keeper reviews turns. This is the **global default** for new sessions; `/keeper on\|off` overrides it per session (see below). |
| `provider` | string | `deepseek-official` | LLM provider route for the keeper model. |
| `model` | string | `deepseek-v4-flash` | Keeper model id from the DSH model list. |
| `reasoningEffort` | string | `""` | Optional reasoning effort passed to the keeper model. |
| `persona` | textarea | *rigorous-goal-keeper* | The keeper's persona and reviewing instructions. |
| `minDeltaChars` | number | `40` | Skip a review when the rendered transcript delta is shorter than this many characters. |
| `createGoals` | boolean | `true` | Let the keeper set, update, and complete the session goal directly via the native goal service. |
| `createTasks` | boolean | `true` | Let the keeper add tasks to the agent's todo checklist directly. |

Default persona:

> You are a rigorous goal-keeper watching a coding agent. Speak up only when something matters: a bug, a security hole, a wrong turn, or a premature "done". Keep advice concrete and short.

The runtime-persisted settings section and RPC channel live at the URL path `/dsh-goal-keeper` (derived from the plugin name). When `dsh-better-sidebar` is installed, a **Goal Keeper** sidebar tab exposes both the section and a live activity feed (last advice, last error).

## Per-session toggle: `/keeper`

The settings `enabled` switch is global. To silence (or enable) the keeper in **one chat** without touching every other session, use the slash command:

| Command | Effect |
|---|---|
| `/keeper` or `/keeper status` | Report this session's state and whether it comes from the global default or a session override. |
| `/keeper on` | Turn the keeper on for this session only. |
| `/keeper off` | Turn the keeper off for this session only — no reviews, advice, goals, or tasks. |

A session with no override follows the settings toggle, so the panel remains the default for new sessions while the command is a session-local override. Overrides live in memory, keyed by session id, and are dropped on `session/disposed` — a session that is resumed later starts from the global default again.

This mirrors `dsh-fusion`'s `/fusion on|off|status` split (settings default + per-session command). The command is registered through the `commands` service (`@deepseek-ai/dsh-commands`, mounted by `@deepseek-ai/dsh-base`), which is why `commands` appears in this plugin's `inject`. It declares `input: { hint }` so the web composer accepts trailing arguments instead of sending `/keeper on` to the model as a prompt.

## Bundle mounts

Both server and client are mounted:

- **Server** — `package.json#dsh.bundle.patch` → `cordis.patch.yml` adds a single `insert` row with `id: dsh-goal-keeper`, pointing the loader at this package's `main` entry.
- **Client** — `package.json#dsh.client.inject` declares `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-connection"]` so the React Settings section and the optional sidebar tab probe get the runtime and connection APIs they need.

The client ships two surfaces: a Settings section slot (always mounted) and a sidebar tab probe that activates when `dsh-better-sidebar` is present.

## Install

`file:`-installed into the `web` profile from `~/.dsh/plugins-src/dsh-goal-keeper` (the committed `lib/` is used; `prepare` falls back to it, so no `allowBuilds` key is needed). Because this plugin was renamed from `dsh-mini-advisor`, a live update is remove-old + add-new:

```sh
dsh plugin --profile web remove dsh-mini-advisor
dsh plugin --profile web add 'file:~/.dsh/plugins-src/dsh-goal-keeper'
```

See `docs/deepseek-harness.md` (Install best practices) for the full per-restart install protocol, including the `file:`-dep re-materialize step.

## Caveats

- **Completion is keeper-owned.** `complete_goal` closes the goal and disarms continuation. If the keeper model completes prematurely, the primary stops being driven — the tool description sets a high bar, and set/complete should not fire in the same review. With no explicit round cap, the deployment default `maxGoalRounds` is the backstop.
- **LLM failures are visible, not silent.** If `ctx.llm.stream` rejects (e.g. `NO_ADAPTER` for the configured provider/model), the error is written into the activity store via `setLastError` and surfaces in the sidebar tab.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test          # 19 tests in tests/index.test.ts
pnpm run build
```

Static gates:

```sh
dsh-plugin-dev check --strict   # manifest / cordis.patch.yml / build traps / hub registration
dsh-plugin-dev verify           # full plugin repo verification
```

The plugin can also be diagnosed in-place with the `plugin_check` tool (action `check`, repo = this directory).

## License

[Apache License 2.0](LICENSE) © 2026 dsh-goal-keeper contributors.
