# Transaction Tokens (TraT) + mTLS Gateway Enforcement

**Date:** 2026-05-20
**Status:** Approved (revised — architecture update)
**Spec ref:** [draft-oauth-transaction-tokens-for-agents-00](https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/00/)

---

## 1. Problem Statement

The MCP Gateway forwards a delegated bearer token to the MCP server over WebSocket. That token is bound to a user identity and a resource audience, but carries no context about the specific transaction: which tool was called, in which session, for what purpose, by which agent. A token captured from the gateway→server leg could be replayed outside its originating transaction.

Additionally, the TX token's audience (`ping.demo`) is intentionally broad — it covers the gateway and both downstream MCP servers. Nothing in the token itself prevents a client from bypassing the gateway (and its PingAuthorize check) and calling an MCP server directly.

IETF Transaction Tokens (TraT) solve the context-binding problem. mTLS between the gateway and each MCP server solves the bypass problem. Together they form a coherent security story: TraT for policy context at the gateway, mTLS for caller attestation at the MCP server.

---

## 2. Goals

- Cryptographically bind MCP tool calls to their originating transaction context (tool name, session, correlation id, purpose, delegation chain)
- Use PingOne Authorize to enforce TraT claims at the gateway — the sole enforcement point for all MCP tool calls
- Prevent clients from bypassing the gateway and calling MCP servers directly, using mTLS client certificates (self-signed, dev-only)
- Keep the current RFC 8693 flow as the default; gate TraT behaviour behind `ff_trat_mode`
- Simulate TraT until PingOne natively supports the draft — with an honest `trat_sim` marker in the UI
- Provision the PingOne token policy claims automatically during bootstrap (always, idempotent)
- Add a dedicated education panel explaining the draft, the mTLS enforcement model, and the upgrade path

---

## 3. Approach

**Single TX token, gateway as sole enforcement point, mTLS for bypass prevention.**

The BFF performs one RFC 8693 exchange (user subject token + agent actor token) and receives a TX token with `aud: ping.demo`. This token is broad-scoped: it is valid at the gateway and at both downstream MCP servers (`mcp-olb`, `mcp-invest`). No re-exchange happens at the gateway.

The gateway is the sole PingAuthorize enforcement point. It validates the TX token, evaluates TraT claims against the Authorize policy, and — on PERMIT — proxies the request to the appropriate MCP server over a mTLS-authenticated WebSocket connection.

MCP servers enforce mTLS: they require a client certificate from the gateway. A client presenting only the TX token (no cert) is rejected at the TLS handshake before any application logic runs.

If PingOne's token policy does not emit TraT claims natively (expected until native support lands), the BFF simulation shim activates: the BFF builds a `X-TraT-Context` JSON header and attaches it to the request to the gateway. The gateway forwards it to the MCP server alongside the TX token. `trat_sim: true` distinguishes simulation from native in the UI.

---

## 4. Feature Flag

```
ff_trat_mode   default: false   public: true
```

Added to `demo_api_server/services/configStore.js` alongside the existing RFC 8693 flags (`ff_skip_token_exchange`, `ff_inject_may_act`, etc.).

- `false` (default): existing path, zero behaviour change
- `true`: BFF injects TraT claims into the exchange request; gateway evaluates TraT context in Authorize; mTLS enforced between gateway and MCP servers

Config UI helper text: _"Requires PingOne token policy setup — run `npm run pingone:setup:trat` or re-run bootstrap."_

---

## 5. TraT Claims

| Claim | Type | Value | TraT draft field |
|---|---|---|---|
| `reqctx` | object | `{ tool, session_id, correlation_id }` | Request context |
| `purp` | string | `"banking:mcp:tool_call"` | Purpose |
| `azd` | object | `{ sub: userId, act: agentClientId, gateway: gatewayClientId }` | Authorized delegation |
| `rctx` | object | `{ ip, user_agent: "banking-bff/1.0", timestamp }` | Requester context |
| `trat_sim` | boolean | `true` when BFF-simulated; absent when PingOne-native | Simulation marker |

Claims mirror §3 of `draft-oauth-transaction-tokens-for-agents-00`.

---

## 6. Token Flow

### TraT mode OFF (default — unchanged)

```
Browser → (cookie) → BFF
BFF → RFC 8693 exchange (user token + agent token)
    → TX token  (aud: ping.demo, sub: user, act: agent)
BFF → Gateway  (TX token as Bearer)
Gateway → PingAuthorize  (TX token + tool context)  → PERMIT
Gateway → mcp-olb  (TX token as Bearer)
         → Tool execution
```

### TraT mode ON — simulation path (current)

