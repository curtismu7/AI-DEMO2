---
name: privilege-mcpgw-agent-k8s
description: Deploy, repair and verify the PingOne Privilege AI Gateway (formerly "agentless MCP gateway") on the SE DevOps Kubernetes cluster from the pingone-privgateway-helm package, register an MCP server as an Agentic App, author policy, and prove the chain from an MCP client. Use whenever the task touches the agentless-mcpgw/privgateway Helm charts, ENV_PROXY_TOKEN or the Privilege console Gateways wizard, Agentic Apps registration, a Frontend Name like *.applications.procyon.ai:8643, or symptoms such as "Unknown client", "Gateway Unreachable — Error discovering MCP server: calling initialize: Unauthorized", "Access Denied for", "user not found in system", an MCP client hanging on a svc.cluster.local URL, or "has same NodeURL".
---

# Privilege AI Gateway on K8s

Rebuilt end to end 2026-09-01/02 and proven from Postman, LM Studio and the demo's
own client. Every command and error string here was observed, not inferred.

## The one gateway

| | |
|---|---|
| Helm release | `agentless-mcpgw` in `ping-devops-curtismuir` |
| Chart | `pingone-privgateway-helm-main/agentless/agentless-mcpgw-0.1.0.tgz` |
| Host | `mcpgw.ai-demo.ping-devops.com` (external-dns publishes it from the ingress) |
| Cluster ID | `ai-demo-cmuir` (the `clusterID` in the enrollment token) |
| PingOne tenant | `0428ba4f-169c-436b-aff9-b230496e0e3b` — "AI Agent" |
| Client URL | `https://mcpgw.ai-demo.ping-devops.com/<AgenticAppName>/mcp` |

**This chart prefixes nothing.** Its objects are `opensearch-mcp-server`,
`opensearch`, `agentless-mcpgw` — no release prefix. The older `privgateway`
chart did prefix (`cm-mcpgw-…`), and that release is gone; a `cm-mcpgw-*` or
`ping-mcpgw-*` name anywhere is stale.

Nothing Privilege-related installs into `ping-devops-cmuir` any more, and
`k8s/aws/deploy.sh` no longer tries — the gateway is a deliberate manual install,
because `ENV_PROXY_TOKEN` is single-use and ~2h-lived.

## Register the MCP server with `/sse`, not `/mcp`

This is the trap that cost the most time. In the console (Agentic Apps → Add
Application → MCP Server):

```
Application Name  opensearch22
MCP Server URL    http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/sse
Mesh Cluster      ai-demo-cmuir
Auth Mode         None
```

**The gateway speaks the SSE transport.** Its discovery client issues a bare
`GET` and waits for the SSE `endpoint` event; it never POSTs `initialize`.
FastMCP serves both transports, so `/mcp` *is* reachable and answers `GET` with
200 — the handshake simply never completes. The console then reports:

```
Gateway Unreachable — Error discovering MCP server:
calling "initialize": sending "initialize": Unauthorized
```

which reads like an auth fault and is not one. Proof, from inside the cluster:

```bash
# /sse announces the endpoint event the gateway needs
curl -sN http://opensearch-mcp-server/sse       # event: endpoint  data: /messages/?session_id=…
# /mcp is streamable-HTTP: 200, but no endpoint event
```

Tools stay empty and **policy creation is disabled** until discovery succeeds.
After changing the backend, restart the gateway so discovery re-runs:

```bash
kubectl rollout restart deployment/agentless-mcpgw -n ping-devops-curtismuir
```

**Backend vs client URL are different ends of the hop.** `svc.cluster.local`
resolves only inside the cluster — Postman/LM Studio failing on it is correct,
not a symptom. Clients use the Frontend/client URL above. To reach the backend
from a laptop: `kubectl port-forward -n ping-devops-curtismuir svc/opensearch-mcp-server 9900:80`.

## Deploy

```bash
kubectl config current-context                 # expect: us
kubectl get clusterissuer letsencrypt-pdo
kubectl get ingressclass nginx-public

cat > /tmp/secrets.yaml <<'YAML'
proxyToken: "eyJ..."          # console > Gateways > Add New > Add via Docker
oidc:
  clientId: "…"
  clientSecret: "…"
  authUrl:  "https://auth.pingone.com/<envId>/as/authorize"
  tokenUrl: "https://auth.pingone.com/<envId>/as/token"
  userUrl:  "https://auth.pingone.com/<envId>/as/userinfo"
YAML
chmod 600 /tmp/secrets.yaml

helm upgrade --install agentless-mcpgw <chart>.tgz \
  --namespace ping-devops-curtismuir \
  --set hostname=mcpgw.ai-demo.ping-devops.com \
  --set namespace=ping-devops-curtismuir \
  --set oidc.serverUrl=https://mcpgw.ai-demo.ping-devops.com \
  --values /tmp/secrets.yaml
```

