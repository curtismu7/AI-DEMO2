# SPIFFE / SPIRE — Implementation Plan (Super Banking demo)

This document defines the integration strategy for **SPIFFE** (Secure Production Identity
Framework For Everyone) in Super Banking. It follows the same structure as
`PINGONE_AUTHORIZE_PLAN.md` and should be updated as work progresses.

---

## What SPIFFE provides

SPIFFE is a CNCF standard for **cryptographic workload identity**.  Instead of secrets
(API keys, client_secrets) passed between services, each workload is issued a
**SVID** (SPIFFE Verifiable Identity Document) — either an **X.509 certificate** or a
**JWT** — from a trusted authority (SPIRE or any compliant issuer).

| Concept | Description |
|---------|-------------|
| **Trust Domain** | Namespace for identities, e.g. `spiffe://bxfinance.demo` |
| **SPIFFE ID** | URI uniquely identifying one workload, e.g. `spiffe://bxfinance.demo/bff` |
| **X.509-SVID** | Short-lived TLS certificate — used for mTLS between workloads |
| **JWT-SVID** | Short-lived signed JWT — used as a bearer / actor token |
| **SPIRE** | Reference implementation: SPIRE Server + SPIRE Agent (sidecar) issue SVIDs |
| **Workload API** | gRPC endpoint (Unix socket) each workload calls to fetch its own SVID |
| **Trust Bundle** | CA root(s) distributed to all workloads; used to verify peer SVIDs |

---

## Why it matters for this demo

Super Banking already demonstrates **RFC 8693 Token Exchange** with an `actor_token` (client
credentials) to prove *which service* is acting on the user's behalf.  The `act` claim
carries `client_id` — a PingOne secret.

SPIFFE makes the actor identity **cryptographically provable and secret-free**:

```
Current:   actor_token = PingOne client_credentials JWT  (secret-based)
With SPIFFE: actor_token = SPIFFE JWT-SVID               (cert-based, no secret)
```

It also directly maps to the **"Know Your Agents"** best practice — the AI agent workload has
a SPIFFE ID as its unforgeable machine identity, independent of OAuth client registration.

---

## Workload identity map

| Workload | SPIFFE ID | Current auth mechanism |
|----------|-----------|------------------------|
| BFF (`banking_api_server`) | `spiffe://bxfinance.demo/bff` | `PINGONE_CORE_CLIENT_SECRET` |
| MCP Server (`banking_mcp_server`) | `spiffe://bxfinance.demo/mcp-server` | Bearer token in WS header |
| AI Agent (embedded in BFF) | `spiffe://bxfinance.demo/agent` | `AGENT_OAUTH_CLIENT_SECRET` |
| PingGateway sidecar | `spiffe://bxfinance.demo/gateway` | mTLS cert (manual) |

---

## Integration points

### 1. JWT-SVID as RFC 8693 `actor_token` *(highest value, Phase 2)*

Replace `AGENT_OAUTH_CLIENT_SECRET` with a SPIFFE JWT-SVID in the token exchange request:

```
POST {issuer}/as/token
  grant_type = urn:ietf:params:oauth:grant-type:token-exchange
  subject_token = <user access token>
  actor_token = <BFF JWT-SVID>               ← replaces client_credentials JWT
  actor_token_type = urn:ietf:params:oauth:token-type:jwt
  audience = <mcp_resource_uri>
```

PingOne must be configured to trust the SPIRE trust bundle as an **external JWT token
source**.  The resulting MCP token carries `act: { sub: "spiffe://bxfinance.demo/bff" }`
— a cryptographically verifiable actor identity rather than a guessable `client_id`.

**Files affected:** `agentMcpTokenService.js`, `oauthService.js`, `configStore.js`

---

### 2. mTLS — BFF → MCP WebSocket *(Phase 3)*

Currently the BFF opens a WebSocket to `banking_mcp_server` and authenticates with a
bearer `agentToken`.  With SPIFFE X.509-SVIDs:

```
BFF (X.509-SVID cert)  ──mTLS──▶  MCP Server (validates SPIFFE trust bundle)
  spiffe://bxfinance.demo/bff       spiffe://bxfinance.demo/mcp-server
```

- BFF presents its X.509-SVID for the TLS handshake (no separate bearer token).
- MCP Server validates the BFF's cert against the SPIRE trust bundle — not a static
  CA cert — so rotation is automatic.
- MCP Server can inspect the SPIFFE ID and enforce that only
  `spiffe://bxfinance.demo/bff` is permitted to call tool endpoints.

**Files affected:** `mcpWebSocketClient.js`, `banking_mcp_server/src/server.ts`

---

### 3. Agent workload identity ("Know Your Agents") *(Phase 2)*

