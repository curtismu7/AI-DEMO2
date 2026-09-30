# Trusted AI Agent Transactions — how the demo scores against the five identity values

Date: 2026-09-30. Reference: darkedges, "Trusted AI Agent Transactions, Part 1: The Identity Problem" (dev.to).

Method: code read of `demo_api_server/` in this worktree, a query of the running `ai-demo-api-server` container, and the 2026-09-26/27 A2A-under-PingFederate handoffs. **No live token was minted for this report**, so every "carried in the token" statement below is from code and handoff notes, not from a decoded token. Nothing here was verified against a live PingFederate exchange.

## 1. Are we using PingFederate? Not right now.

| Check | Result |
|---|---|
| `configStore.getOAuthProvider()` inside `ai-demo-api-server` | `pingone` |
| `docker-compose.yml` `OAUTH_PROVIDER` pin | Removed (only an unrelated comment mentions it) |
| `.demo-provider-intent.json` | `provider: pingone` (set by cmuir, 2026-09-26) |
| `/api/health` | `pingone_auth`, `pingone_jwks`, `token_introspection` at auth.pingone.com; no PF component |
| `PF_*` env in the BFF container | Populated (PF token/discovery endpoints, actor and exchanger clients, `PF_ID_JAG_ENABLED=true`), so the PF path is configured and switchable |

The PF code path exists and is selected purely by `oauth_provider` (`configStore.js:1894`). With `pingone` active, the delegation chain runs the PingOne two-exchange path, so **none of the scores below describe a live PF run today.** The 2026-09-27 handoff describes the compose pin being present during the UC40 window; it has since been removed.

## 2. Scorecard against the five values

Legend: ✅ present in the path · ⚠️ partial or not in the governed path · ❌ absent.

| # | Value (article) | PingOne path (live today) | PingFederate path | Verdict |
|---|---|---|---|---|
| 1 | UserID — authenticated human as delegation root | ✅ user token `sub` is the subject_token of Exchange #1 | ✅ same; PF login for user (`PF_USER_CLIENT_ID`), ID-JAG subject is the refresh token | ✅ |
| 2 | AgentID — approved logical agent, policy-mapped to a verified identity | ✅ `agentIdentity.js` / `agentIdentityStore.js` map an agent to its OAuth client; the client credentials token is the `actor_token`; result carries `act` | ⚠️ ordinary PF runs use PF actor clients via `providerConfig`. Two limits: (a) the ID-JAG path does not bind the selected agent (`agentMcpTokenService.js:1520-1527`), (b) in the A2A ID-JAG the `act` value is a hard-coded TEXT `{"sub": <generalist client id>}` in the PF SP-connection mapping, not derived from the calling agent (handoff 2026-09-27 §2.1) | ⚠️ |
| 3 | AgentInstanceID — one execution of that agent | ❌ no per-run identifier anywhere in the services (searched `agent_instance`, `instance`, in `agentMcpTokenService.js`, `a2aDelegationService.js`, `pf*Service.js`) | ❌ | ❌ |
| 4 | SPIFFEID — attested runtime workload identity (JWT-SVID as evidence, X.509-SVID for mTLS) | ⚠️ only via `/api/demo/spiffe/*` | ⚠️ `spiffePingfederateService.js` mints a real SPIRE JWT-SVID and presents it as `actor_token` to PF's RFC 8693 endpoint; PF lands `spiffeId` on the issued token. It is gated by `ff_spiffe_pf_exchange` and its own header says it is "a demonstration endpoint, not part of any governed delegation chain". `agentMcpTokenService.js` has zero SPIFFE references | ⚠️ (real, but off to the side) |
| 5 | TransactionID — immutable id for the delegated action, unchanged across hops | ⚠️ `jti` linkage T1→T2 is logged (`agentMcpTokenService.js:2426-2441`), but `jti` is per-token, not one id carried unchanged | ⚠️ same | ❌ for the article's meaning. `routes/txnTokenDemo.js` is a self-contained mock (`txn-${Date.now()}`), and the banking transaction ids (`routes/transactions.js`) are not put in tokens |

Supporting mechanics from the article:

| Mechanic | Status |
|---|---|
| RFC 8693 token exchange, short-lived, nested `act` | ✅ two-exchange contract, on both providers |
| Exchange performed by PingFederate | ⚠️ configured and (per handoff) rebuilt hop-by-hop, but not the active provider; last step of A2A-under-PF (final `aud` `https://agentgateway.ping.demo` vs BFF-required `https://api.ping.demo:3036/mcp`) was still open at 2026-09-27 and is marked unverified |
| Independent mTLS verification at each hop | Not verified here. `MCP_MTLS_ON` exists as a switch; it was not checked for this report |
| Purpose bound into the token | ⚠️ `scope` and RAR (`pfAiAgentRarService.js`) exist; no explicit purpose claim was confirmed |

Tally: **1 fully present, 2 partial (AgentID, SPIFFEID), 2 missing in the article's sense (AgentInstanceID, TransactionID).**

