# Learning Log — Design Spec

**Date:** 2026-07-15  
**Status:** Draft for review  
**Branch:** `feat/learning-log-design`  
**Related:** Activity Log (`ActivityLogPanel` / `useActivityLog`), `LogViewer` / `/logs`, `appEventService`, `structuredLogger`

---

## 1. Problem

Demo audiences and engineers cannot easily **see what is going on** while a banking turn runs. Logging today is fragmented:

- Semantic events: SSE Activity Log (`/api/app-events/stream`) with categories, but not a teaching-first dual shell
- Raw lines: `LogViewer` file tail (`/api/logs`), already drag/resize
- Ad-hoc `console` / `[MFA]` debug strings without a shared correlation field in the UI

Token Chain remains the **security hop** education surface. Learning Log is a **time-ordered log**—colored, filterable, Learn vs Debug—not a hop rail.

---

## 2. Goals

1. One **draggable + resizable** pop-out panel (upgrade `LogViewer` shell) with **Learn | Debug** toggle.
2. **Color** encodes severity + category; **correlation** tint + filter ties a flow together.
3. **Phase 1 BFF** structured envelope (`correlationId`, redact); raw Debug still works.
4. **Datadog scaffold** (env + optional stubs + docs) without requiring Datadog to run locally.
5. Open via **Monitoring side-nav** + **keyboard** (`Cmd/Ctrl+Shift+L`). Not coupled to Token Chain.

### Non-goals (Phase 1)

- Full MCP/agent cross-process correlation (Phase 2)
- Live Datadog APM/Logs/RUM shipping as a hard dependency
- Changing Token Chain UI/API
- Rewriting every `console.log` in the monorepo

---

## 3. Audience & modes

| Mode | Primary learner | Feed | Default when opened from |
|---|---|---|---|
| **Learn** | SE / demo audience | App-events SSE (`useActivityLog` categories) | Monitoring → Learning Log / Activity Log |
| **Debug** | Engineer | `/api/logs` tail (+ parse JSONL when structured) | Global Logs affordances |

Toggle in the panel header switches list body only; position/size persist.

---

## 4. Shell & navigation

**Primary UI:** Floating panel using existing `useDraggablePanel` (same pattern as current `LogViewer`).

**Detach:** Standalone `/logs` window keeps dual-mode chrome (optional).

**Open:**

- Side-nav **Monitoring → Learning Log** (replace or rename today’s “Activity Log”; `/monitoring/activity-log` opens the same panel / Learn default)
- Keyboard: `Cmd/Ctrl+Shift+L`; Escape closes when the panel is focused
- Existing in-app “Logs” buttons → same panel (Debug default)

**Not:** Tied to Token Chain dock; not a second parallel Activity Log page with a different color system.

---

## 5. Visual design (color & rows)

**Theme:** Light (match current LogViewer / Api Traffic readability).

**Severity glyphs (allowlist only):** `✅` info/success · `⚠️` warn · `❌` error (debug: no glyph or muted text).

**Three color channels per row:**

1. **Severity** — left stripe + badge (`debug` / `info` / `warn` / `error`)
2. **Category chip** — stable hue per Activity Log category (`oauth`, `token_exchange`, `mcp`, `authorize`, `agent`, …)
3. **Correlation tint** — soft background wash hashed from `correlationId` (fallback `requestId` / `sessionId` / legacy `flowId`). Click chip → filter list to that id (shared filter state available in both modes when the field exists)

**Learn row:** `time · [sev] · [category] · headline` → expand metadata JSON (redacted).

**Debug row:** `time · level · source · [category?] · message` → expand structured object or raw line; JSON syntax colors aligned with Api Traffic.

**Chrome (both modes):** pause/freeze, clear visible buffer, search, auto-scroll, category filters (Learn), level/source filters (Debug).

---

## 6. Data model (canonical envelope)

Used by Learn (`appEventService.logEvent`) and preferred for Debug when file lines are JSON:

| Field | Required | Notes |
|---|---|---|
| `timestamp` | yes | ISO-8601 |
| `severity` / `level` | yes | `debug` \| `info` \| `warn` \| `error` |
| `category` | yes for Learn | Existing `ALL_CATEGORIES` |
| `message` | yes | Human-readable; never secrets |
| `correlationId` | when in a demo flow | UI name; **alias** persist/accept `flowId` for backward compat |
| `requestId` | preferred | HTTP / middleware |
| `sessionId` | optional | BFF session |
| `source` | Debug | `bff` \| `console` \| `vercel` \| … |
| `metadata` | optional | Redacted structured detail |
| `tag` | optional | Existing app-event tag |

---

## 7. BFF logging improvements (Phase 1)

