# PingOne Privilege MCP: current configuration index

Verified 2026-08-20. Agentless and Agent are independent deployments with different
authentication, applications, clusters, images, and operating procedures. Use the
mode-specific guide as the operational source of truth.

## Choose the deployment mode

| | Agentless | Agent |
|---|---|---|
| Detailed guide | [`AGENTLESS-CONFIGURATION.md`](AGENTLESS-CONFIGURATION.md) | [`AGENT-CONFIGURATION.md`](AGENT-CONFIGURATION.md) |
| Namespace | `ping-devops-cmuir` | `ping-devops-curtismuir` |
| Helm release | `agentless-mcpgw` | `cm-mcpgw` |
| Mesh cluster | `ai-demo-cmuir` | `ai-demo-agent` |
| Privilege application | `cmuir` | `cmuir2` / OpenSearch |
| MCP client URL | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` | `https://opensearch.default.applications.procyon.ai:8643/mcp` |
| Authentication | Gateway-managed OAuth/PKCE | Installed PingOne Privilege Agent |
| Gateway implementation | `privilege-mcpgw` `v1.260729` | Working legacy `privilege-proxy` `v1.260813` |

## Separation rules

- Agentless requires its OIDC client ID, scopes, callback, and gateway OAuth
  configuration. Its settings are stored in `gatewayConfigs.agentless`.
- Agent uses no client ID, scopes, `pingone.env`, Privilege sign-in button, or BFF
  bearer token. Its settings are stored in `gatewayConfigs.agent`.
- OpenSearch belongs to the working Agent application `cmuir2`; the Agentless
  application `cmuir` has a different backend.
- Use `/mcp` in Postman and the demo client. A configured backend may use `/sse`,
  but that is not the Streamable HTTP client URL.
- Do not change the working Agent deployment while repairing or upgrading
  Agentless. An Agent image migration requires its own plan, rollback, and proof.

Historical investigation and product reference material remains indexed in
[`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md). Dated files do not override either current
mode-specific guide.
