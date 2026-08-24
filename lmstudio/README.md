# LM Studio — default MCP servers

`mcp.json` is the canonical `~/.lmstudio/mcp.json` for this demo: the same doors the
AI Gateway client page (`/privilege-mcp-client`) offers, plus the Agent Gateway.

```bash
cp lmstudio/mcp.json ~/.lmstudio/mcp.json   # then restart LM Studio
```

| entry | door | auth |
|---|---|---|
| `ping-banking` | our banking MCP server (`oauth-mcp`) on the SE cluster | LM Studio's native OAuth (RFC 9728 → DCR → PKCE) |
| `agentless-mcpgw` | Privilege **agentless** gateway, `cmuir` app (same as the AI Gateway client). Banking tools live on the `external` app: swap the path to `/external/mcp` (see `privilege/AGENTLESS-CONFIGURATION.md`) | native OAuth |
| `agent-mcpgw` | OpenSearch MCP **through the Privilege agent** (`cm-mcpgw` in K8s) | the installed macOS Privilege Agent — no prompt |
| `opensearch-direct` | the same OpenSearch MCP server, **bypassing Privilege** | none — needs a port-forward first (below) |
| `agent-gateway` | this repo's Agent Gateway (`demo_mcp_gateway`, local Docker :3005) via its OAuth broker (PR #2353) | native OAuth → PingOne login |

`opensearch-direct` is ClusterIP-only in K8s, so open the tunnel before toggling it on:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80
```

(The local `mcpgw` compose profile publishes the same server on `:9900`, so the entry works there too.)
