# LM Studio — default MCP servers

`mcp.json` is the canonical `~/.lmstudio/mcp.json` for this demo: the same doors the
AI Gateway client page (`/privilege-mcp-client`) offers, plus the Agent Gateway.

```bash
cp lmstudio/mcp.json ~/.lmstudio/mcp.json   # then restart LM Studio
```

| entry (shown as `mcp/<entry>` in LM Studio) | door | auth |
|---|---|---|
| `MCP Direct-Banking` | our banking MCP server (`oauth-mcp`) on the SE cluster | LM Studio's native OAuth (RFC 9728 → DCR → PKCE) |
| `MCP Agentless-Banking` | Privilege **agentless** gateway, `external` app (banking tools; see `privilege/AGENTLESS-CONFIGURATION.md`), through the **SE-hosted** recording façade | native OAuth (the façade points LM Studio at Privilege's AS) |
| `MCP Privilege-OpenSearch` | OpenSearch MCP **through the Privilege AI Gateway** (`agentless-mcpgw`, app `opensearch22`), through the **local** recording façade. Replaced `MCP Agent-OpenSearch` on 2026-09-05: agent mode's mesh frontend still resolves but nothing serves it, so that door hung and was deleted | the façade holds the gateway leg — sign in once at `/privilege-mcp-client` after a gateway restart |
| `MCP Direct-OpenSearch` | the same OpenSearch MCP server (`cm-mcpgw` in K8s), **bypassing Privilege** | none — needs a port-forward first (below) |
| `MCP AgentGateway-Banking` | this repo's Agent Gateway (`demo_mcp_gateway`, deployed to the SE cluster), through the **SE-hosted** recording façade | native OAuth via the gateway's broker (PR #2353, real Let's Encrypt cert) → PingOne login |
| `MCP Privilege-Grafana` | Grafana's read API **through the Privilege AI Gateway** (`agentless-mcpgw`, catalog app `mcp-grafana`), served by the `demo_mcp_grafana` sidecar in the gateway pod on port 8081. Direct to the gateway, not through the façade, so there is no movie reel for it | native OAuth (RFC 9728 → DCR → PKCE) against Privilege's AS, then PingOne login |
| `MCP PingOne-Admin` | the hosted PingOne MCP server (Management API surface, not banking), through the **local** recording façade's `pingone-admin` door | broker OAuth (RFC 9728 → DCR → PKCE) against the demo's own AS. What reaches PingOne is a **delegated** PKCE token, never a worker one: the caller's own `x-pingone-admin-token` when it sends one, otherwise the shared operator session, which is off unless `MCP_FACADE_PINGONE_ADMIN_SHARED_SESSION=true` (see `demo_api_server/services/pingoneAdminSession.js`) |

Every door but the last talks to the SE cluster (`ping-devops-cmuir` namespace,
`ai-demo.ping-devops.com`) — the two OpenSearch doors reach it via a local hop
(the AI Gateway for `MCP Privilege-OpenSearch`, a `kubectl port-forward` for `MCP
Direct-OpenSearch`) because their upstream has no public ingress; the three
banking/gateway doors go straight to it, as does `MCP Privilege-Grafana` (whose
gateway lives in `ping-devops-curtismuir`, one namespace over from the Grafana it
reads). `MCP PingOne-Admin`
talks to PingOne's own hosted MCP server directly from the BFF, unrelated to the SE
cluster's own app resources.

`MCP PingOne-Admin` exposes PingOne's hosted catalog RAW, uncapped — 85 tools / ~373KB
of schema measured live 2026-08-25. Treat that as a historical figure: it was taken
under the old worker credential, and the catalogue is now sized by the ROLES OF THE
ADMIN WHO SIGNED IN, so two operators can see different tool counts through the same
door. Attaching every tool from
this door in one plain chat turn will blow past a small model's context window; pick
specific tools instead when the client supports it.

## The recording façade (movie reel)

Direct doors just work. The four doors that either cross an authorization boundary or
route through the façade for another reason go through the BFF's recording façade
(`demo_api_server/routes/mcpFacade.js`, the client-agnostic half of
`docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md`) — `MCP
AgentGateway-Banking` and `MCP Agentless-Banking` at `https://ai-demo.ping-devops.com/mcp-facade/<door>/mcp`
(the SE deployment); `MCP Privilege-OpenSearch` and `MCP PingOne-Admin` at
`http://localhost:3002/mcp-facade/<door>/mcp` (local only — `MCP Privilege-OpenSearch`
because the façade holds the AI Gateway leg in memory on this BFF; `MCP PingOne-Admin`
because the delegated admin session it can fall back to lives on this BFF too,
unverified on the SE deployment). It relays every call unchanged, records the hops on
the transaction ledger, and appends one extra block to every tool result:

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

(`MCP_FACADE_REEL_BASE` overrides the host — `demo_api_server/.env` locally,
`service-topology.json`'s `MCP_FACADE_REEL_BASE`/`MCP_FACADE_AGENT_GATEWAY_AS` public-patch
entries for k8s. The embed page is public, so it needs no special hostname there either.)

LM Studio renders Markdown only (no embedded HTML — `docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md` §4),
so click that link: the page shows the hop-by-hop chain (identity, the gateway's real
P1AZ decision for `MCP AgentGateway-Banking`, timing) plus the MCP side of the call — tools and
descriptions, resources (or "not advertised"), the request arguments and the raw response.
It keeps refreshing for a few minutes while open, because a session's reel keeps growing as you make more calls.

The **local** façade (`MCP Privilege-OpenSearch` and `MCP PingOne-Admin`) is served over plain HTTP on
`127.0.0.1:3002` on purpose: LM Studio's MCP bridge is a Node process that does not trust the
mkcert chain (`SELF_SIGNED_CERT_IN_CHAIN`, seen live 2026-08-24), the listener is
loopback-only, and every call carries the client's own bearer. The **SE** façade needs no such
workaround — `ai-demo.ping-devops.com` carries a real Let's Encrypt cert.

`MCP Direct-OpenSearch` is ClusterIP-only in K8s, so open the tunnel before toggling it on:

```bash
kubectl --context us -n ping-devops-curtismuir port-forward svc/cm-mcpgw-opensearch-mcp-server 9900:80
```

(The local `mcpgw` compose profile publishes the same server on `:9900`, so the entry works there too.)