```
Browser → (cookie) → BFF
BFF → RFC 8693 exchange (user token + agent token)
    → TX token  (aud: ping.demo, sub: user, act: agent)
    + X-TraT-Context: { reqctx, purp, azd, rctx, trat_sim: true }
BFF → Gateway  (TX token + X-TraT-Context header)
Gateway → PingAuthorize  (TX token + TraT claims + tool context)  → PERMIT
Gateway → mcp-olb  (TX token + X-TraT-Context + mTLS client cert)
         mcp-olb: TX token valid            ✅
         mcp-olb: mTLS cert from gateway    ✅  → Tool execution
```

### TraT mode ON — PingOne native (future)

```
Browser → (cookie) → BFF
BFF → RFC 8693 exchange + TraT params
    → TX token  (aud: ping.demo, + reqctx/purp/azd/rctx embedded)
BFF → Gateway  (TX token as Bearer)
Gateway → PingAuthorize  (TX token — TraT claims read from bearer)  → PERMIT
Gateway → mcp-olb  (TX token as Bearer + mTLS client cert)
         mcp-olb: TX token valid + reqctx present    ✅
         mcp-olb: mTLS cert from gateway             ✅  → Tool execution
```

---

## 7. Component Changes

### 7.1 BFF — `demo_api_server/services/agentMcpTokenService.js` ✅ Done

When `ff_trat_mode` is on:

1. Build TraT context object from current request: `{ tool, session_id, correlation_id, purp, azd, rctx }`
2. Attempt to pass as extra parameters in the RFC 8693 request body (PingOne native path)
3. After receiving the TX token, decode it and check for `reqctx` claim
4. If `reqctx` absent → activate simulation shim: attach `X-TraT-Context` header (JSON-serialised TraT object + `trat_sim: true`) on the outbound call to the gateway
5. Emit a `trat` token event into the existing `tokenEvents` array so Token Chain UI can display it

### 7.2 BFF Gateway Client — `demo_api_server/services/mcpGatewayClient.js` ✅ Done

Forwards `X-TraT-Context` header when present in `opts.tratContextHeader` to the gateway HTTP request.

### 7.3 BFF Tool Pipeline — `demo_api_server/services/mcpToolPipeline.js` ✅ Done

Passes `tratContextHeader` from the token resolution result through to `callToolViaGateway`. Also builds mTLS token event from the gateway audit trail `mtls` field when present.

### 7.4 MCP Gateway — `demo_mcp_gateway/src/`

**Removed:** `demo_mcp_gateway/src/tokenExchange.ts` (deleted). Calls to `exchangeTokenForBackend` and `selectCredentialForBackend` in `index.ts` are removed — the TX token is forwarded unchanged to each MCP server.

**New file: `demo_mcp_gateway/src/mtls.ts`**
- Generates a self-signed CA + client cert at startup using Node `crypto` + `selfsigned` npm package (add to `demo_mcp_gateway/package.json` dependencies)
- Certs live in memory only
- Writes client cert PEM to `MCP_MTLS_GATEWAY_CERT_PATH` (default: `/tmp/gw-client.crt`) so MCP servers can pin it

**`demo_mcp_gateway/src/proxy.ts`** (extend)
- WebSocket connections to MCP servers use `https.Agent` with the gateway's client cert+key when mTLS is enabled
- Existing `proxyJsonRpc` receives optional `tlsOptions` parameter

**`demo_mcp_gateway/src/index.ts`** (change)
- Calls `mtls.ts` at startup when `MCP_MTLS_ENABLED=true`
- Passes TLS agent to proxy
- Adds `mtls: { verified: true, subject: "banking-mcp-gateway" }` to `X-Gw-Audit-Trail` response header
- Forwards `X-TraT-Context` header to MCP server via `buildUpstreamHeaders` ✅ Done

### 7.5 MCP Server — `demo_mcp_server/src/`

**New file: `demo_mcp_server/src/auth/mtlsMiddleware.ts`**
- Reads `MCP_MTLS_GATEWAY_CERT_PATH` at startup and pins the gateway's client cert
- On each incoming connection, verifies the client cert matches the pinned cert
- Rejects unmatched or absent client certs with HTTP 403 before any application logic runs

**`demo_mcp_server/src/server/BankingMCPServer.ts`** (change)
- When `MCP_MTLS_ENABLED=true`: switches `http.createServer` → `https.createServer` with server cert and `requestCert: true, rejectUnauthorized: true`
- Wires `mtlsMiddleware` as the first middleware

**`demo_mcp_server/src/auth/TratClaimsExtractor.ts`** ✅ Done
- Pure function, extracts and normalises TraT claims from JWT bearer or `X-TraT-Context` header

### 7.6 BFF Config Store — `demo_api_server/services/configStore.js` ✅ Done

`ff_trat_mode: { public: true, default: 'false' }` added to FIELD_DEFS.

---

## 8. PingOne Provisioning

### 8.1 One-off setup script

