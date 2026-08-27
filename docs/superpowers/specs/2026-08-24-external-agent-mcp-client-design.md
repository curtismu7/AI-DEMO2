# External-Agent MCP Client — dual front-door support

**Date:** 2026-08-24
**Status:** Design approved, implementation not started
**Related:** `docs/mcp/MAC_MCP_CLIENTS_EXTERNAL_DOOR_REPORT.md` (PR #2330) — the survey that motivated this. That report found no client, ours or third-party, speaks to both the Agent Gateway and Privilege front doors. This design closes that gap for our own client.

## 1. Why this exists

AI-DEMO2 has two "front doors" an external MCP client can use to reach the banking tools:

1. **Agent Gateway path** — `demo_mcp_gateway` (Node), default transport raw WebSocket, alt Streamable HTTP / PingGateway HTTP. Auth: PingOne bearer token with RFC 8707 audience binding.
2. **Privilege path (agentless mode)** — PingOne Privilege Cloud's MCP Gateway. Auth: OAuth 2.0 Authorization Code + PKCE + `client_secret_basic`, streamed over HTTP.

`langchain_agent`'s `MCPConnection` (`langchain_agent/src/mcp/connection.py`) already speaks the Agent Gateway path — WS and HTTP transports, PingOne bearer, audience binding — but has no Privilege support, and its production settings (`langchain_agent/src/settings.py:580-594`) hard-reject any URL that isn't `wss://` or `local://`, so it would reject the Privilege HTTPS endpoint outright.

`mcp-demo-client-for-privilige-main 2` speaks Privilege agentless (OAuth PKCE relay) but has no Agent Gateway support and isn't wired into docker-compose.

Neither can act as a single "external agent" that reaches both doors.

### Non-goals

- **Privilege agent-mode** (the `applications.procyon.ai:8643` endpoint, auth handled transparently by the installed macOS Privilege Agent with Secure Enclave device identity). That's a separate machine-level prerequisite, not something client code negotiates — out of scope here.
- **DPoP / mTLS.** Both remain parked/unsupported per the existing PKCE-hardening backlog; not part of this work.
- **`mcp-demo-client-for-privilige`.** Left untouched. This design extends `langchain_agent`'s client instead (see §3 for why).
- **A full agent/LLM chat loop.** The deliverable proves the MCP wire connection and tool-call round trip, not a LangGraph-style conversational agent.
- **Persistent token storage.** The Privilege OAuth token lives in memory for the CLI process's lifetime only, matching how `mcp-demo-client-for-privilige` already handles it. No new secrets-at-rest surface.

## 2. Role mapping

| Component | Role |
|---|---|
| `langchain_agent/src/mcp/connection.py` | Existing `MCPConnection` / `StreamableHttpMCPConnection` (Agent Gateway) + new `PrivilegeMCPConnection` |
| `langchain_agent/src/mcp/privilege_auth.py` (new) | OAuth Authorization Code + PKCE flow for the Privilege path |
| `langchain_agent/src/settings.py` | New `MCP_FRONT_DOOR` switch + Privilege config block + explicit allowlist entry for the Privilege agentless host |
| `langchain_agent/src/external_client.py` (new) | Standalone CLI — the actual "external agent" a person runs |

## 3. Why extend `MCPConnection` instead of `mcp-demo-client-for-privilige`

`MCPConnection` already implements the harder half of this problem: PingOne bearer handling, RFC 8707 audience binding, and dual WS/HTTP transport support, all specifically built for this gateway's quirks. Privilege's auth model is standard OAuth 2.0 Auth Code + PKCE — a well-understood, one-time addition. Going the other direction (teaching the standalone Node relay about PingOne's bearer/audience scheme) means re-deriving logic that already exists and is tested in `langchain_agent`. The smaller, better-understood addition wins.

## 4. Architecture

One client, one new config switch:

```
MCP_FRONT_DOOR = agent_gateway | privilege_agentless
```

- `agent_gateway` (default, unchanged behavior): existing `MCPConnection`/`StreamableHttpMCPConnection`, WS or HTTP transport, PingOne bearer token supplied via existing config/env — no behavior change.
- `privilege_agentless` (new): `PrivilegeMCPConnection`, Streamable HTTP only, bearer token obtained via an interactive OAuth PKCE flow at startup, then behaves identically to the existing connection classes for the MCP session itself (`initialize` → `tools/list` → `tools/call`).

A factory in `connection.py` picks the class based on `MCP_FRONT_DOOR`. No shared state between the two paths beyond the common MCP session/transport plumbing they already share.

## 5. Components

### 5.1 `privilege_auth.py` (new)

- Generates a PKCE `code_verifier`/`code_challenge` (S256) pair per run.
- Opens the system default browser to the PingOne Privilege agentless authorize URL (client id, redirect URI, scope, state, PKCE challenge from config).
- Starts a local HTTP server on a loopback port to catch the OAuth redirect (mirrors `mcp-demo-client-for-privilige`'s local-callback pattern; port configurable, not hardcoded to that tool's `33418` to avoid collision if both run side by side).
- Exchanges the authorization code for a token via `client_secret_basic` against the token endpoint from `pingone.env`.
- Returns the access token (and expiry) to the caller; no disk persistence. A second `tools/call` in the same process reuses the cached token if still valid; a new process re-authenticates.

### 5.2 `connection.py` (edited)

- Add `PrivilegeMCPConnection`, structurally parallel to the existing `StreamableHttpMCPConnection`, differing only in how it obtains its bearer token (via `privilege_auth.get_token()` instead of the existing PingOne-bearer/audience-binding path) and its target host.
- Existing classes and their tests are untouched.

### 5.3 `settings.py` (edited)

- New settings block: `PRIVILEGE_MCP_URL`, `PRIVILEGE_CLIENT_ID`, `PRIVILEGE_CLIENT_SECRET`, `PRIVILEGE_REDIRECT_URI`, `PRIVILEGE_SCOPE`, sourced the same way existing Privilege env vars are (per-service `.env`, not root — established convention in this repo).
- The production URL-scheme allowlist (`settings.py:580-594`) gets **one explicit addition**: the specific Privilege agentless host, not a wildcard relaxation of the `wss://`/`local://` restriction. This preserves the existing hardening intent for every other URL.

### 5.4 `external_client.py` (new)

- Thin CLI: reads `MCP_FRONT_DOOR`, instantiates the matching connection class, runs `initialize` → `tools/list`, and optionally `tools/call <tool> <json-args>` from CLI args.
- This is the "external agent" — the thing a person actually runs to prove (or use) the connection.

## 6. Data flow

**Agent Gateway (unchanged):** CLI/service starts → `MCPConnection` connects (WS or HTTP) → attaches existing PingOne bearer token → MCP session proceeds.

**Privilege (new):** CLI starts with `MCP_FRONT_DOOR=privilege_agentless` → `PrivilegeMCPConnection.connect()` → check in-memory token cache → if empty/expired, run the PKCE flow (browser opens, user authenticates at PingOne, redirect hits the loopback server, code exchanged for token) → attach bearer token to Streamable HTTP requests → same MCP session logic as the Agent Gateway path from that point on.

## 7. Error handling

- PKCE callback timeout (no redirect within a bounded window, e.g. 120s): fail with a clear message, no partial/half-authenticated state left behind.
- Token exchange failure (bad client secret, redirect_uri mismatch): surface the authorization server's error response directly — don't swallow or generic-ify it.
- Invalid `MCP_FRONT_DOOR` value: fail fast at startup, before any connection attempt.
- Everything on the existing Agent Gateway path: unchanged, no new error handling needed.

## 8. Testing

- **Unit** (pure functions, no network): PKCE `code_verifier`/`code_challenge` generation, token-cache expiry logic in `privilege_auth.py`.
- **Manual/integration proof (phase-1 "done"):** run `external_client.py` twice against the live demo stack — once with `MCP_FRONT_DOOR=agent_gateway`, once with `MCP_FRONT_DOOR=privilege_agentless` — same code, only the env/config changes between runs. Both must return real data from a live banking tool call (`get_my_accounts`, Super Sports vertical per this repo's default-vertical convention).
- No changes to existing Agent Gateway tests. New tests scoped to `privilege_auth.py` and `external_client.py` only.

## 9. Open questions for the implementation plan

- Exact loopback port for the Privilege callback server (must not collide with `mcp-demo-client-for-privilige`'s `33418` if both could run concurrently on a dev machine).
- Whether `external_client.py` needs its own `--help`/argument parsing conventions or should match an existing CLI pattern already used elsewhere in `langchain_agent/`.
