# Gateway Feature Parity — Design Spec

**Date:** 2026-07-03
**Status:** Approved for implementation
**Branch:** `worktree-gateway-parity`

## Goal

Make the two MCP gateways **behaviorally identical** so either can be the MCP
enforcement point with no functional difference:

- **PingOne Agent Gateway** — the real Ping Identity Gateway (IG / PingGateway
  2026.3), container `ai-demo-ping-gateway` (:3036→8080), config in
  `ping-gateway/`. Selected when `ff_mcp_gateway_pinggateway=true` (default).
- **Demo Agent Gateway** — the homegrown Node gateway, container
  `ai-demo-mcp-gateway` (:3005), source in `demo_mcp_gateway/`. The reference
  implementation and the `false`-flag fallback.

Only these two gateway names exist. The manifest resource displayed as "Demo
Agent Gateway" (`agentgateway.ping.demo`, the RFC 8693 Exchange-#1 audience) is
a **separate, load-bearing** concept and is NOT renamed or removed here.

## Non-goals

- No new long-running service is introduced (see Allocation).
- Real PingOne Authorize policy authoring requires the `pingone` connector to be
  authorized; the mock (`demo_authz_server`) side is done regardless, and the
  real side is completed once the connector is available.
- `mcp-code-search` is not fronted by either gateway.

## Architecture — where each capability lives

Both gateways already call PingOne Authorize (P1AZ) on every request. Anything
that is a **decision** belongs in P1AZ policy, so both gateways inherit it for
free. Anything that is **cryptographic proof verification** or **stateful
counting** must happen at the gateway (the PEP).

### 🟦 P1AZ (decisions) — mock `demo_authz_server` (:9001) + real PingOne Authorize
- Per-tool `tools/list` filtering (send `CandidateTools` → receive `DeniedTools`)
- Anti-bypass `aud` invariant (deny if inbound token `aud` already targets a backend)
- act-claim / UC16 impersonation rules (require `act` for agent-mediated tools)
- RAR intent-subset (RFC 9396): pass granted `authorization_details` + actual tx
  args as attributes; policy asserts args ⊆ grant
- HITL trigger (INDETERMINATE) — already present
- **Cost:** author each rule twice (mock + real) to keep the Simulated-Authorize
  toggle at parity.

### 🟩 PingGateway / IG (PEP-side crypto, protocol, stateful) — native filters + thin Groovy
- Inbound introspection + JWKS/HS256 validation — present (JWKS-route validation
  gap fixed in SP-0)
- RFC 8693 token exchange to backends — present
- MCP protocol/schema validation — present (wired onto JWKS routes in SP-0)
- DPoP (RFC 9449) — IG **native** DPoP binding; Groovy fallback if the image lacks it
- Rate limiting → 429 — IG **native** `ThrottlingFilter`
- Web Bot Auth (RFC 9421) — thin Groovy script (no native filter; monitor/enforce)
- Extra backends (mortgage/apikey, dualtoken, bankingdata) — IG routes
- HITL challenge PEP mechanics — IG Groovy calling the existing HITL service

### 🟨 Reuse existing services — not new
- `demo_authz_server` (:9001) — P1AZ mock; extend its rules
- `hitl-service` (:3009) — challenge store/verify; both gateways call it
- `jwt-verifier-mcp-server` — code reference for the DPoP/JWKS Groovy (not wired)

**New service required: NONE** (confirmed by server inventory, see Appendix A).

## Roadmap — 6 sub-projects, dependency-ordered

Each sub-project is its own spec → plan → build → verify cycle.

| SP | Scope | Depends on |
|----|-------|-----------|
| **SP-0** | Stabilize IG core path + verify native DPoP/ThrottlingFilter | — |
| **SP-1** | Parity test harness (both gateways → identical outcomes) | SP-0 |
| **SP-2** | P1AZ policy parity (🟦 bucket) in mock + real | SP-0, SP-1 |
| **SP-3** | Extra backends via IG (🟩) | SP-0 |
| **SP-4** | Residual PEP checks in IG: DPoP, throttling, WBA, HITL wiring | SP-0, SP-2 |