The AI Agent sub-workload (either embedded in the BFF or running as a separate process)
gets its own SVID: `spiffe://bxfinance.demo/agent`.

- Every tool call carries the agent's JWT-SVID as the `act` identity.
- SPIRE can revoke the agent SVID independently of the BFF SVID — clean lifecycle
  management matching the **"Manage agent lifecycles"** best practice.
- The Token Chain UI shows the SVID subject in the `act` claim (stronger than `client_id`).

---

### 4. PingGateway SPIFFE bridging *(Phase 4)*

PingGateway can act as a SPIFFE-aware proxy:

```
Workload (SVID) ──▶ PingGateway ──▶ PingOne (exchange SVID for OAuth token)
```

This bridges SPIFFE workload identity into PingOne's OAuth ecosystem — workloads
authenticate via SPIFFE and receive PingOne access tokens without managing secrets.

Relevant PingGateway filters:  
- `JwtBuilderFilter` — construct a signed assertion from the SVID claims  
- `OAuth2ClientCredentialsGrant` / `TokenExchangeFilter` — exchange the assertion for a
  PingOne token

**References:** `docs/pinggateway-agent-plan.md`, PingGateway SPIFFE integration guide

---

## Education panel integration

| Panel | Addition |
|-------|----------|
| `BestPracticesPanel.js` — "Know Your Agents" tab | Add SPIFFE workload identity as the cryptographic form of agent classification; SVID vs client_id comparison |
| `BestPracticesPanel.js` — "Detect Agents" tab | JWT-SVID `sub` in MCP token identifies the agent workload (not just client_id) |
| `BestPracticesPanel.js` — "Use Delegation" tab | JWT-SVID as `actor_token` in RFC 8693 — secret-free delegation proof |
| `SpiffePanel.js` *(new)* | Dedicated education drawer: trust domain, SVID lifecycle, SPIRE architecture, comparison with OAuth client_credentials |
| Token Chain display | Show SPIFFE ID from `act.sub` when it matches `spiffe://` URI pattern |

---

## Phased implementation plan

### Phase 1 — Documentation + education (no code change to auth flows)

- [x] Write this plan document (`docs/SPIFFE_PLAN.md`)
- [ ] Update `BestPracticesPanel.js` — add SPIFFE references to "Know Your Agents" and
  "Use Delegation" tabs
- [ ] Create `SpiffePanel.js` education drawer (concepts, SVID lifecycle, workload map)
- [ ] Register `SPIFFE` in `educationIds.js` and `EducationPanelsHost.js`
- [ ] Token Chain: detect `spiffe://` URI in `act.sub` and highlight it visually

**Deliverable:** visitors understand SPIFFE from the education panels; no runtime dependency.

---

### Phase 2 — JWT-SVID as RFC 8693 actor_token

**Goal:** replace `AGENT_OAUTH_CLIENT_SECRET` with a SPIFFE JWT-SVID for the token exchange.

#### Server changes

1. **`services/spiffeWorkloadClient.js`** — new service  
   - Connect to SPIRE Agent Workload API (`unix:///tmp/spire-agent/public/api.sock`)  
   - Expose `getJwtSvid(audience)` → returns a signed JWT-SVID for the given audience  
   - Expose `getX509Svid()` → returns PEM cert + key for mTLS (Phase 3)  
   - Use `@spiffe/spiffe-workload-api` npm package

2. **`services/agentMcpTokenService.js`**  
   - When `SPIFFE_WORKLOAD_API_ADDR` is set: call `spiffeWorkloadClient.getJwtSvid(mcp_resource_uri)` instead of `getAgentClientCredentialsToken()`  
   - Pass the JWT-SVID as `actor_token` with `actor_token_type = urn:ietf:params:oauth:token-type:jwt`  
   - Add `spiffe-jwt-svid` token event to the Token Chain display

3. **`services/configStore.js`**  
   - Add `spiffe_workload_api_addr` config key  
   - Env alias: `SPIFFE_WORKLOAD_API_ADDR`

4. **`components/Config.js`**  
   - Add "SPIFFE Workload API Address" text field (alongside the MCP section)

#### PingOne configuration required

1. **Create a JWT Issuer** in PingOne → Security → JWT Issuers  
   - Issuer URI: SPIRE Server's JWKS endpoint (or inline trust bundle)  
   - This tells PingOne to trust JWT-SVIDs signed by SPIRE as `actor_token`

2. **Enable Token Exchange** grant on the BFF app  
   - Add `actor_token_type = urn:ietf:params:oauth:token-type:jwt` to allowed actor token types

**Deliverable:** token exchange works without `AGENT_OAUTH_CLIENT_SECRET`; act claim shows
`spiffe://bxfinance.demo/bff` instead of `client_id`.