New file: `demo_api_server/scripts/setupTratClaims.js`

- Uses the PingOne Management API to add custom claim mappings to the MCP Token Exchanger application's token policy
- Claims: `reqctx`, `purp`, `azd`, `rctx` as passthrough mappings from the exchange request context
- Audience: `ping.demo` (broad domain audience covering gateway and both MCP servers)
- Idempotent: checks if claims already exist before writing
- Runnable standalone: `npm run pingone:setup:trat`

Add to `demo_api_server/package.json` scripts:
```json
"pingone:setup:trat": "node scripts/setupTratClaims.js"
```

### 8.2 Bootstrap integration — `demo_api_server/scripts/bootstrapPingOne.js`

- Call `setupTratClaims.js` as a post-provisioning step after the 7 apps + resource servers are created
- Always runs (not flag-gated) — idempotent guard inside `setupTratClaims.js` prevents duplicate writes
- Logs: `[Bootstrap] TraT claims: already provisioned` or `[Bootstrap] TraT claims: provisioned ✅`

---

## 9. mTLS — Gateway → MCP Servers

### 9.1 Trust model

```
Gateway startup → generate self-signed CA + client cert (in memory)
               → write client cert PEM to MCP_MTLS_GATEWAY_CERT_PATH

MCP server startup → read MCP_MTLS_GATEWAY_CERT_PATH → pin gateway cert
                   → switch to https.createServer (requestCert: true)

Client with TX token only         → TLS handshake rejected (no cert)
Gateway with TX token + cert      → TLS handshake accepted → tool execution
```

### 9.2 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_MTLS_ENABLED` | `false` | Enable mTLS enforcement on MCP servers and gateway |
| `MCP_MTLS_GATEWAY_CERT_PATH` | `/tmp/gw-client.crt` | Path where gateway writes its client cert PEM |

### 9.3 Startup ordering

`run.sh` already starts the gateway before MCP servers. The gateway writes its cert on startup; MCP servers read it when they start. No additional ordering changes needed.

### 9.4 Graceful degradation

When `MCP_MTLS_ENABLED=false` (default): MCP servers run plain HTTP — no behaviour change, all existing tests pass. When `true`: MCP servers switch to HTTPS with client cert requirement; gateway presents cert on every outbound WebSocket connection.

---

## 10. Token Chain UI

### 10.1 TraT badge — `demo_api_ui/src/components/TokenChainDisplay.js`

- When a token event has `trat_sim: true`: amber badge reading `TraT (simulated)`
- When claims came from PingOne natively (no `trat_sim`): green badge reading `TraT`
- Badge style matches existing `act` / `may_act` badges

### 10.2 Claims expansion

Clicking the badge expands an inline detail row showing `reqctx`, `purp`, `azd`, `rctx` key-value pairs. Same expand/collapse pattern as the existing `act` claim detail row.

### 10.3 mTLS token event

When the gateway audit trail includes `mtls`:
- Green badge `mTLS ✅` when `verified: true`
- Amber badge `mTLS ⚠️` when `MCP_MTLS_ENABLED=false` (not enforced)

### 10.4 Deep link to education panel

Badge info icon (`ⓘ`) opens `EDU.TRANSACTION_TOKENS` panel via `useEducationUI()`.

---

## 11. Education Panel — `TransactionTokensPanel.js`

**Registry:** `EDU.TRANSACTION_TOKENS = "transaction-tokens"` added to `educationIds.js`

**Registered in:** `EducationPanelsHost.js`

### Tabs

| Tab | Content |
|---|---|
| **What & Why** | Problem statement — replay attacks, context binding, workload identity in multi-hop agent chains. Link to `draft-oauth-transaction-tokens-for-agents-00` on IETF datatracker. |
| **How It Works** | Step-by-step flow diagram: BFF → RFC 8693 + TraT claims → Gateway → Authorize → MCP Server (mTLS). Follows `TokenExchangeDiagram.js` style. |
| **Claims Reference** | Table of `reqctx`, `purp`, `azd`, `rctx`, `trat_sim` — spec field name, type, example value, and role in this demo. |
| **mTLS** | Why a broad-audience TX token needs a second enforcement mechanism. How self-signed certs work in the demo. What happens when `MCP_MTLS_ENABLED=false`. How to enable. |
| **Draft Status** | IETF maturity: individual draft, OAUTH WG. Link to datatracker. Note that PingOne support is pending. Instructions for checking for spec updates. |
| **This Demo** | Explains simulation mode vs native PingOne mode. What `trat_sim: true` means. How to enable `ff_trat_mode`. How to provision PingOne claims (`npm run pingone:setup:trat`). |

---

## 12. Files Touched

