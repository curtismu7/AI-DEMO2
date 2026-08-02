# MCP Server — Spec Compliance & Best-Practices Status

_Last updated: 2026-06-11. Covers the MCP server hardening + local-LLM work landed on `main` this session._

## Summary

Audited `demo_mcp_server` (+ `demo_mcp_resource_server`) against the MCP spec (2025-11-25) and
industry best practices (Anthropic / OpenAI / xAI), then shipped a series of small,
verified, reviewed PRs. Also wired **Ollama (Qwen3-8B)** as a local LLM provider across
all three agent stacks.

**Test baseline:** `demo_mcp_server` full suite has **53 pre-existing failures** (live-PingOne
integration tests that fail without a tenant). Every PR below was verified to keep that exact
baseline — **zero new failures** — plus added tests.

---

## Shipped to `main`

| PR | Title | Status |
|----|-------|--------|
| #162 | Ollama local LLM provider (Qwen3-8B, native tool-calling) | ✅ merged |
| #162 | JWKS sig verification, fail-closed aud, locked-down token-exchange, version negotiation | ✅ merged |
| #164 | Streamable HTTP transport spec gaps + orphan-session cleanup + tool annotations + enum/pattern validation | ✅ merged |
| #165 | Crypto-random session IDs + stop leaking internal error text | ✅ merged |
| #166 | Publish `authChallenge` under `result._meta` (dual-emit, PR1/2) | ✅ merged |
| #167 | Drop the `content[]` authChallenge mirror — `_meta` only (PR2/2) | ✅ merged |

### Local LLM (Ollama)
- Installed Ollama + `qwen3:8b` (brew service, `127.0.0.1:11434`). Verified native tool-calling.
- Wired as a first-class `ollama` provider: Node reasoning service (`@langchain/ollama`), BFF
  resolver/status/model-config, UI (`ProviderSelector` + `OllamaPanel` + `PROVIDER_OPTIONS`),
  Python agent (`llm_factory` + per-run override). Use `127.0.0.1` (not `localhost`).

### Security / spec fixes
- **JWKS signature verification** at the inbound trust boundary (`TokenIntrospector` + invest
  server) — forged tokens previously passed. Fail-closed when JWKS configured; shared
  `auth/jwks.ts`.
- **Fail-closed audience validation** (RFC 8707) — missing `aud` now rejected.
- **`/auth/token-exchange` locked down** — disabled (404) unless `MCP_TOKEN_EXCHANGE_SECRET`
  set, then timing-safe header.
- **Protocol-version negotiation** counter-offers the latest supported version instead of erroring.
- **Streamable HTTP transport gaps**: Accept-header validation (406), `MCP-Protocol-Version`
  value check, bearer-auth-before-notification, auth on GET/DELETE `/mcp`, idle session TTL
  (`MCP_HTTP_SESSION_TTL_MS`, no background timer), and banking-session cleanup on teardown.
- **Spec tool annotations** in `tools/list` (`readOnlyHint`/`destructiveHint`/`idempotentHint`/
  `openWorldHint`/`title`); custom `userFacing` block preserved for the Python agent.
- **Input validation** now enforces JSON-Schema `enum` and `pattern` (previously ignored).
- **Crypto-random session IDs** (`randomBytes` instead of `Math.random()`).
- **No internal error-text disclosure** — generic client messages; detail stays in server logs.
- **`authChallenge` → `result._meta.authChallenge`** (expand/contract over PRs #166/#167):
  tool-result `content[]` items are now spec-clean `{ type, text }`; the OAuth challenge lives
  solely under the spec's `_meta` extension slot. `BankingToolResult` remains the owner of the
  provider-side `success`/`error`/`authChallenge` fields.

---

## What's intentionally NOT changed

- **Token visibility in logs** — intentional for this teaching demo (per project memory). Left as-is.
- **Weak-random log-correlation tags** (`tx_`/`err_`/`audit_` ids, retry jitter) — not credentials.

## Remaining backlog (not yet done)

| Item | Why deferred |
|------|--------------|
| `structuredContent` + `outputSchema` | Real feature work — needs `outputSchema`s defined and tool handlers emitting structured data (touches `BankingToolProvider`). |
| Migrate hand-rolled `BankingToolValidator` → the unused `jsonschema` dep | Closes remaining nested-object / array-`items` validation gaps in one move instead of extending the bespoke validator. |
| Rate limiting on `tools/call` | `RATE_LIMITED` (-32008) + 429 mapping exist but no limiter. Additive best-practice; deferred (a demo isn't under attack; over-aggressive limits could surprise live demos). |
| JSON-RPC `id` fabrication (`?? 'unknown'`) | Effectively dead (nullish coalescing handles `0`; real requests always carry an id). Low value. |
| Adopt the official `@modelcontextprotocol/sdk` for the transport | Large refactor of load-bearing custom auth/gateway/teaching code; chose to close the spec gaps in the custom transport instead (#164). WebSocket isn't a sanctioned transport, so the HTTP path is the interop surface. |

---

## Key references
- Skill: `.claude/skills/mcp-server/SKILL.md`
- Servers: `demo_mcp_server/` (banking, :8080), `demo_mcp_resource_server/` (:8081)
- Consumers of MCP tool results: `demo_api_server/services/mcpToolPipeline.js` (BFF),
  `langchain_agent/src/agent/mcp_tool_provider.py` (Python agent), `HttpMCPTransport` (403 promotion).
