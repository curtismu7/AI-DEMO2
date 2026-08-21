# Agentless MCP Gateway — Helm Deployment Guide

## Prerequisites

- Helm 3 installed
- `kubectl` access to your EKS cluster
- cert-manager installed with a `ClusterIssuer` named `letsencrypt-pdo` (or your issuer)
- Nginx ingress controller (`nginx-public` class)
- PingOne tenant with a configured OIDC application (see PingOne Configuration below)
- MCP servers registered in the Privilege Cloud console

---

## PingOne Application Setup

In the PingOne console, create or use an existing application:

- **Type:** Web App (OIDC)
- **Token Endpoint Auth Method:** `client_secret_basic`
- **Grant types:** `authorization_code` + `token_exchange`
- **Redirect URI:** `https://<hostname>/callback`
- **Resources tab:** Add PingOne API resource with scopes: `p1:read:env p1:read:user p1:read:application`

---

## Step 1 — Install the Chart

```bash
helm install agentless-mcpgw ./agentless-mcpgw-0.1.0.tgz \
  --namespace <namespace> \
  --set hostname=<your-gateway-hostname> \
  --set namespace=<your-namespace> \
  --set proxyToken=<privilege-cloud-proxy-token> \
  --set oidc.serverUrl=https://<your-gateway-hostname> \
  --set oidc.clientId=<pingone-client-id> \
  --set oidc.clientSecret=<pingone-client-secret> \
  --set oidc.authUrl=https://auth.pingone.com/<env-id>/as/authorize \
  --set oidc.tokenUrl=https://auth.pingone.com/<env-id>/as/token \
  --set oidc.userUrl=https://auth.pingone.com/<env-id>/as/userinfo
```

Or copy `values.yaml`, fill in the credentials, and use:

```bash
helm install agentless-mcpgw ./agentless-mcpgw-0.1.0.tgz -f my-values.yaml
```

---

## Step 2 — Register MCP Servers in Privilege Cloud Console

For each MCP server, add it in the Privilege Cloud console with:

| Field | Value |
|-------|-------|
| Application name | `<server-name>` (e.g. `opensearch-mcp-server`) |
| Backend URL | `http://<service>.<namespace>.svc.cluster.local` |

> **Important:** Register ALL MCP servers **before** the gateway pod starts. Adding servers after startup requires a pod restart (`kubectl rollout restart deployment/agentless-mcpgw`).

For SSE-based backends (FastMCP `--transport stream`), append `/sse` to the backend URL:
```
http://opensearch-mcp-server.<namespace>.svc.cluster.local/sse
```

---

## Step 3 — Add MCP Servers to the Chart

List your MCP server names in `values.yaml` (or via `--set`):

```yaml
mcpServers:
  - name: pingone-mcp-server-2
  - name: opensearch-mcp-server
```

Each entry automatically adds the path route `/<name>` to the ingress.

---

## Step 4 — Configure VS Code mcp.json

```json
{
  "servers": {
    "my-server": {
      "type": "http",
      "url": "https://<hostname>/<server-name>"
    }
  }
}
```

> **Do NOT append `/mcp`** — the `/.well-known/oauth-protected-resource` discovery hangs when `/mcp` is included in the path.

---

## Step 5 — Verify

> **Note:** On first deploy, the gateway pod will show `CrashLoopBackOff` for 5-10 minutes while Privilege Cloud provisions the new node registration. This is normal — it self-heals once the proxy cert is issued. Do not reinstall during this window.

```bash
# Pods healthy (wait for gateway to exit CrashLoopBackOff on first deploy)
kubectl get pods -n <namespace> | grep agentless-mcpgw

# Gateway in TLS mode (required for tool discovery)
kubectl exec -n <namespace> -l app=agentless-mcpgw -c log-tailer -- \
  grep "TLS mode" /var/log/procyon/cyonproxy.log

# Backend tool discovery succeeded
kubectl logs -n <namespace> -l app=<mcp-server> | grep "ListToolsRequest"
```

---

## Upgrading

To add a new MCP server without changing other values:

```bash
helm upgrade agentless-mcpgw ./agentless-mcpgw-0.1.0.tgz \
  -f my-values.yaml \
  --set mcpServers[2].name=new-server
```

Then restart the gateway:
```bash
kubectl rollout restart deployment/agentless-mcpgw -n <namespace>
```

---

## Key Operational Notes

- The gateway **must start in TLS mode** — the initContainer copies `agentless-mcpgw-tls` cert to `/procyon/ssl/mcpgw-cert.pem` automatically
- **Do NOT delete the `agentless-mcpgw-ssl` PVC** — it stores the gateway's Privilege Cloud proxy cert (`proxy-crt.pem`). This cert can only be issued once per node registration. If the PVC is lost, you must delete the gateway node in the Privilege Cloud console and redeploy to get a new cert.
- `helm uninstall` retains PVCs by default — this is intentional
- If the Privilege Cloud console shows "No Tools Discovered", restart the gateway pod after confirming all MCP servers are registered in the console