Decode the token before using it — `tenantName` is the **environment id**, and
`clusterID` is what the Agentic App's Mesh Cluster field must say:

```bash
python3 -c "
import base64,json,sys,datetime
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
print({k:c.get(k) for k in ('clusterID','nodeId','tenantName')})
print('exp',datetime.datetime.fromtimestamp(c['exp'],datetime.timezone.utc))" 'eyJ...'
```

Enrollment lives in the `agentless-mcpgw-ssl` PVC afterwards, so restarts need
no token. Success in the log is `LinkStatus:Active`; `has same NodeURL` and
mesh-controller `not found` are cosmetic — do not chase them.

**Changing OIDC values requires a restart.** `helm upgrade` rewrites the secret
but the running pod keeps the old config, which shows up as an authorize
redirect carrying an empty `client_id`.

## The PingOne OIDC app

Web app, **Client Secret Basic**, grant types Authorization Code **+ Token
Exchange**, redirect `https://mcpgw.ai-demo.ping-devops.com/callback`, and on
Resources grant `openid`, `profile`, `email`.

`p1:read:env` and `p1:read:application` **do not exist as user-context scopes**
in PingOne — the chart's default scope string asks for them, PingOne silently
drops them, and that is harmless. Only `p1:read:user` is real, and the flow works
without it. (Verified by enumerating all 23 scopes on the PingOne API resource.)

## Clients

Everything discovers and registers dynamically — **no client id or secret is
configured anywhere on the client side**:

```
https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp
```

- **Postman:** MCP request, transport HTTP, Auth **None**. It DCRs and opens a browser.
- **LM Studio:** just the `url` in `mcp.json`. Needs ≥ 0.4.10 for MCP OAuth.
- **The demo's own client:** `/privilege-mcp-client` — see below.

**The gateway's DCR registry is in memory.** Every gateway restart forgets every
registered client, and the next authorize shows a bare `Unknown client` page. The
BFF now detects this and re-registers (`isDcrClientStillKnown` in
`demo_api_server/routes/privilegeMcpClient.js`); an MCP client that caches its
registration must be deleted and re-added by hand instead.

## Policy denials

Policies are **per Agentic App**, time-boxed, and name users — a new app has no
policy even if a sibling app does. Read the gateway log, not the client:

```bash
kubectl logs -n ping-devops-curtismuir deployment/agentless-mcpgw -c log-tailer --tail=200 \
  | grep -E 'identity resolved|policy denied'
```

| Log line | Meaning |
|---|---|
| `policy denied … : user not found in system` | the user is not synced into Privilege — fix the PingOne Privilege app's Group Membership Policy and the user's group |
| `policy denied … : Access Denied for` | user is synced; **no policy on this app covers them** |
| `✅ User identity resolved: … Email=` (empty) | cosmetic. Email is empty for every user, including ones whose policy works. Do NOT chase it — it is not why a call is denied |

The client renders both as a bare `403 Forbidden` / "The MCP server denied this
operation", so always go to the log for the real reason.

## Symptom index

| Symptom | Cause |
|---|---|
| Console "Gateway Unreachable … initialize: Unauthorized", Tools empty, policy disabled | backend registered with `/mcp`; use `/sse` |
| `Unknown client` page at `/authorize` | gateway restarted and forgot the DCR client; re-register |
| `Error finding next hop to <cluster>. Cluster not found` | app's Mesh Cluster names a torn-down gateway; set it to `ai-demo-cmuir` |
| MCP client hangs forever | pointed at `svc.cluster.local`, or at a `*.applications.procyon.ai:8643` agent frontend (this chart exposes no inbound mesh port) |
| Authorize redirects with empty `client_id` | pod still running pre-`helm upgrade` OIDC config; restart |
| Console shows apps you did not create / your edits do not appear | wrong tenant. The gateway's tenant is `0428ba4f`; open the console from the agent menu bar and check the tenant name |
| `404 NOT_FOUND` opening the app from the PingOne portal | expected — the gateway's OIDC client has no initiate-login URI; start from the client instead |
