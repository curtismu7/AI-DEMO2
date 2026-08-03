# Live PingOne runbook

Merged code that stays inert until these run. Nothing here was executed by an agent — all of it mutates a live environment.

**Order matters.** Step 1 before step 5, or the demo denies every user — including demoUser.

**Step 5 is not optional.** Both flags default to `false`; with them off, everything above is provisioned and unused.

---

## 0. Preflight — 2 min

```bash
cd /Users/cmuir/Development/AI-DEMO2
git pull
./scripts/sync-main-checkout.sh      # Docker bind-mounts this checkout
```

All three must resolve in `demo_api_server/.env` or configStore, or step 1 throws `Missing PingOne worker credentials`:

- `PINGONE_ENVIRONMENT_ID`
- `PINGONE_WORKER_CLIENT_ID`
- `PINGONE_WORKER_CLIENT_SECRET`

Confirm `demoUser`, `demoAdmin`, `demoDelegate` exist. Missing ones are reported under `summary.missingUsers` and their memberships are **silently skipped**.

---

## 1. Provision groups — PR #1264

Creates `Government_Privileged` / `_Delegates` and the same for investment, manufacturing, university; adds demoUser and demoAdmin to each `*_Privileged`. Idempotent.

```bash
npm run pingone:provision-groups          # all verticals
```

Also needed now that admin's A2A merged (#1297): **`Admin_Privileged`**.

**Verify:** `ok: true`, `summary.warnings === 0`, `summary.missingUsers` empty.

---

## 2. A2A specialist apps — the bulk of the work

Everything is driven from `A2A_SPECIALISTS`, so this provisions them all idempotently:

```bash
npm run pingone:bootstrap                 # Step 37a-A2A
```

⚠️ **Revoke before granting.** PingOne enforces one scope-name per client across all grants and **silently skips a colliding grant**. `pingoneProvisionService.js:3183-3204` already does revoke→create→grant in that order; by hand you must too.

### Already merged — provision now

