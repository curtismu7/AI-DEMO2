# Per-Theme Scope Namespaces — Spec Skeleton (NOT YET DESIGNED)

**Date:** 2026-05-18
**Status:** SKELETON — requires its own `superpowers:brainstorming` cycle before this becomes an approved spec. Do not implement from this document.
**Relationship:** Independent subsystem, parallel to the Reusable Theme Manifest (Phase 1, presentation-only). The manifest spec's load-bearing constraint forbids scopes in the manifest; this spec owns scopes via `scope-topology.json`.

---

## Why this is separate (do not fold into the theme-manifest plan)

Renaming OAuth scopes (`banking:*` → `retail:*` / `medical:*`), provisioning
new PingOne resources/scopes/users per theme, and renaming apps is an
**authorization-topology** change, not presentation. Putting scope names in
the theme manifest would violate the manifest spec's load-bearing constraint
("the manifest never carries secrets, scopes-as-policy, or auth config") and
contradicts the project SSOT rule (`scope-topology.json` is the scope SSOT;
scopes are an Authorize/provisioning decision). See memory
`project_per_theme_scopes_separate_spec`, `project_scope_topology_ssot`,
`reference_architecture_truths`.

## Decisions already locked (from 2026-05-18 discussion)

1. **Per-theme scope namespaces.** `banking:*` stays for banking; add
   `retail:read|write|transfer|...` and `medical:read|write|...`. Each theme
   gets its own PingOne resource server + scope set.
2. **scope-topology.json is the driver.** Per-theme namespaces are declared in
   the SSOT; BFF/gateway/policy/audit/provisioning derive as today. The theme
   manifest may carry only a *reference* (e.g. `scopeNamespace: "retail"`),
   never scope definitions.
3. **Token exchange resolves per active theme.** RFC 8693 `aud`/scope must
   resolve to the active theme's resource/namespace at exchange time.
4. **New demo users per theme.** `bankuser`/`bankadmin` are banking-specific;
   each theme needs appropriately-named demo users (provisioned via
   `pingone:bootstrap`).
5. **Apps kept, renamed.** Existing PingOne apps are reused but renamed to drop
   "banking"; the worker/client-credentials app becomes a single neutral
   "Demo Worker Token App" usable by any theme.

## Open questions (resolve in the brainstorm — DO NOT assume)

- **Q1.** One PingOne environment with N resource servers (one per theme), or
  is multi-resource still bound by the single-resource-per-exchange rule?
  (See memory `project_pingone_single_resource_exchange` — RFC 8693 is one
  resource per exchange; per-theme resources must not break this.)
- **Q2.** Does the active theme switch (server-wide, from the theme manifest
  ThemePicker) also switch the *scope namespace* used by token exchange? If so,
  what happens to an in-flight agent session when the theme flips mid-demo?
- **Q3.** Admin scopes (`admin:read`, `users:manage`, etc.) — per-theme or
  shared? (Currently local-only per `project_scope_topology_ssot`.)
- **Q4.** Tool `requiredScopes` in `scope-topology.json` are banking-named.
  Per-theme tools, or shared tools whose required scope is namespace-resolved?
- **Q5.** Re-bootstrap blast radius: provisioning new resources/scopes/users
  is destructive-ish (re-runs `pingone:bootstrap`). Migration story for an
  existing environment with live `config.db`? (See memory
  `project_env_wipe_incident`, `project_bootstrap_drops_keys_stale_vault`.)
- **Q6.** Backward compatibility: do `banking:*` scopes remain valid during
  and after migration, or is this a hard cutover?
- **Q7.** App rename in PingOne — does renaming an app change its client_id?
  (If yes, every `.env`/vault/config reference must update — large blast
  radius. Verify against live PingOne docs per `feedback_verify_pingone_docs`.)

## Blast radius (verified files — for the brainstorm to scope)

- `scope-topology.json` — `scopes` / `resources` / `apps` / `tools` blocks
  (repo root; the SSOT).
- `banking_api_server/services/pingoneBootstrapService.js`,
  `pingoneProvisionService.js`, `pingoneManagementService.js`,
  `scripts/bootstrapPingOne.js` — provisioning of resources/scopes/users/apps.
- RFC 8693 exchange: `agentMcpTokenService.js`,
  `enhancedTokenExchangeService.js` — `aud`/scope resolution.
- PingOne Authorize decisioning (scope enforcement).
- `banking_mcp_gateway/src/router.ts` — tool `requiredScopes`.
- MCP tool registry (`banking_mcp_server`, `banking_mcp_invest`).
- `.env` / `secrets.vault` — app client_ids/secrets if apps' ids change (Q7).
- Demo user references (login hints, e2e fixtures, docs).

## Required reading before the brainstorm

- Skill `oauth-pingone` (RFC 8693, scope enforcement, single-resource rule).
- Skill `pingone-api-calls` (resource/scope/user provisioning).
- Skill `regression-guard` (REGRESSION_PLAN §1; OAuth/token paths protected).
- `scope-topology.schema.json` + `scope-topology.json`.
- Memories: `project_scope_topology_ssot`,
  `project_pingone_single_resource_exchange`,
  `project_mortgage_scope_resource_drift`, `project_env_wipe_incident`,
  `project_bootstrap_drops_keys_stale_vault`, `feedback_verify_pingone_docs`.

## Next step

Run `superpowers:brainstorming` on this skeleton: resolve Q1–Q7, propose
2–3 approaches (e.g. hard cutover vs additive-namespace-with-aliases vs
per-environment), then produce the real spec and plan. This is OAuth-critical
— do not shortcut the design.