1. Extend `appEventService.logEvent` to accept/emit `correlationId` (map `flowId` ↔ `correlationId`).
2. Middleware / request context stamps `requestId` (+ session when present); hot paths pass them into `logEvent` and `structuredLogger.log`:
   - OAuth / session
   - Token exchange
   - MCP authorize / tool pipeline entrypoints
   - Agent invoke
3. Shared **redact** helper: tokens, client secrets, passwords, full JWTs stripped from `message`/`metadata`.
4. `/api/logs` unchanged as transport; Debug parses JSONL into structured rows when possible.

**Phase 2 (designed, not built):** Propagate the same `correlationId` into MCP gateway + agents so Debug can follow one request across processes.

---

## 8. Datadog setup (Phase 1 = scaffold only)

Local demo and CI must run **without** Datadog credentials.

### Deliverables

| Item | Purpose |
|---|---|
| Env vars documented in `.env.example` / `ENV_VARS.md` | `DD_API_KEY`, `DD_SITE`, `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, `DD_TRACE_ENABLED` (default `false`), optional `DD_LOGS_INJECTION` |
| Optional Node stub module | `demo_api_server/services/datadogBootstrap.js` — no-op unless `DD_TRACE_ENABLED=true` **and** key present; then dynamically requires `dd-trace` if installed |
| Optional UI stub comment/hook | Placeholder for future `@datadog/browser-logs` / RUM — **not** activated in Phase 1 |
| Short doc | `docs/observability/datadog-scaffold.md` — how to enable later; maps `correlationId` → Datadog `trace_id`/log attribute when Phase 1.5 ships |

### Explicit non-goals for scaffold

- No required npm install of Datadog SDKs in default `package.json` install path (or keep as optionalDependency with no auto-start)
- No shipping logs to Datadog from default Docker/K8s profiles
- No RUM cookies / session replay in Phase 1

Phase 1.5 (later): BFF APM + log forward using the same envelope fields.

---

## 9. Component / file map (implementation sketch)

| Area | Direction |
|---|---|
| `LogViewer.js` + CSS | Dual-mode shell; extract Learn/Debug list bodies |
| `useActivityLog.js` | Learn feed; correlation filter |
| `ActivityLogPanel.js` | Reuse row renderer or thin wrap — single color system |
| `AdminSideNav` Monitoring | Label → Learning Log; open panel |
| `App.js` | Global open state + shortcut |
| `appEventService.js` | `correlationId` |
| `structuredLogger.js` + redact helper | Envelope + safe fields |
| Hot path call sites | Pass correlation / request ids |
| Datadog scaffold files | §8 |

---

## 10. Migration of existing surfaces

| Today | After |
|---|---|
| Monitoring → Activity Log | Opens Learning Log (Learn) |
| `/monitoring/activity-log` | Same opener / optional thin redirect |
| Global Logs / `logViewerOpen` | Learning Log (Debug default) |
| Clinical `InspectPane` ActivityLogPanel | Shared row renderer; no second palette |
| `/logs` standalone | Dual-mode detach |

---

## 11. Errors & empty states

- SSE disconnect → “Reconnecting…”; Debug poll still works
- `/api/logs` 401/403 → clear session message in Debug
- Empty Learn → one-line hint after a demo action
- Redaction failure → omit field; never log secret

---

## 12. Testing

- Unit: `flowId` ↔ `correlationId`; redact; correlation hash stability; Datadog bootstrap no-op without flags
- UI: side-nav + shortcut open; Learn category + correlation filter; Debug JSONL vs raw; freeze/pause; mode toggle keeps size/position
- Regression: Token Chain untouched; emoji allowlist; demo runs with `DD_TRACE_ENABLED` unset

---

## 13. Success criteria

1. SE narrates a live turn from **Learn** using severity, category, and correlation colors.
2. Engineer switches to **Debug** and filters the same `correlationId`.
3. Drag/resize/pop-out works without a Token Chain dependency.
4. Fresh clone works with zero Datadog config; scaffold docs explain enablement.

---

## 14. Phased delivery

| Phase | Scope |
|---|---|
| **1** | Learning Log UI (Approach 1), BFF envelope + redact on hot paths, Datadog scaffold |
| **1.5** | Optional Datadog APM + log forward when keys present |
| **2** | Cross-service `correlationId` (MCP + agents) |

---

## 15. Decisions log (brainstorm)

| Topic | Choice |
|---|---|
| Audience | Both (Learn + Debug modes) |
| Feeds | Both semantic + raw, toggle |
| Open | Side-nav + keyboard |
| Color | Severity + category + correlation |
| Architecture | Upgrade `LogViewer` (Approach 1) |
| Logging depth | BFF envelope now; full-stack correlation later |
| Datadog | Scaffold only (A) |
