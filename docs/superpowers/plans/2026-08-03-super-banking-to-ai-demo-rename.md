# Rename "Super Banking" → "AI Demo"

**Date:** 2026-08-03
**Status:** Scoped, not started
**Trigger:** The product is **AI Demo**. "Super Banking" is a legacy name that still
leaks into the PingOne console, the policy editor, the UI's teaching panels and every
canonical key in `scope-topology.json`.

---

## Context

The name is not in one place. It is in five, with very different risk profiles, and the
dangerous one is not the one you would guess.

`scope-topology.json` uses `Super Banking X` as the **canonical key** for every resource
and app. Those keys are already translated to the PingOne-visible name through
`provisioning.resourceNames` / `provisioning.appNames` — which is why the console mostly
shows `Demo API`, `Demo MCP Gateway`, `Demo AI App - User Login`. So most of the 986
occurrences are internal and invisible.

But **10 of the 18 resource mappings are identity mappings** (`Super Banking A2A
Intermediate - Investment Advisor → Super Banking A2A Intermediate - Investment
Advisor`), so those objects really are named "Super Banking …" in the live environment.

Already fixed, out of scope here: the P1AZ policy names. The import file generated on
2026-08-03 (`~/Documents/AI_Demo_P1AZ_import_2026-08-03.json`) renames the PolicySet and
both Policies to `AI Demo …`. Statement `code` values were deliberately left alone.

## Measured blast radius

Counted 2026-08-03, excluding `node_modules`, `.git`, `repo-src`, `build`:

| Area | Files | Notes |
|---|---|---|
| `test-results/`, `.playwright-mcp/` | 572 | Run artifacts. **Not edited** — they regenerate. |
| `docs/` | 132 | Split: current docs vs `docs/archive/` + old plans (historical, leave). |
| `graphify-out/` | 76 | Generated index. Regenerate, do not edit. |
| `demo_api_server/` | 75 | The real work — see tiers below. |
| `demo_api_ui/` | 50 | Teaching copy + one downloadable dashboard JSON. |
| everything else | ~80 | `pac/`, `postman/`, `snapshots/`, `scripts/`, service dirs. |

Densest source files: `services/pingoneProvisionService.js` (39), `SCOPE_VOCABULARY.md`
(34), `src/__tests__/scopeTopology.regression.test.js` (19),
`services/twoExchangeReconciler.js` (19), `config/a2aSpecialists.js` (11),
`scripts/refresh-service-envs.js` (11), `scripts/bootstrapPingOne.js` (11).

## The sharp edge

`pingoneProvisionService.js:459` resolves a PingOne resource **by name**:

```js
return resources.find(resource => resource.name === name);
```

and `:512` falls back to `r.audience === audience || r.name === name`. Applications are
resolved the same way (`:785`, `:815`, `:856`, `:887`, `:965` for attributes, policies,
agreements, sign-on policies).

So if the live display name changes and `provisioning.*Names` does not — or vice versa —
the provisioner **stops finding the existing object and creates a duplicate**. That is
exactly the failure we hit on 2026-08-02 with `Demo MCP Invest`, where the audience in
the manifest did not match the live resource: the reconciler 400'd on every BFF boot for
weeks while logging `OK`.

`twoExchangeReconciler.js:174,193` resolves by **audience only**, so it is unaffected by
display-name changes. Audiences (`enduser.ping.demo`, `a2a-intermediate-*.ping.demo`,
`mcp-invest.ping.demo`) contain no brand string and **must not change** — changing an
audience invalidates every token minted for it.

## Tiers

### Tier 0 — do not touch

`test-results/`, `.playwright-mcp/`, `graphify-out/`, `docs/archive/`,
`docs/superpowers/plans/` and `specs/` (historical records), vendored
`langchain_agent/repo-src/`, `demo_api_server/data/backups/`. Regenerated or historical.

### Tier 1 — canonical keys (largest, lowest runtime risk)

`scope-topology.json` `resources{}` / `apps{}` keys, plus every consumer that spells a
key as a literal: `services/scopeTopology.js`, `pingoneProvisionService.js`,
`twoExchangeReconciler.js`, `config/a2aSpecialists.js`, `scripts/gen-scope-topology.js`,
`snapshots/gen-authorize-snapshot.js`, `demo_authz_server/ruleStore.js`,
`demo_mcp_gateway/src/auth/scopeTopology.ts` (`BACKEND_RESOURCE_NAME`).

Must land as **one atomic commit** — a key renamed in the manifest but not in a consumer
throws at boot (`plugins.js` style hard failure) or silently resolves `undefined`.

Guarded by: `npm run topology:verify` (7 steps), `scopeTopology.regression.test.js`,
`demo_authz_server/topology.parity.test.js`, `allowedScopesByAudience.parity.test.js`.

### Tier 2 — live PingOne display names (smallest, highest risk)

10 resources and 2 applications:

