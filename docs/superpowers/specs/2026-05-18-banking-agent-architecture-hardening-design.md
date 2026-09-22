# Banking Agent Architecture Hardening — Design

**Date:** 2026-05-18
**Status:** Approved (pending written-spec review)
**Scope:** The 4 deferred items from `docs/superpowers/plans/2026-05-18-banking-agent-safety-fixes.md` "Out of scope" section.

## Goal

Resolve the four architectural debts the safety-fixes work deliberately deferred, in increasing order of risk, each phase independently committed and verified:

1. Dead-code removal (`SideAgentDock`, `ResponsiveAgentDock`, `right-dock`/`left-dock`)
2. `embeddedFocus` route-parity across all 3 agent UI modes
3. `AbortController` threading through the NL/MCP send pipeline
4. Double-mount → single `BankingAgent` instance (the #1 root cause)

## Constraints / context

- `demo_api_ui/src/` is CRA, ES modules + JSX in `.js`. Test runner is `react-scripts test` (bare jest skips Babel transform). UI build gate: `cd demo_api_ui && npm run build` exit 0.
- `BankingAgent.js` and `App.js` are REGRESSION_PLAN §1 protected. Phases 3 and 4 touch them; each must state preserved §1 invariants before editing and add a §4 Bug Fix Log entry.
- Emoji rule: only `⚠️` `✅` `❌`.
- The repo's working tree has long-standing unrelated dirty files; all commits must be scoped by pathspec/patch and verified with `git diff --cached --stat` before committing (a pre-commit hook can sweep untracked files; `--no-verify` is safe per project memory, the hook is advisory for our purposes).
- Pure helpers live in `demo_api_ui/src/components/bankingAgentSafety.js` (created by the prior safety-fixes work) and are unit-tested in `demo_api_ui/src/__tests__/BankingAgent.safety.test.js`. New pure helpers extend these.

## Execution model

Four sequential phases. Each phase: implement (TDD where a pure helper exists), build gate, full agent suite (`BankingAgent.test.js` + `.safety` + `.integration` + `.chipRouting`, currently 98 green), scoped commit, §4 entry where §1 files change. Phases done in order; the work is committed per phase.

---

## Phase 1 — Dead-code removal (low risk)

### What is dead (verified post-merge, `fix/mcp-introspection-client-binding`)

- `demo_api_ui/src/components/SideAgentDock.js`, `SideAgentDock.css`, `ResponsiveAgentDock.js` — zero references outside their own files (`grep` confirmed).
- `right-dock` / `left-dock` placements — referenced only in `demo_api_ui/src/context/AgentUiModeContext.js` (JSDoc typedef line ~9; two `syncLegacyString` branches lines ~48/~52; `readState` validation lines ~73/~82) and `AgentUiModeContext.test.js` ("left-dock and right-dock placements" describe ~line 95). No component renders them — a user/scenario persisting `right-dock` reaches a state where no agent renders.

### Also dead (verified, folded into Phase 1 per decision)

- `banking-agent-ui-mode` CustomEvent — dispatched once at `AgentUiModeContext.js:139`, **zero listeners** anywhere in `src`. Pure dead emission.
- `useChatWidget` (`demo_api_ui/src/hooks/useChatWidget.js`) — `isLocalhost` is hardcoded `false /* always use api.ping.demo */`, so the hook unconditionally early-returns `setIsInitialized(true)`; the entire widget-control body is unreachable. Imported + called at `UserDashboard.js:13` / `:516` where it does nothing.

### Approach

- Delete the 3 orphan files (`SideAgentDock.js`, `SideAgentDock.css`, `ResponsiveAgentDock.js`).
- `AgentUiModeContext.js`: remove `'right-dock' | 'left-dock'` from the typedef; delete the two `if (state.placement === 'right-dock'/'left-dock')` branches in `syncLegacyString`; tighten `readState` so an unknown/removed placement (including a stale `'right-dock'` from storage) falls back to the safe default `'bottom'`; delete the dead `new CustomEvent('banking-agent-ui-mode', …)` dispatch (~line 139) since nothing listens.
- Delete `demo_api_ui/src/hooks/useChatWidget.js`; remove its `import` (`UserDashboard.js:13`) and its no-op call (`:516`). This is a no-behavior change (the hook does nothing) but `UserDashboard.js` is §1 — see §1/§4 below.
- `AgentUiModeContext.test.js`: remove the "left-dock and right-dock placements" describe block (tests deleted behavior); add one test asserting a stored `{placement:'right-dock'}` is read back as the safe default (`bottom`), proving the no-render dead-end is closed. If any test references the `banking-agent-ui-mode` event, remove that assertion.

### Success criteria

- `grep -rn 'SideAgentDock\|ResponsiveAgentDock\|right-dock\|left-dock\|banking-agent-ui-mode\|useChatWidget' demo_api_ui/src` returns nothing (excluding this spec / REGRESSION_PLAN history).
- Build exit 0; full agent suite green; `AgentUiModeContext` tests green incl. the new fallback test.
- No behavior change for `middle`/`bottom`/`none` users (the CustomEvent had no listeners; `useChatWidget` was a no-op).

### §1 / §4

`UserDashboard.js` is §1 (REAUTH_KEY, `middleAgentOpen` init, `fetchUserData` 401, FAB/dock/consent). The only change there is removing a dead import + a no-op hook call — no state, effect, handler, route, or control-flow line touched. The plan must state these preserved invariants before editing `UserDashboard.js`. `AgentUiModeContext.js` is not §1 but is load-bearing for placement. A §4 entry is warranted (removes a reachable no-agent state + dead emission + dead hook) — "Do not break: stale/unknown placement must fall back to a rendering mode; do not reintroduce a `banking-agent-ui-mode` listener contract or the localhost chat-widget bridge (hosted builds use the React `BankingAgent`)."

---

## Phase 2 — `embeddedFocus` route-parity (medium risk)

### The gap

`embeddedFocus` selects agent persona/copy (`'banking'` vs `'config'`). Only `EmbeddedAgentDock.js` (~line 164) derives it from route (`isConfigPage ? 'config' : 'banking'`). `UserDashboard.js` (middle) hardcodes `'banking'`; `App.js` (float) omits it (defaults `'banking'`). On `/config` in float/middle the user gets the wrong assistant.

### Approach — single source of truth

- Add pure `resolveEmbeddedFocus(pathname)` to `bankingAgentSafety.js`. Its predicate is a verbatim port of `EmbeddedAgentDock`'s current `isConfigPage` definition — not a new definition of "config route" — so the bottom dock's behavior is provably unchanged.
- Replace `EmbeddedAgentDock`'s inline ternary with `resolveEmbeddedFocus(pathname)` (behavior-identical, deduplicated).
- `UserDashboard.js` middle mount: `embeddedFocus={resolveEmbeddedFocus(pathname)}` instead of hardcoded `'banking'`.
- `App.js` float `<BankingAgent>`: add `embeddedFocus={resolveEmbeddedFocus(pathname)}`.
- Unit tests for the helper: config route → `'config'`; `/dashboard` and other routes → `'banking'`.

### Success criteria

- Helper unit tests green. `EmbeddedAgentDock` existing tests still green (proves no bottom-dock regression).
- On `/config`: all three modes now present the config persona.
- Build exit 0; full agent suite green.

### §1 / §4

No §1 logic file changed in a behavioral way (prop derivation). `App.js` is §1 but the change is purely additive (one prop). State preserved-invariants for `App.js` in the plan; §4 entry documenting the parity fix + "Do not break: `resolveEmbeddedFocus` must mirror the dock's route predicate."

---

## Phase 3 — AbortController threading (medium risk)

### The gap

`callMcpTool` ([bankingAgentService.js]) / `sendMessage` ([bankingAgentLangGraphClientService.js]) take no `signal`. On unmount/route-change, in-flight calls resolve into `setMessages`/`setNlLoading`/`appendTokenEvents` on a dead/wrong instance → React warnings + mis-attributed Token-Chain events.

### Approach

1. Service layer: optional `signal` param on `callMcpTool` and `sendMessage`, forwarded to the underlying `fetch`. Existing inline NL `fetch`es in `BankingAgent.js` already use `AbortSignal.timeout(15000)`; change to `AbortSignal.any([AbortSignal.timeout(15000), instanceSignal])` so timeout and lifecycle abort both apply.
2. Component layer: a `useRef` holding the current `AbortController`. An effect aborts it on unmount AND on route-change away from an agent route (reuse the existing route predicate). Each new send creates a fresh controller, aborting any prior in-flight one (reinforces single-flight: a superseded send is cancelled, not merely ignored).
3. `AbortError` is swallowed silently — not routed through `reportNlFailure` (an aborted call is intentional, not a user failure). `finally` blocks must not flip `nlLoading` or append token events when the controller's signal is already aborted. The prior reentrancy guard must still `release()` on an aborted send.

### Forward-compat with Phase 4

After Phase 4 the single instance rarely unmounts, so the route-change abort becomes the load-bearing lifecycle hook (the reason "unmount + route-change" scope was chosen). Phase 3 changes abort *semantics*; Phase 4 changes *where the instance lives* — independent, composable.

### Success criteria

- Helper/integration test: a wired `signal` aborts a mock fetch; `AbortError` is classified silent (no `reportNlFailure`); the reentrancy guard releases on an aborted send.
- No "state update on unmounted component" warnings in a route-change-mid-send manual check.
- Build exit 0; full agent suite green (98 baseline unchanged).

### §1 / §4

`BankingAgent.js` is §1 — additive (signal plumbing + an abort effect), no change to FAB/resize/`liveAccounts`/consent. State preserved invariants before editing; §4 entry + "Do not break: `AbortError` stays silent; abort must not double-flip nlLoading; guard must release on abort."

---

## Phase 4 — Double-mount → single instance (HIGH risk, §1)

### The problem

`App.js` `showFloatingAgent` (lines ~565-577): when `user && agentFab && onDashboardAgentRoute`, it is true even though `hasEmbeddedDockLayout` is also true → a dock `<BankingAgent>` and a float `<BankingAgent>` both mount. Two instances = split-brain `messages[]`/`pendingClarification`, dual Token-Chain writers (last-writer-wins), 2× session polling, 2× WebSocket churn.

### Target

One `<BankingAgent>` instance. Dock vs float vs middle is a **presentation/portal choice over the same instance**. `fab` is pure CSS visibility of the FAB, never a second instance. Conversation + Token Chain unify because there is exactly one instance and one writer (no new shared-state context needed — the single instance *is* the unification).

### Approach — lift one instance, surfaces are portal hosts

1. **Single stable mount.** One `<BankingAgent>` rendered once in `App.js` above route-switching, so it does not unmount on dashboard route changes (this is also what makes Phase 3's route-change abort the correct hook).
2. **Surfaces expose portal hosts, not instances.** `EmbeddedAgentDock` and the middle column stop rendering their own `<BankingAgent>`; they expose a stable container element (via ref) as a portal host and keep only their layout chrome (resize/collapse/persistence). The single instance renders its existing `floatShell` into the active host chosen from `AgentUiModeContext.placement` + route:
   - `bottom` on a dock route → portal into the dock container
   - `middle` on `/dashboard` → portal into the middle-column container
   - `none`, or no host mounted → existing `createPortal(floatShell, document.body)` float (unchanged)
   - `fab` → CSS visibility of the FAB over that one instance.
3. **Why portals not conditional remount:** a portal relocates the same React subtree (and its state) between DOM hosts without unmounting; conversation survives a dock↔float toggle. Conditional re-render in different parents would remount and wipe `messages[]`, reintroducing split-brain on every layout change.
4. **Dock wrappers become chrome only** — resize/collapse/`localStorage` persistence unchanged; they no longer own an agent.

### Staged migration (each step independently testable)

- **4a:** Introduce the portal-host indirection + single mount, but only for `placement === 'none'` (float). Behavioral no-op for float users — proves the lift mechanism with zero user-visible change.
- **4b:** Migrate `bottom` to portal-host; remove `EmbeddedAgentDock`'s own `<BankingAgent>`.
- **4c:** Migrate `middle` to portal-host; remove `UserDashboard`'s own `<BankingAgent>`.
- **4d:** Delete the now-dead duplicate float mount path in `App.js`; `fab` becomes CSS-only. `showFloatingAgent`'s double-mount override clause removed.

Each of 4a–4d: build gate + full 98-test agent suite + targeted manual smoke (dashboard middle/bottom/float, FAB, Token Chain shows events, consent modal still gates).

### §1 invariants explicitly preserved (state before editing each)

- BankingAgent FAB visibility semantics (App.js / BankingAgent.js rows)
- Float panel resize 90% caps / no max-dimension (BankingAgent.css + handleResize)
- `liveAccounts` hydration from `GET /api/accounts/my`
- Consent / `hitlPendingIntent` gating, REAUTH_KEY guard, marketing-guest float behavior
- Bottom-dock-on-dashboard-routes behavior (App.js / EmbeddedAgentDock rows)

### Success criteria

- Exactly one `<BankingAgent>` mounts in every placement×fab combination (assert via a test counting instances / a render-count probe).
- Conversation persists across a dock↔float toggle (manual + a focused test if feasible).
- Single Token-Chain writer; session polling/WS once.
- Full agent suite green at each of 4a–4d; build exit 0.
- §4 entry documenting "single instance, portaled surfaces" + "Do not break: never render a second `<BankingAgent>`; surfaces are portal hosts."

### Risk

Highest. Mitigation = the staged none→bottom→middle→cleanup migration with the full suite + build gate at each step, and a §4 invariant so the second mount can't be reintroduced silently.

---

## Cross-phase testing

After each phase: `cd demo_api_ui && npm run build` (exit 0) + `CI=true npx react-scripts test src/__tests__/BankingAgent.test.js src/__tests__/BankingAgent.safety.test.js src/__tests__/BankingAgent.integration.test.js src/__tests__/BankingAgent.chipRouting.test.js src/context/__tests__/AgentUiModeContext.test.js --watchAll=false` (98+ baseline green, plus new tests).

## Out of scope

- The `useState`→`useReducer` decomposition of the auth-challenge/HITL clusters (separate, larger refactor; not a correctness defect).
- Any change to the safety-fix behavior shipped in `d6992bf1`/`2a28f6ac`/`e47038fa`.

(The dead `banking-agent-ui-mode` CustomEvent and dead `useChatWidget.js` were folded into Phase 1 per decision — see "Also dead" above.)
