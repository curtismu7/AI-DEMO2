# Mac MCP Clients for the "External Door" Use Case — Plan & Client Report

**Scope:** which macOS-capable MCP clients (commercial, open source, and our own) can act as the "front door" into AI-DEMO2's MCP servers across **both** required paths:

1. **Agent Gateway path** — the repo's own Node `demo_mcp_gateway` (or its PingGateway/IG variant), which fronts `oauth-mcp` / `demo_mcp_resource_server`.
2. **Privilege path** — PingOne Privilege Cloud's MCP Gateway ("mcpgw" / AI Gateway), agent-mode or agentless-mode.

## TL;DR

**No client — ours or third-party — currently speaks to both doors.** The two paths use fundamentally different transports and auth models, and closing that gap is a small, targeted fix, not a client-shopping problem:

- The Agent Gateway's **default transport is raw WebSocket**, which is not part of the MCP spec. That alone disqualifies *every* commercial and open-source client in this survey (Claude Desktop, Claude Code, ChatGPT, Cursor, VS Code/Copilot, Windsurf, Zed, LibreChat, 5ire, Goose, Cline, Continue) — none of them speak MCP-over-WebSocket. Only our own `langchain_agent` client does, because it was hand-built for this gateway.
- The gateway *can* run in Streamable HTTP mode, or you can front it with the PingGateway/IG variant (already HTTP), which brings it into range of every modern client — provided the client can carry a PingOne bearer token with the right audience (RFC 8707) claim. That's the one config change that turns this from "no client works" into "most modern clients work."
- The Privilege path is close to standard already: **agentless mode is plain OAuth 2.0 Authorization Code + PKCE + client_secret_basic**, which is exactly what Cursor, Zed, VS Code/Copilot, Claude Desktop, and Claude Code all support natively. **Agent mode** needs the PingOne Privilege macOS agent installed (Secure Enclave device identity) — auth is then transparent to whatever MCP client you point at it, since it's just HTTPS Streamable HTTP underneath.
- Our own `mcp-demo-client-for-privilige-main 2` already proves the Privilege agentless path end-to-end but doesn't touch the Agent Gateway. Our `langchain_agent` MCPConnection already proves the Agent Gateway path (WS + HTTP, PingOne bearer, audience binding) but doesn't touch Privilege, and its own code currently hard-rejects any URL that isn't `wss://`/`local://` in production — so it would reject the Privilege HTTPS endpoint even if you tried.

## Plan

1. **Decide the Agent Gateway's public transport.** Either (a) switch its default to Streamable HTTP / route through PingGateway (already HTTP), or (b) accept that only our own WS-aware client can reach it. (a) is what unlocks every off-the-shelf client below — recommended.
2. **Pick one client to prove both doors** rather than surveying forever. Best current candidates, in order of native fit: **Cursor**, **Zed**, or **VS Code + GitHub Copilot Chat** — all have native OAuth 2.1+PKCE and Streamable HTTP, no self-signed-cert restriction, and support pre-registered (confidential) OAuth clients, which matches how PingOne apps are registered (no dynamic client registration in this stack).
3. **Test Privilege-agentless first** — it's the closer-to-standard path. Point the chosen client at `https://cmuir-agentless-mcpgw.ping-devops.com/<app>/mcp` with the PingOne OAuth client id/secret from `pingone.env`.
4. **Test Agent Gateway second**, once it's in HTTP mode — same client, second server entry, PingOne bearer token with the `MCP_GW_RESOURCE_URI` audience. DPoP (`REQUIRE_DPOP_PROOF`) is parked/off today — leave it off for this test; turning it on later will break every client below, since none currently implement DPoP.
5. **If one client working both doors isn't enough** and you specifically need *our own* client to do it: the smallest code lift is extending `langchain_agent`'s `MCPConnection` (it already understands PingOne bearer + audience binding + both WS/HTTP transports) to (a) accept the Privilege OAuth PKCE flow and (b) drop its `wss://`/`local://`-only production allowlist for the Privilege host — versus adding Agent-Gateway-style PingOne auth to `mcp-demo-client-for-privilige`, which currently has none.
6. **Do not re-enable `AGENT_GATEWAY_URL`** as a workaround for a client that can't do OAuth — `REGRESSION_PLAN.md:4281-4303` flags that legacy HTTP path as deliberately dead because it bypasses PingOne Authorize tool filtering.

## The two front doors, as they exist today

