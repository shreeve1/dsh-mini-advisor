window.__ModuleLoader__.load({ id: "dsh-goal-keeper", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/SettingsSection.tsx
var React = __toESM(require("react"), 1);

// src/delta.ts
var PLUGIN_NAME = "dsh-goal-keeper";

// src/rpc.ts
var RPC_CHANNEL = `/${PLUGIN_NAME}`;

// src/client/SettingsSection.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var { useCallback, useEffect, useRef, useState } = React;
var TEXT_COMMIT_DELAY_MS = 600;
function unwrap(response, label) {
  if (!response || typeof response !== "object") throw new Error(`${label}: malformed response`);
  const outer = response;
  const result = outer.result && typeof outer.result === "object" ? outer.result : outer;
  if (result.ok === false) throw new Error(`${label}: ${result.error?.message ?? "unknown error"}`);
  return "value" in result ? result.value : result;
}
var styles = {
  root: { display: "flex", flexDirection: "column", gap: 14, fontSize: 13, maxWidth: 640 },
  row: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontWeight: 600 },
  hint: { opacity: 0.7, fontSize: 12 },
  input: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #ccc)", font: "inherit" },
  textarea: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #ccc)", font: "inherit", minHeight: 80, resize: "vertical" },
  toggle: { display: "flex", alignItems: "center", gap: 8 },
  footer: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 },
  button: { padding: "6px 14px", borderRadius: 6, border: "1px solid var(--dsh-border, #ccc)", cursor: "pointer", font: "inherit" },
  status: { fontSize: 12, opacity: 0.8 }
};
function createSettingsSection(ctx) {
  return function GoalKeeperSettingsSection() {
    const [config, setConfig] = useState(null);
    const [providers, setProviders] = useState([]);
    const [status, setStatus] = useState("");
    const [saving, setSaving] = useState(false);
    const load = useCallback(async () => {
      try {
        const res = await ctx.connection.rpc.call(RPC_CHANNEL, "get", {});
        const { config: config2 } = unwrap(res, "get");
        setConfig(config2);
        setStatus("");
      } catch (error) {
        setStatus(String(error.message));
      }
    }, []);
    const loadPickers = useCallback(async () => {
      try {
        const res = await ctx.connection.rpc.call(RPC_CHANNEL, "pickers", {});
        const { providers: providers2 } = unwrap(res, "pickers");
        setProviders(Array.isArray(providers2) ? providers2 : []);
      } catch (error) {
        setProviders([]);
        setStatus(`pickers: ${String(error.message)}`);
      }
    }, []);
    useEffect(() => {
      void load();
      void loadPickers();
    }, [load, loadPickers]);
    const commit = useCallback(
      async (next) => {
        setSaving(true);
        setStatus("Saving\u2026");
        try {
          const res = await ctx.connection.rpc.call(RPC_CHANNEL, "update", { patch: next });
          unwrap(res, "update");
          setStatus("Saved.");
        } catch (error) {
          setStatus(String(error.message));
          void load();
        } finally {
          setSaving(false);
        }
      },
      [load]
    );
    const textTimer = useRef(void 0);
    const pendingText = useRef(void 0);
    const flushText = useCallback(() => {
      if (textTimer.current !== void 0) {
        clearTimeout(textTimer.current);
        textTimer.current = void 0;
      }
      const pending = pendingText.current;
      pendingText.current = void 0;
      if (pending) void commit(pending);
    }, [commit]);
    useEffect(() => () => flushText(), [flushText]);
    if (!config) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.root, children: status ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.status, children: status }) : "Loading\u2026" });
    }
    const patch = (next) => {
      const merged = { ...config, ...next };
      setConfig(merged);
      if (pendingText.current) {
        if (textTimer.current !== void 0) clearTimeout(textTimer.current);
        textTimer.current = void 0;
        pendingText.current = void 0;
      }
      void commit(merged);
    };
    const patchText = (next) => {
      const merged = { ...config, ...next };
      setConfig(merged);
      pendingText.current = merged;
      if (textTimer.current !== void 0) clearTimeout(textTimer.current);
      textTimer.current = setTimeout(() => {
        textTimer.current = void 0;
        const pending = pendingText.current;
        pendingText.current = void 0;
        if (pending) void commit(pending);
      }, TEXT_COMMIT_DELAY_MS);
    };
    const authenticatedProvider = providers.find((p) => p.provider === config.provider);
    const providerOptions = [];
    if (!authenticatedProvider && config.provider) {
      providerOptions.push({ value: config.provider, label: `${config.provider} (current \u2014 not authenticated)`, disabled: true });
    }
    for (const p of providers) {
      providerOptions.push({ value: p.provider, label: p.displayName });
    }
    const modelsForProvider = authenticatedProvider?.models ?? [];
    const authenticatedModel = modelsForProvider.find((m) => m.id === config.model);
    const modelOptions = [];
    if (!authenticatedModel && config.model) {
      modelOptions.push({
        value: config.model,
        label: authenticatedProvider ? `${config.model} (current \u2014 not in catalog)` : `${config.model} (current \u2014 provider not authenticated)`,
        disabled: true
      });
    }
    for (const m of modelsForProvider) {
      modelOptions.push({ value: m.id, label: m.name });
    }
    const effortsForModel = authenticatedModel?.efforts ?? [];
    const effortOptions = [
      { value: "", label: "Default (unspecified)" }
    ];
    for (const e of effortsForModel) {
      effortOptions.push({ value: e.id, label: e.name });
    }
    if (config.reasoningEffort && !effortsForModel.some((e) => e.id === config.reasoningEffort)) {
      effortOptions.push({
        value: config.reasoningEffort,
        label: `${config.reasoningEffort} (current \u2014 not supported)`,
        disabled: true
      });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.root, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: config.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Enabled" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Review each turn and inject advice." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Provider" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "select",
          {
            style: styles.input,
            value: config.provider,
            onChange: (e) => {
              const next = providers.find((p) => p.provider === e.target.value);
              if (!next) return;
              const firstModel = next.models[0];
              patch({
                provider: next.provider,
                model: firstModel?.id ?? "",
                reasoningEffort: ""
              });
            },
            children: providerOptions.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "LLM provider route for the keeper model (only authenticated providers listed)." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Model" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "select",
          {
            style: styles.input,
            value: config.model,
            onChange: (e) => {
              const nextModel = modelsForProvider.find((m) => m.id === e.target.value);
              if (!nextModel) return;
              const efforts = nextModel.efforts.map((x) => x.id);
              patch({
                model: nextModel.id,
                reasoningEffort: efforts.includes(config.reasoningEffort) ? config.reasoningEffort : ""
              });
            },
            disabled: !authenticatedProvider,
            children: modelOptions.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Keeper model id from the DSH model list." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Reasoning effort" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "select",
          {
            style: styles.input,
            value: config.reasoningEffort,
            onChange: (e) => patch({ reasoningEffort: e.target.value }),
            disabled: !authenticatedModel,
            children: effortOptions.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Optional; pick the model default with \u201CDefault (unspecified)\u201D." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Persona" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "textarea",
          {
            style: styles.textarea,
            value: config.persona,
            onChange: (e) => patchText({ persona: e.target.value }),
            onBlur: flushText
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "The keeper's reviewing instructions." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Min delta chars" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            style: { ...styles.input, maxWidth: 120 },
            type: "number",
            min: 0,
            value: config.minDeltaChars,
            onChange: (e) => patchText({ minDeltaChars: Math.max(0, Number(e.target.value) || 0) }),
            onBlur: flushText
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Skip a review when the transcript delta is shorter than this." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: config.createGoals,
            onChange: (e) => patch({ createGoals: e.target.checked })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Create goals" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Let the keeper set, update, and complete the session goal directly." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: config.createTasks,
            onChange: (e) => patch({ createTasks: e.target.checked })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.label, children: "Create tasks" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: "Let the keeper add tasks to the todo checklist directly." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.status, children: status || "Changes save automatically." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: styles.button, onClick: () => void load(), disabled: saving, children: "Reload" })
      ] })
    ] });
  };
}

