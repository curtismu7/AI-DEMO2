# Pre-Demo Check Page — Design

**Date:** 2026-07-11
**Status:** Approved (design)
**Author:** brainstormed with Curtis

## Problem

Before running a live demo, the presenter has no single place to confirm the
environment is actually demo-ready. Feature flags may be set for "real" mode
(real PingOne Authorize, real PingOne Agent Gateway) but the underlying service,
credentials, or model may be down or misconfigured — and today that only
surfaces mid-demo when a chip "vanishes" or a transaction hangs.

We want a **Check** page that runs a list of checks and tells the presenter, at
a glance, **READY / NOT READY**, before the demo starts.

## Goals

- One page, one "Run all checks" button, a clear top-level READY / NOT READY verdict.
- Checks are **both**:
  - a **fixed suite** that always runs (all servers up, config/secrets present), and
  - **flag-driven** checks that adapt to the current feature-flag configuration.
- Explicitly answer the presenter's key questions:
  - Is **PingOne Authorize** running **real** or **Demo/simulated** — and does the real path actually work?
  - Is the **Agent Gateway** the **real PingOne Agent Gateway** or the **Demo** one — and does the active one actually work?
  - Are **all servers** running?
  - Does a **chip go all the way through** end-to-end (real full run)?
  - Which **LLM models** are working and usable in the demo?

## Non-Goals

- Not changing any feature flag, OAuth scope, or PingOne configuration. The page
  is read/probe-only; it never mutates flags or config. (See `[[no-scope-changes]]`.)
- Not replacing the existing **Servers** page (live inventory) or **Feature
  Flags** page — it complements them.
- Not a continuous monitor. It runs on demand.

## Users & Access

- **Any logged-in user** (same access level as the Servers page). Anyone about
  to run the demo can self-check readiness. Not admin-gated.

## Architecture

Backend-driven. The browser page is a thin renderer; all probing happens
server-side where worker credentials, internal service URLs, and the agent
pipeline live.

### Check engine (`demo_api_server/services/checkService.js`)

A registry of **checks**. Each check is a unit:

```
{
  id:        'servers.all_up',
  name:      'All servers running',
  category:  'Servers',
  appliesWhen(flags): boolean,   // default () => true for fixed-suite checks
  async run(ctx): { status, detail, meta? }
}
```

- `status` ∈ `pass | fail | warn | skip`.
- `detail` is a short human string; `meta` carries structured extras (e.g. the
  active mode, per-model results) for richer rendering.
- `ctx` provides: current resolved feature flags, an internal HTTP client with a
  demo user/worker token, and helpers to reach services by their compose names.

The engine:
1. Resolves current feature flags (same source the Feature Flags page reads: `FLAG_REGISTRY` + persisted overrides).
2. Selects checks where `appliesWhen(flags)` is true (fixed-suite checks always apply).
3. Runs them, emitting each result as it completes.

**Flag-driven preconditions.** Flag-adaptive checks live in the registry and
gate themselves via `appliesWhen`. Example: the "real P1AZ decision endpoint
reachable" check has `appliesWhen = flags => flags.ff_authorize_simulated === false`.
This keeps the flag→precondition mapping in the check registry (not scattered),
and means adding a check is a local change.

### Routes (`demo_api_server/routes/check.js`, mounted `app.use('/api/check', authenticateToken, ...)`)

- `GET /api/check/catalog` — returns the checks that **would** run given the
  current flags (id, name, category, and for flag-driven ones the flag context),
  so the page can render the list before running.
- `POST /api/check/run` — runs the selected checks (default: all applicable
  except the two heavyweight opt-in probes below). Streams results via **SSE** so
  long-running checks show live progress. Body may include
  `{ only: [...ids|categories], vertical, useCaseId, deepLlm: boolean }`.

Heavyweight checks are **opt-in** so "Run all" stays fast by default:
- the **real end-to-end chip test** (real full run), and
- the **deep LLM test** (forced completion against every model).

Both are triggered by explicit buttons / flags on the page.

## The Checks

### Category: Servers (fixed)
- **All servers running** — reuse `GET /api/health/inventory` (the source the
  Servers page already uses); fail-list any expected service that is down.

### Category: PingOne Authorize (flag-driven + **specific real-decision test**)

These must do more than "endpoint reachable" — they must prove a **real PingOne
Authorize decision** comes back. We reuse the existing force-live test path.

