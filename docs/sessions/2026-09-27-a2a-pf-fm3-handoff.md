# Handoff — A2A-under-PingFederate: FM3 live fix, 2026-09-26/27

> **Snapshot status (recovered 2026-09-30):** point-in-time notes from 2026-09-27. Whether the section 4 fix was applied in the live PingFederate is unverified; check the ATM audience before relying on it. Live PF config is not tracked in the repo.

> For the next agent. Read this before touching the PF profile or the A2A chain.
> Everything in section 2 is DONE and live; section 4 is the ONE remaining step.

---

## 0. TL;DR

- **FM1 + FM2 pass live. FM3 (happy path) fails at the very last step** — a
  BFF-side audience check on the final MCP token.
- The **entire PF-side A2A config** (lost with the 2026-09-26 profile rebuild)
  has been **rebuilt and verified working hop-by-hop** (Exchange #1 id-jag with
  `act`+`a2a_tenant_id`, wire bearer gate PASS, Exchange #2 nested-act token
  minted, gateway JWKS validation PASS, gateway P1AZ PERMIT).
- **One remaining fix**: the final token's `aud` is
  `https://agentgateway.ping.demo` but the BFF requires
  `https://api.ping.demo:3036/mcp` (PingGateway routing). See section 4.

## 1. Context

- PR #334 (merged) fixed the BFF PF-mode routing (agent1 actor CC + Exchange #1
  exchanger now use the PF clients instead of PingOne UUIDs).
- The PingFederate profile was rebuilt on 2026-09-26 from the
  `ai-demo-pingfederate-out-classic` volume and lost the 2026-09-22 A2A runtime
  config (SP connections, specialist clients, scopes, ATM wiring).
- `docker-compose.yml` still pins `OAUTH_PROVIDER: pingfederate` (UC40 window);
  `.demo-provider-intent.json` says `pingone`. The A2A chain here runs UNDER
  the PF pin — that is the point of this work.

## 2. What was rebuilt in PF (all verified live)

Admin API: `https://local.ping-devops.com:9999/pf-admin-api/v1`, basic auth
`administrator:$PING_IDENTITY_PASSWORD` (read from the container env), header
`X-XSRF-Header: x` on every call. Admin sessions expire fast and the admin
account LOCKS OUT after repeated failures — wait ~2 min on 401s.

### 2.1 SP connections (12) — script: `scripts/pingfederate/provision-a2a-sp-connections.sh`
- ids `aiDemoA2a{Investment,Records,Purchase,Membership,Payroll,Tax,Finaid,Supplier,Holdings,Passenger,Identity,Gateway}Sp`
- `resourceUris: ["https://<aud>.ping.demo"]` (gateway: `https://mcpgateway-a2a.ping.demo`)
- `idJagEnabled: true`, signing keypair `aidemopf-idjag-signing`
- attribute contract: core `TOKEN_SUBJECT`; extended `client_id`, `scope`,
  `act`, `a2a_tenant_id`
- processor policy: `aiDemoStandardTePolicy` (subject=access_token + required
  actor=access_token); mappings fulfill:
  - `scope` from policy scope (policy scope from `CONTEXT/OAuthScopes` — passes
    the requested scope through)
  - `TOKEN_SUBJECT` from policy `subject`
  - `client_id` from policy `client_id`
  - `act` from **TEXT** `{"sub":"0b412e8b-cfbc-4c7d-a773-0d46118de09d"}` (the
    generalist client id; PF parses the TEXT value as a JSON object claim —
    this is how the id-jag gets its act claim)
  - `a2a_tenant_id` from TEXT `<PINGONE_ENVIRONMENT_ID>`

### 2.2 Specialist PF clients (11) — script: `scripts/pingfederate/provision-a2a-specialist-pf-clients.sh`
- clientId = the PingOne UUIDs from `demo_api_server/.env`
  (`PINGONE_A2A_<V>_AGENT_CLIENT_ID`), secret = the matching `_SECRET`
