# Plan — Agent UI: Clinical Split (Option 2B refined)

**Status:** proposed
**Mockup:** [docs/mockups/agent-ui-redesign/option-2b-refined.html](../../mockups/agent-ui-redesign/option-2b-refined.html)
**Scope:** redesign the **inline dashboard** Agent UI to the 2B refined clinical-split layout (chat-left, audit-timeline-right) with a 3-tab cognitive model (**Talk · Inspect · Configure**), retire the Middle/Float/Always-float toggle, and introduce a **single placement choice** (Inline OR Floating) selected in the Configure tab. When the user picks **Floating**, the inline split disappears entirely and the dashboard reclaims the full page; the FAB popover gains a **Chat · Token chain · Rules** tab switcher so the token-chain audit surface is still one click away.

---

## 1 · Goal & non-goals

### Goal
Make the agent feel professional and banking-grade. Reduce the dashboard's ~12 peer toolbar controls to a single 3-tab segmented control. Move the token-chain inspector from a 40 %-of-viewport billboard above the agent into a sibling column next to the chat, with explicit visual states for every production scenario (in-flight, HITL 428, token error, session expired, multi-tool chain, mobile).

### Non-goals
- Touching the floating FAB's outer visual (button, position, breathing pulse). The popover surface inside the FAB **does** get the new tab switcher — that's an additive change, not a redesign of the FAB itself.
- Replacing [`BankingAgent.js`](../../../demo_api_ui/src/components/BankingAgent.js) wholesale. It stays as the chat surface; we're rewrapping it, not rewriting it.
- Migrating any data layer — same `TokenChainContext`, same `apiTrafficStore`, same `bffAxios`, same MCP plumbing.
- Marketing pages, Admin View, Setup, Delegation — all keep their existing chrome.

---

## 2 · Success criteria

- `cd demo_api_ui && npm run build` exits **0**.
- `npm test` in [`demo_api_ui/`](../../../demo_api_ui) passes with `App.structure` green (REGRESSION_PLAN §1 gate).
- Visual (Inline placement, default): on `/dashboard`, the page contains exactly one agent surface (left chat + right timeline), one 3-tab rail at the top, and zero peer controls between them. Theme dropdown / Middle-Float toggle / Always-float checkbox / Controls button are gone.
- Visual (Floating placement): on `/dashboard`, no agent chrome at all — the 3-tab rail is hidden, banking content (balances, activity) is full-width. A single FAB at bottom-right opens a 360-px popover with a `Chat · Token chain · Rules` tab switcher. Configure is reachable from the popover ⋯ menu.
- Real states render correctly when triggered: HITL 428 shows the gold inline card + held token row; expired user_token shows the gold session pill + rose subject row + held-request preservation card; multi-tool calls render one timeline group per call.
- The floating FAB on `/marketing`, `/admin/*`, `/configure`, `/delegation` looks identical to today, but its expanded popover now has the tab switcher (which was always implicit — chat was the only tab — and is now explicit).

---

## 3 · Files touched (estimated impact)

