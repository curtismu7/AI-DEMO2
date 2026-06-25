# MCP Specification 2025-11-25 — Gap Analysis (Super Banking demo)

This document compares this repository’s MCP implementation (primarily `banking_mcp_server/` + BFF bridge `banking_api_server/services/mcpWebSocketClient.js`) against the authoritative specification:

- [Specification index](https://modelcontextprotocol.io/specification/2025-11-25)
- [Authorization (HTTP transports)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Base protocol / JSON-RPC](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)

**Scope note:** The spec’s **authorization** chapter is written for **HTTP-based** MCP transports. This project uses **WebSocket** JSON-RPC plus a **BFF** (`POST /api/mcp/tool`, etc.). That pattern is explicitly allowed as an **alternative transport** only if it follows **established security best practices**; it does **not** automatically satisfy the HTTP OAuth discovery rules (RFC 9728, `WWW-Authenticate`, etc.).

Normative language in the specification follows [BCP 14](https://datatracker.ietf.org/doc/html/bcp14) ([RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119), [RFC 8174](https://datatracker.ietf.org/doc/html/rfc8174)): **MUST** / **REQUIRED**, **MUST NOT**, **SHOULD** / **RECOMMENDED**, **SHOULD NOT**, **MAY** / **OPTIONAL**.

**Implementation status:** All phases A, B, C, D, E, and F are **fully implemented** in-repo (2026-03-30). Tests cover all implemented behaviours. A user-facing Feature Flag ("MCP — Use 2024-11-05 Protocol") lets admins choose the handshake protocol version at runtime.

---

## Normative requirements — required vs optional / suggested (spec 2025-11-25)

This table summarizes **what the specification obliges** versus **what is optional or advisory**. Citations point to the main spec pages; the authorization row references [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); lifecycle rows reference [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle); base protocol rows reference [Overview (Basic)](https://modelcontextprotocol.io/specification/2025-11-25/basic).

| Level | Topic | What the spec says |
|-------|--------|---------------------|
| **MUST (required)** | **Core stack** | Every implementation **MUST** support the **base protocol** (JSON-RPC) and **lifecycle** (initialize → operate → shutdown). Other components (resources, prompts, tools, client features, authorization profile, utilities) are **not** universally mandatory—see **MAY / OPTIONAL** rows. ([Overview](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **JSON-RPC requests** | Requests **MUST** include a string or integer `id`; the id **MUST NOT** be `null`; within a session the requestor **MUST NOT** reuse an id. ([Basic / Messages](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **JSON-RPC notifications** | Notifications **MUST NOT** include an `id`. ([Basic / Messages](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **JSON-RPC responses** | Result responses **MUST** use the same `id` as the request; error responses **MUST** include `error` with integer `code` and `message`. ([Basic / Messages](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **Lifecycle: initialize** | The **initialization** phase **MUST** be the **first** interaction between client and server. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **MUST** | **Lifecycle: initialize contents** | The client **MUST** initiate with an `initialize` request containing **protocol version**, **client capabilities**, and **client implementation** information (`clientInfo`). ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **MUST** | **Lifecycle: `notifications/initialized`** | After a successful `initialize`, the client **MUST** send a **`notifications/initialized`** notification before normal operation. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **MUST** | **Version negotiation** | If the server supports the client’s requested `protocolVersion`, it **MUST** respond with the **same** version; otherwise it **MUST** respond with a version it **does** support (typically its latest). ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **MUST** | **HTTP: protocol version header** | If using **HTTP** transport, the client **MUST** include the **`MCP-Protocol-Version`** HTTP header on **all** subsequent requests to the MCP server (after initialization). ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle); [Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)) |
| **MUST** | **Negotiated capabilities** | During the session, both parties **MUST** **only use capabilities that were successfully negotiated**. ([Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture)) |
| **MUST** | **JSON Schema default** | Clients and servers **MUST** support **JSON Schema 2020-12** for schemas without an explicit `$schema`. ([Basic / JSON Schema](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **Schema validation** | Schemas **MUST** be valid per their declared or default dialect; unsupported dialects **MUST** yield an appropriate error. ([Basic / JSON Schema](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MUST** | **Input validation = tool execution errors** | Input validation failures (e.g., wrong argument type, value out of range) **MUST** be returned as **tool execution errors** (`isError: true` in the `content` array) rather than protocol errors (`-32602`), so LLMs can self-correct and retry with adjusted parameters. ([Tools — Error Handling](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)) |
| **MUST** | **Authorization (overall)** | **Authorization is OPTIONAL** for MCP implementations. **When** an implementation supports authorization for **HTTP-based** transports, the spec lists many **MUST** rules (e.g. MCP servers **MUST** implement RFC 9728 protected resource metadata; HTTP MCP clients **MUST** use it for AS discovery; MCP clients **MUST** support both `WWW-Authenticate` and well-known discovery fallbacks; **MUST** implement RFC 8707 `resource` parameter; token usage and validation rules for HTTP resource servers). ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **MUST** | **Alternative transports** | Implementations using transports **other than** HTTP or STDIO (e.g. WebSocket) **MUST** follow **established security best practices** for that protocol. ([Authorization — Introduction](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD NOT** | **STDIO + HTTP auth spec** | STDIO implementations **SHOULD NOT** follow the HTTP authorization specification; they **SHOULD** retrieve credentials from the **environment** instead. ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **HTTP transport + auth** | Implementations using an **HTTP-based** transport **SHOULD** conform to the authorization specification. ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **OAuth / AS extras** | Authorization servers **SHOULD** implement OAuth 2.1 with appropriate measures; AS and clients **SHOULD** support Client ID Metadata Documents; **MAY** support Dynamic Client Registration. AS discovery now also supports **OpenID Connect Discovery 1.0** in addition to RFC 9728. **Incremental scope consent** via extended `WWW-Authenticate` is supported (spec major change). ([Authorization — Overview](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **Lifecycle ordering (client)** | The client **SHOULD NOT** send requests (other than **pings**) before the server has responded to `initialize`. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **SHOULD** | **Lifecycle ordering (server)** | The server **SHOULD NOT** send requests (other than **pings** and **logging**) before receiving **`initialized`**. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **SHOULD** | **Client protocol version** | The client **SHOULD** send the **latest** protocol version it supports in `initialize`. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **SHOULD** | **Disconnect on mismatch** | If the client cannot accept the server’s negotiated `protocolVersion`, it **SHOULD** disconnect. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **SHOULD** | **Timeouts** | Implementations **SHOULD** establish **timeouts** for sent requests; **SHOULD** cancel on timeout per cancellation utilities. ([Lifecycle — Timeouts](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **SHOULD** | **Scope in 401** | MCP servers **SHOULD** include a `scope` parameter in `WWW-Authenticate` on **401** when helpful. ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **Insufficient scope (403)** | On insufficient scope at runtime, servers **SHOULD** respond with **403** and structured `WWW-Authenticate` as described. ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **Scope selection (clients)** | MCP clients **SHOULD** follow least-privilege scope selection order (401 `scope` first, then `scopes_supported`, etc.). ([Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)) |
| **SHOULD** | **Security implementation** | Implementors **SHOULD** build consent flows, document risks, use access controls, follow security practices, consider privacy. ([Specification — Security](https://modelcontextprotocol.io/specification/2025-11-25/index)) |
| **SHOULD** | **JSON Schema dialects** | Implementations **SHOULD** document which schema dialects they support beyond the default. ([Basic / JSON Schema](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MAY / OPTIONAL** | **Server features** | Servers **MAY** offer **resources**, **prompts**, **tools**; not all are required. ([Overview](https://modelcontextprotocol.io/specification/2025-11-25/index)) |
| **MAY / OPTIONAL** | **Client features** | Clients **MAY** offer **sampling**, **roots**, **elicitation** (per negotiated capabilities). ([Overview](https://modelcontextprotocol.io/specification/2025-11-25/index)) |
| **MAY / OPTIONAL** | **Utilities** | **Progress**, **cancellation**, **logging**, **completion**, **pagination** etc. are defined where relevant but not mandatory for minimal implementations. ([Overview](https://modelcontextprotocol.io/specification/2025-11-25/basic)) **Tasks** now have a full experimental specification (see dedicated row below). |
| **MAY** | **Custom auth** | Clients and servers **MAY** negotiate **custom** authentication/authorization strategies (outside the standard HTTP OAuth profile). ([Basic — Auth](https://modelcontextprotocol.io/specification/2025-11-25/basic)) |
| **MAY / OPTIONAL** | **Elicitation URL mode (new in 2025-11-25)** | Clients **MAY** declare the `elicitation` capability with a `url` sub-capability. Servers can then send `elicitation/create` with `mode: "url"` to direct users to external URLs (OAuth flows, payment, sensitive credentials). Servers **MAY** send `notifications/elicitation/complete`. Servers **MUST NOT** use this to authorize the MCP client itself (that is MCP Authorization). Introduces error code **`-32042`** (`URLElicitationRequiredError`). For backwards compatibility, an empty `elicitation: {}` capability is treated as form-mode only. ([Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)) |
| **MAY / OPTIONAL** | **Tasks (experimental, new in 2025-11-25)** | Servers and clients **MAY** declare a `tasks` capability to support durable, polling-based request execution. Introduces messages: `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`, `notifications/tasks/status`. Tool definitions **MAY** carry `execution.taskSupport: "optional" \| "required" \| "forbidden"` (default: `"forbidden"`). Receivers **MUST** bind tasks to auth context if one is present. ([Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)) |
| **MAY / OPTIONAL** | **Sampling: tool definitions (new in 2025-11-25)** | `sampling/createMessage` requests **MAY** include `tools` (array of tool definitions) and `toolChoice` parameters, allowing servers to provide tool-calling context to the LLM during sampling. ([Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)) |
| **MAY / OPTIONAL** | **`Implementation.description`** | The `clientInfo` and `serverInfo` objects (sent in `initialize`) **MAY** include an optional `description` field (human-readable string) to align with the MCP registry `server.json` format. ([Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) |
| **RECOMMENDED (non-normative goals)** | **Trust & safety** | The overview’s security principles state users **must** consent, hosts **must** obtain consent before exposing data, hosts **must** obtain consent before invoking tools—expressed as principles for implementors rather than wire-protocol **MUST**s in the same RFC 2119 block. ([Specification — Security](https://modelcontextprotocol.io/specification/2025-11-25/index)) |

**How to use this table:** Rows marked **MUST** are **hard requirements** for a spec-compliant implementation *of that topic* (e.g. HTTP MCP auth **MUST**s apply only if you implement the HTTP authorization profile). **SHOULD** / **RECOMMENDED** are **strong suggestions**; **MAY** / **OPTIONAL** leave freedom. For the full authoritative list, use the [schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts) and the linked spec sections.

---

## Summary table — compliance vs gaps (post-remediation)

| Area | Spec (2025-11-25) | Our status | Notes |
|------|-------------------|------------|--------|
| **HTTP OAuth: Protected Resource Metadata (RFC 9728)** | MCP servers using HTTP MUST expose metadata; clients MUST use it for AS discovery. | **Implemented** | `GET /.well-known/oauth-protected-resource` on MCP server. Returns `resource`, `authorization_servers`, `bearer_methods_supported`, `scopes_supported`. |
| **Alternative transport (e.g. WebSocket)** | MUST follow **security best practices**. | **OK** | BFF + introspection + scopes; custom `initialize` params. Unchanged. |
| **Lifecycle: `initialize` + `notifications/initialized` + tools** | Client MUST send initialized before normal ops. | **Compliant** | `mcpWebSocketClient.js` sends `initialize` → on success `notifications/initialized` → `tools/list` / `tools/call`. |
| **Lifecycle: client `initialize` params** | `protocolVersion`, **capabilities**, **clientInfo**. | **Compliant** | BFF sends `capabilities: {}`, `clientInfo`, `MCP_CLIENT_PROTOCOL_VERSION` (default `2025-11-25`). Server defaults missing `capabilities` to `{}`. |
| **Protocol version negotiation** | Same version if supported; else server version. | **Compliant** | Server supports **`2025-11-25`** and **`2024-11-05`** (any `2024-*` maps to `2024-11-05`). |
| **SHOULD: Disconnect on version mismatch** | Client SHOULD disconnect if it cannot accept the server's negotiated `protocolVersion`. | **Implemented** | `mcpWebSocketClient.js` checks `msg.result.protocolVersion` against `SUPPORTED_PROTOCOL_VERSIONS = {'2025-11-25', '2024-11-05'}` after `initialize` response and rejects/closes on mismatch. |
| **SHOULD: Lifecycle ordering (server gate)** | Server SHOULD NOT process non-init requests before `notifications/initialized` is received. | **Implemented** | `BankingMCPServer.routeMessage` intercepts `notifications/initialized` and sets `connection.initialized = true`; rejects (−32600) any other request (except `initialize` and `ping`) until that flag is set. |
| **SHOULD: Request timeouts** | Implementations SHOULD establish timeouts for sent requests; SHOULD cancel on timeout per cancellation utilities. | **Implemented** | `MCPMessageHandler.handleToolCall` wraps `executeTool` in `Promise.race` with a configurable `TOOL_CALL_TIMEOUT_MS` timeout (default 30 s). Returns `isError: true` on timeout so the LLM can retry. CIBA waits are excluded. |
| **JSON-RPC: request IDs** | MUST NOT be `null`. | **Compliant** | `BankingMCPServer.isValidMCPMessage` rejects `id === null`; notifications use `notifications/*` without `id`. |
| **Server capabilities** | Advertised features should match implementation. | **Compliant** | **tools** + **logging** only (prompts/resources removed). `logging/setLevel` handled; `notifications/message` from server is optional and not currently emitted. |
| **Server methods** | `tools/list`, `tools/call` | **Compliant (+ extensions)** | Tool schema extensions unchanged. |
| **`ping`** | Optional utility. | **Compliant** | `ping` returns `{ result: {} }`. |
| **Utilities: cancellation, progress** | Optional. | **Not implemented** | Optional future work. |
| **Tasks** (`tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`) | Optional / experimental (2025-11-25). Requires declared `tasks` capability. | **Not implemented** | Optional future work; all tools currently use `execution.taskSupport: "forbidden"` (default). |
| **Tool content: `audio` type** | MAY return `{ type: "audio", data, mimeType }` in content array. | **Not implemented** | `ToolResult.type` only supports `text \| image \| resource`. |
| **Tool content: `resource_link` type** | MAY return `{ type: "resource_link", uri, name, ... }` in content array. | **Not implemented** | Not in `ToolResult` type union. |
| **Tool results: `structuredContent` + `outputSchema`** | Tools MAY declare `outputSchema`; servers MUST then populate `structuredContent` field on results. Clients SHOULD validate against schema. | **Not implemented** | `ToolDefinition` lacks `outputSchema`; `ToolResult` lacks `structuredContent`. |
| **Elicitation URL mode** | Optional client capability; `elicitation/create mode:"url"`. | **N/A** | This repo's HITL/consent uses a custom auth-challenge mechanism; no standard elicitation client surface. |
| **HTTP MCP authorization profile** | RFC 9728, 401, etc. | **N/A** | Not using HTTP MCP transport. |

---

## Authorization — focused analysis

### What the spec requires (HTTP MCP)

Per [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization):

- Authorization is **optional** for MCP implementations.
- **HTTP-based** transports **SHOULD** conform (OAuth 2.1, RFC 9728 protected resource metadata, `WWW-Authenticate` on 401, AS discovery, etc.).
- **STDIO** SHOULD **not** use this; use **environment** credentials.
- **Alternative transports** MUST follow **security best practices** (not the RFC 9728 HTTP profile).

### What we do instead

- **WebSocket** JSON-RPC + **Bearer-style agent token** in `initialize` params (`agentToken`), validated via **PingOne introspection** (`TokenIntrospector`).
- **End-user context** via **`userSub`** (trusted metadata from BFF) rather than passing the user’s access token to MCP.
- **BFF** enforces **scope-to-tool** mapping (`MCP_TOOL_SCOPES`) before calling MCP.

This is **not** the **HTTP MCP authorization profile**. Interoperability with a **third-party MCP client** that expects RFC 9728 + HTTP 401 challenges would **fail** unless Phase D is implemented.

---

## Remediation plan — status

### Phase A — Lifecycle correctness — **done**

- **`mcpWebSocketClient.js`:** After successful `initialize` (id `1`), sends **`notifications/initialized`**, then **`tools/list` / `tools/call`** (id `2`). Initialize errors do not send follow-ups.
- **`MCPMessageHandler`:** Handles **`notifications/initialized`** (no response).
- **Tests:** Integration test `initialize → notifications/initialized → tools/list`.

### Phase B — Protocol version alignment — **done**

- **Server:** Negotiates **`2025-11-25`** or **`2024-11-05`** via `negotiateProtocolVersion()`.
- **BFF:** `MCP_CLIENT_PROTOCOL_VERSION` env (default **`2025-11-25`**), exported for inspector context.

### Phase C — Capability honesty and JSON-RPC strictness — **done**

- **`serverCapabilities`:** Only **tools** + **logging**.
- **`isValidMCPMessage`:** Rejects **`null`** request ids; **`notifications/*`** without `id` only.
- **`initialize`:** Default **`capabilities`** to **`{}`** if missing.

### Phase D — HTTP authorization profile — **implemented** (2026-03-30)

- New `HttpMCPTransport.ts` adds `POST /mcp` (Streamable HTTP) and `GET /.well-known/oauth-protected-resource` (RFC 9728) on the same port as the WebSocket server.
- Bearer token from `Authorization` header validated via existing `BankingAuthenticationManager.validateAgentToken()` (PingOne introspection).
- Returns `401 WWW-Authenticate: Bearer realm=..., resource_metadata=<RFC 9728 URL>` on missing/invalid token.
- `MCP-Session-Id` header issued on `initialize`; required on subsequent requests.
- `MCP-Protocol-Version` header required on non-initialize requests.
- `Origin` header validated (rejects with HTTP 403 if present but not in `MCP_ALLOWED_ORIGINS`).
- WebSocket transport is completely unchanged.
- Opt-out: `HTTP_MCP_TRANSPORT_ENABLED=false`.

### Phase E — Utilities — **fully done**

- **`ping`** implemented.
- **`logging/setLevel`** implemented (2026-03-30): `MCPMessageHandler` handles the request, validates RFC 5424 level, stores it as `clientLogLevel`, returns `{}`. `notifications/message` emission from server is optional and not currently used.
- **Tests**: `MCPMessageHandler.test.ts` — `describe('logging/setLevel')` covers all 8 RFC 5424 levels (parameterised), invalid level (-32602), absent level (-32602).
- **`MCP_SERVER_RESOURCE_URI`** documented (2026-03-30): added to `.env.example` and `EnvironmentVariables` interface. Audience validation in `TokenIntrospector` is now opt-in-but-documented; set this to `MCP_RESOURCE_URL` value in production to enable zero-trust aud checks.
- **Cancellation / progress** not implemented (optional).
- **Tasks** not implemented (optional / experimental).

### Phase F — SHOULD requirements — **fully implemented + tested** (2026-03-30)

- **Input validation → `isError: true`**: `MCPMessageHandler.handleToolCall` now returns an `isError: true` tool result (not a protocol error) for unknown tool names. The content item includes `{ type, text, success: false, error }` fields for LLM self-correction. Auth failure (no token/session) still returns JSON-RPC −32001 (early gate added before tool lookup so the error type matches the cause).
- **`scope=` in `WWW-Authenticate` 401**: `HttpMCPTransport.sendUnauthorized` accepts `requiredScopes?` and appends `scope="…"` to the header.
- **403 on insufficient scope**: `HttpMCPTransport.sendInsufficientScope` emits HTTP 403 with `error="insufficient_scope"` in `WWW-Authenticate`; `handlePost` promotes an `authChallenge`-carrying tool result to 403.
- **Disconnect on version mismatch**: `mcpWebSocketClient.js` checks `msg.result.protocolVersion` against `SUPPORTED_PROTOCOL_VERSIONS` after `initialize` response; closes and rejects on mismatch.
- **Server lifecycle gate**: `BankingMCPServer.routeMessage` intercepts `notifications/initialized` (sets `connection.initialized = true`) and rejects any non-init, non-ping request received before that flag is set (−32600). **Tests**: `BankingMCPServer.test.ts` — `describe('Lifecycle gate')` covers pre-init rejection (-32600), post-init allowed, ping always permitted.
- **Request timeouts**: `MCPMessageHandler.handleToolCall` wraps `executeTool` in `Promise.race` with `TOOL_CALL_TIMEOUT_MS` (default 30 s, configurable via env). On timeout, returns `isError: true` with a descriptive message. CIBA waits are not affected. **Tests**: `MCPMessageHandler.test.ts` — `describe('Tool call timeout')` verifies `isError: true` with timeout message.

### Phase D — HTTP authorization profile — **fully implemented + tested** (2026-03-30)

- New `HttpMCPTransport.ts` adds `POST /mcp` (Streamable HTTP) and `GET /.well-known/oauth-protected-resource` (RFC 9728) on the same port as the WebSocket server.
- Bearer token from `Authorization` header validated via existing `BankingAuthenticationManager.validateAgentToken()` (PingOne introspection).
- Returns `401 WWW-Authenticate: Bearer realm=..., resource_metadata=<RFC 9728 URL>` on missing/invalid token.
- `MCP-Session-Id` header issued on `initialize`; required on subsequent requests. Unknown session → 404.
- `MCP-Protocol-Version` header required on non-initialize requests. Missing → 400.
- `Origin` header validated (rejects with HTTP 403 if present but not in `MCP_ALLOWED_ORIGINS`).
- `GET /mcp` returns 405 (SSE streaming not yet supported).
- `DELETE /mcp` terminates session (200); unknown session → 404.
- Auth-challenge tool results promoted to HTTP 403 + `insufficient_scope` in `WWW-Authenticate`.
- Notifications (no `id`) return 202 with no body.
- WebSocket transport is completely unchanged.
- Opt-out: `HTTP_MCP_TRANSPORT_ENABLED=false`.
- **Tests**: `tests/server/HttpMCPTransport.test.ts` — 15 tests covering all above behaviours.

---

## Tool schema additions (2025-11-25)

The following fields were added to tool definitions and results in the 2025-11-25 spec. They are **MAY / OPTIONAL** and our implementation does not use them today.

| Field | Location | Description |
|-------|----------|-------------|
| `title` | `ToolDefinition` | Optional human-readable display name (separate from `name`). |
| `icons` | `ToolDefinition` | Optional array of `{ src, mimeType, sizes }` icon objects for UI display. |
| `outputSchema` | `ToolDefinition` | Optional JSON Schema 2020-12 describing `structuredContent` output. If present, servers MUST conform; clients SHOULD validate. |
| `annotations` | `ToolDefinition` | Optional metadata about tool behaviour (treat as untrusted unless from a trusted server). |
| `execution.taskSupport` | `ToolDefinition` | Opt-in to task-augmented execution: `"forbidden"` (default) \| `"optional"` \| `"required"`. |
| `structuredContent` | Tool call result | JSON object containing structured output when `outputSchema` is declared. For backwards compatibility, the serialised JSON SHOULD also appear in a `TextContent` block. |
| `audio` content | Tool call result `content[]` | `{ type: "audio", data: "<base64>", mimeType: "audio/wav" }` — audio media in results. |
| `resource_link` content | Tool call result `content[]` | `{ type: "resource_link", uri, name, description, mimeType }` — links to server resources without embedding them. |

**Current interfaces to update when implementing any of the above:** `ToolDefinition` and `ToolResult` in `banking_mcp_server/src/interfaces/mcp.ts`.

---

## User-facing options (demo / admin)

| Option | Where | How | Notes |
|--------|-------|-----|-------|
| **MCP Protocol Version** | Admin → Feature Flags → "MCP Server" category | Toggle **"MCP — Use 2024-11-05 Protocol (legacy)"** ON/OFF | OFF (default) = `2025-11-25`. ON = `2024-11-05`. Checked at call time in `mcpWebSocketClient.js`; takes effect on the next agent tool call. |
| **HTTP MCP Transport** | `banking_mcp_server/.env` | `HTTP_MCP_TRANSPORT_ENABLED=true/false` | MCP server env var; cannot be toggled at runtime from the BFF. Default: enabled. |
| **Tool call timeout** | `banking_mcp_server/.env` | `TOOL_CALL_TIMEOUT_MS=<ms>` | MCP server env var. Default: 30 000 ms. |
| **RFC 8707 audience validation** | `banking_mcp_server/.env` | `MCP_SERVER_RESOURCE_URI=<value>` | When set, `TokenIntrospector` rejects tokens whose `aud` claim does not include this value. Recommended: set to `MCP_RESOURCE_URL` in production. |
| **Auto-inject `may_act`** | Admin → Feature Flags → "Token Exchange" | Toggle **"Token Exchange — Auto-inject may_act"** | Demo-only. See Token Exchange section. |
| **Auto-inject audience** | Admin → Feature Flags → "Token Exchange" | Toggle **"Token Exchange — Auto-inject audience"** | Demo-only. See Token Exchange section. |

---

## References

- [`REGRESSION_PLAN.md`](../REGRESSION_PLAN.md) §2 — protocol alignment note; §4 bug log for remediation implementation entry.
- [MCP 2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Authorization (HTTP)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- Repo: `banking_mcp_server/src/server/MCPMessageHandler.ts`, `banking_mcp_server/src/server/BankingMCPServer.ts`, `banking_api_server/services/mcpWebSocketClient.js`

---

*Update this doc when protocol or code changes.*
