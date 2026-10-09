# External-agent demo runbook — Muse, Grok, LM Studio, LibreChat, ChatGPT

**Story:** "You already have an agent. Point it at our bank's MCP endpoint.
Watch Ping govern it." The agent is the presenter's own install; every
governance surface is ours. Two lanes, same agent:

- **Standard lane** — agent → external door → PingGateway → PingOne Authorize → tool
- **Agent Privilege lane** — agent → facade `privilege-gateway` door → PingOne Agent Privilege → registered app

Setup steps per agent also live in the product: the learning hub at
`/external-agents/<agent>` (muse-app, muse-code, grok-app, grok-cli,
lm-studio, librechat, chatgpt) renders the same content from
`demo_api_ui/src/config/externalAgents.js` — this runbook and those pages
are kept in sync by the drift-guard test in
`demo_api_ui/src/config/__tests__/externalAgents.test.js`.

## The two doors

| Lane | URL (any MCP client's remote-server field) | Governed by |
|---|---|---|
| Standard (SE host — cloud AND local agents) | `https://cmuir-mcp.ping-devops.com/mcp` | PingGateway + PingOne Authorize (RFC 8693 chain, P1AZ, HITL, step-up) |
| Standard (local stack — local agents only) | `https://api.ping.demo:3036/mcp` | Same enforcement, local PingGateway |
| Agent Privilege (local BFF) | `https://localhost:3001/mcp-facade/privilege-gateway/mcp` | PingOne Agent Privilege (per-user policy; credential swapped at the facade) |

Wire facts (verified 2026-10-08, see
`docs/superpowers/plans/2026-10-08-agent-doors-verification.md`):

- The BFF serves **TLS** on 3001 — use `https://localhost:3001`, not http.
- The facade's OAuth broker paths are under `/oauth/*` on :3005
  (`/oauth/register`, `/oauth/authorize`, `/oauth/token`).
- Every MCP call after `initialize` needs the `MCP-Protocol-Version: 2025-11-25` header.
- Cloud agents (Muse app, Grok, ChatGPT) can only reach the SE host — never
  a laptop URL. Local agents reach both doors.

## Before the demo (once)

1. SE host (standard lane, all agents): confirm
   `curl -s https://cmuir-mcp.ping-devops.com/.well-known/oauth-protected-resource/mcp`
   returns the RFC 9728 document.
2. Local stack (lane 2 + local demos): `./run-docker.sh` (OrbStack, never
   Docker Desktop); confirm `curl -sk https://localhost:3001/mcp-facade/privilege-gateway/mcp -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`
   answers 401 with a `WWW-Authenticate: Bearer resource_metadata=...` challenge.
3. Keep the dashboard open on the second screen — the token chain, HITL and
   audit panels are the audience's view; the agent runs on yours.

## Demo steps (map to demo use cases)

| Step | You say/type in the agent | What the audience sees | Surface |
|---|---|---|---|
| Onboard | first tool use in any client | Browser opens: PingOne login → consent | Browser |
| Read (UC-MUSE1) | "Show my checking account balance" | Token chain: RFC 8693 exchange (sub=user, act=agent) → gateway → tool | Dashboard token-chain panel |
| Governed write (Muse Code leads; Grok CLI / LM Studio / LibreChat can run it) | "Transfer $500 to savings" | P1AZ evaluates → HITL pending → approve in dashboard → tool runs | Dashboard HITL panel |
| Lane 2 (UC-MUSE2) | Same read, pointed at the privilege-gateway door | Credential swap at the facade; per-user policy at the Agent Privilege | Dashboard + Privilege console |
| Step-up | Trigger MFA step-up case | Agent paused until MFA completes | Dashboard step-up surface |
| Audit | Any call | Correlation id, decision, sub/act in the audit trail | Dashboard audit panel |
| Governance is structural | (demo only, no client) A service-identity token is refused `accounts:read` — user data requires the real login | `Insufficient scope` on `get_my_accounts` with a CC token | curl probe, live-verified |

## Per-client setup

### Muse Code (CLI, local) — the full two-lane demo
- Install: `curl -fsSL https://dev.meta.ai/install.sh | sh`
- Settings → mcp_servers:
```json
{ "mcp_servers": { "demo-bank": {
    "transport": "streamable_http",
    "url": "https://cmuir-mcp.ping-devops.com/mcp",
    "mode": "optional" } } }
```
- First tool use triggers OAuth: browser opens, PingOne login, callback to 127.0.0.1.
- Verified behaviors: ⏳ [paste from the verification matrix]

### Muse (consumer app — cloud)
- Runs in Meta's cloud; **cannot reach the local stack**. Use the SE host.
- In Muse, prompt (custom connector): "Build a custom integration. Its MCP
  server is `https://cmuir-mcp.ping-devops.com/mcp`, transport streamable HTTP.
  Connect, inspect the tools, request credentials through the secure credential
  flow, and keep approval required for anything that writes or spends."
- The OAuth browser step opens on the phone/web; whether Muse completes our
  RFC 9728 + DCR + PKCE dance is the open matrix cell. Fallback: pre-minted
  Bearer via the credential flow (governance intact; login out-of-band).
- Verified behaviors: ⏳ [paste]

### Grok (app custom connector)
- Grok → Connectors → New Connector → Custom → paste the MCP URL → complete
  the auth flow (browser OAuth). Public URL required: use the SE host, not the
  local stack.
- If DCR is unsupported (xAI does not document it): pre-register a client via
  `curl -X POST https://cmuir-mcp.ping-devops.com/register ...` and hand the
  fixed client_id/secret to the connector UI, or mint a Bearer from a
  pre-registered client and use xAI's Remote MCP API shape
  (`authorization: "Bearer ..."`).
- Verified behaviors: ⏳ [paste]

### Grok CLI (local)
- Remote HTTP MCP with browser OAuth on first use; credentials persist in
  `~/.grok/mcp_credentials.json`.
- Verified behaviors: ⏳ [paste]

### LM Studio (local)
- Connectors → Add MCP → remote URL (standard lane URL above; lane 2:
  `https://localhost:3001/mcp-facade/privilege-gateway/mcp`).
- Known quirk: LM Studio falls back to SSE on any non-`UnauthorizedError` — the
  doors answer GET deliberately, so use POST-based connect.
- Verified behaviors: ⏳ [paste]

### LibreChat (local)
- `librechat/` in-repo; add the door as a remote MCP server in `librechat.yaml`:
```yaml
mcpServers:
  demo-bank:
    type: streamable_http
    url: https://cmuir-mcp.ping-devops.com/mcp
```
- Lane 2: second entry with `url: https://localhost:3001/mcp-facade/privilege-gateway/mcp`.
- Verified behaviors: ⏳ [paste]

### ChatGPT (cloud)
- Connectors require a publicly reachable URL: the SE host (or a tunnel for
  the local stack); record in the matrix which works. ⏳ [paste verified setup]

## Talking points

- "Any spec-compliant agent works — we didn't pre-register any of them. DCR did it live."
- "The agent has no keys of its own. Its authority is minted per call by RFC 8693."
- "Two lanes, one trust layer: our gateway or the Agent Privilege — the external agent is governed either way."
- "When the action is sensitive, the agent stops. The human approves in the bank's UI — the trust boundary is Ping, not the agent."
- "Kill the agent's token in Agent Governance and the same tool call is denied — governance outlives the agent."

## Failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| Client shows not connected | Stack down or TLS not trusted | `./run-docker.sh`; trust mkcert root CA |
| Empty reply on localhost:3001 | Plain http instead of https | The BFF serves TLS — use `https://localhost:3001` |
| Unknown endpoint on register/token | Bare paths used | The broker is under `/oauth/*` on :3005 |
| Missing MCP-Protocol-Version error | Header absent after initialize | Send `MCP-Protocol-Version: 2025-11-25` on every call |
| Browser login loops | Callback port blocked | Re-run the client's OAuth (LM Studio: remove + re-add connector) |
| Agent Privilege lane 503 after BFF restart | Gateway leg dropped with the session | Re-authenticate the door from the client (config unchanged — by design) |
| Tool call 401s mid-demo | Token expired | Clients auto-refresh; if not, reconnect the connector |
| HITL approval never appears | HITL service down | `docker logs` the hitl service; restart it |