## SP-0 — Stabilize IG core path (this change)

**Why first:** everything builds on a reliably-working IG, and SP-0 repairs two
real bugs already breaking / about to break the live path.

### Tasks
1. **Fix `03-oauth-passthrough` route.** `Chain.filters[0]` is declared
   `"type": "ClientHandler"`, but a Chain filter list requires `Filter` objects;
   `ClientHandler` is a `Handler`. IG throws `ClassCastException` at route load.
   Fix: the passthrough needs no custom filter — use an empty `filters: []` (or
   drop the Chain) so `/as/token` proxies straight through a `ClientHandler`.
2. **Fix `refresh-service-envs.js`** so the generated `ping-gateway/.env` always
   includes `PG_OLB_BACKEND_URL` and `PG_INVEST_BACKEND_URL` (and the mock/JWKS
   env below). Today they are only in `.env.example`; the live container has them
   only from an earlier boot, so the next `./run.sh` drops them and the invest
   `ReverseProxyHandler` `baseURI` resolves empty → invest proxying breaks.
3. **Wire mock-P1AZ + JWKS/HS256 env** into `.env.example` and the generator:
   `P1AZ_MOCK_BASE`, `AUTHZ_JWT_SECRET`, `PINGONE_JWKS_URI`. Without them,
   `X-Authz-Simulated: true` fails closed (403) and HS256 mock tokens fail closed
   (401), so the Simulated path is unusable through IG.
4. **Add MCP request validation to both JWKS routes.** `mcp-request-validation.groovy`
   is wired only onto the introspection routes (`01`/`02`); the JWKS routes
   (`00-*-jwks.json`) bypass JSON-RPC/tool-schema checks. Add the same
   `ScriptableFilter` step to both.
5. **Add a `/health` route.** No route matches a health path, so the container
   never reports healthy and logs spam `No handler to dispatch for .../health`.
   Add a `StaticResponseHandler` 200 route and a compose `healthcheck`.
6. **Verify native DPoP + ThrottlingFilter** availability in the
   `forgeops-public/images-base/ig:latest` image (informs SP-4). Record findings
   in this spec. Fallback if absent: Groovy DPoP verify + scriptable throttle.

### Acceptance criteria
- IG loads **all 5 routes** with no `ERROR ... building the route` in logs.
- `curl :3036/health` → **200**; container shows `(healthy)` in `docker ps`.
- `curl :3036/mcp/olb` (no token) → **401** (unchanged core-path enforcement).
- `curl :3036/mcp/invest` (no token) → **401** (invest route reachable; not a
  proxy-target error).
- A fresh `refresh-service-envs.js` run produces a `ping-gateway/.env` containing
  `PG_OLB_BACKEND_URL`, `PG_INVEST_BACKEND_URL`, `P1AZ_MOCK_BASE`,
  `AUTHZ_JWT_SECRET`, `PINGONE_JWKS_URI`.
- JWKS routes run `mcp-request-validation.groovy` (verified by a malformed
  JSON-RPC body → `-32700`/`-32601`).
- Native DPoP/ThrottlingFilter verdict recorded below.

### SP-0 outcome (done, verified 2026-07-03)

Verified by booting a throwaway IG container on the live network with the worktree
config (published :3037, real `.env`):

- **All 5 routes load, zero route-build errors.** The `oauth-passthrough`
  `ClassCastException` is gone because the route was **removed**, not repaired:
  it had never once loaded since the initial commit, nothing routes `/as/token`
  through the gateway, and the Node gateway exposes no such passthrough — so
  removing it *advances* parity. `04-health` registers as `health`.