| | Agent Gateway path | Privilege path |
|---|---|---|
| **Service** | `demo_mcp_gateway` (Node, `demo_mcp_gateway/src/index.ts`) or PingGateway/IG variant (`ping-gateway/`, flag `ff_mcp_gateway_pinggateway`) | PingOne Privilege Cloud MCP Gateway ("mcpgw"), agent or agentless mode |
| **Default transport** | **WebSocket** (`demo_mcp_gateway/src/config.ts:289`, port 3005) — not an MCP-spec transport | Streamable HTTP |
| **Alt transport** | Streamable HTTP (`MCP_TRANSPORT=streamable_http`), or plain HTTPS via PingGateway (port 3036, now HTTPS) | n/a |
| **Endpoint (agentless)** | ws(s)://…:3005 or https://…:3036 | `https://cmuir-agentless-mcpgw.ping-devops.com/<app>/mcp` |
| **Endpoint (agent mode)** | n/a | `https://opensearch.default.applications.procyon.ai:8643/mcp` |
| **Client-side auth** | PingOne bearer token, RFC 8707 audience binding (`MCP_GW_RESOURCE_URI`), optional DPoP (parked, off by default) | Agentless: OAuth2 Auth Code + PKCE (S256) + `client_secret_basic`. Agent-mode: **none** — handled transparently by the installed macOS Privilege Agent (Secure Enclave identity) |
| **Server-side (not client-visible)** | RFC 8693 token exchange to backend audience, PingOne Authorize (P1AZ) decision per tool call | RBAC policy, routes to `oauth-mcp`'s `mcp-server` |
| **Known gaps** | Legacy `AGENT_GATEWAY_URL` HTTP path deliberately disabled (bypasses Authorize) — `REGRESSION_PLAN.md:4281-4303` | The 2026-08-10 end-to-end console-token proof ran on the *old* `cyonproxy` binary, not the current `mcpgw` binary — not yet re-verified (`.claude/skills/privilege-cloud-mcp/SKILL.md:23-56`) |

## Compatibility matrix

`✅` native fit · `⚠️` works with config/caveats · `❌` blocked · `❓` unverified, needs a live test

