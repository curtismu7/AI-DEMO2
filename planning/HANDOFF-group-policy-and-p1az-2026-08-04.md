# Handoff — group policy, P1AZ snapshot imports, amount bands (2026-08-04)

Written so another agent can pick this up cold. Live state was verified by probing
the real PingOne decision endpoint, not inferred.

Environment: `AI-Demo`, id `01d89b06-66d5-430e-9f28-65636843788b`, **type SANDBOX**
(there is no separate prod environment — see "Publishing" below).

---

## 1. What is live and verified

Probed against the live decision endpoint after the final publish:

```
Standard        $2,500   DENY    mcp-tier-amount-exceeded
PrivateBanking  $2,500   PERMIT                              <- UC21 works
PrivateBanking $60,000   DENY    mcp-tier-amount-exceeded    <- own cap enforced
no UserTier     $2,500   DENY                                <- fail-open shut
no UserTier     $9,999   DENY
unknown "Gold"  $2,500   DENY                                <- unknown tier = least privileged
read, no Amount          PERMIT                              <- was INDETERMINATE
$1,900                   single HITL_CONSENT                 <- was duplicated
```

Reproduce with `demo_api_server/scripts/verifyAuthorizeCloudParity.js` and
`scripts/verifyA2aDelegationPolicy.js`, or the ad-hoc probes described in §5.

Live PingOne facts worth not re-deriving:

- Groups `AI_Demo_Privileged` / `AI_Demo_Delegates` exist. demoUser + demoAdmin are
  in privileged; demoDelegate in delegates only.
- All 10 A2A specialist apps hold their dedicated scope. 10 apps serve 11
  specialists — banking and investment share the Holdings app (`appKey: investment`).
- `ff_a2a_delegation` = **true**. `ff_authorize_group_policy` = **false** (see §3).
- The demo worker is **403 on `authorizationPolicies`, `trustFrameworkServices`,
  `authorizationStatements`** and `/authorizationVersions` returns 0. Live policy
  structure can only be inspected by **exporting from the console** — not from code.

---

## 2. The import/publish workflow — read before touching policy

This cost more time than anything else today. The rules:

1. **The merger requires a LIVE EXPORT as input**, not the repo snapshot.
   `node snapshots/merge-mcp-amount-bands.js <export.json> [out.json]`
   Building from `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`
   produces a package describing a tree that does not exist in the environment.
   Every live version is a **PingOne-minted UUID**; the repo's are house-pattern
   strings, so they never correspond.

2. **PingOne SKIPS an object whose version is unchanged.** An edit with a stale
   version imports as a silent no-op: the file is right, the import reports
   success, the cloud keeps the old content. One import applied 61 new objects and
   **none** of the 14 edits.

3. **Import ≠ publish.** Importing stages objects; the decision endpoints evaluate
   the *published* authorization version. Behaviour does not change until Publish.

4. **Publishing has no endpoint to choose.** There are decision endpoints literally
   named `PROD` / `TEST` / `DEV` — the demo does not use them. It reads:
   ```
   PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID = 1f9e9c71…  "AI Demo — MCP first tool"
   PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID     = c9e87348…  "AI Demo — Transactions"
   ```
   Neither is version-pinned, so they take whatever is published. `PROD`/`TEST`
   **are** pinned, so publishing would not move them anyway.

Current procedure end to end:

```bash
# 1. Console: Authorize -> Trust Framework -> Export, save the JSON
# 2. Merge (also overlays generator-owned objects — see §4)
node snapshots/merge-mcp-amount-bands.js ~/Documents/<export>.snapshot /tmp/out.json
# 3. Console: Import that file, THEN PRESS PUBLISH
# 4. Probe (§5) — never assume it landed
```

---

## 3. Open items, smallest first