```
Super Banking A2A Intermediate - {Investment Advisor, Records Specialist,
  Purchase History Specialist, Membership Specialist, Payroll Specialist,
  Tax Records Specialist, Financial Aid Specialist, Supplier Contract Specialist,
  Holdings Specialist}
Super Banking A2A MCP Gateway
Super Banking Worker Data DaVinci 20260708-165226      (app)
Super Banking Worker MCP Skill 20260708-165550         (app)
```

Rename via Management API `PUT`, **in the same change** as `provisioning.resourceNames`.
Verify with `npm run verify:scopes -- --manifest-diff` (must exit 0) and by confirming
the resource **count does not increase** — a duplicate is the failure mode, and it looks
like success.

The two `Worker …` apps are timestamped one-offs not in the manifest at all; decide
whether to rename or delete them.

### Tier 3 — user-visible copy

`demo_api_ui/src/components/education/*` (RFC8707Content, BestPracticesPanel and
others), `routes/setupWizard.js`, `data/publicBranchCatalog.js`,
`demo_mcp_server/src/tools/handlers/publicCatalogHandlers.ts`,
`demo_api_ui/public/downloads/Super_Banking_Authorize_Dashboard.json` (filename too),
`SCOPE_VOCABULARY.md`, current `docs/`.

Requires the UI build gate (`cd demo_api_ui && npm run build` exits 0) per
REGRESSION_PLAN §0.

### Tier 4 — regenerate, never hand-edit

`docs/scope-topology.md` (`npm run scopes:doc`), `snapshots/*.snapshot.json`
(`node snapshots/gen-authorize-snapshot.js`), `mcp-tool-schemas.json`
(`npm --prefix demo_mcp_gateway run gen:tool-schemas`), `verticalTools.generated.ts`,
`intent-topology.json`, `graphify-out/` (`graphify update .`).

### Tier 5 — tests

Expectation literals in `scopeTopology.regression.test.js`,
`pingoneProvisionService.regression.test.js`, `pingoneAudit.integration.test.js`,
`scopeAuditRoute.test.js`, `snapshots/authorizeSnapshotCloudDelta.test.js`,
`demo_api_ui/src/components/__tests__/PingOneAudit.test.jsx`.

Watch for the `decision.d05-bypass.test.js` failure mode seen on 2026-08-02: a
hardcoded literal that no longer matches a **generated** condition does not fail loudly,
it silently stops exercising the rule. Prefer deriving from the manifest over hardcoding.

## Sequence

Each step is its own PR; each must be green before the next starts.

1. **Tier 4 generators** — make every generated artifact reproducible from the manifest
   first, so later steps are `regenerate`, not `hand-edit`. (Fold in the
   `gen-authorize-snapshot.js` package-grouping bug found 2026-08-03: it splices objects
   around the separator and never normalizes, which is why the console import only
   loaded attributes and conditions.)
2. **Tier 1 canonical keys** — one atomic commit. `topology:verify` is the gate.
3. **Tier 5 tests** — should be nearly empty if step 2 was atomic; whatever remains is
   a hardcoded literal that should be derived.
4. **Tier 3 copy + UI build gate.**
5. **Tier 2 live PingOne** — last, deliberately. Reversible via the same API, and doing
   it after the manifest is settled means one authoritative name list to rename against.

## Success criteria

- `grep -r "Super Banking"` returns hits **only** in Tier 0 paths.
- `npm run topology:verify` exits 0.
- `npm run verify:scopes -- --manifest-diff` exits 0 against the live environment, and
  the PingOne resource/application counts are unchanged from before Tier 2.
- `cd demo_api_ui && npm run build` exits 0.
- Full suites green: `demo_api_server`, `demo_mcp_gateway`, `demo_authz_server`.
- A BFF restart logs no `TwoExchangeReconciler` warning.
- One chip per vertical still returns real data end to end.

## Open questions

1. **`Demo …` or `AI Demo …`?** The console already says `Demo API`, `Demo MCP Gateway`,
   `Demo AI App - User Login`. Renaming canonical keys to `AI Demo API` while the live
   resource stays `Demo API` keeps a translation layer that is arguably the thing worth
   removing. Options: (a) canonical keys become `AI Demo …` and the mapping stays;
   (b) canonical keys match the live names exactly and `provisioning.*Names` collapses
   to identity. (b) removes a whole class of drift but is a bigger Tier 2.
2. Are the two timestamped `Super Banking Worker …` apps still used, or deletable?
3. Does the SE AWS environment (`ai-demo.ping-devops.com`) need the same Tier 2 pass?
4. Does the repo itself get renamed, or only its contents?

## Non-goals

- Changing any **audience** (`*.ping.demo`). Tokens are minted against these.
- Changing any **scope** name (`invest:read`, `airlines:read`). No brand in them.
- Changing P1AZ **statement codes**. The BFF matches gates on them
  (`KNOWN_STATEMENT_CODES`, plus the HITL/STEPUP substring check); renaming silently
  disables step-up and consent enforcement.
- Renaming the `demo_api_server` / `demo_mcp_*` directories or Docker service names.