| File | Action | Why |
|------|--------|-----|
| [`src/components/UserDashboard.js`](../../../demo_api_ui/src/components/UserDashboard.js) | **Edit (heavy)** | Owns the `split3` layout that this plan replaces. Becomes the host for the new 3-tab rail. |
| [`src/components/agent-clinical/`](../../../demo_api_ui/src/components) (new dir) | **Create** | Houses the four new components: `AgentTabsRail`, `TalkPane`, `InspectPane`, `ConfigurePane`. Plus a fifth — `TokenAuditTimeline` — extracted from `TokenChainDisplay` reuse. |
| [`src/components/BankingAgent.js`](../../../demo_api_ui/src/components/BankingAgent.js) | **Edit (light)** | Keep all chat/tool logic. Strip the inline header chrome (chips, layout toggle, theme dropdown) that the new rail subsumes. New prop: `chrome="rail"` to opt out of the legacy toolbar render. |
| [`src/components/BankingAgent.css`](../../../demo_api_ui/src/components/BankingAgent.css) | **Edit (light)** | Add a `.ba-mode-clinical` class that suppresses the legacy embed chrome and tightens dock padding. Do **not** touch the `.banking-agent-fab` block. |
| [`src/components/AgentUiModeToggle.js`](../../../demo_api_ui/src/components/AgentUiModeToggle.js) + `.css` | **Delete** (or no-op stub) | Middle/Float/Always-float is retired. If anything imports it, replace with an inert stub for one release before deletion. |
| [`src/context/AgentUiModeContext.js`](../../../demo_api_ui/src/context/AgentUiModeContext.js) | **Edit (medium)** | `placement` becomes the **single** placement toggle, written by Configure tab (`inline` or `floating`; "none" / "middle" are mapped to `floating` / `inline` on read for backward compat). `fab` field is retired — there is no longer a "both at once" mode. Keep storage keys to preserve user preference across redeploys. |
| [`src/components/agent-clinical/AgentFabPopover.jsx`](../../../demo_api_ui/src/components) (new) | **Create** | Hosts the Chat / Token chain / Rules tab switcher inside the existing `.banking-agent-fab` open state. Reuses `BankingAgent` for Chat tab, `TokenAuditTimeline` for Token chain tab, `AuthorizeRulesPanel` summary for Rules tab. ⋯ menu has "Switch to inline mode" + "Open Configure" actions. |
| [`src/App.js`](../../../demo_api_ui/src/App.js) | **Edit (light)** | Drop the dashboard-only AgentUiModeToggle render. Keep the FAB-portal logic unchanged. App-level routing untouched. |
| [`src/components/AuthorizeRulesPanel.jsx`](../../../demo_api_ui/src/components/AuthorizeRulesPanel.jsx) | **Edit (none on file, repositioned)** | Move into the new `ConfigurePane`. No code change to the panel itself. |
| [`src/components/ActivityLogPanel.js`](../../../demo_api_ui/src/components/ActivityLogPanel.js) | **Edit (none on file, repositioned)** | Move into the new `InspectPane`. Reuse as-is. |
| [`src/components/TokenChainDisplay`](../../../demo_api_ui/src/components) | **Edit (medium)** | Extract the timeline-card renderer into the new `TokenAuditTimeline`. Old call site keeps a thin wrapper for backward compat. |
| `__tests__/App.structure.test.js` | **Edit (medium)** | Update assertions: split3 panels gone, AgentTabsRail expected, TokenChainDisplay no longer in default dashboard layout. |
| `REGRESSION_PLAN.md` | **Edit (§1 + §4)** | Add the new rail / pane components to §1 protected list. Add a §4 entry for this redesign. |

**Estimated touch:** 7 files edited, 5 new files, 2 deleted/stubbed. ~600-900 lines net new code, ~400 lines removed (toggle, peer toolbar controls, old split3 plumbing). Almost no diff against the 5,725-line `BankingAgent.css` — new styles live in `agent/AgentTabsRail.css` etc., scoped under `.agent-clinical-host`.

---

## 4 · Step-by-step

### Phase 1 — Foundation (no UX change yet)
1.1. Create [`src/components/agent-clinical/`](../../../demo_api_ui/src/components) with placeholder exports: `AgentTabsRail`, `TalkPane`, `InspectPane`, `ConfigurePane`, `TokenAuditTimeline`. Each exports a `() => null` stub.
1.2. Add the design tokens from the mockup (`--teal: #0d6760`, `--rule`, `--ink`, etc.) to a new `agent/clinical.css` scoped under `.agent-clinical-host`. No globals.
1.3. Verify: `npm run build` still 0. No visible change.

