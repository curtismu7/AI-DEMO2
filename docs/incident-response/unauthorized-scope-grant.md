# Runbook: Unauthorized Scope Grant / Delegation Abuse

A principal holds — or used — authority it should not: an agent acting on a
user's behalf without a valid `may_act` grant, a delegation (`act` chain) used
for a tool it shouldn't reach, a token carrying an unexpected scope, or a
PingOne resource that drifted to grant more scopes than the topology intends.

**Default severity:** SEV-2 (confirmed unauthorized action) → SEV-1 (write/admin
scope abused, or PingOne resource misconfigured platform-wide).

See [README.md](README.md) for first-response and evidence-capture steps.

---

## 1. Detect / confirm

- **Decode the offending token.** Check `scope`, `act` (who is acting), and
  `may_act` (who the user authorized). The Authorization Server denies a delegated
  call when `act.sub != may_act.sub` — a PERMIT with a mismatched/empty `may_act`
  is the red flag.
- **Pull the delegation chain for the request.** `middleware/delegationAuditLogger.js`
  logs every mutating request's `act`/`may_act` chain (`DELEGATION_ACTION`,
  with `user`, `actor`, `actorType`, `agentPath`, correlation id). Find the
  request by correlation id and read the chain.
- **Check what the authz server decided.** With correlation propagation (see the
  gateway/authz `X-Correlation-ID` and the `authz_decision` structured audit
  record in `demo_authz_server`), a DENY/INDETERMINATE for the same correlation
  id tells you whether policy already blocked it or wrongly permitted it.
- **Check for PingOne scope drift.** If the concern is "a resource grants a scope
  it shouldn't":
  ```bash
  curl -sk https://api.ping.demo:3001/api/admin/scope-audit/resources \
    -H 'Authorization: Bearer <ADMIN_SESSION>'
  ```
  `services/scopeAuditService.js` compares each resource's **current** PingOne
  scopes to the **expected** set from the scope topology and flags `MISMATCH`
  (with `missing` / `extra`).

## 2. Contain

### a) Revoke the agent's authority to act for the user (`may_act`)
`routes/agentAuthorization.js` writes/clears the user's PingOne `mayAct`
attribute — the grant the user gave the agent.
```bash
curl -sk -X POST https://api.ping.demo:3001/api/agent-authorization/revoke \
  -H 'Authorization: Bearer <USER_SESSION>'
```
Returns `reauthRequired: true` — the new (cleared) claim only takes effect on the
**next** token, so also revoke the current token (see
[token-compromise.md](token-compromise.md) §2) so the in-flight token can't keep
acting. Verify with `GET /api/agent-authorization/status`.

### b) Revoke a family/user-to-user delegation
`services/delegationService.js` backs the family-delegation feature (LMDB db
`delegations`). `revokeDelegation(delegationId)` sets the record `status:
'revoked'` and re-syncs the delegator's `delegatedTo` attribute at PingOne. Find
the active grant (`getDelegationsForUser` / the Delegated Access admin view) and
revoke it. Pair with token revocation so an already-issued token stops working.

### c) Tighten the policy (stop it recurring this session)
Authorization is decided by the Authorization Server, and several rules are
runtime-editable via its rule store (`demo_authz_server/ruleStore.js`):
- `ENFORCE_MAY_ACT` — require the actor to equal the user's `may_act.sub`
  (per-user delegation) rather than a static authorized actor.
- The authorized-actor client id and the scope→tool / write-tool classification.

  Mirror any policy change in **both** the gateway path and the mock
  `demo_authz_server` (see the `authz-server-parity` skill) so the live and
  simulated backends stay identical.

### d) Fix PingOne scope drift
If the audit shows a resource with **extra** scopes, remove them in the PingOne
console. If a scope is **missing** (under-grant masking a config error),
`POST /api/admin/scope-audit/scopes` can create the intended one. Re-run the
audit until every resource reads `CORRECT`.

## 3. Eradicate

- Confirm the principal can no longer reach the resource: re-issue its token and
  retry the action — it must now be DENIED at the Authorization Server.
- Confirm the `authz_decision` audit shows DENY for the previously-permitted call.
- Confirm `scope-audit/resources` is all `CORRECT`.

## 4. Recover

- Re-grant *intended* delegations the response may have cleared.
- Have affected users re-authenticate so their tokens reflect the corrected
  `may_act` / scope state.
- If you edited authz rules, confirm the gateway and mock are back in parity and
  legitimate flows still PERMIT.

## 5. Post-incident

Run the [README post-incident checklist](README.md#post-incident-checklist-all-incidents).
Scope-specific:
- [ ] Root cause: was it a bad delegation grant, a token that over-scoped, or
      PingOne resource drift? Each has a different fix owner.
- [ ] If policy *should* have blocked it but didn't, add an `authz_decision`-level
      test and a `REGRESSION_LOG.md` entry; verify the rule in both gateway and mock.