- **Authorize mode** — always reports the active mode from `ff_authorize_simulated`
  (`OFF` = real PingOne, `ON` = Demo/simulated). Badge: **Real P1AZ** vs **Demo**.
  Simulated is a `pass` with a "Demo mode" note (not an error — it's a valid demo choice).
- **Real P1AZ decision (specific test)** — reuse
  `POST /api/authorize/test-evaluate` with `{ forceLive: true, amount, type }`.
  This bypasses the enable flag and simulated branch and calls the **configured
  PingOne decision endpoint directly** (`evaluatePingOneTransaction`). Assert:
  `ok === true`, `engine === 'pingone'`, `decision ∈ {PERMIT, DENY}`, and a
  `decisionId` is present (proof a real policy evaluated). Map the known failure
  modes to actionable messages:
  - `409 pingone_not_configured` ⇒ **fail**: worker creds or decision endpoint id missing.
  - `502 pingone_evaluation_failed` ⇒ **fail**: real call failed — surface `message`
    (bad worker creds, policy-not-found, region/URL wrong, recordId 400, timeout).
  - Run at least two shaped inputs (a small PERMIT-expected and a large
    DENY/step-up-expected) so the test proves the **policy actually discriminates**,
    not just that a call succeeds.
  - `appliesWhen`: always available to run (force-live works regardless of the
    live-enable flag), but when `ff_authorize_simulated === true` the result is
    labeled "real path verified (simulated is active for the demo)" so the
    presenter knows the real path works even while demoing in simulated mode.
- **Fail-open awareness** — `warn` if `ff_authorize_fail_open === false` (mid-demo
  Authorize errors will hard-deny transactions). Informational, not a failure.

### Category: Agent Gateway (flag-driven + **specific real-path test**)

The real PingOne Agent Gateway (IG) path must be proven end-to-end, not just
pinged. We reuse the three graded PingGateway test endpoints in
`pinggatewayTestRoutes.js`, run in order so a failure pinpoints the exact hop:

- **Gateway mode** — reports active gateway from `ff_mcp_gateway_pinggateway`
  (`ON` = real PingOne Agent Gateway / IG, `OFF` = Demo Agent Gateway). Badge:
  **Real PingGateway** vs **Demo**.
- **IG introspection (specific test)** — `POST /api/admin/pinggateway/test/introspect`
  with a freshly minted demo token; assert the IG returns an `active: true`
  introspection (proves McpProtectionFilter → introspection/JWKS config works).
- **IG authorize (specific test)** — `POST /api/admin/pinggateway/test/authorize`;
  assert a real P1AZ decision returns **through the gateway** (proves the IG's
  PingOneAuthorizeClient / X-Authz-Simulated wiring mirrors the direct P1AZ test).
- **IG MCP tool call (specific test, the proof)** —
  `POST /api/admin/pinggateway/test/mcp-call` with a known tool; assert a **real
  `tools/call` result** comes back through the IG. This is the end-to-end proof:
  it exercises inbound introspection **and** the RFC 8693 token exchange
  (gateway-brokered or bff-brokered per `ff_gateway_brokered_exchange`) **and**
  the backend MCP server. `fail` surfaces the failing hop and status
  (401 introspection, 403 authorize deny, `hs256_secret_not_configured`, exchange
  failure, backend MCP error).
- **Gateway token-validation prereqs** — `appliesWhen: ff_mcp_gateway_pinggateway === true`.
  Verify prerequisites for the current `ff_mcp_gateway_jwks` setting (e.g. the
  simulated-authorize + local-JWKS combo requires `AUTHZ_JWT_SECRET` in
  `ping-gateway/.env`); `fail` early with the exact missing key so the presenter
  fixes config rather than chasing a downstream 401.
- **Demo gateway path** — when `ff_mcp_gateway_pinggateway === OFF`, probe
  `demo_mcp_gateway` health instead (the specific IG tests are skipped).

### Category: Config / Secrets (fixed + flag-driven)
- **Required config present for the current flag combo** — each flag-driven check
  above contributes its own prerequisite verification; this category also covers
  always-required demo config. Missing prereq ⇒ `fail` with the exact missing key
  and where it belongs.

### Category: LLM (fixed + opt-in deep)
- **LLM proxy status** (default) — read `demo_llm_proxy /status`: list every
  configured model (tiers) with `healthy`/loadable state and the currently-loaded
  tier. Do **one** real minimal completion against the currently-loaded model to
  confirm it actually generates. Other models reported as "available (not loaded)".
  `meta` carries per-model results so the page shows exactly which models are
  demo-ready. Account for flag-gated providers: report `ff_bedrock_llm` /
  `ff_helix_lmstudio_fallback` / `llm_framework` and whether the provider's
  endpoint/config is present.
- **Deep LLM test (all models)** (opt-in button) — force a real tiny completion
  against **every** configured model, swapping as needed. Highest confidence, but
  can take minutes per swap (20B load). Surfaced as a separate "Deep LLM test"
  button, not part of the default run, with an explicit "this may take several
  minutes" note.

### Category: End-to-end chip test (opt-in, real full run)
- **Chip goes all the way through** — execute a canonical use case through the
  **real** agent pipeline (`POST /api/agent/run`, the same stream the action
  chips use) with a demo user token. Assert it completes with a **successful tool
  result** (agent → Authorize → gateway → MCP tool → response), not an error or
  empty result. `fail` surfaces the hop that broke.
  - **Vertical + use case are configurable** on the page (dropdowns), defaulting
    to **banking** and a banking transfer use case that exercises the full
    agent→P1AZ→gateway→MCP chain (the path where "chips vanish" bugs appear).
  - Runs against whatever real/demo mode the flags currently select — so it
    validates the actual configuration that will be demoed.

## Frontend (`demo_api_ui/src/pages/CheckPage.jsx`, route `/check`)

- Follows the existing appShell page pattern (like `ServersPage`): imported and
  routed in `App.js` at `/check`, wrapped in the standard shell, visible to any
  logged-in user (same guard as `/servers` — `authenticateToken` only, no admin gate).
- **Side-nav entry** in `demo_api_ui/src/components/AdminSideNav.jsx` (the app's
  role-aware side nav that renders for ALL logged-in users) — a
  `{ label: "Check", path: "/check", icon }` item **without** `adminOnly`, placed
  near the Servers item (~line 711), so every user can open and run it.
- **Emoji rule (CLAUDE.md §0):** the traffic lights and status icons must be
  **CSS / semantic** (colored dots via tokens), NOT emoji. The only emoji allowed
  anywhere are `⚠️ ✅ ❌ 🔐 ✕ ✓`. The mock's card lights already use CSS dots;
  the real page must do the same everywhere (no 🟢🟡🔴⚪🚦).
### Layout — one results model, four switchable views

All layouts render the **same** check-results model (categories → checks →
status/detail). The page has a **view switcher (tabs)**; the data and actions are
identical across views, only the presentation changes. This keeps one data layer
and lets the presenter use whichever view suits the moment.

- **Cards (default, resting view)** — traffic-light card grid, one card per
  category (**Servers, PingOne Authorize, Agent Gateway, Config/Secrets, LLM,
  End-to-end Chip**). Each card shows a light (🟢 all pass / 🟡 warn or partial /
  🔴 any fail / ⚪ not run — worst status among its checks), a one-line summary,
  and a **Real vs Demo** badge on the Authorize and Gateway cards. Clicking a card
  expands its individual checks with full structured detail.
- **Pre-flight stepper (the "run" experience)** — invoking **Run pre-flight**
  plays the ordered stepper (Servers → Config → Authorize → Gateway → LLM → Chip)
  with a progress bar and the active phase expanded live via SSE, ending on a
  readiness summary; it then settles back into the cards. The stepper is a *run
  mode over the same data*, not a separate results set.
- **Grouped checklist (tab)** — single scrolling list grouped by category; the
  simplest dense view.
- **Rail + detail (tab)** — category rail + detail pane for drilling into a
  single category's full detail (raw P1AZ request/response + `decisionId`, IG
  per-hop trace, per-model LLM table).