- grants `CLIENT_CREDENTIALS` + `TOKEN_EXCHANGE`
- **`tokenExchangeProcessorPolicyRef: aiDemoStandardTePolicy`** — REQUIRED;
  without it PF returns "Token Exchange Processor Policy mapping not found"
- `defaultAccessTokenManagerRef: aiDemoPfAgentGwJwtAtm`, `restrictToDefaultATM: true`

### 2.3 Scopes (23 added to common scopes)
- `agent:invoke:{finaid,holdings,identity,investment,membership,passenger,payroll,purchase,records,supplier,tax}`
- tool scopes: `invest:read records:read purchase:read membership:read payroll:read tax:read finaid:read supplier:read holdings:read pnr:read identity:read`
- `gateway:mcp:invoke`

### 2.4 TE processor policy `aiDemoStandardTePolicy`
- scope fulfillment: `CONTEXT/OAuthScopes` (was a hardcoded TEXT list — that
  made every id-jag carry the wrong scope and fail the wire gate)
- **second processorMapping** added: `subjectTokenType=id-jag`,
  `actorTokenType=access_token`, so Exchange #2 (id-jag subject) finds a mapping

### 2.5 JWT processor `aiDemoPfAccessSubjectProcessor`
- Allowed Audiences extended to 32 entries: scheme-less AND
  `https://`-prefixed a2a intermediates, `mcpgateway-a2a.ping.demo`,
  `agentgateway.ping.demo`, `https://agentgateway.ping.demo`,
  `mcpserver.ping.demo`, `https://api.ping.demo:3036/mcp`
  (the id-jag's aud is `https://a2a-intermediate-*.ping.demo` WITH scheme —
  the rebuild lost the https forms; without them PF says "Invalid Token")

### 2.6 Access token mappings / ATMs
- `aiDemoPfJwtAtm` (user tokens): added `sub` extended attribute; the
  `authz_req|aiDemoPfHtmlForm|aiDemoPfJwtAtm` mapping now fulfills
  `sub` from ADAPTER `username` (PF user tokens had NO sub, so the bearer gate
  failed with "no subject (sub) on the delegated token")