// src/client/sidebar.tsx
var React2 = __toESM(require("react"), 1);
var import_jsx_runtime2 = require("react/jsx-runtime");
var { useEffect: useEffect2, useState: useState2 } = React2;
var TAB_ID = "goal-keeper:advisories";
var POLL_MS = 2e3;
var PROBE_INTERVAL_MS = 1e3;
var PROBE_MAX_ATTEMPTS = 15;
function unwrap2(response) {
  const outer = response ?? {};
  const result = outer.result && typeof outer.result === "object" ? outer.result : outer;
  if (result.ok === false) throw new Error(result.error?.message ?? "rpc error");
  return "value" in result ? result.value : result;
}
var cache = /* @__PURE__ */ new Map();
var connectionRef = null;
var pollTimer = null;
var refCount = 0;
var scopeWanted = null;
var listeners = /* @__PURE__ */ new Set();
function notify() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
    }
  }
}
function pollOnce() {
  const connection = connectionRef;
  if (!connection) return;
  connection.rpc.call(RPC_CHANNEL, "status", scopeWanted ? { sessionId: scopeWanted } : {}).then((result) => {
    const { sessions } = unwrap2(result);
    const next = /* @__PURE__ */ new Map();
    for (const session of sessions ?? []) next.set(session.sessionId, session);
    cache = next;
    notify();
  }).catch(() => {
  });
}
function setScope(sessionId) {
  scopeWanted = sessionId;
  if (refCount > 0) pollOnce();
}
function acquire(connection) {
  connectionRef = connection;
  refCount += 1;
  if (refCount === 1) {
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_MS);
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
function useCache() {
  const [, setTick] = useState2(0);
  useEffect2(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return cache;
}
var SEVERITY_COLORS = {
  blocker: "#dc5050",
  concern: "#e08a3c",
  nit: "#7da7d9"
};
var CREATION_COLORS = {
  goal: "#9a7fd1",
  task: "#4caf7d"
};
var panel = { display: "flex", flexDirection: "column", gap: 12, padding: 12, fontSize: 13, height: "100%", overflowY: "auto" };
var card = { border: "1px solid var(--dsh-border, rgba(128,128,128,0.25))", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6 };
var hint = { opacity: 0.6, fontSize: 12 };
var chip = { display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "1px 8px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.25))", fontSize: 11 };
function formatTime(time) {
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function AdvisoriesTab(props) {
  const scoped = props.scopedSessionId;
  useEffect2(() => {
    setScope(scoped ?? null);
    return () => setScope(null);
  }, [scoped]);
  const cacheMap = useCache();
  const session = scoped ? cacheMap.get(scoped) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Goal Keeper" }),
      session ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: chip, children: [
          session.reviews,
          " reviews"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: chip, children: [
          session.advice,
          " advice"
        ] }),
        session.goals > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...chip, borderColor: CREATION_COLORS.goal, color: CREATION_COLORS.goal }, children: [
          session.goals,
          " goals"
        ] }),
        session.tasks > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...chip, borderColor: CREATION_COLORS.task, color: CREATION_COLORS.task }, children: [
          session.tasks,
          " tasks"
        ] }),
        session.lastError && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...hint, color: "#dc7070" }, title: session.lastError, children: [
          "\u26A0 ",
          session.lastError.length > 80 ? `${session.lastError.slice(0, 80)}\u2026` : session.lastError
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: hint, children: "No keeper activity for this session yet. Advice appears here after the next turn." })
    ] }),
    session && session.creations.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Created" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: session.creations.map((creation, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...chip, borderColor: CREATION_COLORS[creation.kind], color: CREATION_COLORS[creation.kind] }, children: creation.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...hint, fontVariantNumeric: "tabular-nums" }, children: formatTime(creation.time) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: creation.text })
      ] }, `${creation.time}-${index}`)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Advisories" }),
      !session || session.advisories.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: hint, children: "No advisories issued yet." }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: session.advisories.map((advisory, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 3 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...chip, borderColor: SEVERITY_COLORS[advisory.severity], color: SEVERITY_COLORS[advisory.severity] }, children: advisory.severity }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...hint, fontVariantNumeric: "tabular-nums" }, children: formatTime(advisory.time) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: advisory.note })
      ] }, `${advisory.time}-${index}`)) })
    ] })
  ] });
}
function AdvisorIcon({ size }) {
  return React2.createElement(
    "svg",
    { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
    React2.createElement("path", { d: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" }),
    React2.createElement("circle", { cx: 12, cy: 12, r: 3 })
  );
}
function badge(...args) {
  const scope = args[1];
  if (!scope?.sessionId) return null;
  const session = cache.get(scope.sessionId);
  if (!session || session.advice === 0) return null;
  if (session.lastError) return "!";
  return session.advice;
}
function looksLikeBetterSidebar(value) {
  return typeof value === "object" && value !== null && typeof value.registerTab === "function";
}
function mountSidebarTab(ctx) {
  ctx.effect(() => {
    let disposed = false;
    let attempts = 0;
    let releasePoll = null;
    let unregister = null;
    let probeTimer = null;
    const tryRegister = () => {
      if (disposed) return true;
      let service;
      try {
        service = typeof ctx.get === "function" ? ctx.get("betterSidebar") : void 0;
      } catch {
        return false;
      }
      if (!looksLikeBetterSidebar(service)) return false;
      try {
        unregister = service.registerTab({
          id: TAB_ID,
          title: () => "Goal Keeper",
          icon: (size) => React2.createElement(AdvisorIcon, { size }),
          order: 60,
          single: true,
          badge,
          component: (scopeProps) => React2.createElement(AdvisoriesTab, {
            scopedSessionId: scopeProps?.scope?.sessionId
          })
        });
        if (ctx.connection) releasePoll = acquire(ctx.connection);
        ctx.logger?.info?.("dsh-goal-keeper: registered Goal Keeper tab in dsh-better-sidebar");
      } catch (error) {
        ctx.logger?.info?.(`dsh-goal-keeper: better-sidebar registration skipped (${String(error?.message ?? error)})`);
        return true;
      }
      return true;
    };
    if (!tryRegister()) {
      probeTimer = setInterval(() => {
        attempts += 1;
        if (tryRegister() || attempts >= PROBE_MAX_ATTEMPTS) {
          if (probeTimer !== null) {
            clearInterval(probeTimer);
            probeTimer = null;
          }
        }
      }, PROBE_INTERVAL_MS);
    }
    return () => {
      disposed = true;
      if (probeTimer !== null) clearInterval(probeTimer);
      if (releasePoll) releasePoll();
      if (unregister) {
        try {
          unregister();
        } catch {
        }
      }
    };
  }, "dsh-goal-keeper: better-sidebar tab");
}

// src/client/index.ts
var name = "dsh-goal-keeper";
var inject = ["slots", "connection"];
function apply(ctx) {
  ctx.effect(
    () => ctx.slots.inject("settings.section", function* () {
      yield ctx.slots.register(
        {
          name: "settings.section",
          id: "dsh-goal-keeper",
          order: 50,
          label: () => "Goal Keeper",
          inject: () => ({})
        },
        createSettingsSection(ctx)
      );
    }),
    "dsh-goal-keeper: settings section"
  );
  mountSidebarTab(ctx);
}

return module.exports; } });
