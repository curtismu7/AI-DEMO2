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

## 5. Not done in this report

- No PF token was decoded, no exchange was run, and the FM1-FM3 spec was not re-run.
- PF admin config (SP connections, clients, ATM) was not inspected; it is not tracked in the repo.
- mTLS per hop was not checked.