### 3a. `deploy-live.sh` reports "nothing to deploy" after every merge
It compares the **checkout SHA**, which `sync-main-checkout.sh` (and the 15-minute
launchd job) has usually already advanced — so it concludes there is no work while
the containers still run old code. It is structurally unable to detect the case it
exists for. Worked around manually 4× today with `docker restart ai-demo-api-server`.
Fix: compare against what the **containers** loaded, not the checkout.

⚠️ The BFF bind-mounts source, so a file change is visible to `grep` inside the
container while the Node process still holds the old module in its require cache.
`docker exec … grep` proving the file is right does **not** prove the code is live.
Restart and re-probe.

### 3b. `demo_authz_server` red locally, green in CI
`tests/decision.test.js:189` — `sensitive_holdings (read consent tool, no amount)`
expects INDETERMINATE, gets DENY. pass 220 / fail 1 locally; CI passes (the job
tolerates pre-existing failures for this suite). Newly relevant: #1310 changed
INDETERMINATE semantics (P1AZ's own INDETERMINATE now fails closed to DENY), so
this may be the mock disagreeing with the new contract rather than a stale test.
Run: `cd demo_authz_server && CI=true npm test` (**`node --test`, not jest** —
`npx jest` there reports "must contain at least one test" for all 23 suites).

### 3c. Browser-verify `/group-policy`
The board's API is tested; the page has never been rendered. Check: nav entry under
Demos, 11 rows, toggle flips every row to DENY with `mcp-user-not-in-group`, and
back. Sign in at `local.ping-devops.com:4000` — **not** `api.ping.demo:4000`, where
the session cookie lives on the other host and everything looks like broken auth.

### 3d. Enable `ff_authorize_group_policy`  ← the big one
Still `false`. Group policy therefore applies **only to UC9**, via a per-request
escape hatch (`shouldApplyGroupPolicyDemo`); everywhere else `UserGroups` is not
sent and the gate is dormant.

It is now safe to enable — the reason it was dangerous is fixed (§4, membership
read). Groups are provisioned and members are correct. After enabling, re-probe all
six checks in §1.

⚠️ Setting it: `PATCH /api/admin/feature-flags` requires an authenticated admin
session and the body shape `{ "updates": { "<flag>": true } }`. From the host, the
working path is inside the container, followed by a restart because the running
process caches it:
```bash
docker exec ai-demo-api-server node -e "
  const cs=require('/app/services/configStore');
  (async()=>{await cs.ensureInitialized();
   await cs.setRaw({ ff_authorize_group_policy:'true' });})()"
docker restart ai-demo-api-server
```

⚠️ Self-heal trap: `mcpToolAuthorizationService.js:1231-1244` disables this flag
**and strips `userTier`** on a live 400 naming `parameters.UserGroups`. `UserTier`
then defaults to `'none'`, so every tier ceiling goes dormant too, and the disable
**persists**. If a tier DENY stops firing, check the flag before suspecting policy.

### 3e. Stage 0 parity leftovers
`llm` chips for 3 verticals, 32 use-case cells. 24 negative chips landed in #1349.

### 3f. PR #1296 — open since earlier in the week.

---

## 4. Traps that cost time today

**A wrong `_embedded` key returns `[]`, and `[]` beats the manifest.**
`pingOneGroupMembershipService` read `resp.data._embedded.groups`. PingOne returns
the parsed **body** (no `data` envelope) under **`groupMemberships`**. Both wrong,
either alone fatal. A user in 15 groups resolved to zero, the function returned
`[]` from a *successful* call, and `groupPolicy.groupsForUser` lets an empty array
outrank the manifest — so enabling the flag would have denied **everyone**,
including demoUser. The unit fixtures encoded both mistakes, so the test proved the
parser handled fiction. Fixed in #1323.

**An under-specified probe is indistinguishable from a missing policy rule.**
`verify:authorize-parity` reported UC21's restricted-tool rule MISSING across three
imports. The rule was live the whole time; the probe's PERMIT control omitted
`Amount`, the tier-cap comparison had no operand, and P1AZ answered INDETERMINATE
with **no statements**. Tell them apart:
- `INDETERMINATE` + no statements → **missing operand in the probe**.
- `DENY` carrying the **wrong statement code** → the rule genuinely is not live.

**An unresolved NUMBER makes the WHOLE decision INDETERMINATE.**
`Amount` had `defaultValue: null` and **read tools never send Amount**
(`toolAmount` is only computed for tools in `WRITE_TOOL_TYPE_MAP`). Every read went
INDETERMINATE. Combined with #1310's fail-closed normalisation, pointing the gateway
at the cloud would have denied every read. `RarMaxAmount` already carried the same
`defaultValue: 0` fix, with a comment describing the mechanism verbatim — the older
attribute never got it. Fixed in #1343.

**Statement codes are deliberately reused, so a code cannot identify its rule.**
The merger emits `HITL_CONSENT` / `step-up-required` / `mcp-tier-amount-exceeded`
matching existing statements so the readers classify them. Two different rules
emitting `HITL_CONSENT` looked like a leftover; it was the amount band and the
per-vertical tool gate both firing. **Print the statement `name` and `payload`, not
just the code.** I misattributed this twice before doing that.

**Generator-owned objects must be overlaid, not inherited.** The merger builds on a
live export, so it inherited the cloud's `ExceedsTierAmountCap` and would have
shipped a package that fixed UC21 while opening a fail-open. #1367 overlays
`ExceedsTierAmountCap` / `IsStandardTier` / `IsTierRestrictedTool` / `Amount` from
the generated snapshot. `overlaid 0` in the output means the cloud already matches
the repo — a good sign, not a skip.

**A guard can pass while proving nothing.** Two examples today:
- The merger's churn guard asked "is this id in the `touched` set?" — deleting every
  `touch()` call also deleted everything it looked at, so the revert-to-RED passed.
- Its replacement used `JSON.stringify(rest, Object.keys(rest).sort())`. An array
  second argument is a key **allowlist applied at every level**, so nested keys
  inside `condition` were stripped from both sides and always matched. It could
  only ever see top-level scalars.
Always run revert-to-RED on a new guard.

**Tier conditions are version-grouped, not content-derived.** Changing them requires
bumping `TIER_VERSION_GROUP` in `gen-authorize-snapshot.js` (currently `4323`). The
generator warns; obey it or the import skips the object being fixed. Everything else
generated by `requestAttr`/`conditionDef`/`denyStatement`/`denyRule` is
content-derived since #1311 and moves automatically.

---

## 5. Probing recipes

```js
// demo_api_server — real decisions against live PingOne
const { decide, params, workerToken } =
  require('./scripts/verifyA2aDelegationPolicy');
const t = await workerToken();
const r = await decide(t, {
  ...params({ tool: 'create_transfer', depth: 1, vertical: 'banking' }),
  UserTier: 'PrivateBanking', Amount: 2500, TransactionType: 'create_transfer',
});
// r.decision, and ALWAYS r.body.statements[].name / .payload — not just .code
```

`snapshots/` is **allow-by-default** in `.gitignore`; a test added there is tracked
and will run. `authorizeSnapshotTierPolicy.test.js` runs under `npm run
test:snapshots` (node --test) — a separate CI job from the jest suites, so changing
a snapshot condition means running **both**.

`merge-mcp-amount-bands.js` contains 4 NUL bytes (deliberate sentinel tokens in the
de-brand masker), so git treats it as **binary** and plain `grep` suppresses
matches. Use `grep -a`.

---

## 6. Merged today

`#1320` generic group · `#1323` membership read · `#1329` UC9 toggle ·
`#1331` specialist scopes · `#1343` Amount defaultValue · `#1311` content-derived
versions · `#1346` merger versioning guard · `#1352` tier-aware deny ·
`#1367` generator overlay + guard fix · `#1369` consent dedupe + `/group-policy` board