**Passenger Records Specialist** (airlines, #1279):

- WEB_APP `Demo AI App - Passenger Records Specialist Agent` — `client_credentials` + `token-exchange`, `client_secret_post`
- resource `Super Banking A2A Intermediate - Passenger Records Specialist`, aud `a2a-intermediate-passenger.ping.demo`, scope `agent:invoke:passenger`
- add `pnr:read` to `Super Banking API` **and** `Super Banking A2A MCP Gateway`
- grant `agent:invoke:passenger` to the **AI Agent** app on the new intermediate, and to the specialist on its own
- grant `pnr:read` to the specialist on the A2A MCP Gateway resource
- `may_act = {"sub":"<specialist clientId>"}` and `act = ${#root.context.requestData.subjectToken.may_act}` on the new intermediate
- env: `PINGONE_A2A_PASSENGER_AGENT_CLIENT_ID` / `_SECRET`, `A2A_INTERMEDIATE_AUDIENCE_PASSENGER`

**Identity Verification Specialist** (admin, #1297 — merged, provision now) — same shape: `agent:invoke:identity`, aud `a2a-intermediate-identity.ping.demo`, scope `identity:read`, env `PINGONE_A2A_IDENTITY_AGENT_CLIENT_ID` / `_SECRET` and `A2A_INTERMEDIATE_AUDIENCE_IDENTITY`. Also needs group `Admin_Privileged`.

### Pending merge — do after that PR lands

**Three dedicated scopes replacing bare `read`** — retail `purchase:read`, sporting-goods `membership:read`, workforce `payroll:read`. For each: revoke the app's grants on `Demo API` and `Demo MCP Gateway`, create `<appKey>:read` on `Super Banking A2A MCP Gateway`, grant to that app only.

---

## 3. Snapshot import — REQUIRED

**Investment's A2A stays broken until this runs.** `RequiresA2aDelegation` now names `sensitive_holdings` instead of a tool that never existed.

```bash
npm run snapshot:generate
git diff --stat            # must be empty
```

PingOne console → **Authorize → Trust Framework → Import** → `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`

⚠️ **PingOne skips an object whose `version` is unchanged.** A regenerated ceiling with a stale version imports as a silent no-op — the file is right, the cloud is stale, and nothing says so. Bump `TIER_VERSION_GROUP` in the same commit as any threshold change.

---

## 4. Deploy policy

```bash
pac deploy pac/policies/mcp-delegation.yaml
```

---

## 5. Enable the two flags — LAST

Everything above is inert until these are on. Both default to `false`.

### `ff_a2a_delegation`

**Without this, every A2A chain is dormant** — the specialists, the dedicated scopes, the nested `act` chains, all of it. `a2aDelegationService.js:249` returns `a2a_delegation_disabled` immediately, and `verticalDispatch.js:20` gates `a2aActiveFor` on it, so `a2aDelegated` tools fall through to the standard BFF preflight.

That fallthrough is the failure this work exists to remove: the tool still returns data, and demonstrates no delegation at all. A demo that looks correct and proves nothing.

### `ff_authorize_group_policy`

⚠️ **Only after step 1 reports clean.** `groupPolicy.groupsForUser()` prefers a live directory lookup and it **beats the manifest** — it returns `[]` on a *successful* call where the user is in none of the vertical's groups, and that empty array wins. Enable before the groups exist and demoUser is denied too: "no gate" becomes "a gate that denies everyone."

```
PATCH /api/admin/feature-flags   { "ff_a2a_delegation": true }
PATCH /api/admin/feature-flags   { "ff_authorize_group_policy": true }
```

Confirm both took:

```bash
curl -s https://api.ping.demo:3001/api/admin/feature-flags \
  | python3 -c "import json,sys; print({f['id']: f['value'] for f in json.load(sys.stdin)['flags'] if f['id'] in ('ff_a2a_delegation','ff_authorize_group_policy')})"
```

---

## 6. Verify against real PingOne — not the mock

```bash
cd demo_api_server && npm run verify:authorize-parity
```

Hits the **real** decision endpoint with a worker token, bypassing the mock, requires the specific `statements[].code`, and includes a negative control. **That is the discriminator: a mock DENY never reaches that endpoint at all.**

| Vertical | Action | Expect |
|---|---|---|
| government | `sensitive_tax_record`, non-privileged | DENY `user_not_in_group` |
| government | same, as demoUser | permit |
| investment | `inv-a2a` chip | nested `act` chain, Exchange #1 + #2 |
| airlines | `ua-a2a` chip | delegation; an ordinary consent read must NOT answer it |
| banking | `create_transfer` $5,000 as Standard | DENY `mcp-tier-amount-exceeded` |
| banking | same as PrivateBanking | permit |

---

## Separate — broken dev environment

Not PingOne, but it blocks resource-server work. `demo_mcp_resource_server/node_modules` has `@types/node@20.19.39` against a `^22.10.2` requirement and **no jest**, so `tsc --noEmit` fails on `node:sqlite` and `npm test` exits 127.

Both resource-server containers bind-mount this checkout, so do it in a window where a restart is acceptable:

```bash
cd demo_mcp_resource_server && npm install
docker restart ai-demo-mcp-resource-server ai-demo-api-resource-server
```

---

## Four ways this looks fine while being broken

**A malformed `UserGroups` value disables both controls, permanently.** `mcpToolAuthorizationService.js:1231-1244` self-heals a live 400 by disabling `ff_authorize_group_policy` **and** retrying with `userTier` stripped. `UserTier` defaults to `'none'`, so every tier ceiling goes dormant too — and `disableGroupPolicy` *persists*. If a DENY stops firing, check the flag before suspecting policy.

**Two guards run before the group guard and mask it.** The a2a-delegation guard needs act depth ≥ 2; the audience guard needs `mcpResourceUri` absent or matching. A trace returning `a2a_delegation_required` never reached the group check — do not read it as confirmation.

**A mock DENY proves nothing about the cloud.** The local p1az-mock is authored policy in the same generator.

**A colliding grant is skipped silently.** One scope-name per client across all grants — if you grant without revoking first, PingOne accepts the call and does nothing.
