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

## Appendix A — Server inventory (parity relevance)

| Server | Container : port | Parity role |
|--------|------------------|-------------|
| PingOne Agent Gateway | `ai-demo-ping-gateway` :3036 | parity target (IG) |
| Demo Agent Gateway | `ai-demo-mcp-gateway` :3005 | reference (Node) |
| Authz server (P1AZ mock) | `ai-demo-authz-server` :9001 | 🟦 decisions — reuse |
| HITL service | `ai-demo-hitl-service` :3009 | 🟩 HITL — reuse |
| MCP OLB backend | `ai-demo-mcp-server` :8080 | backend (fronted) |
| MCP invest backend | `ai-demo-mcp-invest` :8081 | backend (fronted) |
| Mortgage (apikey) | `ai-demo-mortgage-service` :8082 | backend — SP-3 |
| mcp-code-search | `ai-demo-mcp-code-search` :8095 | out of scope |
| BFF / token custodian | `ai-demo-api-server` :3001 | client |
| mcp-proxy | `ai-demo-mcp-proxy` :8895 | HTTP↔MCP transport |
| agents | langchain/openai/mastra/pydantic/agent-service | clients |
| llm-proxy, weaviate, embeddings, ui | — | infra |
| `jwt-verifier-mcp-server` | not wired | DPoP/JWKS code reference |
| `agent_token_service`, `compliance_agent`, `dev_mcp` | not wired | not relevant |

## Appendix B — Native-filter verification (filled during SP-0)

- **DPoP:** _TBD — recorded during SP-0 task 6._
- **ThrottlingFilter:** _TBD — recorded during SP-0 task 6._