---

### Phase 3 — mTLS BFF → MCP server

**Goal:** authenticate the BFF → MCP WebSocket connection with X.509-SVIDs.

1. **`services/mcpWebSocketClient.js`**  
   - Load X.509-SVID from `spiffeWorkloadClient.getX509Svid()`  
   - Pass `cert` + `key` + SPIRE CA `bundle` to the `ws` TLS options  
   - Remove bearer `agentToken` from the WebSocket handshake header (SVID replaces it)

2. **`banking_mcp_server/src/server.ts`**  
   - Enable `requestCert: true` on the HTTPS/WSS server  
   - Validate peer certificate SPIFFE ID matches `spiffe://bxfinance.demo/bff`  
   - Reject connections from unknown SPIFFE IDs

3. **Local dev:** run a lightweight SPIRE dev stack via `docker-compose` alongside the
   existing services.

**Deliverable:** BFF ↔ MCP connection is mutually authenticated; no bearer tokens on
the WebSocket.

---

### Phase 4 — PingGateway SPIFFE bridging

**Goal:** workloads authenticate to PingGateway using their SVID; PingGateway issues
PingOne tokens — zero secrets in workload environment variables.

- PingGateway `JwtBuilderFilter` constructs a signed assertion from the SVID
- `OAuth2ClientCredentialsGrantFilter` or `TokenExchangeFilter` exchanges it for a
  PingOne access token
- BFF drops `PINGONE_CORE_CLIENT_SECRET` from its environment

**Dependencies:** Phase 2 + PingGateway 2024.x deployment (see `docs/pinggateway-agent-plan.md`)

---

## Environment variables (new)

| Variable | Purpose | Example |
|----------|---------|---------|
| `SPIFFE_WORKLOAD_API_ADDR` | SPIRE Agent socket path or address | `unix:///tmp/spire-agent/public/api.sock` |
| `SPIFFE_TRUST_DOMAIN` | Trust domain for SVID validation | `bxfinance.demo` |
| `SPIFFE_AUDIENCE` | JWT-SVID audience (= `mcp_resource_uri`) | `https://mcp.bxfinance.com` |

---

## npm dependency

```bash
# Phase 2+
cd banking_api_server && npm install @spiffe/spiffe-workload-api
```

Package: [`@spiffe/spiffe-workload-api`](https://www.npmjs.com/package/@spiffe/spiffe-workload-api)  
Implements the SPIFFE Workload Endpoint spec; works with SPIRE and other compliant agents.

---

## Local development setup (SPIRE)

```yaml
# docker-compose.dev.yml addition (Phase 2)
spire-server:
  image: ghcr.io/spiffe/spire-server:1.9
  volumes:
    - ./spire/server.conf:/etc/spire/server/server.conf
  ports:
    - "8081:8081"

spire-agent:
  image: ghcr.io/spiffe/spire-agent:1.9
  volumes:
    - /tmp/spire-agent:/tmp/spire-agent
    - ./spire/agent.conf:/etc/spire/agent/agent.conf
  depends_on: [spire-server]
```

SVID registration entries:
```bash
# Register BFF workload
spire-server entry create \
  -spiffeID spiffe://bxfinance.demo/bff \
  -parentID spiffe://bxfinance.demo/host \
  -selector unix:uid:$(id -u node)

# Register MCP server
spire-server entry create \
  -spiffeID spiffe://bxfinance.demo/mcp-server \
  -parentID spiffe://bxfinance.demo/host \
  -selector unix:uid:$(id -u node)
```

---

## Decision log

| Decision | Rationale |
|----------|-----------|
| JWT-SVID before X.509-SVID | Easier to integrate with PingOne token exchange (existing JWT Bearer flow); no TLS plumbing changes needed for Phase 2 |
| `@spiffe/spiffe-workload-api` | Official CNCF package; maintained by SPIFFE project; small footprint |
| Keep `AGENT_OAUTH_CLIENT_SECRET` as fallback | Graceful degradation — if `SPIFFE_WORKLOAD_API_ADDR` is unset, existing client_credentials flow continues unchanged |
| Education before code | Phase 1 delivers immediate demo value (education panels) with zero runtime risk |

---

## References

- [SPIFFE spec](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE.md)
- [SPIRE project](https://spiffe.io/docs/latest/spire-about/)
- [SPIFFE JWT-SVID spec](https://github.com/spiffe/spiffe/blob/main/standards/JWT-SVID.md)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) — §2.1 actor_token
- Internal: `banking_api_server/services/agentMcpTokenService.js`, `docs/PINGONE_AUTHORIZE_PLAN.md`, `docs/pinggateway-agent-plan.md`