| Client | macOS | Agent Gateway (WS, default) | Agent Gateway (HTTP mode) | Privilege — agentless (OAuth+PKCE) | Privilege — agent mode |
|---|---|---|---|---|---|
| **Claude Desktop** | native app | ❌ no WS transport | ⚠️ OAuth client id/secret fields exist, but Custom Connector UI **rejects self-signed certs** — needs a publicly trusted cert on the gateway URL | ⚠️ should work; verify the Procyon/gateway domain's cert is a trusted CA, not a demo cert | ⚠️ transport-wise fine (plain HTTPS); same cert caveat |
| **Claude Code (CLI)** | native | ❌ no WS transport | ⚠️ HTTP/streamable-http supported; static bearer header possible as a manual stopgap | ✅ OAuth for remote MCP supported | ✅ plain HTTPS, no client auth needed |
| **ChatGPT Desktop** | native | ❌ | ❌ no machine-credential/static-token entry; connector setup is beta, Plus/Pro only | ⚠️ Auth Code+PKCE is user-delegated (not the M2M grant ChatGPT blocks), but ChatGPT's connector flow expects DCR-style registration, not a pre-registered confidential client — **known bug**: connectors have shown "OAuth-supported" then failed to complete connect ([GitHub #20296](https://github.com/twentyhq/twenty/issues/20296)) | ❓ same connector-setup uncertainty |
| **Cursor** | native | ❌ | ⚠️ static headers supported as a stopgap for a fixed bearer token | ✅ native OAuth 2.1+PKCE since v1.0; **known bug**: redirect URI changed from `cursor://` to `http://localhost` for Streamable HTTP MCP — verify against whatever redirect_uri the PingOne app has registered ([forum report](https://forum.cursor.com/t/oauth-redirect-uri-changed-from-cursor-to-http-localhost-for-streamable-http-mcp/165019)) | ✅ plain HTTPS |
| **VS Code + GitHub Copilot Chat** | native | ❌ | ⚠️ static headers / preregistered OAuth client id + secret storage (added June 2026) | ✅ good fit for a confidential client like PingOne's | ✅ plain HTTPS |
| **Windsurf (Cascade)** | native | ❌ | ❓ | ❓ native MCP support added early 2026; specific OAuth/transport claims in vendor docs weren't independently confirmed — test directly before relying on this | ❓ |
| **Zed** | native | ❌ | ❓ | ✅ robust OAuth 2.1+PKCE: auto-detects 401, does discovery, browser flow, persists token in Keychain | ✅ plain HTTPS |
| **LibreChat** (open source) | via Docker/browser | ❌ out of the box | ❓ open source — could be patched to add WS or custom bearer/audience handling, but no evidence this exists out of the box | ❓ | ❓ |
| **5ire** (open source) | native | ❌ | ❓ config-file/CLI/UI server config exists; no confirmed OAuth support found | ❓ | ❓ |
| **Goose** (open source, Block) | native/CLI | ❌ | ❓ no OAuth/transport specifics confirmed in this pass | ❓ | ❓ |
| **Cline** (VS Code ext, open source) | via VS Code | ❌ | ❓ separate MCP client implementation from VS Code's native one — don't assume it inherits VS Code's OAuth support; verify directly | ❓ | ❓ |
| **Continue** (VS Code/JetBrains ext, open source) | via VS Code | ❌ | ❓ same caveat as Cline | ❓ | ❓ |
| **Our own — `langchain_agent` `MCPConnection`** | Python, runs on Mac | ✅ purpose-built for this: WS default, HTTP mode supported, PingOne bearer + RFC 8707 audience binding | ✅ | ❌ **not implemented** — no Privilege OAuth PKCE code path, and production settings reject any URL that isn't `wss://`/`local://` (`langchain_agent/src/settings.py:580-594`) — would need code changes | ❌ same reason |
| **Our own — `mcp-demo-client-for-privilige-main 2`** | Node, runs on Mac | ❌ **not implemented** — no PingOne bearer/audience/token-exchange handling for this path | ❌ | ✅ purpose-built: OAuth2 PKCE relay with local callback, standalone, not wired into docker-compose | ❓ untested against agent mode specifically |

## Why mTLS and DPoP aren't the deciding factor (yet)

Two auth mechanisms sometimes discussed for these gateways are mostly moot for client selection right now:

- **mTLS client certificates**: not supported by any mainstream MCP client surveyed. Claude Code has an *open feature request* for it ([anthropics/claude-code#9869](https://github.com/anthropics/claude-code/issues/9869)) — i.e., confirmed absent, not just undocumented. If either front door starts requiring client certs, this list of viable clients shrinks to none.
- **DPoP**: `REQUIRE_DPOP_PROOF` on the Agent Gateway is parked/off (see prior PKCE-hardening-backlog decision), and no client surveyed here advertises DPoP support. Leave it off for client compatibility testing; flipping it on later is a breaking change for every client in this table.

## Recommendation

Start with **Cursor or Zed** against **Privilege-agentless** — that's the pairing with the fewest open questions (native OAuth+PKCE, no cert restrictions, no beta/Developer-Mode gates). In parallel, flip the Agent Gateway to HTTP mode (or route through PingGateway, which already is HTTP) so the same client can be pointed at it as a second server entry with a bearer token. That proves "one real MCP client, both doors" without writing new client code. Only invest in extending `langchain_agent` or `mcp-demo-client-for-privilige` if the goal is specifically an *in-repo* client that covers both paths (e.g., for automated testing) rather than a general-purpose desktop client for people to use.

---
*Sources for third-party client claims (web research, August 2026):*
- [Get started with custom connectors using remote MCP — Anthropic](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP and Connectors — OpenAI API docs](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [ChatGPT Apps OAuth connect flow does not complete — GitHub issue #20296](https://github.com/twentyhq/twenty/issues/20296)
- [MCP Authentication in Cursor — TrueFoundry](https://www.truefoundry.com/blog/mcp-authentication-in-cursor-oauth-api-keys-and-secure-configuration)
- [Cursor OAuth redirect URI change — Cursor forum](https://forum.cursor.com/t/oauth-redirect-uri-changed-from-cursor-to-http-localhost-for-streamable-http-mcp/165019)
- [GitHub Copilot in VS Code, June 2026 releases](https://github.blog/changelog/2026-07-08-github-copilot-in-visual-studio-code-june-2026-releases/)
- [MCP remote server OAuth authentication — Zed PR #51768](https://github.com/zed-industries/zed/pull/51768)
- [Support mTLS Client Certificates for SSE MCP Transport — anthropics/claude-code#9869](https://github.com/anthropics/claude-code/issues/9869)
- Internal: `demo_mcp_gateway/src/index.ts`, `demo_mcp_gateway/src/config.ts`, `demo_mcp_gateway/.env.example`, `ping-gateway/README.md`, `privilege/AGENT-CONFIGURATION.md`, `privilege/AGENTLESS-CONFIGURATION.md`, `.claude/skills/privilege-cloud-mcp/SKILL.md`, `langchain_agent/src/mcp/connection.py`, `langchain_agent/src/settings.py`, `mcp-demo-client-for-privilige-main 2/server.js`, `REGRESSION_PLAN.md`
