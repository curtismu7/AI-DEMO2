# Attack-sim demo groups — 17 defense layers

Date: 2026-07-27
Status: approved design, not yet implemented

## Problem

The demo's 50-entry use-case catalog is presented through three hand-curated
ID lists in `demo_api_ui/src/config/demoUseCaseSteps.js`:

- `DEMO_PRIMARY_USE_CASE_IDS` — 20 tiles, 5x4 grid, the "demo steps"
- `SECURITY_DEMO_USE_CASE_IDS` — 10 tiles, the 15-minute security script
- `DEMO_ADVANCED_USE_CASE_IDS` — empty

Neither list explains *what defense* each step proves. A presenter walking the
20 steps cannot say which security layer a given tile exercises, and tiles that
prove the same control (UC14 + UC14b; UC30/31/32) are scattered. Catalog
entries that ship working defenses — `rate-limit-defense`, `cross-owner-account`,
`agent-identity-lifecycle` — have no conceptual home at all.

## Goal

Reorganize the demo presentation around **17 defense-layer groups**, rendered
as three rows (7 / 7 / 3), so every tile sits under the control it proves.

## The 17 groups

Group members are given as UC ids, the key both demo lists and the catalog use.
`useCaseId` slugs appear in parentheses for readability.

### Row 1 — the request path

| # | Group | UC ids |
|---|-------|--------|
| 1 | Token exchange | UC1 (delegated-access-with-proof), UC3 (may-act-gate), UC-LEARN6 (token-flow), UC-LEARN9 (id-jag-cross-app-access) |
| 2 | P1AZ policy deny | UC6 (authz-denied), UC10 (cross-owner-account), UC13 (confused-deputy-actor-injection), UC16 (impersonation-blocked) |
| 3 | Gateway denies | UC11 (bad-client-gateway), UC5 (insufficient-scope), UC18 (rate-limit-defense) |
| 4 | A2A | UC2 (a2a-delegation), UC2.5 (a2a-orchestrator-learning) |
| 5 | Bypassing the MCP gateway with a user token | UC26 (proof-of-enforcement) |
| 6 | HITL | UC8 (hitl-consent), UC27 (hitl-consent-bypass-attempt) |
| 7 | Consent | UC23 (progressive-trust-demo), UC24 (progressive-trust-public-access) |

### Row 2 — identity and trust infrastructure

| # | Group | UC ids |
|---|-------|--------|
| 8 | CIBA | UC22 (ciba-out-of-band-approval) |
| 9 | Audit trail | UC20 (audit-trail), UC35 (ai-explain-last-denial), UC34 (ai-spot-unusual-patterns) |
| 10 | MCP server | UC-LEARN4 (mcp-tools), UC-LEARN3 (demo-mcp-inspector), UC-LEARN2 (pingone-mcp-inspector) |
| 11 | Protecting the MCP server (Dallas / Miami) | UC30 (weather-mcp-texas-permit), UC31 (weather-mcp-texas-deny), UC32 (weather-mcp-live-reconfigure) |
| 12 | OAuth introspection deny | UC29 (oauth-fail-closed) |
| 13 | JWKS token validation deny | UC15 (intent-token-tampering), UC12 (token-theft-replay) |
| 14 | RAR / PAR intent binding | UC14b (rar-intent-verified), UC14 (rar-intent-violation), UC28 (unauthorized-commitment-fee-waiver) |

### Row 3 — agent governance

| # | Group | UC ids |
|---|-------|--------|
| 15 | Kill switch / agent lifecycle | UC19 (agent-identity-lifecycle), UC17 (jit-ephemeral-credentials), UC-LEARN7 (ungoverned-agent) |
| 16 | Step-up | UC7 (step-up-required) |
| 17 | Entitlements / least privilege | UC21 (entitlement-tiered-capability), UC9 (group-entitlement-check), UC4 (overscoped-agent) |

## Decisions

**Learn-track tiles may be group members.** Several groups draw on the `learn`
track — `token-flow` (UC-LEARN6), `ungoverned-agent` (UC-LEARN7), the two MCP
inspectors. These teach the concept their group proves, so excluding them would
leave the MCP server group empty. Group membership is therefore decided by
subject matter, not by catalog track.

**Only pure tooling is excluded** — 6 entries, which stay exactly where they are
today and are not part of any group: UC-TOOL1 (code-search), UC-TOOL2
(code-explorer), UC-LEARN1 (oauth-academy), UC-LEARN5 (learning-hub),
UC-PAM-SETUP, UC-PAM-SCRIPT.

**Three entries are deliberately unassigned.** UC25 (enterprise-managed-mcp-access)
and UC-LEARN8 (enterprise-managed-mcp-auth) belong to an enterprise-management
theme that is not one of the 17; UC33 (mortgage-delegated-access) is a vertical
feature tile, not a defense. They stay ungrouped rather than padding a group
they do not fit.

Coverage: 41 grouped + 6 excluded tooling + 3 unassigned = 50.

**Groups are presentation only.** No change to catalog data, routing, feature
flags, or any sim implementation. A group is an ordered list of UC ids plus a
title.

## Constraint that must not be broken

`SECURITY_DEMO_USE_CASE_IDS` is documented as 1:1 with the teleprompter beats in
`demo_api_ui/src/components/demoScript.js` — "step N here == beat N there".
Any reordering or regrouping of that list desynchronizes the teleprompter, so
the 15-minute script order must either stay untouched or be changed in lockstep
with `demoScript.js`. The 17-group structure is additive: it introduces a new
grouping export and leaves the existing three lists intact.

## Implementation surface

- `demo_api_ui/src/config/demoUseCaseSteps.js` — add a `DEMO_DEFENSE_GROUPS`
  export: an ordered array of `{ id, title, row, useCaseIds }`. Existing exports
  unchanged.
- `demo_api_ui/src/pages/LiveUseCaseWorkbenchPage.js` — render the groups. The
  page already resolves curated ID lists against the catalog with
  `.map(id => useCases.find(...)).filter(Boolean)` and filters by `matchesQuery`;
  the group renderer follows that existing pattern rather than inventing one.
- Unit test asserting every UC id in `DEMO_DEFENSE_GROUPS` resolves against the
  catalog, and that no id appears in two groups. This is the guard against the
  ID drift that has repeatedly broken curated lists in this repo.

## Success criteria

1. All 17 groups render in 7 / 7 / 3 rows.
2. Every UC id in the grouping resolves to a real catalog entry — no dead tiles.
3. No UC id appears in more than one group.
4. The 20-step demo list and the 15-minute security script behave exactly as
   before; teleprompter beats stay aligned.
5. `cd demo_api_ui && npm run test:unit && npm run build` green.

## Known risks

**Three groups have a single member** — Bypassing the gateway (UC26), CIBA
(UC22), Step-up (UC7). Acceptable at one minute per group; if more depth is
wanted, new sims must be built, which is out of scope here.

**Row assignment is fixed, not responsive.** Rows of 7/7/3 are a presenter
layout. Narrow viewports will wrap, and the "three rows" framing is then
cosmetic only.

## Out of scope

- Building new attack sims.
- Changing any sim's behavior, scope, or PingOne provisioning.
- Reordering the 15-minute script or the 20-step demo list.