- `aiDemoPfAgentGwJwtAtm`: **Audience Claim Value =
  `https://api.ping.demo:3036/mcp`** (matches the gateway's required audience)
- TE mapping
  `urn:...:token-exchange|aiDemoStandardTePolicy|aiDemoPfAgentGwJwtAtm`:
  `scope` from `CONTEXT/OAuthScopes` (was hardcoded TEXT, so the final token
  lacked `pnr:read`)

### 2.7 ping-gateway env (host file `ping-gateway/.env`, gitignored)
- `PF_ISSUER_URI=https://local.ping-devops.com:9031`
- `PF_JWKS_URI=https://local.ping-devops.com:9031/pf/JWKS`
- WITHOUT these, `jwks-token-validation.groovy` validates every token against
  PingOne's JWKS only, so PF tokens fail `no_matching_jwk`. After adding them
  the gateway log shows
  `[JWKS] validation ok: alg=RS256 ... aud=https://api.ping.demo:3036/mcp`.

## 3. Verified working (live, hop by hop)

1. Specialist CC mint to actor token (aud=intermediate, scope=agent:invoke:<v>) — OK
2. Exchange #1 to id-jag with `sub`, `act={sub:generalist}`, `a2a_tenant_id`,
   aud=intermediate — OK
3. Wire bearer gate (a2aPingOneBearer) PASS — OK
4. Exchange #2 (id-jag subject + agent2 actor) returns 200, final token minted — OK
5. ping-gateway JWKS validation of the PF final token PASS — OK
6. Gateway P1AZ PERMIT for sensitive_passenger_record — OK
7. FM1/FM2 green in every run — OK

## 4. THE ONE REMAINING FIX

**Symptom:** FM3 fails with `Wrong audience: the access token's aud is
[https://agentgateway.ping.demo] but the gateway requires
"https://api.ping.demo:3036/mcp"` — thrown by the BFF (`mcpToolPipeline`,
audience check against `mcpToolAuthorizationService.resolveExpectedMcpResourceUri()`).

**Meaning:** the final token that reached the tool call still carries the OLD
AgentGw ATM audience. The AgentGw ATM's `Audience Claim Value` is already set
to `https://api.ping.demo:3036/mcp` — so either:
1. PF cached the ATM config (restart the PF container or wait out its cache), or
2. the token was minted by a DIFFERENT ATM (PF picks the ATM via the
   resource/audience association of the resource `mcpgateway-a2a.ping.demo` —
   check which ATM that resource points to in PF admin; it may still be an ATM
   whose audience is `agentgateway`), or
3. my mistaken edit was only half-reverted (see caution below).

**CAUTION — a wrong edit was made and reverted:** `aiDemoPfJwtAtm`'s Audience
Claim Value was briefly set to `https://api.ping.demo:3036/mcp` and then
**reverted to `enduser.ping.demo`** (verified 200). Double-check it is
`enduser.ping.demo` before debugging — if it is not, user login tokens break.

**Fix recipe:**

```bash
# 1. verify the revert
PW=$(docker inspect ai-demo-pingfederate --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PING_IDENTITY_PASSWORD | cut -d= -f2-)
curl -sk -u "administrator:$PW" -H "X-XSRF-Header: x" \
  https://local.ping-devops.com:9999/pf-admin-api/v1/oauth/accessTokenManagers/aiDemoPfJwtAtm \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print([f['value'] for f in d['configuration']['fields'] if f['name']=='Audience Claim Value'])"
# must print ['enduser.ping.demo']

# 2. find which ATM the a2a-gateway resource/audience resolves to, and either
#    repoint it to aiDemoPfAgentGwJwtAtm (aud=api.ping.demo:3036/mcp) or set
#    that ATM's Audience Claim Value to https://api.ping.demo:3036/mcp

# 3. rerun FM3
cd demo_api_ui && CI=true PLAYWRIGHT_SKIP_WEBSERVER=1 \
  npx playwright test tests/e2e/a2a-failure-modes.real.spec.js \
  --config=playwright.real.config.js --grep "FM3"
```

## 5. Debugging cheatsheet

- BFF errors: `nohup script -q /tmp/bff.log docker logs --tail 6000 ai-demo-api-server > /dev/null 2>&1`
  then grep /tmp/bff.log. (Plain `docker logs` HANGS on this host — always use
  `script -q <file>` plus grep, or `docker exec` into ping-gateway /
  pingfederate, whose logs are on-disk files.)
- Gateway audit: `docker logs --tail 1500 ai-demo-mcp-gateway` then look at
  `gw_audit_trail` — check `authorize.decision` and `filterChain`.
- PF token-endpoint failures:
  `docker exec ai-demo-pingfederate grep -B3 "transaction failed" /opt/out/instance/log/server.log`
  - "Policy mapping not found" = missing client `tokenExchangeProcessorPolicyRef`
    or a missing subject/actor token-type mapping
  - "Invalid Token" = JWT processor allowed-audiences missing the exact aud string
- Manual two-hop replay (fastest way to test PF config without a browser):
  mint a CC actor token for the specialist, then TE it
  (subject=actor, actor=actor) requesting
  `urn:ietf:params:oauth:token-type:id-jag` at
  `audience=https://a2a-intermediate-passenger.ping.demo`; then a second TE
  (subject=id-jag, subject_token_type=id-jag, actor=CC) at
  `audience=https://mcpgateway-a2a.ping.demo` requesting access_token with
  `scope=pnr:read gateway:mcp:invoke`. Both must return 200.
- The admin account LOCKS OUT on repeated bad auth — wait ~2 min after 401s.

## 6. Also done this session

- PR #334 merged (BFF PF-mode routing + hygiene fix). Main synced.
- Local stack redeployed (OrbStack wedged once and was restarted — never
  Docker Desktop, per policy).
- Playwright artifacts cleaned (`test-results/`, `playwright-report/`).
- `/academy/identity` double-menu: NOT reproducible (single topnav at all
  widths) — closed.
- Previous handoff doc: `HANDOFF-A2A-PF-SESSION-2026-09-26.md` (background;
  sections 3-4 of that doc are superseded by this file).
