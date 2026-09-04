# Page → Feature-Flag Audit + Inline Gate Banner — Design

**Date:** 2026-09-04
**Status:** Draft, pending review

## Problem

The demo has ~150 nav pages / ~30-40 use cases, many of which only work when
one or more feature flags are on. Today the only ways to turn a flag on are:

1. The Feature Flags **setup page** (`FeatureFlagsPage.js`, full registry).
2. The header **QuickFlagsPill** (`QuickFlagsPill.js`, a curated ~20-flag
   subset, signed-in-admin only per its own design doc).
3. A **silent auto-arm** that fires only when a signed-in user runs a
   use-case chip (`AIAgent.js:7682-7739` client-side,
   `useCases.js:138-154`/`207-213` server-side) — invisible, and doesn't
   cover plain nav pages that were reached directly (not via chip dispatch).

There's no map of which pages need which flags, and no way to enable a
flag from the page itself without leaving to the setup page (or already
having a session and having triggered the one dispatch path that auto-arms).

## Scope

- **In scope:** (A) an audit of every page/use-case's flag requirement(s),
  produced as a reviewable table; (B) a `FlagGateBanner` shown inline on a
  gated page/use-case when a required flag is off, with an **Enable**
  button, working for guests and signed-in users alike.
- **Out of scope:** pages whose *nav item itself* is hidden when a flag is
  off (the banner can't help if the page is unreachable — the audit calls
  these out separately; fix is a nav-visibility change, not this feature).
  No changes to `FeatureFlagsPage.js` or `QuickFlagsPill.js` behavior.

## Part A — Audit

Two independent sources of "this page needs a flag" exist and both must be
walked:

1. **Use-case pages** (`demo_api_server/config/useCases.js`) — required
   flags are already computable via the existing, duplicated
   `requiredFlagsForUseCase()` (server: `demoStepPrerequisites.js:100-117`;
   UI mirror: `requiredDemoFlags.js:37-72`). No new logic — run it across
   every entry in the catalog.
2. **Plain nav pages** — the ~110 remaining entries in
   `navStructureCatalog.js` that aren't use cases. These have no existing
   registry; find them by grepping `demo_api_ui/src/pages/**` and
   `components/**` for direct flag reads (`configStore`, `useQuickFlags`,
   `ff_*` literals, `resolveFlag`) that gate rendering or behavior.

**Output:** one markdown table — page/use-case, required flag(s), current
toggle surface (setup page / QuickFlagsPill / neither), and a `nav-hidden`
column flagging the unreachable-page edge case for separate follow-up.

## Part B — `FlagGateBanner`

### Components

- **`demo_api_ui/src/components/FlagGateBanner.js`** (new) — takes a
  resolved list of required flag ids + their current values, renders
  nothing if all are on, otherwise a banner naming the missing flag(s)
  with an **Enable** button. Reuses `useQuickFlags`'s fetch/save plumbing
  rather than re-implementing flag I/O.
- **Use-case pages**: wire the banner using the flags already resolved by
  `requiredFlagsForUseCaseId()` — zero new mapping.
- **Plain nav pages found gated in the audit**: only if the audit finds
  any (YAGNI — skip this file entirely if it finds none). Add
  `demo_api_server/config/pageFlagRequirements.js` — a small
  `{ routePath: ['flag_id', ...] }` map, server-side so the guest-safe
  enable endpoint below can validate against it. Served read-only via a
  new `GET /api/page-flag-requirements` (open, same openness model as
  `GET /api/use-cases`).

Rejected alternative: a single new registry file covering *all* pages
(use-case and plain) — adds a 10th source of truth for flag-to-page
mapping when 9 already exist for use cases; the existing computation
already covers use-case pages, so only the genuinely-uncovered plain pages
need anything new.

### Guest-safe enable — new narrow endpoint, not a gate removal

Flag mutation is deliberately locked to signed-in sessions
(`featureFlagsAuthGate.js:10-21`) — anonymous writes were an intentional
kill-switch removed because this demo is internet-facing with no
sandbox/prod split, and `configStore` is a single global process-wide
store (one visitor's write affects every other visitor). Reopening the
general `PATCH /api/admin/feature-flags` route to anonymous callers would
let a guest flip *any* of the ~100+ registry flags, including the ones the
gate's own comment calls out as dangerous (`ff_hitl_enabled`,
`step_up_enabled`, `ff_skip_token_exchange`, `ff_inject_*`, gateway policy
modes).

Instead, add one new, narrow, unauthenticated route:

`POST /api/demo-flags/enable` — body `{ useCaseId }` or `{ path }`.
The server — never the client — resolves which flags that use case/page
needs (via `requiredFlagsForUseCase()` or `pageFlagRequirements.js`) and
sets only those via `configStore.setRaw()`. The client cannot name an
arbitrary flag id; the reachable set is exactly what a legitimate
signed-in user's chip-run auto-arm can already flip today
(`useCases.js:138-154`). The only thing that changes is *who* can trigger
it — guests as well as signed-in users — not *which* flags are reachable.
The existing `authenticateToken`-gated general PATCH route is untouched.

