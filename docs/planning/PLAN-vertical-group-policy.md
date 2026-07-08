# Vertical-Scoped PingOne Group Policy — Implementation Plan

**Status:** Phase 1–3 complete; Phase 4 operator docs added  
**Date:** 2026-07-08  
**Goal:** Each demo vertical owns its own PingOne groups (same *categories*, vertical-specific *names*). Healthcare must not inherit banking group names like `PrivilegedBanking`. Close the gaps: static JSON drift, missing tier provisioning, and no live directory lookup.

---

## Problem

Group membership enforcement today is **banking-only**:

| Gap | Current state |
|---|---|
| Single global `config/group-policy.json` | All verticals share banking group names |
| Provisioning | Only creates `BankDelegates` + `PrivilegedBanking` |
| Runtime resolution | Username → static JSON; never calls PingOne Management API |
| Tier group | `PrivateBanking` in JSON but **not** provisioned in PingOne |
| Vertical switch | Active vertical ignored by `groupPolicy.js` |

Medical (`sensitive_patient_records`), retail, workforce, and sporting-goods each have sensitive tools but no vertical group policy.

---

## Design — category model (same shape, different names)

Every customer vertical manifest may declare a `groups` block:

```json
"groups": {
  "categories": {
    "privileged": { "name": "Healthcare_Privileged", "description": "..." },
    "delegates":  { "name": "Healthcare_Delegates",  "description": "..." },
    "premiumTier": { "name": "Healthcare_PremiumTier", "description": "..." }
  },
  "restrictedTools": {
    "sensitive_patient_records": "privileged"
  },
  "userMemberships": {
    "demoUser":    ["privileged", "premiumTier"],
    "demoAdmin":   ["privileged", "premiumTier"],
    "demoDelegate": ["delegates"]
  }
}
```

**Categories (shared semantics):**

| Category | Purpose |
|---|---|
| `privileged` | Binary gate (UC9) — sensitive tool requires membership |
| `delegates` | Delegation demo — `demoDelegate` persona |
| `premiumTier` | Entitlement tier (UC21) — maps via `tiers.groupToTier` |

PingOne group **names** are vertical-prefixed (`Banking_Privileged`, `Healthcare_Privileged`, …). Category keys stay the same across verticals.

---

## Phases

### Phase 1 — Vertical manifest SoT (this PR)

- [x] Add `groups` to `ManifestSchema`
- [x] Add `groups` blocks to banking, healthcare, retail, sporting-goods, workforce manifests
- [x] Refactor `groupPolicy.js` — resolve from active vertical manifest (legacy JSON fallback)
- [x] Wire `mcpToolAuthorizationService` — pass `verticalId` from `activeIdFor(req)`
- [x] Tier resolution from manifest `tiers.groupToTier` (not hardcoded `PrivateBanking`)
- [x] Update `groupPolicy.test.js` + parity tests for new group names
- [x] Deprecate `config/group-policy.json` (shim reads banking manifest)

### Phase 2 — Provisioning parity

- [x] Replace hardcoded bootstrap group steps with `_provisionVerticalGroups()`
- [x] Create all category groups per vertical manifest (including `premiumTier`)
- [x] Assign demo users per `userMemberships`
- [x] Expand wipe `DEMO_GROUPS` to all manifest-defined group names
- [x] Bootstrap step logging grouped by vertical

### Phase 3 — Live PingOne membership lookup

- [x] `pingOneGroupMembershipService.js` — `GET /users/{id}/memberOfGroups`
- [x] `groupPolicy.groupsForUser()` prefers live lookup when PingOne user id available; falls back to manifest
- [x] Short TTL cache (60s) per user+vertical
- [x] Optional: surface group list in MCP Inspector / Token Chain panel
- [x] Tests with mocked Management API

### Phase 4 — Live PingOne Authorize (operator step)

See **[OPERATOR-vertical-group-policy.md](./OPERATOR-vertical-group-policy.md)** for cloud policy parameters and per-vertical group names.

---

## Vertical group matrix (target)

| Vertical | Privileged tool | Privileged group | Premium tier group |
|---|---|---|---|
| banking | `get_sensitive_account_details` | `Banking_Privileged` | `Banking_PremiumTier` |
| healthcare | `sensitive_patient_records` | `Healthcare_Privileged` | — |
| retail | `sensitive_order_history` | `Retail_Privileged` | — |
| sporting-goods | `sensitive_membership_details` | `SportingGoods_Privileged` | — |
| workforce | `sensitive_payroll_details` | `Workforce_Privileged` | — |

Delegates group per vertical: `{Vertical}_Delegates`.

---

## Files touched

| File | Change |
|---|---|
| `services/verticalManifest/schema.js` | `GroupsSchema` |
| `config/verticals/*/manifest.json` | `groups` block (5 verticals) |
| `services/groupPolicy.js` | Vertical-aware resolution |
| `services/pingOneGroupMembershipService.js` | Live lookup + cache |
| `services/mcpToolAuthorizationService.js` | Pass verticalId, tier from manifest |
| `services/simulatedAuthorizeService.js` | Vertical tier policy |
| `services/pingoneProvisionService.js` | Generic vertical group bootstrap |
| `config/group-policy.json` | Deprecated shim |
| `src/__tests__/groupPolicy.test.js` | Vertical cases |

---

## Test plan

1. `./run-tests.sh unit` — `groupPolicy.test.js`, `simulatedAuthorizeService.test.js`, parity tests
2. Bootstrap fresh — verify PingOne groups created for all 5 verticals
3. Switch to healthcare + enable `ff_authorize_group_policy` — `demoDelegate` DENY on `sensitive_patient_records`
4. Switch to banking — `demoUser` PERMIT on `get_sensitive_account_details`; tier ceiling $50k with premium group
