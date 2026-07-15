# Demo Check (unified pre-demo readiness) — Design

**Date:** 2026-07-15  
**Status:** Approved in brainstorming (§1–§3); awaiting written-spec review  
**Related:** `2026-07-11-pre-demo-check-page-design.md`, `2026-07-10-ping-ai-test-lab-design.md` (superseded as a product)

## Problem

Demo presenters (SEs) need one place to confirm the live environment will work
**before** the talk. Today that intent is split:

- **`/check`** — Pre-Demo Check page with READY / NOT READY, `checkService`,
  stack/flags/LLM/gateway probes, any logged-in user.
- **`/ping-ai-test-lab`** — Originally skills/CIAM evals; recently retargeted to
  stack + MCP + use-case PERMIT/DENY, but still a second surface, admin-gated,
  and without a single presenter-facing verdict.

Presenters should not juggle two pages or interpret 57 CIAM rows / skill catalogs
unrelated to “can I run this banking demo now?”

## Decisions (from brainstorming)

| Topic | Choice |
|--------|--------|
| Product shape | **Unify** on one UI branded **Demo check**, powered by `checkService`, folding in Test Lab use-case PERMIT/DENY |
| Access | **Any logged-in user** |
| READY bar | **Stack + happy-path PERMIT + at least one attack-sim DENY** |
| Fail UX | **Status + nextAction + expandable deep detail** |
| Approach | **A — Grow `/check`**; redirect `/ping-ai-test-lab` → `/check` |

## Goals

- One page, one primary **Run demo check**, clear **Ready for demo / Ready — with warnings / Not ready**.
- Prove what the presenter's demo needs:
  - Core processes and config are healthy.
  - A real **PERMIT** path works (delegated MCP / gateway).
  - At least one **DENY** path works (enforcement on — not fail-open or mis-routed).
- On failure: immediate human **next action**, plus expandable token-chain / hops / sim meta for support.
- No mutation of feature flags, OAuth scopes, or PingOne config.

## Non-Goals

- CIAM ping-bench / Agent Skills catalog / external docs probes / LLM keyword grading.
- Continuous monitoring (on-demand only).
- Replacing the Servers or Feature Flags pages.
- Making READY require Deep LLM or every optional attack sim.

## Users & access

- **Any logged-in user** (same as current `/check`).
- Gate checks that need a user access token **fail** (with nextAction to sign in)
  when no live session token — they do not `skip` for READY, because presenters
  must run signed-in.

## Architecture

```
Browser  /check  (Demo check)
    │
    ▼
POST /api/check/run   GET /api/check/catalog
    │
    ▼
checkService (selectChecks → runChecks → aggregateVerdict)
    │
    ├── existing: servers, config, authorize, llm, gateway
    └── new: usecase.permit_accounts, usecase.deny_insufficient_scope
            (+ optional advisory: deny_replay, deny_rogue_actor, deny_impersonation)
```

- Canonical URL: **`/check`**.
- Nav label: **Demo check** (point existing Check / Test Lab entries here).
- `/ping-ai-test-lab` → client `<Navigate to="/check" />`.
- Reuse Test Lab BFF logic by extracting into
  `demo_api_server/services/checks/usecaseCheck.js` (and shared helpers if needed).
  Remove or leave unused `routes/pingAiTestLab.js` in the same or a follow-up PR
  once nothing calls it.

## Check classes

| Class | Default run | READY impact | Examples |
|--------|-------------|--------------|----------|
| **Stack (blocking)** | yes | fail → NOT READY | `servers.all_up`, `config.prereqs` |
| **Stack / other (advisory)** | yes | fail or warn → WARN at most if gates pass | authorize mode notes, `llm.status` quirks |
| **Gate — PERMIT** | yes | fail → NOT READY | `usecase.permit_accounts` |
| **Gate — DENY** | yes | fail → NOT READY | `usecase.deny_insufficient_scope` |
| **Heavy / on-demand** | no (`includeHeavy` or separate CTA) | does not define default READY | `llm.deep`, extra attack sims, “Run real chip test” |

