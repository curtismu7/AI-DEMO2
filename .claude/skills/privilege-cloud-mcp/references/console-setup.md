# Console setup — headers, sections, forms, auth modes, discovery

Referenced from SKILL.md. Cloud-API headers (dead path, reference only), how the
console sections relate, field-by-field forms (Gateways, Add MCP Application),
upstream auth modes, and the tool-discovery prerequisite.

### Headers (Cloud API path only — kept for reference, that path is dead)

| Header | When | Value |
|--------|------|-------|
| `Authorization` | Always | `Bearer <user's PingOne SSO token>` |
| `x-procyon-session-id` | Always | Unique session UUID (generated per-session in BFF) |
| `mcp-protocol-version` | Non-initialize requests | `2024-11-05` |
| `Content-Type` | Always | `application/json` |

### How the pieces relate (Privilege console)

| Console section | Purpose |
|-----------------|---------|
| **Gateways** | Manage proxy infrastructure (clusters, nodes, enrollment tokens) |
| **Agentic Apps → MCP Servers** | Register which MCP server the gateway protects; set upstream auth mode |
| **Policies / Configure MCP Access** | Grant users access to specific tools (requires discovery first) |

These are **separate entities** linked via the "Mesh Cluster" dropdown on the MCP App.

### Console forms, field by field

**Setup Gateways** (Cloud → Gateways → Add via Docker). Only needed for a *new*
node — see rule 4 above before opening it.

| Field | Value |
|---|---|
| Mode | Private Proxy |
| Cluster ID | `ai-demo-fresh` |
| Host IP | `local.ping-devops.com` |

Then *Get Docker Command* and copy the `ENV_PROXY_TOKEN` JWT. Decode it before
using it — the `clusterID` claim must match the cluster your MCP application is
bound to, or the frontend will have no node behind it. Enrolling a second node on
the same Host IP produces the permanent `has same NodeURL` error.

**Add MCP Application** (Agentic Apps → Add Application).

| Field | Value | Note |
|---|---|---|
| Application Name | `MCP-aidemo` | free text |
| **MCP Server URL** | `http://mcp-server:8080/mcp` | the **backend**. Compose DNS — the proxy shares that network. Never `localhost:8080` |
| Auth Mode | Static Token | this is **upstream** auth (gateway → backend), not how clients are challenged |
| Auth Token | *empty* | `mcp-server` runs `MCP_AUTH_DISABLED=true`; Privilege is the boundary |
| Headers | none | |
| Mesh Cluster | `ai-demo-fresh` | must match the enrolled node's cluster |

There is **no Frontend field in this modal**, and the Frontend Name the console
assigns afterwards is read-only. Instead, read the registered name from the console
API (see "The nginx front door") and add it as a `map` line in
`demo_mcpgw_nginx/nginx.conf` plus a `/etc/hosts` entry. That `Host` rewrite is what
routes to the app; without it every request gets `Domain not found` and an empty
`200`.

Verify the backend is reachable from inside the network first, or discovery fails:

```bash
docker run --rm --network ai-demo_ai-demo curlimages/curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://mcp-server:8080/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# expect 200
```

### Upstream auth modes (MCP Application → Auth Mode)

| Mode | When to use |
|------|-------------|
| **Static Token** | MCP server expects a fixed Bearer token (or no auth) |
| **OAuth (Pre-Register)** | MCP server protected by an IdP; you provide client_id/secret/endpoints |
| **OAuth (DCR)** | Privilege registers itself as an OAuth client at runtime (RFC 7591) |

Our MCP server uses mTLS for gateway auth (not OAuth bearer). Set mTLS to false
when Privilege is the gateway — Privilege IS the security boundary. Use **Static
Token** with no token value, or OAuth if the MCP server validates bearers.

### Tool discovery prerequisite

Before policies can be created, Privilege must discover the MCP server's tools.
This requires the proxy to successfully call `POST /mcp` on the upstream server
and get an `initialize` + `tools/list` response. If mTLS blocks the connection,
discovery fails with "No Tools, Prompts, or Resources Discovered."
