# LM Studio — default MCP servers

`mcp.json` is the canonical `~/.lmstudio/mcp.json` for this demo: the same doors the
AI Gateway client page (`/privilege-mcp-client`) offers, plus the Agent Gateway.

```bash
cp lmstudio/mcp.json ~/.lmstudio/mcp.json   # then restart LM Studio
```

| entry | door | auth |
|---|---|---|
| `ping-banking` | our banking MCP server (`oauth-mcp`) on the SE cluster | LM Studio's native OAuth (RFC 9728 → DCR → PKCE) |
| `agentless-mcpgw` | Privilege **agentless** gateway, `external` app (banking tools; see `privilege/AGENTLESS-CONFIGURATION.md`), through the recording façade | native OAuth (the façade points LM Studio at Privilege's AS) |
| `agent-mcpgw` | OpenSearch MCP **through the Privilege agent** (`cm-mcpgw` in K8s), through the recording façade | the installed macOS Privilege Agent — no prompt |
| `opensearch-direct` | the same OpenSearch MCP server, **bypassing Privilege** | none — needs a port-forward first (below) |
| `agent-gateway` | this repo's Agent Gateway (`demo_mcp_gateway`, local Docker :3005), through the recording façade | native OAuth via the gateway's broker (PR #2353) → PingOne login |

## The recording façade (movie reel)

Direct doors just work. The three doors that cross an authorization boundary
(`agent-gateway`, `agentless-mcpgw`, `agent-mcpgw`) go through the BFF's recording
façade, `http://localhost:3002/mcp-facade/<door>/mcp` (`demo_api_server/routes/mcpFacade.js`,
the client-agnostic half of `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md`).
It relays every call unchanged, records the hops on the transaction ledger, and appends one
extra block to every tool result:

```text
reel_url: https://localhost:4000/transaction-trace/embed/<correlationId>
```

(`MCP_FACADE_REEL_BASE` in `demo_api_server/.env` overrides the host — the embed page is
public, so it needs no special hostname and no `/etc/hosts` entry.)

LM Studio renders Markdown only (no embedded HTML — `docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md` §4),
so click that link: the page shows the hop-by-hop chain (identity, the gateway's real
P1AZ decision for `agent-gateway`, timing) plus the MCP side of the call — tools and
descriptions, resources (or "not advertised"), the request arguments and the raw response.
It keeps polling until the `response` hop lands, so open it as soon as the tool returns.

The façade is served over plain HTTP on `127.0.0.1:3002` on purpose: LM Studio's MCP bridge
is a Node process that does not trust the mkcert chain (`SELF_SIGNED_CERT_IN_CHAIN`, seen
live 2026-08-24), the listener is loopback-only, and every call carries the client's own
bearer. The same façade is also on the BFF's HTTPS port (`https://api.ping.demo:3001/mcp-facade/…`)
for containerized clients such as LibreChat.

`opensearch-direct` is ClusterIP-only in K8s, so open the tunnel before toggling it on:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80
```

(The local `mcpgw` compose profile publishes the same server on `:9900`, so the entry works there too.)
