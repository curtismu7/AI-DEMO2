# UC40 PingFederate ID-JAG — Session Work Log & Handoff

**Date:** 2026-09-26
**Purpose:** Record of everything done debugging the UC40 (PingFederate ID-JAG) demo end-to-end, the exact remaining blocker, and what the next agent must do. Use this to check your work against ours — do not re-derive conclusions already proven here.

---

## 1. Current end-to-end status

| Stage | Status | Notes |
|---|---|---|
| BFF config → PingFederate provider | ✅ | `OAUTH_PROVIDER: pingfederate` pinned in `docker-compose.yml` `environment:` (overrides `.env` churn by other sessions) |
| PF clients (login/admin/id-jag/spiffe-te) | ✅ | Exist on `ai-demo-pf-user` secret = BFF's `pf_user_client_secret` |
| Login chain (intent → logout → SLO → PF login → callback) | ✅ | Verified headless: `oauth=success`, `idJagRunIntent` present in `/api/auth/oauth/user/status` |
| Silent logout (SLO confirmation auto-consent) | ✅ | Template patched; re-apply via `scripts/pingfederate/apply-login-theme.sh` after any PF volume reset |
| PF session recognized after login | ✅ | Was broken by wrong issuer/audience in PF's JWT ATM — fixed (see §2) |
| **Standard 2-exchange — Exchange #1 (actor CC)** | ✅ | `ai-demo-pf-standard-actor` CC grant returns 200 |
| **Standard 2-exchange — Exchange #1 (token exchange)** | ❌ **BLOCKED HERE** | PF rejects the **subject token**: `UnresolvableKeyException` inside `JwtTokenProcessor` (see §4) |
| Token chain UI update | ❌ | Follows from the above — pipeline 502s before any hop is emitted |

---

## 2. What was found broken and fixed (PF admin API at `https://localhost:9999/pf-admin-api/v1`, user `administrator`, password `Reset-Temp-Pass-2026`, header `X-XSRF-Header: x`)

1. **`oauth_provider` flapping to `pingone`** — other sessions kept rewriting `demo_api_server/.env`.
   - Fix: pinned `OAUTH_PROVIDER: pingfederate` in the `demo-api-server` service `environment:` block of `docker-compose.yml` (env_file-override semantics, commented with a removal note).
   - **Check:** `docker exec ai-demo-api-server sh -c 'echo $OAUTH_PROVIDER'` must print `pingfederate`.

2. **PF JWT access-token manager (`aiDemoPfJwtAtm`) had wrong claims:**
   - `Issuer Claim Value` was `https://localhost:9031` → changed to `https://local.ping-devops.com:9031`
   - `Audience Claim Value` was `ai-demo-pf-id-jag` → changed to `enduser.ping.demo` (must match BFF `ENDUSER_AUDIENCE`).
   - **Check:** tokens minted by PF decode with `iss=https://local.ping-devops.com:9031`, `aud=enduser.ping.demo`, `sub=demouser`.

3. **Missing OAuth clients** (only 4 existed on the `out-classic` volume; the standard-exchange clients were never created):
   - `ai-demo-pf-standard-actor` — secret `ZTuYmXA5jziDTm25dAcIKKyUmdQVD3y9crnu2SKcNG4tScauBm3GM5MntfHdszkJ` (from BFF `pf_ai_agent_actor_client_secret`), grants: `CLIENT_CREDENTIALS`, `TOKEN_EXCHANGE`
   - `ai-demo-pf-standard-mcp-exchanger` — secret `a1874fd1978fde38a136eec549b517b1a2d3b2551dd5343c1fc717fdbaaa0e94` (from BFF `pf_standard_token_exchange_client_secret`)
   - `ai-demo-pf-standard-agent-exchanger` — secret `dd53ddf4b2e95dc0266b3229d5b2291f0cd39c9a51c8de79040bb8f6db4dde29` (from BFF `pf_standard_agent_exchange_client_secret`), with `defaultAccessTokenManagerRef = aiDemoPfAgentGwJwtAtm` and `restrictToDefaultAccessTokenManager = true`
   - All three grant types: `["CLIENT_CREDENTIALS", "TOKEN_EXCHANGE"]`, `requireProofKeyForCodeExchange: false`.