- `curl :3037/health` → **200** `{"status":"ok","gateway":"ping-gateway"}`.
- `curl :3037/mcp/olb` and `:3037/mcp/invest` (no token) → **401** (enforcement
  intact); `/as/token` → **404** (clean, not 500).
- Compose `healthcheck` uses `bash` + `/dev/tcp` (the image has no curl/wget/nc)
  and **requires a `Host` header** — IG returns 400 to a Host-less HTTP/1.0
  request. Probe verified `HEALTHCHECK: pass` in-container.
- `refresh-service-envs.js` now emits the full `PG_*` / `TE_*` / `P1AZ_*` /
  `PINGONE_JWKS_URI` / `AUTHZ_JWT_SECRET` key set for `ping-gateway/.env`, and the
  same `AUTHZ_JWT_SECRET` into `demo_authz_server/.env` (shared HS256 secret).
  **Severity correction:** the main `docker-compose.yml` already pins
  `PG_OLB_BACKEND_URL` / `PG_INVEST_BACKEND_URL` / `P1AZ_MOCK_BASE` in the service
  `environment:` block (wins over env_file), so the running stack was not at risk
  of the invest-proxy break on restart — but the standalone compose and all the
  non-pinned keys (scopes, resource URIs, `TE_*`, `P1AZ_REAL_BASE`,
  `AUTHZ_JWT_SECRET`, `PINGONE_JWKS_URI`) were, and are now generated.

**Deferred to SP-1 (need a valid mock token to exercise):** runtime proof that
the JWKS routes now run `mcp-request-validation.groovy` (config change is in
place); a full `refresh-service-envs.js` run (needs PingOne connector auth).

## SP-1 — Parity test harness (done)

`scripts/gateway-parity-harness.js` replays identical requests through BOTH
gateways (`GW_NODE_URL` :3005, `GW_IG_URL` :3036) and asserts identical
HTTP-observable outcomes on `status`, `WWW-Authenticate` presence, and JSON-RPC
error code. Complements the unit-level decision-payload parity gates
(`decision.pinggateway-parity.test.js`, `authorize.parity.test.js`).

- **Tier A (token-free, always runs):** `/health`→200 both; unauthenticated
  `/mcp`→401 *with* `WWW-Authenticate` both. **Verified PASS** (Node :3005 vs the
  SP-0 IG on :3037).
- **Tier B (authenticated):** tools/list, malformed JSON-RPC, unknown-method
  parity. Gated behind `GW_TEST_BEARER` — the gateways are asymmetric on mock
  HS256 (Node rejects inbound HS256, IG JWKS accepts it), so a **real delegated
  RS256 token** is required to drive both; skipped (not failed) when absent.
- Harness proven to **detect** divergence, not just green-wash: run against the
  un-updated live IG (:3036, pre-SP-0) it correctly FAILs `/health` (node=200
  ig=404) and exits 1.

**Follow-up:** wire Tier B into a run that acquires a real delegated token via the
BFF exchange (needs a logged-in session / live PingOne) — natural companion to
landing SP-0 live.

## SP-2 — P1AZ policy parity (mock side done; IG-input + real deferred)

Delta mapping (Node gateway vs mock `demo_authz_server` vs IG `p1az-decision.groovy`)
found the mock **already implements** per-tool `tools/list` filtering
(`DeniedTools`/`AllowedVertical`), act/UC16 (Rule 2.5 + A2A chain), and RAR
intent-subset (Rule 3c). The single true mock-side logic gap was **D-05**.

**Done (mock side):**
- `scopeTopology.upstreamAudiences()` — the D-05 backend/RS blacklist sourced
  from the SoT manifest + `BANKING_RESOURCE_SERVER_RESOURCE_URI`, gateway URI
  excluded (mirrors Node `GatewayTokenPolicy` upstreamAuds).
- `decision.js` **Rule 0b-2**: DENY `bypass_attempt` when `TokenAudActual`
  targets an upstream — even a multi-aud `[gateway, backend]` token that passes
  the "aud includes gateway" check. Legacy callers without `TokenAudActual`
  unaffected.
