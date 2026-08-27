# dsh-mini-advisor

A passive advisor watchdog for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH): a second model reviews each turn and can steer the primary agent — by injecting weighable advice into the next turn, setting a native session goal, or merging tasks into the agent's todo checklist.

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2`+ |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | All (plain ESM; no native code) |

Peer dependencies: `@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-llm >=0.1.0-rc.8 <0.2.0`, `@deepseek-ai/schemastery ^3.18.0`, `react ^18.0.0 || ^19.0.0`.

## What it does

On every `session/event → turn/end`, the advisor:

1. Renders a transcript delta from the current turn.
2. Calls `ctx.llm.stream` with the configured persona and three advisor tools (`advisor_inject_advice`, `advisor_create_goal`, `advisor_merge_tasks`).
3. Optionally:
   - **Injects advice** — appends a user-role note to the primary agent's next turn:
     ```xml
     <advisor advisor="mini-advisor" severity="…" guidance="weigh, don't blindly obey">…</advisor>
     ```
     Severity is one of `info | caution | warning | blocker`; the `guidance` attribute reminds the agent to weigh the advice, not blindly obey it.
   - **Creates a goal** — calls `ctx.goals.create(agent, {objective})` to set a native DSH goal directly on the session. (See *Caveats* — this is set-only.)
   - **Merges tasks** — appends items to the agent's todo checklist via `session.append('todo/write', {…})`.

Reviews shorter than `minDeltaChars` are skipped without an LLM call. If the LLM call itself fails, the error is surfaced to the activity store via `setLastError` and shown in the sidebar tab — it is no longer silent.

## Configuration

All knobs live in the Schemastery `Config` schema (`src/config.ts`) and can be edited at runtime from the **Mini Advisor** settings section.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether the advisor reviews turns. |
| `provider` | string | `deepseek-official` | LLM provider route for the advisor model. |
| `model` | string | `deepseek-v4-flash` | Advisor model id from the DSH model list. |
| `reasoningEffort` | string | `""` | Optional reasoning effort passed to the advisor model. |
| `persona` | textarea | *rigorous-second-reviewer* | The advisor's persona and reviewing instructions. |
| `minDeltaChars` | number | `40` | Skip a review when the rendered transcript delta is shorter than this many characters. |
| `createGoals` | boolean | `true` | Let the advisor set the session goal directly via the native goal service. |
| `createTasks` | boolean | `true` | Let the advisor add tasks to the agent's todo checklist directly. |

Default persona:

> You are a rigorous second reviewer watching a coding agent. Speak up only when something matters: a bug, a security hole, a wrong turn, or a premature "done". Keep advice concrete and short.

The runtime-persisted settings section lives at the URL path `/dsh-mini-advisor`. When `dsh-better-sidebar` is installed, a **Mini Advisor** sidebar tab exposes both the section and a live activity feed (last advice, last error).

## Bundle mounts

Both server and client are mounted:

- **Server** — `package.json#dsh.bundle.patch` → `cordis.patch.yml` adds a single `insert` row with `id: dsh-mini-advisor`, pointing the loader at this package's `main` entry.
- **Client** — `package.json#dsh.client.inject` declares `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-connection"]` so the React Settings section and the optional sidebar tab probe get the runtime and connection APIs they need.

The client ships two surfaces: a Settings section slot (always mounted) and a sidebar tab probe that activates when `dsh-better-sidebar` is present.

## Install

This plugin is already part of the `web` profile's `bundles` array (`~/.dsh/profiles/web/package.json`) and is `file:`-installed from `~/.dsh/plugins-src/dsh-mini-advisor` — no `allowBuilds` key is needed (the committed `lib/` is used; `prepare` falls back to it). To (re)install from source:

```sh
dsh plugin --profile web add 'file:../../plugins-src/dsh-mini-advisor'
```

See `docs/deepseek-harness.md` (Install best practices) for the full per-restart install protocol.

## Caveats

- **`create_goal` is set-only.** Calling `advisor_create_goal` a second time in the same session fails silently because `ctx.goals.create()` throws `GOAL_ALREADY_EXISTS`. The tool's doc string now states this so the model doesn't retry.
- **LLM failures are visible, not silent.** If `ctx.llm.stream` rejects (e.g. `NO_ADAPTER` for the configured provider/model), the error is written into the activity store via `setLastError` and surfaces in the sidebar tab.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test          # 17 tests in tests/index.test.ts
pnpm run build
```

Static gates:

```sh
dsh-plugin-dev check --strict   # manifest / cordis.patch.yml / build traps / hub registration
dsh-plugin-dev verify           # full plugin repo verification
```

The plugin can also be diagnosed in-place with the `plugin_check` tool (action `check`, repo = this directory).

## License

[Apache License 2.0](LICENSE) © 2026 dsh-mini-advisor contributors.