| File | Change | Status |
|---|---|---|
| `demo_api_server/services/configStore.js` | Add `ff_trat_mode` to FIELD_DEFS | ✅ Done |
| `demo_api_server/services/agentMcpTokenService.js` | Inject TraT params into RFC 8693 exchange; simulation shim; emit `trat` token event | ✅ Done |
| `demo_api_server/services/mcpGatewayClient.js` | Forward `X-TraT-Context` header to gateway | ✅ Done |
| `demo_api_server/services/mcpToolPipeline.js` | Pass `tratContextHeader` to gateway client; build mTLS token event from audit trail | ✅ Done |
| `demo_mcp_gateway/src/proxy.ts` | Forward `X-TraT-Context` via `buildUpstreamHeaders`; add `tlsOptions` for mTLS client cert | ✅ Done (TraT) / 🔵 New (mTLS) |
| `demo_mcp_server/src/auth/TratClaimsExtractor.ts` | New — extract + normalise TraT claims from JWT or header | ✅ Done |
| `demo_mcp_gateway/src/tokenExchange.ts` | Delete — gateway no longer re-exchanges tokens | 🔵 Delete |
| `demo_mcp_gateway/src/credentialSwap.ts` | Delete — no longer needed without re-exchange | 🔵 Delete |
| `demo_mcp_gateway/src/mtls.ts` | New — generate self-signed CA + client cert at startup; write cert PEM to shared path | 🔵 New |
| `demo_mcp_gateway/src/index.ts` | Remove re-exchange code; call `mtls.ts` at startup; add mTLS to audit trail | 🔵 Change |
| `demo_mcp_server/src/auth/mtlsMiddleware.ts` | New — pin gateway cert; reject connections without valid client cert | 🔵 New |
| `demo_mcp_server/src/server/BankingMCPServer.ts` | Switch to `https.createServer` + `requestCert: true` when `MCP_MTLS_ENABLED=true` | 🔵 Change |
| `demo_api_server/scripts/setupTratClaims.js` | New — idempotent PingOne claim provisioning (aud: ping.demo) | 🔵 New |
| `demo_api_server/scripts/bootstrapPingOne.js` | Call `setupTratClaims.js` post-provisioning | 🔵 New |
| `demo_api_server/package.json` | Add `pingone:setup:trat` script | 🔵 New |
| `demo_api_ui/src/components/TokenChainDisplay.js` | TraT badge + claims expansion + mTLS token event | 🔵 New |
| `demo_api_ui/src/components/TokenChainDisplay.css` | Badge styles for TraT + mTLS | 🔵 New |
| `demo_api_ui/src/components/education/educationIds.js` | Add `TRANSACTION_TOKENS` | 🔵 New |
| `demo_api_ui/src/components/education/TransactionTokensPanel.js` | New — education panel with mTLS tab | 🔵 New |
| `demo_api_ui/src/components/education/EducationPanelsHost.js` | Register new panel | 🔵 New |

---

## 13. Success Criteria

- `ff_trat_mode=false` (default): zero behaviour change, all existing tests pass
- `ff_trat_mode=true` + simulation: Token Chain shows `TraT (simulated)` amber badge with expanded claims; MCP tool calls proceed (Authorize permits)
- `ff_trat_mode=true` + PingOne native: Token Chain shows `TraT` green badge; `trat_sim` absent from token
- `MCP_MTLS_ENABLED=false` (default): MCP servers run plain HTTP — no behaviour change
- `MCP_MTLS_ENABLED=true`: client without gateway cert is rejected at TLS handshake; gateway cert accepted
- Token Chain shows green `mTLS ✅` badge when mTLS is enforced and verified
- Bootstrap always provisions TraT claims; re-running is idempotent
- `npm run pingone:setup:trat` runs standalone without error on a provisioned environment
- `TransactionTokensPanel` opens from Token Chain badge info icon and from education nav
- UI build passes (`cd demo_api_ui && npm run build` exit 0)
- No regressions on existing OAuth, HITL, or step-up flows

---

## 14. Draft Spec Notes

**Spec:** `draft-oauth-transaction-tokens-for-agents-00`
**IETF datatracker:** https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/00/
**WG:** OAUTH
**Maturity:** Individual draft (00) — pre-WG adoption as of May 2026

**Key differences between this demo's simulation and the real draft:**
- Real draft: TraT is a distinct token type with its own `token_type` value and a Transaction Token Service (TTS) endpoint
- This demo: TraT claims are embedded in a standard access token issued by PingOne (simulation) or injected via `X-TraT-Context` header (shim)
- Real draft: TraT has a very short lifetime (seconds, not minutes)
- This demo: lifetime matches the access token; `trat_sim: true` marks the difference
- Real draft: does not prescribe mTLS; mTLS is a complementary enforcement mechanism for the broad-audience TX token model used here

**To check for spec updates:** Visit https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/ — the education panel links directly to the datatracker page.