- `decision.d05-bypass.test.js` — 5 cases, all PASS (gateway-only PERMIT;
  `[gw,OLB]` space form, `[gw,invest]` JSON form, `[gw,bankingRS]` all DENY;
  missing-aud legacy PERMIT). Existing `decision.pinggateway-parity.test.js`
  still green (no regression).

**Remaining SP-2 (IG PEP-input side — needs a live authenticated run to verify):**
- `p1az-decision.groovy` must **send `CandidateTools`** on the `McpToolsList`
  path and **consume `DeniedTools`/`AllowedVertical`** advice to rewrite the
  tools/list response `_meta.deniedTools` — otherwise per-tool greying never
  happens through IG (the mock already returns the advice).
- Send `RarAuthorizationDetails` (from the TraT/`azd` envelope) so mock Rule 3c
  enforces RAR subset on the IG path.
- Send `NestedActClientId` so the mock's A2A generalist-identity sub-check is
  reachable through IG.

**Real PingOne Authorize:** blocked on `pingone` connector auth (interactive
session) / console access. The mock rules (now incl. D-05) are the translation
source; `X-Authz-Simulated: false` + a real token via the harness is the gate.

## Appendix A — Server inventory (parity relevance)

| Server | Container : port | Parity role |
|--------|------------------|-------------|
| PingOne Agent Gateway | `ai-demo-ping-gateway` :3036 | parity target (IG) |
| Demo Agent Gateway | `ai-demo-mcp-gateway` :3005 | reference (Node) |
| Authz server (P1AZ mock) | `ai-demo-authz-server` :9001 | 🟦 decisions — reuse |
| HITL service | `ai-demo-hitl-service` :3009 | 🟩 HITL — reuse |
| MCP OLB backend | `ai-demo-mcp-server` :8080 | backend (fronted) |
| MCP invest backend | `ai-demo-mcp-resource-server` :8081 | backend (fronted) |
| Mortgage (apikey) | `ai-demo-api-resource-server` :8082 | backend — SP-3 |
| mcp-code-search | `ai-demo-mcp-code-search` :8095 | out of scope |
| BFF / token custodian | `ai-demo-api-server` :3001 | client |
| mcp-proxy | `ai-demo-mcp-proxy` :8895 | HTTP↔MCP transport |
| agents | langchain/openai/mastra/pydantic/agent-service | clients |
| llm-proxy, weaviate, embeddings, ui | — | infra |
| `jwt-verifier-mcp-server` | not wired | DPoP/JWKS code reference |
| `agent_token_service`, `compliance_agent`, `dev_mcp` | not wired | not relevant |

## Appendix B — Native-filter verification (SP-0 task 6, done)

Scanned `forgeops-public/images-base/ig:latest` = PingGateway **2026.3.0**
(`/opt/gateway/lib/*.jar` via `jar tf`).

- **ThrottlingFilter:** ✅ **NATIVE.** `org.forgerock.openig.filter.throttling.*`
  in `openig-core-2026.3.0.jar` — includes `ThrottlingFilterHeaplet`,
  `MappedThrottlingPolicyHeaplet`, `ScriptableThrottlingPolicy`. Per-agent /
  per-tool keying is achievable via a mapped or scriptable throttling policy.
  → **SP-4 rate-limiting = native config, no code.**
- **DPoP:** ❌ **NO native DPoP class** in any bundled jar (searched
  `dpop|proofofpossession|senderconstrain` across all libs — zero hits).
  → **SP-4 DPoP = Groovy script** (verify the DPoP proof JWT + `cnf.jkt`
  binding), using `jwt-verifier-mcp-server` / `demo_mcp_gateway/src/dpopVerify.ts`
  as the reference. Not a config toggle. Effort for SP-4 revised up accordingly.
