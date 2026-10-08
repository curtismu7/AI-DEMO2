# Agent-doors verification matrix

Filled per `docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md` Task 1.
Machine-side probes done by Claude (2026-10-08); app-side cells await the real
apps and are marked ⏳. A ⛔ cell means "stop that cell; new investigation."

## Standard lane — external door

### SE cluster (`https://cmuir-mcp.ping-devops.com`) — machine-verified 2026-10-08

| Check | Result |
|---|---|
| RFC 9728 `/.well-known/oauth-protected-resource/mcp` | ✅ 200, correct document |
| RFC 8414 `/.well-known/oauth-authorization-server` | ✅ 200; issuer, DCR, `client_id_metadata_document_supported: true` |
| DCR (RFC 7591) | ✅ live: 3 clients registered via curl, client_id+secret minted |
| `/authorize` | ✅ 302 → PingOne (PKCE S256, `resource=enduser.ping.demo`, `max_age=1800`) |
| MCP streamable HTTP | ✅ initialize → session → `tools/list` = 9 tools (curation active); requires `MCP-Protocol-Version: 2025-11-25` header |
| Scope governance (service token) | ✅ CC token gets `mcp:invoke read openid`; refused `accounts:read` — `get_my_accounts` → clean `Insufficient scope` error (`requiredScopes: ["accounts:read"]`) |
| `create_transfer` array-scope fix (#984) | ✅ deployed (pod rolled 17:19Z past the 15:53Z image) |

### Local stack (`https://api.ping.demo:3036`) — machine-verified 2026-10-08

| Check | Result |
|---|---|
| RFC 9728 + RFC 8414 | ✅ 200 both |
| Door behavior | ✅ tokenless POST /mcp → 401 (challenge correct) |

## AI Gateway lane — facade `privilege-gateway` door

### Local stack (`https://localhost:3001`) — machine-verified 2026-10-08

> **Note:** the BFF serves TLS on 3001 (container port named `https`); the
> plan's original `http://localhost:3001` URL was wrong — use `https`.

| Check | Result |
|---|---|
| POST initialize (tokenless) | ✅ 401 with Host-derived `resource_metadata="https://localhost:3001/mcp-facade/privilege-gateway/.well-known/oauth-protected-resource"` |
| Protected-resource metadata | ✅ `resource=https://localhost:3001/...`, `authorization_servers=["http://localhost:3005"]` |
| Broker AS metadata (:3005) | ✅ 200; endpoints under `/oauth/*` (`/oauth/register`, `/oauth/authorize`, `/oauth/token`) — NOT bare `/register` |
| Broker DCR | ✅ live: clients registered, client_id+secret minted |
| Broker `/oauth/authorize` | ✅ 302 → PingOne federation (PKCE, `resource=mcpgateway.ping.demo`, scope `openid read mcp:invoke`) |
| Broker client_credentials | ⛔ refused (`unsupported_grant_type`), even for CC-registered clients; AS metadata advertises `authorization_code` only — **by design** (facade broker is the human sign-in model per the LM Studio spec). Local lane-2 verification must use the browser PKCE flow; no service-token shortcut |
| SE cluster facade | ⏳ blocked on ingress (see plan "SE facade exposure") — the deployed SE BFF has the routes (in-cluster probe: 401 + correct challenge) but `ai-demo-ingress` 302s `/mcp-facade/*` to the frontend OAuth wall |

## Per-client cells (need the real apps)

| Client | Standard lane | AI Gateway lane | Notes to capture on test |
|---|---|---|---|
| Muse (consumer app) | ⏳ connect + read — OAuth-discovery compatibility is the open question | ⏳ (needs SE ingress) | discovery URL constructed; whether Sentinel completes DCR+PKCE; redirect shape |
| Muse Code (CLI) | ⏳ connect + read + governed write | ⏳ | `mcp_servers` config; token-endpoint auth method; HITL pause behavior |
| Grok (app connector) | ⏳ connect + read — DCR-vs-fixed-client is the open question | ⏳ (needs SE ingress) | whether Grok self-registers or demands fixed credentials |
| Grok CLI | ⏳ connect + read | ⏳ | browser OAuth on first use; `~/.grok/mcp_credentials.json` |
| LM Studio | ⏳ re-verify (proven 2026-09-11) | ⏳ re-verify (proven 2026-09-11) | SSE-fallback behavior |
| LibreChat | ⏳ connect + read | ⏳ | `librechat.yaml` shape |
| ChatGPT | ⏳ connect + read (SE host or tunnel) | ⏳ (needs SE ingress) | reachable-host setup that works |

## Wire facts every client will hit (from the probes above)

- External door: `MCP-Protocol-Version: 2025-11-25` header required on every call after initialize.
- Facade broker paths are `/oauth/*` (register/authorize/token/callback) — not bare.
- Local facade URL is **https**://localhost:3001 (TLS); challenge URLs follow the request Host automatically.
- Service tokens never see user data: `accounts:read` requires the delegated user token on both doors — the governance story is structural.
- Local broker: authorization_code only. SE external door: authorization_code + client_credentials.
