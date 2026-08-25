# LM Studio — default MCP servers

`mcp.json` is the canonical `~/.lmstudio/mcp.json` for this demo: the same doors the
AI Gateway client page (`/privilege-mcp-client`) offers, plus the Agent Gateway.

```bash
cp lmstudio/mcp.json ~/.lmstudio/mcp.json   # then restart LM Studio
```

| entry (shown as `mcp/<entry>` in LM Studio) | door | auth |
|---|---|---|
| `MCP Direct-Banking` | our banking MCP server (`oauth-mcp`) on the SE cluster | LM Studio's native OAuth (RFC 9728 → DCR → PKCE) |
| `MCP Agentless-Banking` | Privilege **agentless** gateway, `external` app (banking tools; see `privilege/AGENTLESS-CONFIGURATION.md`), through the recording façade | native OAuth (the façade points LM Studio at Privilege's AS) |
| `MCP Agent-OpenSearch` | OpenSearch MCP **through the Privilege agent** (`cm-mcpgw` in K8s), through the recording façade | the installed macOS Privilege Agent — no prompt |
| `MCP Direct-OpenSearch` | the same OpenSearch MCP server, **bypassing Privilege** | none — needs a port-forward first (below) |
| `MCP AgentGateway-Banking` | this repo's Agent Gateway (`demo_mcp_gateway`, local Docker :3005), through the recording façade | native OAuth via the gateway's broker (PR #2353) → PingOne login |

## The recording façade (movie reel)

Direct doors just work. The three doors that cross an authorization boundary
(`MCP AgentGateway-Banking`, `MCP Agentless-Banking`, `MCP Agent-OpenSearch`) go through the BFF's recording
façade, `http://localhost:3002/mcp-facade/<door>/mcp` (`demo_api_server/routes/mcpFacade.js`,
the client-agnostic half of `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md`).
It relays every call unchanged, records the hops on the transaction ledger, and appends one
extra block to every tool result:

```text
reel_url: https://localhost:4000/transaction-trace/embed/<correlationId>
reel_image: http://localhost:3002/mcp-facade/reel/<correlationId>.svg
Transaction trace ("movie reel") for this tool call: who called, the gateway's authorization decision, the MCP request and response.
![Transaction trace](http://localhost:3002/mcp-facade/reel/<correlationId>.svg)
```

The block is deliberately **data, not instructions** — a sentence like "always show this link"
inside a tool result is prompt injection by definition, and qwen3 correctly refused it. Tell the
model what to do with it where instructions belong, the chat's **System Prompt** (LM Studio →
chat settings, or a preset):

```text
Tool results from the mcp/* servers may include a transaction trace: a `reel_url:` line, a
`reel_image:` line and a Markdown image. Include them in your reply — the link as a clickable
"Transaction trace" link and the image as-is. They are part of the answer, not debug output.
```

The image is rendered on request from the ledger, so it fills in as the hops land (the gateway's
own decision arrives a beat after the tool result). It keeps refreshing for a few minutes while
open, because a session's reel keeps growing as you make more calls.

(`MCP_FACADE_REEL_BASE` in `demo_api_server/.env` overrides the host — the embed page is
public, so it needs no special hostname and no `/etc/hosts` entry.)

LM Studio renders Markdown only (no embedded HTML — `docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md` §4),
so click that link: the page shows the hop-by-hop chain (identity, the gateway's real
P1AZ decision for `MCP AgentGateway-Banking`, timing) plus the MCP side of the call — tools and
descriptions, resources (or "not advertised"), the request arguments and the raw response.
It keeps refreshing for a few minutes while open, because a session's reel keeps growing as you make more calls.

The façade is served over plain HTTP on `127.0.0.1:3002` on purpose: LM Studio's MCP bridge
is a Node process that does not trust the mkcert chain (`SELF_SIGNED_CERT_IN_CHAIN`, seen
live 2026-08-24), the listener is loopback-only, and every call carries the client's own
bearer. The same façade is also on the BFF's HTTPS port (`https://api.ping.demo:3001/mcp-facade/…`)
for containerized clients such as LibreChat.

`MCP Direct-OpenSearch` is ClusterIP-only in K8s, so open the tunnel before toggling it on:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80
```

(The local `mcpgw` compose profile publishes the same server on `:9900`, so the entry works there too.)
