# Focus Mode — Filmstrip Layout (Option C) — Design Spec

**Date:** 2026-08-08
**Status:** Draft — awaiting approval
**Supersedes:** [`2026-08-07-focus-mode-dashboard-design.md`](./2026-08-07-focus-mode-dashboard-design.md) (Option A — fixed 380px rail)
**Scope:** `demo_api_ui` — new `TokenChainFilmstrip.jsx` + `UserDashboardPing2026.js` middle branch + `UserDashboard.css`

---

## Why this replaces Option A

Option A put the token chain in a fixed 380px right column. Reviewed against the goal — *this demo is about the evidence* — that renders the evidence permanently in the narrowest column on screen, which is backwards. Option C (filmstrip) gives the agent full width and lays the chain along the bottom, where a click can raise a detail sheet across the **whole** width.

The decisive constraint discovered during review: **the token chain rail is a shared service.** `TokenChainTraceRail.jsx` mounts on ~20 surfaces (`ProofOfEnforcementContext.js:266` says so in a comment). Option A's plan modified the dashboard's use of it; Option C must not modify the rail at all.

---

## Non-negotiable: the shared rail is frozen

`TokenChainTraceRail.jsx` is **not modified by this work.** Current consumers, all of which must render byte-identically after this change:

| Surface | File |
|---|---|
| Frozen classic dashboard (×3 placements) | `UserDashboard.js` |
| Ping2026 dashboard (×3 placements) | `UserDashboardPing2026.js` |
| Standalone route `/monitoring/token-chain` | `routes/MonitoringRoutes.js` |
| Architecture diagram | `ArchitectureDiagramPage.js` |
| Vertical feature page | `VerticalFeaturePage.jsx` |
| API-key path page | `ApiKeyPathPage.jsx` |
| Access/ID token path page | `AccessIdTokenPathPage.jsx` |
| Mortgage path page | `MortgagePathPage.jsx` |
| Unified token flow inspector | `UnifiedTokenFlowInspector.jsx` |
| Token chain education panel | `education/TokenChainEducationPanel.js` |
| Token chain modal | `TokenChainModal.js` |
| Floating token chain panel | `FloatingTokenChainPanel.js` |
| Actor token education | `ActorTokenEducation.tsx` |
| Learning Hub | `LearningHub.tsx` |
| Admin dashboard | `Dashboard.js` |
| Vertical ops console (passes `mcpRouteOnly`) | `verticalOps/VerticalOpsConsole.jsx` |
| Dev tools dashboard | `DevToolsDashboard.jsx` |
| OAuth academy | `OAuthAcademyPage.jsx` |
| Live use case workbench | `pages/LiveUseCaseWorkbenchPage.js` |
| Delegated commerce | `pages/DelegatedCommercePage.jsx` |
| Agent lifecycle | `pages/AgentLifecyclePage.jsx` |

---

## Component split

```
services/tokenChainTrace/tokenChainTraceStore.js ─┬─▶ TokenChainTraceRail.jsx    (vertical, FROZEN)
services/tokenChainTrace/buildTraceSteps.js      ─┘
                                                  └─▶ TokenChainFilmstrip.jsx   (horizontal, NEW)
```

`TokenChainFilmstrip.jsx` is a **sibling, not a fork**. It subscribes to the same store, derives steps with the same `buildTraceSteps` / `buildLiveTokenChainSteps`, and renders the same child components:

`TraceStepCard` · `TraceTokenSummary` · `TraceMcpPanel` · `TraceTrustPanel` · `SimpleStepper` · `DetailedStepper` · `TokenChainDemoTrackTab` · `ClaimDetailsModal` · `TokenLegendModal`

All nine already exist as standalone modules, so tab behaviour has one implementation. Only geometry is new.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Topbar (existing, unchanged)                                      │
├──────────────────────────────────────────────────────────────────┤
│ Config strip (42px) — existing toolbarHostRef portal target       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Agent host — full width, flex:1                                 │
│   (BankingAgent portals into ud-dashboard-inline-agent-host)      │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│ ▐ Token Chain   [Live|Classic]           A- 100% A+  Clear Legend │  ← rail header
│ ● User → ● Agent → ● MCP                              CHAINED     │  ← chain line
│ Token Chain | Tokens | MCP 4 | Trust | Simple | Detailed | Track  │  ← tabs
│ LIVE PIPELINE — "Move $500 from checking into savings."           │  ← section label
│ [01 website]→[02 signin]→[03 prompt]→ … →[16 reply]   (h-scroll)  │  ← filmstrip
└──────────────────────────────────────────────────────────────────┘
                    ↑ clicking a step or a tab raises the sheet ↑