### Phase 2 — Talk pane (default scene)
2.1. Move the existing `BankingAgent` render into `TalkPane`. Pass `chrome="rail"` so the legacy toolbar is suppressed (one-line CSS gate on `.ba-mode-clinical`).
2.2. Build the right-column `TokenAuditTimeline` by extracting the timeline-card renderer from `TokenChainDisplay`. Subscribe to the same `TokenChainContext`; render in the new clinical card style.
2.3. Compose into `<AgentClinicalHost>`: rail at top, two-column grid below.
2.4. Wire it in [`UserDashboard.js`](../../../demo_api_ui/src/components/UserDashboard.js) under a feature flag `ff_agent_clinical_split` (default off). When off → existing behavior. When on → new layout.
2.5. Verify: turn flag on; basic chat + token chain works end-to-end. `App.structure` test passes (it doesn't yet check for the new components, just that nothing existing broke).

### Phase 3 — Real states
3.1. **In-flight:** observe `BankingAgent` `loading` / `isStreaming` state; render the thinking-dots bubble + disabled composer. Timeline shows pending tokens (outline-only dots, skeleton rows). Hook: existing AG-UI `useAgentRun` already exposes this.
3.2. **HITL 428:** the existing `TransactionConsentModal` flow already provides the 428 signal via `pendingActionManager`. Replace the modal mount on this layout with an inline `<InlineConsentCard>` rendered in the chat thread + a gold "Held by policy" timeline row. The modal stays available on legacy layout.
3.3. **Token error:** subscribe to `tokenEvents` for failure markers (`actClaimAbsent`, `actMismatch`). Render the rose inline card + recovery actions (Re-authenticate → existing `navigateToCustomerOAuthLogin`; Open inspector → switch to Inspect tab; Copy diagnostics → existing `tokenchain_explain` MCP tool).
3.4. **Session expired:** existing `SessionExpiryTimer.jsx` already fires an event at exp-reach. Convert from a modal to an inline gold card + a "Held request" preservation panel that stores the in-flight tool call + params in `sessionStorageService` under `bx_agent_held_request`. On post-auth callback, replay it through `BankingAgent.sendAgentMessage`.
3.5. **Multi-tool chain:** the timeline already gets one `tokenEvents` push per MCP call; just group consecutive calls by `messageId`. Render one timeline group per call with header `Call N of M · tool_name · latency`.
3.6. Verify: each state can be triggered from the running app. Run `npx jest hitlRoute.regression hitlRoute.integration oauthStatus.regression oauthStatus.integration` — all 43 pass.

### Phase 4 — Inspect tab
4.1. Implement `InspectPane` as a wrapper around the existing `ActivityLogPanel`. Reuse the panel's data layer; only the chrome changes (read-only table + status badges + filter chips).
4.2. Right column hosts the timeline + alert digest from `appEventClient`.
4.3. Keyboard: `2` switches to Inspect.

### Phase 5 — Configure tab
5.1. Implement `ConfigurePane`. Form fields write to `configStore.setEffective(key, value)` — same write path as `/configure` page. Reuse existing field defs (`FIELD_DEFS`).
5.2. Right column = live `pingone_get_app` MCP tool output for the current vertical's AI_AGENT app. Wrap the existing `cachedStatusService` call.
5.3. Move `AuthorizeRulesPanel` into a `<Section title="Authorize rules">` here. No code change to the panel; just a different mount point.
5.4. Keyboard: `3` switches to Configure.

### Phase 6 — Mobile layout
6.1. Add `@media (max-width: 768px)` block in `agent/clinical.css`: stack split into single column; render a `<ViewToggle value="chat|timeline" />` segmented control inside Talk; show one or the other.
6.2. Inspect/Configure tabs collapse the same way.
6.3. Verify in DevTools at 390 × 800 (iPhone-class).

### Phase 7 — Retirement of old toggle
7.1. Remove `<AgentUiModeToggle>` mounts from the dashboard toolbar.
7.2. Stub `AgentUiModeToggle.js` to render `null` (don't delete the file yet — Phase 8 deletes it after one release).
7.3. `AgentUiModeContext.setAgentUi({placement})` now accepts only `inline` or `floating`. Legacy values (`middle`, `none`) coerce on read: `middle` → `inline`, `none` → `floating`. The `fab` field is removed from the writable surface; reads return `placement === 'floating'` for one release to keep older consumers compiling.
7.4. Update `App.structure.test.js` to expect the new rail and not the toggle.

### Phase 8 — Cleanup (separate PR, after one release)
8.1. Delete `AgentUiModeToggle.{js,css}`.
8.2. Remove `placement` from `AgentUiModeContext` entirely; keep `fab` only.
8.3. Remove dead CSS in `BankingAgent.css` that supported the `.ba-mode-inline` legacy embed.

---

## 5 · REGRESSION_PLAN impact

### §1 protected list — add
- `src/components/agent-clinical/AgentClinicalHost.jsx` — owns the inline dashboard agent
- `src/components/agent-clinical/AgentTabsRail.jsx` — the only chrome control
- `src/components/agent-clinical/TokenAuditTimeline.jsx` — replaces TokenChainDisplay in clinical layout

### §1 protected list — keep
- `src/components/BankingAgent.{js,css}` — chat still lives here
- `.banking-agent-fab` button (the outer FAB) — untouched on all routes
- `src/context/AgentUiModeContext.js` — context boundary kept; `placement` semantics change but the consumer API (`useAgentUiMode()`) stays the same shape

### §4 entry (template, fill in PR)
```
- 2026-MM-DD · feat(agent-ui) · clinical-split inline layout on /dashboard
  - Replaced split3 layout + Middle/Float toggle with AgentClinicalHost (Talk/Inspect/Configure tabs)
  - Floating FAB on non-dashboard routes unchanged
  - Behind ff_agent_clinical_split; default on after one release if no regressions
  - Verified: App.structure green, build 0, HITL + OAuth + session tests green
```

---

## 6 · Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **`App.structure.test.js` brittleness.** It asserts on the existing toolbar + panels. | Update test once in Phase 2 to expect the new structure under `ff_agent_clinical_split=on`; keep legacy-off assertions running. |
| **`TokenChainContext` consumers elsewhere.** Other pages may subscribe. | `TokenChainDisplay` keeps its current public component; new `TokenAuditTimeline` is a sibling, not a replacement. |
| **Held-request replay corrupting sessionStorage.** | Use a single namespaced key (`bx_agent_held_request_v1`), ttl = 5 min via timestamp, clear on resume or cancel. Existing `pendingActionManager` already does this for HITL. Reuse it. |
| **HITL inline card vs `TransactionConsentModal`.** Both could fire. | Layout owns the choice: `AgentClinicalHost` renders inline, suppresses the modal; legacy layout still uses the modal. One signal source, two render paths. |
| **Scope creep into `BankingAgent.js`'s 9,049-line file.** | Hard rule: this redesign does not edit chat logic, NL routing, or LangChain handling. Only the wrapper render is rewrapped. |

---

## 7 · Out of plan / explicit non-changes

- Floating FAB visual or behavior
- Marketing page agent embed
- Admin View agent rendering
- The `/configure` page itself (the new Configure **tab** writes to the same `configStore`, doesn't replace the page)
- Vertical theme system, NL intent routing, MCP plumbing, RFC 8693 exchange logic

---

## 8 · Estimated effort

- **Phases 1-2 (foundation + default Talk):** 1 day. Mostly mechanical reorganization.
- **Phase 3 (real states):** 1.5 days. The HITL inline-card swap and held-request preservation are the highest-risk pieces.
- **Phases 4-5 (Inspect + Configure):** 0.5 day. Both are wrappers over existing panels.
- **Phase 6 (mobile):** 0.5 day. CSS only.
- **Phases 7-8 (retirement + cleanup):** 0.5 day total, split across two PRs.

**Total: ~4 days of focused work** behind a feature flag, with one cleanup PR a week later.

---

## 9 · Open questions for review

1. **Should Phase 8 cleanup ship in the same PR as Phase 1-7,** or wait a release? Recommend wait — gives a rollback path if a HITL or expired-token scenario surfaces something the mockup didn't cover.
2. **Configure tab vs `/configure` page** — keep both, or migrate `/configure` into the tab eventually? Recommend keep both for now; the `/configure` page is reached during setup before any agent layout exists.
3. **Inspect tab vs `/admin/activity` route** — same question. Recommend keep both; the route is admin-only, the tab is per-session.

## 10 · Resolved decisions (from mockup review · 2026-05-28)

1. **Placement is single-choice (Inline OR Floating), not coexistence.** Resolved on review of mockup scene 13 (FAB + inline coexistence) — both surfaces felt redundant and added dual-state complexity. Mockup scene 14 added to show what Floating looks like; user picked **Option A — Banking reclaims the space.**
2. **Toggle lives in Configure tab → Agent placement.** No always-visible chrome control. One-line setting written to `configStore`.
3. **Default = Inline** on first load. Float is opt-in via Configure.
4. **In Floating mode, the FAB popover gets a 3-tab switcher: Chat · Token chain · Rules.** Configure stays reachable from ⋯ menu in popover header. Inspect is intentionally not in the FAB to keep the surface small — switch to inline to use Inspect.
5. **No "switch back" affordance on the dashboard itself in Floating mode.** Reachable from FAB popover ⋯ menu → "Switch to inline mode." Same one-click cost as the Configure-tab route, just discoverable without leaving the FAB.