### Gate — PERMIT (`usecase.permit_accounts`)

- Session → RFC 8693 chain → banking read tool (`get_my_accounts` or equivalent
  empty-args tool used today).
- Expected: tool succeeds / gateway decision PERMIT when applicable.
- When `ff_mcp_gateway_pinggateway` is true: drop `heavy: true` on
  `gateway.real_path` (or invoke that hop sequence from
  `usecase.permit_accounts`) so the default run always includes a real
  PingGateway PERMIT proof. When the flag is false, `usecase.permit_accounts`
  uses the demo BFF / active-gateway path only.

### Gate — DENY (`usecase.deny_insufficient_scope`)

- Run UC5-class attack sim (`insufficient-scope`) via `attackSimulatorService`.
- Pass: HTTP 401/403 and not `unexpected_permit`.
- Fail: unexpected permit, wrong status, or sim misconfiguration that means
  enforcement did not fire.
- `gateway_not_configured` → fail or NOT READY-relevant not_configured mapped
  to fail with nextAction (presenter cannot rely on DENY stories without gateway).

### Optional advisory use cases (same category, not gates)

- UC12 token replay, UC13 rogue actor, UC16 impersonation — available under
  Deep / expanded suite; failures do not flip READY unless explicitly included
  later.

## Verdict rules

Replace “any fail ⇒ NOT READY” with severity-aware aggregation:

1. Run default checks (`includeHeavy: false`).
2. **NOT READY** if any check with `severity: 'gate'` or `severity: 'blocking'`
   has `status === 'fail'`.
3. **READY with warnings** if all gate + blocking checks pass, but one or more
   advisory checks warn or fail.
4. **READY** if gate + blocking pass and no advisory warn/fail.
5. `skip` on non-gate checks does not force NOT READY; **gate/blocking must not
   skip** for a successful READY (use fail + nextAction instead).

Each result may include:

```
{
  status, detail,
  nextAction?: string,   // one concrete presenter step
  meta?: object          // hops, tokenChain, sim, useCaseId, …
}
```

`runChecks` / SSE payload must forward `nextAction` (today only `meta` is
forwarded — extend the result shape).

## UI

- Verdict bar copy unchanged in meaning: Ready for demo / Ready — with warnings /
  Not ready.
- Primary CTA label: **Run demo check**.
- Secondary: Run real chip test, Deep LLM test (existing).
- Default view: Cards by category; add **Use cases** category.
- Always show `nextAction` on fail/warn when present.
- Expand row → deep `meta` (JSON), emoji allowlist per REGRESSION_PLAN §0.
- Mark gate checks visually (“Required for READY”).

### Example nextAction strings

| Situation | nextAction |
|-----------|------------|
| No session on gate | Sign in with the demo user, open Demo check, Run again |
| DENY unexpected permit | Gateway enforcement off or wrong path — check PingGateway / authorize feature flags |
| Servers down | Re-check SE pods / cluster status; retry when BFF and MCP are healthy |

## Sunset — Ping AI Test Lab

- Remove or retarget nav entries to Demo check (`/check`).
- Redirect `/ping-ai-test-lab` → `/check`.
- Extract usable runners into `usecaseCheck.js`; delete or stub Test Lab routes
  after extraction (no second product page).
- Older Test Lab / CIAM design docs remain historical; this doc is the product
  source of truth for pre-demo readiness.

## Testing

- Unit: `usecaseCheck` PERMIT/DENY outcomes; `aggregateVerdict` with
  gate/blocking/advisory.
- Route: `/api/check/run` SSE includes `nextAction`.
- UI: CheckPage shows nextAction; READY when gates pass.
- Manual on SE: signed-in → Run demo check → READY with PERMIT + DENY green.

## Out of scope for first implementation PR

- Reworking all four CheckPage view modes beyond Cards/rail for nextAction
  (minimum: Cards + Rail/detail show nextAction; others can follow).
- Making every legacy advisory check perfect; prioritize gates + blocking stack.
- Deleting `ciamEvalChecks.json` (unused by this product; cleanup optional).