```

**16 steps are kept, not collapsed to lanes.** Horizontal scroll is accepted: detail fidelity beats seeing the whole chain at once, because the demo is about the detail.

### Two-level content model

The rail's content has two levels, so the UI has two:

- **Chain-level** — the seven tabs, `Live/Classic`, zoom, `Clear`, `Legend`, chain line and `CHAINED` badge live on the rail header. These are chain-wide and cannot nest under one step.
- **Step-level** — clicking a step raises the sheet with that step's `TraceStepCard` body.

Both render into **one sheet** (`max-height: 78%`), which is what lets detail win without the rail crowding the agent.

---

## What the sheet must show for a step

Full `TraceStepCard` parity — this is the reason for the redesign, so nothing may be dropped:

| Section | Source |
|---|---|
| `narrative` | `NARRATIVES` in `buildTraceSteps.js` |
| `why` — "Why this run:" | per-step `why`, generated for exchange by `exchangeWhy` |
| `scopeDiff` — before → after, with "← scope after exchange:" | `scopeDiff` (exchange step only) |
| `kv` grid — act chain, exchange method, audience (incl. `MISMATCH`) | `kv` |
| `rfc` chips | `STEP_RFCS` |
| `beforeAfter` two columns with `claimDiffs()` highlighting | `exchangeBeforeAfter` |
| `request` / `response` / `altRequest` / `altResponse` | step detail |
| "→ Pop out full detail" | `openStepTeachingWindow(step, useCase)` |
| "Inspect" → `ClaimDetailsModal` | `inspectToken` |

The `beforeAfter` claim diff is the single strongest explainer of RFC 8693 delegation and must be prominent.

---

## What does NOT change

- `TokenChainTraceRail.jsx` — zero diff
- All nine shared child components — zero diff
- `tokenChainTraceStore.js`, `buildTraceSteps.js` — zero diff
- `UserDashboard.js` (frozen classic) — zero diff
- `placement: 'bottom'` and `placement: 'none'` branches of `UserDashboardPing2026.js`
- `AgentUiModeContext`, `EmbeddedAgentDock`, `BankingAgent` internals
- Auth, token exchange, BFF wiring
- Emoji allowlist: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`

---

## Success criteria

1. `placement: 'middle'` renders agent full width with the filmstrip below; no banking column.
2. All 16 steps render in order with correct lane colour and `ran`/`skipped` status.
3. Clicking a step raises the sheet with full `TraceStepCard` parity (table above).
4. All seven tabs render their existing panel components in the sheet.
5. `Live/Classic`, zoom (0.8–1.6, step 0.1), `Clear`, `Legend` behave as in `TokenChainTraceRail`.
6. `TokenChainTraceRail.jsx` has **zero** diff; a guard test asserts it.
7. Every one of the ~20 existing rail surfaces renders unchanged — `/monitoring/token-chain` verified live.
8. `UserDashboard.js` has zero diff — guard test asserts it.
9. `npm run test:unit` and `npm run build` green.
10. `agentColumnRef`, `ud-agent-column`, and the config-strip slot are retained (the three defects the Option A v2 plan caught).
11. No `{!user && …}` login prompt is reintroduced — PR #1450 removed it deliberately.

---

## Files touched

| File | Change |
|---|---|
| `demo_api_ui/src/components/TokenChainFilmstrip.jsx` | **Create** — horizontal layout over the shared store and children |
| `demo_api_ui/src/components/TokenChainFilmstrip.css` | **Create** — filmstrip, rail header, sheet |
| `demo_api_ui/src/components/UserDashboardPing2026.js` | Modify — replace middle branch (3512–3602); delete dead FAB (3663–3684) and orphaned `middleAgentOpen` |
| `demo_api_ui/src/__tests__/FocusModeLayoutGuard.test.js` | **Create** — guards incl. zero-diff assertions for the shared rail and classic dashboard |

---

## Open item — evidence values

The Option C mock currently carries **illustrative** values for `decisionId`, hop durations, `exp`/`iss`, LLM token counts and the Demo Track gauntlet score. The step model, titles, lanes, narratives, skip reasons, token metadata, Trust copy, product labels, accounts and scopes are all real.

Before this ships as a demo asset, those figures should be replaced with a captured run: sign in at `local.ping-devops.com:4000`, execute the $500 transfer, and read the resulting `tokenChainTraceStore` payload. Not a blocker for implementing the layout.
