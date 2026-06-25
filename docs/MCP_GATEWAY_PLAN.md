> **Historical note (archived plan):** This document describes a design proposal for integrating the commercial PingGateway 2025.11.1 product. This plan was not executed as written. The implemented gateway is a custom TypeScript service (`demo_mcp_gateway`, port 3005). Refer to `ARCHITECTURE.md` for the current architecture.

# MCP security gateway plan (PingGateway + Super Banking)

This document extends the team’s MCP gateway architecture plan with **official Ping transfer-of-information (TOI) material** for **PingGateway 2025.11.1 — MCP Security Gateway**.  
Use it together with the public tutorial: [MCP security gateway | PingGateway 2025.11](https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html).

## Primary reference (internal PDF)

| Item | Detail |
|------|--------|
| **Document** | PingGateway 2025.11.1 — MCP TOI (Transfer of Information) |
| **Product / version** | PingGateway **2025.11.1** (deck dated **February 2026**; product line release **January 26, 2026**) |
| **Local copy** | `/Users/cmuir/Documents/ai logos/PingGateway 2025.11.1 - MCP TOI.pdf` |

**Note:** The PDF is marked *Confidential — do not distribute*. Do not republish slides verbatim outside Ping-approved channels; use this file for **paraphrased** planning notes and the **public** doc link above for shareable detail.

---

## Summary from TOI (planning hooks)

### What MCP is (per TOI)

- **Model Context Protocol (MCP)** is an open standard for connecting AI apps to data sources, tools, and workflows (JSON-RPC style requests such as `tools/call`, responses with structured `content`).
- **MCP client** (e.g. AI agent) talks to an **MCP server** that exposes tools.

### Business problem & Ping’s answer

- **Challenge:** Teams want to expose services over MCP quickly; IAM/security need a **consistent, documented, adaptable** security model across all MCP-exposed assets.
- **Solution:** **MCP Security Gateway** on PingGateway — security **in front of** MCP servers with **no coding** on the MCP server for gateway features.

### Gateway value (TOI)

1. **Security:** Consistent, evolvable posture for everything exposed via MCP.  
2. **Cost / focus:** Business teams ship MCP use cases; IAM owns gateway policy.  
3. **Ping capabilities** (transparent to MCP server):  
   - Allow only **valid MCP** requests  
 - **Audit** MCP requests and actors  
   - **Coarse-grained** controls (OAuth 2.0)  
   - **Fine-grained** controls (PingOne Authorize, Advanced Identity Cloud, PingOne Protect) — see **`docs/PINGONE_AUTHORIZE_PLAN.md`** for Authorize APIs and decision endpoints.  
   - **Token transformation** to match downstream security models  

### High-level flow (TOI diagrams)

1. **Intercept** MCP traffic at the gateway.  
2. **Enforce** identity and security rules via the Ping platform.  
3. **Adapt** tokens/security to what the **real MCP / backend** expects (JWT, token exchange, HTTP Basic, etc.).

**Securing one MCP request (conceptual steps):**

1. MCP-specific validation and processing.  
2. Authorization / fraud detection with Ping platform (patterns applicable to REST APIs as well).  
3. Adapt security for the backend, then forward to the business backend.

---

## PingGateway MCP objects (2025.11.1 — TOI alignment)

These are the main building blocks called out in the TOI; match them to route JSON in the [public MCP tutorial](https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html).

| Object / feature | Role |
|------------------|------|
| **McpContext** | Holds MCP request/response context for downstream filters/handlers; populated by **McpValidationFilter**; access e.g. `${contexts.mcp}`; includes protocol version and MCP **session id** per TOI. |
| **McpValidationFilter** | Validates **Origin** and **Accept**; validates **JSON-RPC** payload; validates MCP **client message** format (excluding tools schema); populates **McpContext**; optional **`metricsEnabled`**. |
| **McpProtectionFilter** | Serves static **OAuth 2.0 Protected Resource Metadata** at `/.well-known/oauth-protected-resource`; adapts **WWW-Authenticate** to include **resource_metadata**; validates **aud** on the access token vs **`resourceId`**; works with **`resourceServerFilter`**, **`supportedScopes`**, **`resourceIdPointer`** (TOI example uses `audience`). |
| **McpAuditFilter** | Writes MCP events to the audit service; TOI shows **`eventName`** such as `PING-GATEWAY-MCP`, with client fields including **`method`** (e.g. `tools/call`), **`param`** (tool name), **`protocolVersion`**. |
| **MCP metrics** | Controlled via **McpValidationFilter**; **Prometheus**-format counters for tools/resources/prompts; TOI example path pattern: `https://ig.example.com/gateway/metrics/prometheus/0.0.4` (adjust to your IG deployment). |

### OAuth protected resource metadata (RFC 9728)

TOI aligns with **RFC 9728**: MCP clients can discover RS constraints **before** tool invocation and before obtaining a token; RS exposes metadata at `/.well-known/oauth-protected-resource`; token is then obtained to match those constraints; RS **always** validates the token.

### Token `aud` / audience (TOI)

- **McpProtectionFilter** validates **`aud`** against **`resourceId`**.  
- **PingAM / PingOne AIC:** TOI states an **OAuth2 Access Token Modification** script may be needed to set the **audience** claim (consistent with the public tutorial’s `resourceIdPointer` / `audience` pattern).  
- **PingFederate:** Configure access token manager to include **audience** in the JWT.

### Rate limiting (TOI)

- Use **ThrottlingFilter** with **MappedThrottlingPolicy**, mapping rates by MCP tool.  
- TOI **correction note:** MCP tool name may need to be extracted via a **ScriptableFilter** before throttling mapping (e.g. `${contexts.mcpInfo.toolName}` pattern may require preceding script).

### Documentation pointers (TOI slide)

- Tutorial: `https://docs.pingidentity.com/pinggateway/2025.11/mcp/`  
- References: **McpAuditFilter**, **McpProtectionFilter**, **McpValidationFilter**  
- **PingGateway Agent Gateway module** called out as related capability in the TOI deck.

### MCP flow with gateway (TOI)

- Without gateway: agent ↔ LLM ↔ MCP server (typical tool list, LLM, tool call, answer).  
- **With MCP Security Gateway:** first MCP interaction drives **authorization** (registration, user auth, consent) to obtain **`access_token`**; subsequent MCP requests send the token; gateway validates (e.g. **scope** enforcement).

---

## Application to Super Banking (`banking_mcp_server`)

| Super Banking | PingGateway MCP plan |
|------------|----------------------|
| **MCP server** (`banking_mcp_server`, WebSocket, Railway/Fly/Render) | Place **behind** PingGateway; clients use `wss://` / HTTPS URL on the gateway, not the raw host. |
| **PingOne OAuth** | Configure tokens so **`aud` / audience** matches **`resourceId`** on **McpProtectionFilter** (`resourceIdPointer` aligned with your token shape). |
| **SSE / streaming** | Public tutorial requires **`streamingEnabled: true`** in PingGateway admin config for MCP transports that use SSE. |
| **Observability** | Consider **McpAuditFilter** + **Prometheus** MCP metrics from **McpValidationFilter** per TOI. |
| **Throttling** | Optionally throttle by tool name (with **ScriptableFilter** if TOI correction applies). |

---

## Revision history

| Date | Change |
|------|--------|
| 2026-03-25 | Initial plan: merged earlier Super Banking gateway outline with PingGateway **2025.11.1 MCP TOI** PDF (local path above) and public 2025.11 MCP doc link. |
