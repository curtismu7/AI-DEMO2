# Tech Debt Log

## TD-1 — `invest` vs `investment` vertical id drift

**Found:** 2026-09-22 (naming-consistency sweep, Group E2)

The investment vertical's directory and manifest id is `investment`
(`demo_api_server/config/verticals/investment/manifest.json`), but the BFF uses
the id `invest` in several code paths:

- `demo_api_server` use-case routing (`useCases.js:2210` area)
- `a2aDelegationService.js:18`
- scope `invest:read` (mirrored in `scope-topology.json` and granted to the
  gateway app)

Display name is consistent everywhere (**Meridian Wealth**), so there is no
user-visible impact. Renaming either side would touch scope topology, PingOne
scope grants, A2A delegation wiring, and generated data — deliberately
**skipped** in the naming sweep and logged here instead.

**Fix sketch:** unify on the manifest id (`investment`), regenerate
`scope-topology.json` via `npm --prefix demo_api_server run scopes:gen`, update
`invest:read` → `investment:read` in scope topology + PingOne provisioning, and
sweep `a2aDelegationService.js` / `useCases.js` references.
