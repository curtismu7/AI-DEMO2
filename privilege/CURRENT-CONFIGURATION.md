# PingOne Privilege MCP: current configuration index

Verified 2026-09-02. **There is now exactly one gateway.** The Agentless/Agent
split below the fold is history: the per-owner gateways were torn down on
2026-09-01 and replaced by a single AI Gateway (the product's own new name for
what this repo called "agentless").

## The current deployment

| | |
|---|---|
| Operational guide | `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` (source of truth) |
| Namespace | `ping-devops-curtismuir` |
| Helm release | `agentless-mcpgw` (chart `pingone-privgateway-helm-main/agentless`) |
| Mesh cluster | `ai-demo-cmuir` |
| PingOne tenant | `0428ba4f-169c-436b-aff9-b230496e0e3b` ("AI Agent") |
| Agentic App | `opensearch22` |
| MCP client URL | `https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp` |
| Backend registered as | `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse` |
| Authentication | Gateway-managed OAuth: RFC 7591 dynamic registration + PKCE, no client id configured on the client |

## Rules that still bite

- **Register the backend with `/sse`, never `/mcp`.** The gateway's discovery
  client speaks the SSE transport — it issues a `GET` and waits for the SSE
  `endpoint` event, and never POSTs `initialize`. `/mcp` answers 200 and the
  handshake then dies, which the console reports as
  `Error discovering MCP server: calling "initialize": Unauthorized`. This
  corrects the previous version of this file, which said to use `/mcp`.
- **`svc.cluster.local` is the backend, not a client URL.** It resolves only
  inside the cluster; a client pointed there hangs. Clients use the client URL
  above.
- **The chart adds no release prefix.** Objects are `opensearch-mcp-server`,
  `opensearch`, `agentless-mcpgw`. Any `cm-mcpgw-*` or `ping-mcpgw-*` name is
  from a deleted release.
- **The gateway's DCR registry is in memory** — restarting it invalidates every
  registered client. The BFF re-registers automatically; standalone MCP clients
  must be removed and re-added.
- **Policies are per Agentic App and time-boxed.** A new app starts with none.
  Read `deployment/agentless-mcpgw -c log-tailer` for the real denial reason;
  the empty `Email=` in `User identity resolved` is cosmetic and never the cause.

## Doors that are deliberately dark

`mcpFacade.js`'s `agentless` (banking) door points at torn-down infrastructure
and is left that way on purpose until a banking MCP server is registered on the
gateway as its own Agentic App — see the 2026-09-01 entry in
[`../TECH_DEBT.md`](../TECH_DEBT.md) for the remaining steps.

The `agent` and `agent-cmuir` (agent-mode) doors were **removed** 2026-09-05.
They hung rather than failing fast: their `*.applications.procyon.ai:8643`
frontends still resolve through the Priv Agent's DNS proxy while nothing serves
the mesh port. Restoring agent mode needs inbound mesh exposure this chart does
not ship; the live client path is the `privilege-gateway` door.

Historical investigation and product reference material remains indexed in
[`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md); `AGENTLESS-CONFIGURATION.md` and
`AGENT-CONFIGURATION.md` describe the retired two-gateway split and are kept for
history only. Dated files do not override this index or the skill.