4. **Missing AS scopes** — added to `/oauth/authServerSettings` scopes list: `agent:invoke`, `read`, `write`, `transfer`, `admin:read`, `sensitive:read`. (`read`/`write` are injected by the BFF when `ff_inject_scopes` is ON; `agent:invoke` is the actor CC scope.)

5. **Stale JWT Token Processor (`aiDemoPfAccessSubjectProcessor`)** — its Allowed Issuers table still had `https://localhost:9031`; updated issuer to `https://local.ping-devops.com:9031` + JWKS URL, and added audience `enduser.ping.demo` (kept `ai-demo-pf-id-jag`).

6. **New Token Exchange processor policy `aiDemoStandardTePolicy`** ("AI Demo Standard 2-Exchange Delegation") — mirrors `aiDemoSpiffeTePolicy` but subject processor = `aiDemoPfAccessSubjectProcessor` for BOTH subject and actor (PF access tokens, not SPIFFE SVIDs). Attribute contract copied from the SPIFFE policy (subject/scope/client_id/spiffeId), `spiffeId` fulfilled from `ACTOR_TOKEN.sub`. Attached to client `ai-demo-pf-standard-mcp-exchanger` via `tokenExchangeProcessorPolicyRef`.

7. **New access-token manager `aiDemoPfAgentGwJwtAtm`** — clone of `aiDemoPfJwtAtm` with `Audience Claim Value = https://agentgateway.ping.demo` and `Publish Keys to the PingFederate JWKS Endpoint = false` (so the shared key ID doesn't collide). Needed because PF derives output token `aud` from the mapping's ATM, and Exchange #1's intermediate token must have aud `https://agentgateway.ping.demo` for `validateIntermediateToken` to pass.

8. **New access-token mapping** `urn:ietf:params:oauth:grant-type:token-exchange|aiDemoStandardTePolicy|aiDemoPfAgentGwJwtAtm` (copy of the SPIFFE mapping with the new policy context + new ATM). A second mapping for `...|aiDemoPfJwtAtm` also exists; PF currently resolves the exchange via the client's default ATM (agent-gw one).

9. **BFF code fix (`services/pfStandardTokenExchangeService.js`)** — `sameScopes()` changed from exact-equality to **subset** semantics: PF's policy issues a policy-level scope set (superset of requested scopes); exact equality made every PF-mode exchange fail "intermediate scope mismatch". **This is an uncommitted working-tree change.**

10. **SLO templates** (in the PF volume, re-applied by `apply-login-theme.sh`):
    - `idp.slo.success.page.template.html` — meta-refresh to `https://local.ping-devops.com:4000/logout`
    - `idp.slo.confirm.page.template.html` — `giveConsent()` auto-submits (`/* ai-demo silent logout */ submit(true); return;`)
    - ⚠️ The theme script's confirm-template sed uses a `\0` backreference that **fails on Alpine sed** — it was applied manually. Fix the script line before relying on it.

---

## 3. Verified-green chain (as of the last full test)

```
intent POST            → 201
logout ?id_jag_handoff → 200 (signoffUrl built, id_token_hint present)
SLO confirm            → (silent/auto) → success page → meta-refresh → /logout
clear-session          → 200 (marks logoutContinuationConsumed)
login?mode=live-id-jag → 302 → PF authorize (prompt=login)
PF login demouser/Baseball123! → 302 → callback
callback               → 302 → /pingfederate-id-jag/demo?oauth=success
user/status            → authenticated:true + idJagRunIntent{...}
```

Credentials: PF user `demouser` / `Baseball123!` (Simple PCV `aiDemoPfSimplePcv`).

**Session caveat:** `id_jag_login_required` is returned by `/api/mcp/tool` unless the request comes from a session that completed the live ID-JAG handoff (pending-intent chain). A plain logged-in session is NOT enough for UC40 runs; the UI chip flow satisfies it.

---

## 4. THE REMAINING BLOCKER (start here)

**Symptom:** `POST /api/mcp/tool` → 502 `invalid_grant`. BFF log shows:
```
[Exchange-As] client=ai-demo-pf-standard-agent-exchanger audience=(policy-derived) scope="agent:invoke read"
[ERROR] [mcp_tool_pipeline] Token resolution failed ... invalid_grant
```
**No `[Exchange-As] Failed` line is printed** — meaning `performTokenExchangeAs` SUCCEEDED (PF returned 200, confirmed in `server.log`) and the failure is thrown by `validateIntermediateToken()` in `services/pfStandardTokenExchangeService.js` (called at `agentMcpTokenService.js:2758`), which is silent (no log line) and whose error gets wrapped as `invalid_grant` upstream.

**PF-side root cause (proven from `server.log`):**
```
[JWT Token Processor 2.0] token processor failed processing [Subject Token]
Invalid Token. JWT processing failed. ...
  cause: org.jose4j.lang.UnresolvableKeyException: Unable to find a suitable verification key
```
PF's `aiDemoPfAccessSubjectProcessor` cannot verify the **user access token's signature** when it is the exchange SUBJECT. Reproduce with:
```bash
docker cp /tmp/replayrun.js ai-demo-api-server:/tmp/   # script exists on host /tmp/replayrun.js
docker cp /tmp/session_token.txt ai-demo-api-server:/tmp/st.txt
docker exec ai-demo-api-server node /tmp/replayrun.js
# → FAIL: Token exchange failed for ai-demo-pf-standard-agent-exchanger: Invalid Token.
```
(Hypothesis to check first: the processor's JWKS URL `https://local.ping-devops.com:9031/pf/JWKS` — PF fetching its **own** JWKS through the external hostname may fail TLS/hostname resolution inside the container, or the JWKS cache is stale. The SPIFFE flow worked earlier because its subject processor used a static JWKS/cert, not a URL fetch. Options: point the JWKS URL at `https://localhost:9031/pf/JWKS` or an internal alias, paste the JWKS inline in the "JWKS" field, or verify with `docker exec ai-demo-pingfederate curl -sk https://local.ping-devops.com:9031/pf/JWKS`.)

**Secondary gotcha once key resolution works:** `validateIntermediateToken` also checks `sub === userSub`. The policy maps `subject` from `SUBJECT_TOKEN.sub` (the user token's `demouser`), and `userSub` comes from the same token's claims, so they should match — verify after the key issue is fixed.

**After Exchange #1 works, expect Exchange #2 issues** (same policy, `ai-demo-pf-standard-mcp-exchanger`, final aud = mcp gateway audience). The final-token validation also requires a supported `act` claim shape (`act.sub = agent actor`, optionally nested) — the mapping fulfills `act` from `spiffeId` (= ACTOR_TOKEN.sub = the agent actor), which produces the flat shape. If the mcp-exchanger client also needs its own ATM for the final aud, clone the same pattern (its expected final audience is `mcpResourceUri` / gateway aud — check `opts.forcePingGatewayAudience` / `expectedFinalAudience` in `agentMcpTokenService.js:1782-1801`).

---

## 5. Diagnostics that were added (temp) — REMOVE before merging

- `services/oauthService.js` `performTokenExchangeAs` catch block logs `debugAuth: { clientId, secretLen, secretPrefix, endpoint, method }` — **uncommitted**, strip it.

## 6. Files changed this session (all UNCOMMITTED unless noted)

| File | Change |
|---|---|
| `docker-compose.yml` | `OAUTH_PROVIDER: pingfederate` pin in demo-api-server `environment:` (labelled temporary) |
| `demo_api_server/services/pfStandardTokenExchangeService.js` | `sameScopes` → subset semantics |
| `demo_api_server/services/oauthService.js` | TEMP debug line in `performTokenExchangeAs` catch (remove) |
| `scripts/pingfederate/apply-login-theme.sh` | Added silent-logout injection (its sed has a broken `\0` backreference on Alpine — the manual one-liner that works is in §2.10) |
| `demo_api_server/.env` | `OAUTH_PROVIDER=pingfederate` (line 226) + `PF_ISSUER_URI=https://local.ping-devops.com:9031` (gitignored, local only) |
| **Other sessions' dirty files** (~300 step-verification JSONs, `middleware/auth.js`, `envReconcile.js`, `mcpToolPipeline.js`, tests, `docker-compose.yml` parts) | NOT ours — do not commit or revert them |

## 7. PF objects created this session (live in `ai-demo-pfederate-out-classic` volume; survive PF restarts, lost only if the volume is replaced)

- Clients: `ai-demo-pf-standard-actor`, `ai-demo-pf-standard-mcp-exchanger` (+ `tokenExchangeProcessorPolicyRef`), `ai-demo-pf-standard-agent-exchanger` (+ default ATM `aiDemoPfAgentGwJwtAtm`, `restrictToDefaultAccessTokenManager=true`)
- ATM: `aiDemoPfAgentGwJwtAtm` (aud `https://agentgateway.ping.demo`, JWKS publish off)
- TE policy: `aiDemoStandardTePolicy`
- ATM mappings: `urn:ietf:params:oauth:grant-type:token-exchange|aiDemoStandardTePolicy|aiDemoPfJwtAtm` and `...|aiDemoPfAgentGwJwtAtm`
- AS scopes added: `agent:invoke`, `read`, `write`, `transfer`, `admin:read`, `sensitive:read`
- Modified: `aiDemoPfJwtAtm` (issuer/audience), `aiDemoPfAccessSubjectProcessor` (issuer/JWKS/audiences)

## 8. Operational traps learned (do not rediscover these)

1. **`docker restart` does NOT reload `.env`** — must `docker compose up -d <svc>` to re-inject.
2. **PF client lockout** ("Client temporarily locked...") persists across restarts and even client delete+recreate is unreliable; it clears eventually or via restart + correct creds. Repeated failed attempts by the BFF re-lock the client immediately — fix the creds FIRST, then unlock.
3. **PF client cache**: after delete+recreate of a client, PF may keep serving the old record until restart.
4. **PF admin API**: v1 endpoints live at `https://localhost:9999/pf-admin-api/v1`; runtime is `:9031`. The OpenAPI spec is at `/pf-admin-api/v1/openapi.json` (linked from `/pf-admin-api/api-docs`). Grant-type enum uses PF's own constants (`TOKEN_EXCHANGE`, not the RFC URI); `clientAuth` has NO `tokenEndpointAuthMethod` field (PUT the secret only).
5. **PF container must be started separately** from the main stack: `cd scripts/pingfederate && PINGFEDERATE_PROFILE_PATH="$HOME/pingfederate-profile" PINGFEDERATE_ADMIN_PASSWORD=Reset-Temp-Pass-2026 docker compose -f docker-compose.local.yml up -d` (profile at `~/pingfederate-profile`, volume `ai-demo-pingfederate-out-classic`).
6. **Multiple concurrent agent sessions** actively redeploy the stack and rewrite `.env` — the compose `environment:` pin exists for this reason. Always re-verify the provider after any external deploy.
7. **Docker/OrbStack can hang** (all `docker` cmds time out) — restart OrbStack and re-verify containers.
8. **Multiple mappings under one TE policy** are ambiguous — PF picks one (not per-request); per-hop ATM selection is done via the CLIENT's `defaultAccessTokenManagerRef` + `restrictToDefaultAccessTokenManager`.

## 9. Quick verification playbook (once §4 is fixed)

```bash
# 1. config sanity
docker exec ai-demo-api-server sh -c 'echo $OAUTH_PROVIDER'
# 2. scripted full chain (the curl sequence in §3) — expect oauth=success + idJagRunIntent
# 3. run the tool
curl -sk -c /tmp/j -b /tmp/j -X POST https://local.ping-devops.com:4000/api/mcp/tool \
  -H "Origin: https://local.ping-devops.com:4000" -H "Content-Type: application/json" \
  -d '{"tool":"banking.get_balance","params":{},"vertical":"banking"}'
# expect 200 + tokenEvents with two-ex-exchange1 / two-ex-exchange2 / gateway hops
# 4. then the browser UC40 chip run — token chain should populate on /pingfederate-id-jag/demo
```

## 10. Next agent's TODO list

1. **Fix the `UnresolvableKeyException`** (§4) — likely JWKS self-fetch inside the PF container.
2. Re-run `/api/mcp/tool` → expect Exchange #1 + #2 to pass; fix Exchange #2 aud/act per §4 notes.
3. Remove the `debugAuth` line from `oauthService.js`; fix the theme script's broken sed; commit `pfStandardTokenExchangeService.js` (subset scopes) with a note referencing this file.
4. Re-verify the browser UC40 run end-to-end and confirm the token chain UI populates.
5. Confirm provider pin still holds (`environment:` in compose).
