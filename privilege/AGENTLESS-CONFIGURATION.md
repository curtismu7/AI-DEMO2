# PingOne Privilege MCP: Agentless configuration

Verified 2026-08-20 against the live `ping-devops-cmuir` deployment. This is the
operational source of truth for Agentless mode.

## What Agentless means

The MCP client connects directly to customer-owned DNS and TLS. The gateway runs
the OAuth/PKCE flow, validates the resulting access token, applies Privilege policy,
and proxies allowed MCP calls to the backend registered on the `cmuir` application.

Agentless mode requires an OIDC client. It does not use the installed Privilege
Agent and must not inherit Agent-mode settings.

## Current deployment

| Item | Current value |
|---|---|
| Kubernetes context | `us` |
| Namespace | `ping-devops-cmuir` |
| Helm release/chart | `agentless-mcpgw` / `agentless-mcpgw-0.1.0` |
| Mesh cluster | `ai-demo-cmuir` |
| Active node | `bf42a9fd-d2e8-461e-bee3-16aacfa18ebf` |
| Gateway hostname | `cmuir-agentless-mcpgw.ping-devops.com` |
| Privilege application | `cmuir` |
| MCP client URL | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` |
| OIDC environment | `01d89b06-66d5-430e-9f28-65636843788b` |
| OIDC client ID | `a6219652-47af-4ed2-8dea-20e9940b3377` |
| OIDC callback | `https://cmuir-agentless-mcpgw.ping-devops.com/callback` |
| Console callback | `https://callback.login.privilege.pingone.com/oidc/callback` |
| Gateway version | `v1.260729` |
| Gateway image | `public.ecr.aws/s7q1z8z4/privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d` |

The public route is:

```text
MCP client
  -> HTTPS cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
  -> ingress-nginx
  -> service agentless-mcpgw:8623
  -> privilege-mcpgw
  -> backend registered on Privilege application cmuir
```

The backend URL is not the client URL. Do not put a Kubernetes
`svc.cluster.local` backend address into Postman. The current `cmuir` Agentless
application is not OpenSearch; OpenSearch belongs to Agent mode.

## PingOne OIDC application

Create an OIDC Web App for the gateway with:

- Authorization Code flow
- Client Secret Basic
- PKCE `S256`
- scopes `openid profile email` plus any required environment/user/application
  read scopes used by the deployment
- redirect URI `https://cmuir-agentless-mcpgw.ping-devops.com/callback`

The Privilege console login application also needs
`https://callback.login.privilege.pingone.com/oidc/callback`. Do not keep unrelated
or obsolete callback URLs unless another deployed application still uses them.

## Gateway enrollment token

Generate the token from Privilege console > Gateways > Add New > Add via Docker.
Before installation, validate the JWT payload without printing the token:

- `clusterID` must be `ai-demo-cmuir`
- `nodeType` must be `PrivateProxy`
- the token must have exactly three JWT segments
- the raw value must contain no whitespace or characters outside the JWT alphabet
- `exp` must still be in the future for first enrollment

Store the token only in Kubernetes Secret `agentless-mcpgw-secret`, key
`ENV_PROXY_TOKEN`. Never commit it or put it into a checked-in values file. Once
the pod is enrolled and verified, remove the local plaintext token file.

## Privilege application and policy

In AI Security > Agentic Apps, configure:

- Application name: `cmuir`
- Mesh cluster: `ai-demo-cmuir`
- MCP Server URL: the backend service intended for this Agentless use case
- policy: publish the required tools and bind the intended user or group
- recording/approval: enable according to the demo policy

The gateway derives the client route from the application name:
`/<application-name>/mcp`, therefore this deployment uses `/cmuir/mcp`.

## Demo client configuration

The BFF owns OAuth tokens and implements MCP Streamable HTTP. Agentless settings
are stored independently in `gatewayConfigs.agentless`.

```text
gatewayMode: agentless
mcpUrl: https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
clientId: a6219652-47af-4ed2-8dea-20e9940b3377
scopes: openid profile email
```

Agentless mode shows the Privilege sign-in control. It may use the existing main
demo PingOne browser session for silent `prompt=none` authentication.

`PRIVILEGE_AGENTLESS_MCPGW_URL` is the preferred BFF environment variable;
`PRIVILEGE_MCPGW_URL` remains a compatibility fallback. `pingone.env` belongs to
the Agentless gateway only.

## Postman

Create an MCP request with transport **HTTP** and URL:

```text
https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
```

Let Postman complete the OAuth flow advertised by the gateway. Use `/mcp`, not
`/sse`. `/sse` may be a backend transport on some applications, but it is not this
Streamable HTTP client URL.

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

Expected tokenless result: HTTP `401` advertising protected-resource metadata and
`/cmuir/authorize`. A plain `404` means the application path is wrong. After OAuth,
the client must perform `initialize`, `notifications/initialized`, `tools/list`, and
`tools/call`, preserving `MCP-Session-Id` and negotiated protocol headers.

## Known cleanup

Old `ai-demo-mine` and `asdf` records may appear with the same public address.
They are stale Privilege control-plane registrations, not additional Kubernetes
deployments. Do not generate another token to hide them. Remove them through the
Privilege console/API when deletion is available.
