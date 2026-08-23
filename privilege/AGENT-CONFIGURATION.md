# PingOne Privilege MCP: Agent configuration

Verified 2026-08-20 against the working Agent deployment in
`ping-devops-curtismuir`. This is the operational source of truth for Agent mode.

## What Agent mode means

The MCP client connects to a Privilege-hosted frontend name. The installed PingOne
Privilege Agent intercepts/resolves that frontend and supplies the device-bound
identity. The demo client must speak MCP, but it must not run its own OAuth flow.

Agent mode therefore has:

- no OAuth client ID in the demo settings
- no requested-scopes field
- no `pingone.env` load
- no **Sign in with Privilege** button
- no BFF bearer token added to MCP requests

## Current deployment

| Item | Current value |
|---|---|
| Kubernetes context | `us` |
| Namespace | `ping-devops-curtismuir` |
| Helm release/chart | `cm-mcpgw` / `privgateway-0.1.0` |
| Mesh cluster | `ai-demo-agent` |
| Active node | `a5b8dfa2-321a-436b-abd0-810980fb99aa` |
| Gateway hostname | `cm-mcpgw.ping-devops.com` |
| Privilege application | `cmuir2` / OpenSearch |
| MCP client URL | `https://opensearch.default.applications.procyon.ai:8643/mcp` |
| Backend service | `cm-mcpgw-opensearch-mcp-server` |
| Backend transport used by the application | `/sse` |
| Gateway version | `v1.260813` |
| Running gateway image | `public.ecr.aws/s7q1z8z4/privilege-proxy@sha256:d8bec731460f1cc3ccf950b49d3285f5849c885a5eaeb1a3cc73ce3e6a87526e` |

This table records the working deployment as it exists. It intentionally uses the
legacy `privilege-proxy` image. Do not replace it merely to make the two modes look
the same; upgrade it only as a separate tested Agent migration. The additional
`agentless-mcpgw` release visible in `ping-devops-curtismuir` is not this Agent path.

## Install and onboard the Agent

1. In PingOne, grant the user access to PingOne Privilege and any required
   Privilege Administrator role.
2. Directory > Users > user > Services > Privilege > Generate Onboarding Link.
3. Install PingOne Privilege on the workstation.
4. Open the one-time onboarding link on that workstation and launch the Agent.
5. Verify the Agent reports Connected and uses the expected tenant.
6. If the Agent holds multiple onboarded tenants, set Preferred Tenant to the
   tenant that owns the `cmuir2` application and `ai-demo-agent` cluster.
7. Enrol the required PingID/MFA method for policy step-up.

On macOS, the Agent identity is device-bound in the Secure Enclave. Re-pairing can
remove access to the previous tenant, so generate a valid onboarding link before
disconnecting an existing pairing. See
[`SE1-Privilege-Agent-Setup-Mac.md`](SE1-Privilege-Agent-Setup-Mac.md) for the
detailed Mac workflow.

## Gateway and backend setup

The current Agent gateway is Helm release `cm-mcpgw` in
`ping-devops-curtismuir`. Its OpenSearch workloads are:

- deployment/service `cm-mcpgw-opensearch`
- deployment/service `cm-mcpgw-opensearch-mcp-server`
- backend URL pattern
  `http://cm-mcpgw-opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse`

The backend `/sse` path is not the MCP client's URL. Postman and the demo client use
the Privilege frontend `/mcp` URL.

In AI Security > Agentic Apps, the working application is `cmuir2`. It must remain
attached to mesh cluster `ai-demo-agent`, with tool policy bound to the intended
Agent user. Privilege policies are time-bound; a previously working request that
starts returning a policy denial may simply need its grant renewed.

## Demo client configuration

Agent settings are stored independently in `gatewayConfigs.agent`:

```text
gatewayMode: agent
mcpUrl: https://opensearch.default.applications.procyon.ai:8643/mcp
```

There is no client ID, scopes, or OAuth configuration. The BFF still performs the
MCP protocol sequence:

1. `initialize`
2. `notifications/initialized`
3. `tools/list`
4. `tools/call`

It must accept JSON or SSE responses, validate JSON-RPC response IDs, and preserve
negotiated `MCP-Session-Id` and `MCP-Protocol-Version` headers. It must not attach an
Agentless bearer token.

## Postman

Prerequisites:

- PingOne Privilege Agent installed, connected, and pointed at the correct
  Preferred Tenant
- `cmuir2` application policy grants the current Agent user

Create an MCP request with transport **HTTP**:

```text
https://opensearch.default.applications.procyon.ai:8643/mcp
```

Configure no OAuth client and no bearer token. The Agent supplies authentication.
Use `/mcp`, not `/sse`.

Useful reachability checks on macOS:

```bash
dscacheutil -q host -a name opensearch.default.applications.procyon.ai
curl -sk -m 8 -H 'Accept: text/event-stream' \
  https://opensearch.default.applications.procyon.ai:8643/sse
```

The `/sse` curl is only a reachability/policy probe. Use `/mcp` in the MCP client.
A 403 naming a user proves Agent authentication and routing worked but policy is
missing or expired.

## Verification

```bash
helm list -n ping-devops-curtismuir
kubectl get deploy cm-mcpgw-mcpgw \
  cm-mcpgw-opensearch cm-mcpgw-opensearch-mcp-server \
  -n ping-devops-curtismuir
kubectl logs -n ping-devops-curtismuir \
  deployment/cm-mcpgw-mcpgw -c log-tailer --tail=50
```

Look for cluster `ai-demo-agent`, node
`a5b8dfa2-321a-436b-abd0-810980fb99aa`, version `v1.260813`, and active command
streams. The recurring `has same NodeURL` line is cosmetic while command streams
remain active.

Then connect from Postman or the demo client and verify that tools load and a tool
call completes through the Agent-authenticated frontend.

## Change isolation

Do not update this Agent deployment while repairing the cmuir Agentless gateway.
The modes use different namespaces, releases, applications, authentication models,
and client configuration. Treat an Agent image upgrade as its own change with its
own rollback and Postman proof.
