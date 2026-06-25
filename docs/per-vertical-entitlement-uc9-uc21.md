# Per-Vertical Entitlement — UC9 (Group) + UC21 (Tier)

**Status:** Design / not yet implemented. Supersedes the global banking-only
group policy. **Branch:** `authz-group-tier-rules`.

## Why this exists

Today the group/entitlement use case is **global and banking-only**:
`demo_api_server/config/group-policy.json` maps exactly one banking tool
(`get_sensitive_account_details`) to one banking group (`PrivilegedBanking`).
Switch to any other vertical and there is no entitlement enforcement — the
restricted-tool map matches nothing.

We are a **multi-vertical** demo. Each vertical must demonstrate its **own**
version of:

- **UC9 — Group / entitlement check:** a user not in the required group is
  denied a sensitive tool, even with a valid token and the right scope
  (least-privilege at the authorization layer).
- **UC21 — Entitlement-tiered capability:** a premium-tier user's agent can use
  a higher-value tool; a standard-tier user's agent cannot (and the tool isn't
  even offered).

Both must run on the **MCP tool-call path** (where `RequiredGroup`/`UserGroups`
already flow), not the transaction-amount policy.

## The architecture already supports this

Each vertical plugin (`demo_api_server/config/verticals/<v>/tools.js`) declares
per-tool `authz` metadata, surfaced by `getAuthz()`
(`config/verticals/shared/createVerticalPlugin.js:37`) and resolved per active
vertical by `services/verticalDispatch.js:142`. Example today:

```js
{ name: 'release_records', scopes: ['write'], authz: { stepUp: true, consent: true } }
```

The entitlement use cases extend this same `authz` block — no new plumbing
shape, just two new keys (`requiredGroup`, `requiredTier`).

## Derived defaults (proposed — adjust freely)

`demoUser` is entitled + premium; `demoDelegate` is neither (the user who gets
denied). Group/tier names are vertical-flavored.

### UC9 — restricted sensitive tool → required group

| Vertical | Restricted tool | Required group |
|---|---|---|
| healthcare | `sensitive_patient_records` | `PrivilegedCare` |
| retail | `sensitive_order_history` | `VerifiedShoppers` |
| government | `release_record` | `ClearedFilers` |
| workforce | `sensitive_payroll_details` | `PayrollAccess` |
| manufacturing | `release_work_order` | `PlantOperators` |
| university | `release_transcript` | `EnrolledStudents` |
| sporting-goods | `sensitive_membership_details` | `VerifiedMembers` |
| banking (baseline) | `get_sensitive_account_details` | `PrivilegedBanking` |

### UC21 — premium-only tool → required tier

| Vertical | Premium-only tool | Premium tier |
|---|---|---|
| healthcare | `release_records` | `ConciergeCare` |
| retail | `redeem_store_credit` | `PremiumMember` |
| government | `submit_filing` | `PriorityFiler` |
| workforce | `enroll_training` | `LeadershipTrack` |
| manufacturing | `approve_purchase_order` | `PlantManager` |
| university | `apply_scholarship` | `HonorsProgram` |
| sporting-goods | `redeem_points` | `EliteAthlete` |
| banking (baseline) | (large-value tool) | `PrivateBanking` |

## Mechanism (both use cases)

1. **Declare** in each vertical's `tools.js` authz block:
   - UC9: `authz: { requiredGroup: 'PrivilegedCare' }`
   - UC21: `authz: { requiredTier: 'ConciergeCare' }`
2. **Identity data is per-vertical** (a user can be entitled in healthcare but
   not banking). Store `userGroups` / `userTiers` per vertical (seed.json block
   or vertical-scoped map). `demoUser` in the group + premium tier;
   `demoDelegate` standard / no group.
3. **`groupPolicy.js` becomes vertical-aware** — `requiredGroupForTool(tool)`
   reads the **active vertical's** resolved authz (via `verticalDispatch`
   `getAuthz`) instead of the global JSON. Add `requiredTierForTool(tool)` and
   `tierForUser(username)`. The global `group-policy.json` is retired (or kept
   only as the banking baseline).
4. **`mcpToolAuthorizationService.js`** resolves `requiredGroup`/`userGroups`
   (already) **plus** `requiredTier`/`userTier` (new) and passes them as Trust
   Framework parameters to whichever engine runs.
5. **`simulatedAuthorizeService.evaluateMcpToolCall`** — group guard already
   exists (`:338`). Add a tier guard: `DENY` when
   `requiredTier && userTier !== requiredTier`.
6. **`demo_authz_server`** MCP decision — mirror the group + tier guards
   (**parity invariant**: simulated, mock, and live PingOne must agree on the
   same parameters → same decision).
7. **PingOne Authorize snapshot** — add the group + tier rules to the **MCP
   Delegation policy** (`DecisionContext = McpFirstTool/McpToolCall`) using
   `RequiredGroup`/`UserGroups` and `RequiredTier`/`UserTier`. **Scrap** the
   transaction-policy UC9/UC21 rules currently committed on this branch
   (parity-incorrect — wrong policy + single-string vs array-contains).
8. **Feature flags:** `ff_authorize_group_policy` (exists, default OFF) gates
   UC9. Add `ff_authorize_tier_policy` (default OFF) for UC21. Both no-ops when
   off — existing flows unchanged.

## App side (frontend) — what must understand this change

- **Use-case launcher** (`demo_api_ui/src/pages/UseCaseLauncherPage.js`,
  registry `demo_api_server/config/useCases.js`): UC9 + UC21 are **per-vertical**
  now. The demo of each fires against the **active vertical's** restricted /
  premium tool and group / tier — not banking's. Launcher copy ("transfer $600")
  is banking-specific and must be generalized per vertical.
- **Required-vs-user surfacing:** the MCP authz path already exposes
  required-vs-user **groups** to the UI
  (`mcpToolAuthorizationService.js:327`). The UI needs the same for **tier**
  (required tier vs user tier) so the denial is explainable on screen.
- **Tool visibility:** UC21's promise is "standard user's agent doesn't even
  see the premium tool." If the UI lists available tools per vertical, a
  standard-tier user should have premium-only tools filtered out (not just
  denied on call).
- **Decision parameters / token-chain panels:** any UI that renders the
  Trust Framework parameter set must include the new `RequiredGroup`/
  `UserGroups`/`RequiredTier`/`UserTier` keys.

## Parity checklist (must stay in lockstep)

Any change to the decision parameters or guards below must land in **all three**
engines (skill: `authz-server-parity`):

- `demo_api_server/services/simulatedAuthorizeService.js` (`evaluateMcpToolCall`)
- `demo_authz_server/routes/decision.js`
- `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`
  (MCP Delegation policy)

## Open items

- UC21 premium-tool picks above are proposals — confirm per vertical.
- Decide whether the global `group-policy.json` is deleted or demoted to the
  banking baseline only.
- Confirm `demoDelegate` is the right "denied" user across verticals.