## 3. Gaps, in order of leverage

1. **AgentInstanceID (❌).** Cheapest to add: generate an id per agent run in the delegation service and carry it as a claim through both exchanges. PF side needs one attribute in the SP-connection contract (same mechanism as `a2a_tenant_id`).
2. **TransactionID (❌).** Mint once at the edge and pass unchanged through both exchanges as a claim. Reuse the existing T1↔T2 linkage logging to prove it. Do not reuse `txnTokenDemo.js`; it is a mock.
3. **SPIFFE in the governed chain (⚠️).** Move the SVID from the demo endpoint into the Exchange #1 `actor_token` path under PF. The PF JWT processor (`aiDemoPfAccessSubjectProcessor` per handoff) already trusts the SPIRE issuer.
4. **AgentID in PF ID-JAG (⚠️).** Replace the hard-coded `act` TEXT value with the selected agent's identity, and lift the limit at `agentMcpTokenService.js:1520`.
5. **Make PF the active provider for the demo of this story** — see section 4.

## 4. What "make sure we are using PF" needs

Switching provider is a live-stack change and is protected (REGRESSION_PLAN §1: auth / token exchange). Steps, each to be run and confirmed before claiming PF is active:

1. Set `oauth_provider=pingfederate` through the admin toggle (not by re-adding the compose pin: the intent file and its pre-commit guard say the env layer must not outrank the toggle).
2. Confirm inside the container: `configStore.getOAuthProvider()` returns `pingfederate`.
3. Confirm the PF profile still holds the A2A config from the handoff (SP connections `aiDemoA2a*Sp`, 11 specialist clients, `aiDemoStandardTePolicy`, ATM audience fix from handoff §4). The handoff says this is unverified.
4. Run one delegation and decode the final token; check `iss` is PF (`https://local.ping-devops.com:9031`), `sub`, nested `act`, and `spiffeId` if the SPIFFE flag is on.
5. Re-run `demo_api_ui/tests/e2e/a2a-failure-modes.real.spec.js` (FM1/FM2/FM3) against `local.ping-devops.com:4000`.

Caution: the provider intent file records an earlier finding that "A2A requires PingOne-minted act claims". The 2026-09-27 handoff reports that PF now mints them; step 4 is the check that settles it.

## 5. Live PingFederate run (2026-09-30, after the flip)

Setup: provider flipped with `POST /api/admin/config {oauth_provider: pingfederate}` (the admin UI toggle was unusable, see 5.3). The running server then reported `pingfederate`. Stack generation was pinned before and unchanged after, so the run is valid. Login and the A2A call used the demo customer through `local.ping-devops.com:4000`.

### 5.1 FM1-FM3 (`a2a-failure-modes.real.spec.js`): 2 passed, 1 failed

| Test | Result |
|---|---|
| FM1 out-of-allowlist tool refused, allowlist named | ✅ pass |
| FM2 act-less bearer refused by the A2A wire gate | ✅ pass |
| FM3 happy path stays green | ❌ `sensitive_passenger_record failed: mcp_error` (final hop) |

### 5.2 Decoded tokens from one real delegation (sanitized claims; raw tokens never printed)

All tokens are issued by PingFederate (`iss` = `https://local.ping-devops.com:9031`), so PF is the live issuer.

| Hop | sub | act | aud | scope |
|---|---|---|---|---|
| user token | `demouser` | empty | `enduser.ping.demo` | openid profile email offline_access accounts:read ai:agent:read mcp:invoke |
| agent 1 actor (CC) | absent | none | `enduser.ping.demo` | agent:invoke |
| Exchange #1 | `demouser` | `{sub: 0b412e8b-...}` | `https://a2a-intermediate-passenger.ping.demo` | agent:invoke:passenger |
| agent 2 actor (CC) | absent | none | `https://agentgateway.ping.demo` | agent:invoke:passenger |
| Exchange #2 | **absent** | `{sub: 7f598698-...}`, single level | `https://agentgateway.ping.demo` | gateway:mcp:invoke pnr:read |
| A2A protocol message | failed | | | |

Findings:

1. **UserID (✅ through Exchange #1).** `sub=demouser` is preserved by Exchange #1, then **not visible in Exchange #2** (no `sub` in the sanitized claims; the event list is filtered by `sanitizeClaims`, so this needs a raw-claim check).
2. **AgentID (⚠️ confirmed).** `act.sub` at Exchange #1 is `0b412e8b-...`, which equals `PF_AI_AGENT_ACTOR_CLIENT_ID` (the generalist client). That matches the hard-coded TEXT `act` in the SP-connection mapping, so it names the generalist, not the calling specialist.
3. **Nested act (❌ for the article's chain).** Exchange #2 carries a single `act`, no `act.act`. The Exchange #1 actor is not nested under the Exchange #2 actor, so the user -> generalist -> specialist chain is not present in the final token as decoded.
4. **AgentInstanceID, SPIFFEID, TransactionID (❌ on this path).** No such claim is visible on any hop. The sanitized view may hide claims (only some events list hidden claim names), so absence of a claim here is "not shown", not proof the token lacks it.
5. **FM3 root cause (matches the handoff).** The final token's `aud` is `https://agentgateway.ping.demo`, and the last hop fails with `mcp_error`. The handoff's open item (BFF requires `https://api.ping.demo:3036/mcp`) is still the likely cause; the call was not traced to the exact rejecting check.

### 5.3 Side findings during the run

- **UI 404 was a stray port-forward.** A `kubectl port-forward -n ai-demo svc/frontend 4000:4000` (PID 6418, started 08:03) was bound to `127.0.0.1:4000` and shadowed Docker's forward, so the browser reached the k8s frontend. It was stopped with the user's approval. `ai-demo-ui` was also restarted (its Vite process had stopped answering `docker exec`).
- **`/api/admin/config` is open on the local stack by design.** An unauthenticated POST returned 200 and could flip the provider, which first looked like a hole. It is not: `requireAdminOrUnconfigured` (`routes/adminConfig.js:71`) lets every request through when `NODE_ENV !== production`, and the local Docker BFF runs `development`. In production it requires an admin session (401 otherwise). No defect; an earlier draft of this report and a TECH_DEBT.md entry said otherwise and were retracted.
- **Provider lock drift.** `.demo-provider-intent.json` still says `pingone` while the live provider is `pingfederate`; `scripts/pingone/demo-provider-lock.js verify` and the health gate's provider-lock row will report drift until one is changed.
- **PF admin login failing in spec harness.** The spec's headless admin login logs `PingFederate rejected the credentials` and falls back to the LMDB session store; not relevant to FM1-FM3 but noisy.

### 5.4 Investigation of the two open items (read-only; no PF or code changes)

**FM3 root cause: the audience fix from the handoff is not live.** Read-only PF admin GETs (one login) show:

| PF object | Value |
|---|---|
| ATM `aiDemoPfAgentGwJwtAtm` Audience Claim Value | `https://agentgateway.ping.demo` (handoff section 4 says it was set to `https://api.ping.demo:3036/mcp`) |
| ATM `aiDemoPfMcpGatewayJwtAtm` Audience Claim Value | `https://api.ping.demo:3036/mcp` (already exists) |
| ATM `aiDemoPfJwtAtm` (user tokens) | `enduser.ping.demo` (correct; the handoff's mistaken edit is reverted) |
| Specialist client `7f598698-...` (PASSENGER) | default ATM `aiDemoPfAgentGwJwtAtm`, restrict-to-default = true |
| TE mappings for `aiDemoStandardTePolicy` | to `aiDemoPfAgentGwJwtAtm`, `aiDemoPfJwtAtm` and `aiDemoPfMcpGatewayJwtAtm` |

Because the specialist client is restricted to `aiDemoPfAgentGwJwtAtm`, Exchange #2 mints with that ATM, so the final `aud` is `https://agentgateway.ping.demo`, which the BFF rejects (it requires `https://api.ping.demo:3036/mcp`). The handoff's hypotheses 1 (PF cache) and 3 (half-reverted edit) are ruled out for the user ATM; the actual state is that the AgentGw ATM edit is absent (never persisted, lost in a profile rebuild, or applied to a different environment: not determinable from here).

Two candidate fixes, both changes to live PF config that is not tracked in this repo:
- (a) Set `aiDemoPfAgentGwJwtAtm` Audience Claim Value to `https://api.ping.demo:3036/mcp`. One edit, but it also changes the audience of every token that ATM mints, including the agent actor tokens; the JWT processor's allowed-audiences list already contains both strings per the handoff.
- (b) Repoint the 11 specialist clients' default ATM to `aiDemoPfMcpGatewayJwtAtm` (audience already correct). More edits, scoped to A2A, and leaves the AgentGw ATM untouched for any other user.

Neither has been applied. Verification once applied: rerun FM3, then decode Exchange #2 and check `aud`.

**Admin-login noise is expected under PF.** `tests/real/helpers/session.js` logs in the admin persona with `DEMO_ADMIN_*` / `PINGONE_TEST_ADMIN_*` credentials against whichever provider is active. Under `pingfederate` those PingOne admin credentials are sent to PF's form, which rejects them, and the helper falls back to the LMDB session store (`session.js:246-256`). It does not affect FM1-FM3 and does not occur under PingOne. Inferred from the code path; the specific env vars in use were not printed or checked.

## 6. Not done

- Raw (unsanitized) token claims were not inspected, so `spiffeId`, instance and transaction claims are unconfirmed either way.
- PF admin config (SP connections, clients, ATM) was not inspected; it is not tracked in the repo.
- mTLS per hop was not checked.
- The provider was flipped back to `pingone` after the run (confirmed by GET `/api/admin/config`), matching `.demo-provider-intent.json`.