### Error handling

- Resolve/GET failure → banner doesn't render (fail closed to "no banner"
  rather than a broken one); page behaves as it does today.
- Enable POST failure → banner stays, shows an inline retry affordance.
- Unknown `useCaseId`/`path` → 404, banner stays as-is.

### Testing

- Server: jest test that `POST /api/demo-flags/enable` only ever sets
  flags present in that use case's/page's resolved requirement set, never
  an arbitrary client-supplied flag id.
- UI: vitest for `FlagGateBanner` — renders nothing when flags satisfied,
  renders banner + fires the scoped enable call when not, for both a
  logged-out and logged-in render (no sign-in branching in this
  component — it's guest-safe by construction).
- Manual: pick 2-3 pages from the audit table (one use-case, one plain
  page if any exist) as a live guest (no session) and confirm Enable
  works end-to-end.

## Non-goals (YAGNI)

- No changes to the existing signed-in-only chip-run auto-arm.
- No changes to `FeatureFlagsPage.js` or `QuickFlagsPill.js`.
- No fix for nav-hidden pages (audit flags them; separate follow-up).
- `pageFlagRequirements.js` is only created if the audit finds plain pages
  that need it.

## Success criteria

1. Audit table committed, covering every use case and every plain nav
   page, with nav-hidden cases called out.
2. On a use-case page with a required flag off, as a guest (no session):
   banner appears, Enable works, page becomes functional without
   navigating away.
3. `POST /api/demo-flags/enable` cannot set a flag outside the resolved
   requirement set for the given id (verified by test, not just code
   review).
4. No behavior change to `FeatureFlagsPage.js`, `QuickFlagsPill.js`, or
   the general admin PATCH route's auth gate.
5. `cd demo_api_ui && npm run build` and the touched jest/vitest suites
   pass.

## Audit results (2026-09-04)

Computed via `requiredFlagsForUseCase()` against the live `USE_CASES` catalog
(60 entries): **32 use cases require at least one flag, 7 of those require
two simultaneously** (the maturity flag plus `ff_mcp_gateway_pinggateway`,
added whenever `primaryTool` is set). Full list: `delegated-access-with-proof`,
`a2a-delegation`, `a2a-orchestrator-learning`, `a2a-generalist-mismatch`,
`may-act-gate`, `agent-identity-lifecycle`, `audit-trail`,
`mortgage-delegated-access`, `overscoped-agent`, `authz-denied`,
`step-up-required`, `hitl-consent`, `group-entitlement-check`,
`entitlement-tiered-capability`, `ciba-out-of-band-approval`,
`progressive-trust-public-access`, `token-theft-replay`,
`par-rar-intent-violation`, `par-rar-intent-verified`,
`jit-ephemeral-credentials`, `weather-mcp-texas-permit`,
`weather-mcp-texas-deny`, `brave-mcp-search-permit`, `brave-mcp-crypto-deny`,
`code-search`, `enterprise-managed-mcp-access`, `enterprise-mcp-revocation`,
`enterprise-managed-mcp-authorization`, `hitl-consent-bypass-attempt`,
`unauthorized-commitment-fee-waiver`, `verified-trust-a2a-assertion`,
`personal-agent-concierge`. The two-flag cases are
`group-entitlement-check`, `ciba-out-of-band-approval`,
`par-rar-intent-verified`, `enterprise-managed-mcp-access`,
`enterprise-mcp-revocation`, `verified-trust-a2a-assertion`,
`personal-agent-concierge`.

**Plain nav pages:** grepped `demo_api_ui/src/pages/**` and `components/**`
for direct flag reads outside the use-case mapping. Zero hits in `pages/`.
Four component-level hits, all sub-panel visibility only (not "the page
doesn't work" gates): `TokenChainTraceRail.jsx`/`TokenChainFilmstrip.jsx`
show/hide a Trust tab on `ff_dpop`/`ff_rar` (both already covered by the
use-case table above), `Dashboard.js` shows a debug notice on
`ff_inject_scopes`, `AuthorizeRulesPanel.jsx` shows an extra rule row on
`ff_authorize_mcp_first_tool`. **No page needs its own banner beyond the
use-case set** — `pageFlagRequirements.js` is not created (YAGNI, per the
design's own non-goal).

**Nav-hidden pages:** none found — the audit found no nav item whose
visibility itself is flag-gated, so the "banner is unreachable" edge case
does not currently apply anywhere.

**Rollout scope:** `UseCaseLauncherPage.js` only (Tasks 1-6 of the
implementation plan). `LiveUseCaseWorkbenchPage.js` is deliberately excluded
— see the plan's "Scope note" for why (existing signed-in auto-arm path,
compact drawer cards, AIAgent sibling already provides a dark-mode
control). Revisit if guest use of the live workbench becomes a real
scenario.
