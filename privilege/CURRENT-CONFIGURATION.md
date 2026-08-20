# PingOne Privilege MCP: current cmuir configuration

Verified 2026-08-20 against the live `ping-devops-cmuir` deployment. This is the
operational source of truth. Dated investigation files preserve historical evidence
and must not override this page.

## Do not mix the two modes

| Setting | Agentless | Agent |
|---|---|---|
| Privilege application | `cmuir` | `cmuir2` / OpenSearch |
| MCP client URL | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` | `https://opensearch.default.applications.procyon.ai:8643/mcp` |
| Client authentication | Gateway-managed OAuth/PKCE | PingOne Privilege Agent |
| Client ID in demo settings | Required | Not shown or used |
| Sign-in button | Shown | Not shown |
| `pingone.env` | Agentless gateway only | Not loaded by the demo client |
| Config persistence | `gatewayConfigs.agentless` | `gatewayConfigs.agent` |

The Agent URL is a real MCP Streamable HTTP endpoint. Do not navigate the browser
to it. The BFF sends MCP `initialize`, `notifications/initialized`, `tools/list`,
and `tools/call`; the installed Agent supplies identity.

## Live Agentless deployment

| Item | Current value |
|---|---|
| Kubernetes context | `us` |
| Namespace | `ping-devops-cmuir` |
| Helm release/chart | `agentless-mcpgw` / `agentless-mcpgw-0.1.0` |
| Mesh cluster | `ai-demo-cmuir` |
| Active node | `bf42a9fd-d2e8-461e-bee3-16aacfa18ebf` |
| Gateway hostname | `cmuir-agentless-mcpgw.ping-devops.com` |
| Privilege application/path | `cmuir` / `/cmuir/mcp` |
| OIDC environment | `01d89b06-66d5-430e-9f28-65636843788b` |
| OIDC client ID | `a6219652-47af-4ed2-8dea-20e9940b3377` |
| OIDC callback | `https://cmuir-agentless-mcpgw.ping-devops.com/callback` |
| Console callback | `https://callback.login.privilege.pingone.com/oidc/callback` |
| Gateway version | `v1.260729` |
| Gateway image | `public.ecr.aws/s7q1z8z4/privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d` |

The enrollment token is a secret. Store it only in Kubernetes Secret
`agentless-mcpgw-secret`, key `ENV_PROXY_TOKEN`. Never put the token in a values
file, command example, ticket, or committed document. Before installation, validate
that its JWT payload says `clusterID=ai-demo-cmuir` and `nodeType=PrivateProxy`.

The current public routing is:

```text
MCP client
  -> HTTPS cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
  -> ingress-nginx
  -> service agentless-mcpgw:8623
  -> privilege-mcpgw
  -> backend registered on the Privilege application named cmuir
```

The backend URL belongs to the Privilege `cmuir` application and is not the client
URL. Do not use a Kubernetes `svc.cluster.local` backend URL in Postman.

## Postman

Create an MCP request with transport **HTTP**:

- Agentless: `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp`
- Agent: `https://opensearch.default.applications.procyon.ai:8643/mcp`

For Agentless, let Postman complete the advertised OAuth flow. A tokenless MCP
initialize must return `401` with `WWW-Authenticate`, `resource_metadata`, and
`authorization_uri`. For Agent, configure no OAuth client ID and no bearer token;
the installed Privilege Agent authenticates the connection.

Use `/mcp` on both client URLs. `/sse` may be the backend transport configured on
some Privilege applications, but it is not the Postman Streamable HTTP client URL.

## Application configuration

Agentless application:

- Application name: `cmuir`
- Mesh cluster: `ai-demo-cmuir`
- Client-facing path: `/cmuir/mcp`
- Policy: bind the intended user/group and publish the required tools
- Backend: use the service URL configured for `cmuir`; it is not OpenSearch

Agent application:

- Application name: `cmuir2`
- Frontend: `opensearch.default.applications.procyon.ai:8643`
- Authentication: installed Agent
- Backend: OpenSearch MCP server

## Verification

```bash
kubectl get deploy agentless-mcpgw -n ping-devops-cmuir
kubectl get pod -l app=agentless-mcpgw -n ping-devops-cmuir \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'

curl -i -X POST \
  https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
```

Expected tokenless result: HTTP `401` advertising the `cmuir` protected-resource
metadata and `/cmuir/authorize`. A plain `404` means the application path is wrong.

## Known console cleanup

Old `ai-demo-mine` and `asdf` gateway records may still appear with the same public
address. They are stale Privilege control-plane registrations, not additional
Kubernetes deployments. The only running Agentless Kubernetes deployment is
`agentless-mcpgw` in `ping-devops-cmuir`. Remove stale records in the Privilege
console/API when deletion becomes available; do not create another gateway token to
try to hide them.