Shared across all views:

- **Top bar:** overall **READY / NOT READY** verdict (any `fail` ⇒ NOT READY;
  `warn`-only ⇒ READY with warnings; all `pass` ⇒ READY) + **Run all checks** /
  **Run pre-flight** actions.
- **Heavyweight probes** are explicit, never silently part of "Run all":
  **Run real chip test ▸** (with vertical + use-case selectors, "may take a
  while") and **Deep LLM test (all models) ▸** ("may take several minutes"). Each
  still contributes to the overall verdict once run.
- **Live updates:** every view updates from the same SSE result stream in real time.
- The view switcher and expand/collapse are the only view-local state; results
  live in one shared store so switching tabs never re-runs checks.

## Data Flow

```
Browser CheckPage
  GET  /api/check/catalog                 → list of applicable checks (render skeleton)
  POST /api/check/run (SSE)               → stream {id,status,detail,meta} per check
        └─ checkService runs each check server-side:
             health.inventory  ·  worker-token + P1AZ decision  ·  gateway probe
             config/secret reads  ·  llm-proxy /status + completion
             agent/run real chip execution (opt-in)
  → page aggregates → READY / NOT READY
```

## Error Handling

- Each check is isolated: a thrown error becomes that check's `fail` with the
  error message in `detail`; it never aborts the run.
- Per-check timeout (e.g. 15s for probes; longer, explicit budget for the chip
  run and deep LLM test) so a hung service can't hang the whole page.
- SSE stream sends a terminal `done` event with the aggregate verdict; if the
  connection drops, the page shows partial results and offers re-run.
- The page degrades gracefully if `/api/check/*` is unavailable (shows an error
  banner, not a blank page).

## Testing

- **checkService unit tests** — each check's `run()` against mocked ctx: pass,
  fail, and skip (`appliesWhen`) paths, including the real-vs-simulated branching
  for P1AZ and gateway.
- **Route tests** — `/api/check/catalog` reflects flag state; `/api/check/run`
  streams results and isolates a failing check.
- **Frontend** — CheckPage renders grouped results, derives READY / NOT READY
  correctly, and gates the two heavyweight buttons behind explicit clicks
  (follow existing page test patterns, e.g. `FeatureFlagsPage.test.js`).
- **Real E2E (manual/pre-demo)** — run the real chip test and deep LLM test
  against a live stack in both simulated and real P1AZ/gateway modes.

## Open Questions / Follow-ups

- Exact canonical banking use case id for the default chip test — pick from the
  catalog during implementation (the one that most fully exercises
  agent→P1AZ→gateway→MCP).
- Whether to persist the last run's results for quick reference (deferred; YAGNI
  unless asked).
