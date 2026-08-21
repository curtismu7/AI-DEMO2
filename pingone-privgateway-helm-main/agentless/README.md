# Agentless MCP Gateway — Quick Start

## What's in this package

`agentless-mcpgw-0.1.0.tgz` is a Helm chart that deploys:
- The Privilege Cloud Agentless MCP Gateway
- OpenSearch database
- OpenSearch MCP Server (exposes OpenSearch as MCP tools)

## Prerequisites

- Helm 3: https://helm.sh/docs/intro/install/
- `kubectl` connected to your Kubernetes cluster
- cert-manager installed in the cluster
- Nginx ingress controller installed in the cluster
- A PingOne tenant with an OIDC application configured (see below)

## PingOne Application Setup

Create a Web App (OIDC) in PingOne with:
- Token Endpoint Auth Method: `client_secret_basic`
- Grant types: `Authorization Code` + `Token Exchange`
- Redirect URI: `https://<your-gateway-hostname>/callback`
- Resources tab: add PingOne API with scopes `p1:read:env`, `p1:read:user`, `p1:read:application`

## Deploy

```bash
helm install agentless-mcpgw ./agentless-mcpgw-0.1.0.tgz \
  --namespace <your-namespace> \
  --set hostname=<your-gateway-hostname> \
  --set namespace=<your-namespace> \
  --set proxyToken=<privilege-cloud-proxy-token> \
  --set oidc.serverUrl=https://<your-gateway-hostname> \
  --set oidc.clientId=<pingone-client-id> \
  --set oidc.clientSecret=<pingone-client-secret> \
  --set oidc.authUrl=https://auth.pingone.com/<env-id>/as/authorize \
  --set oidc.tokenUrl=https://auth.pingone.com/<env-id>/as/token \
  --set oidc.userUrl=https://auth.pingone.com/<env-id>/as/userinfo \
  --set opensearchMcpServer.image=<your-registry>/opensearch-mcp-server:latest
```

Or use a values file:

```bash
# 1. Extract the default values
helm show values ./agentless-mcpgw-0.1.0.tgz > my-values.yaml

# 2. Fill in your values in my-values.yaml

# 3. Deploy
helm install agentless-mcpgw ./agentless-mcpgw-0.1.0.tgz -f my-values.yaml -n <namespace>
```

## After Deploy

1. **Register MCP servers in the Privilege Cloud console** before the gateway pod starts.
   - Name: `opensearch-mcp-server`
   - Backend URL: `http://opensearch-mcp-server.<namespace>.svc.cluster.local/sse`

2. **Restart the gateway** if you add servers after the pod is already running:
   ```bash
   kubectl rollout restart deployment/agentless-mcpgw -n <namespace>
   ```

3. **Configure your MCP client** (e.g. VS Code `mcp.json`):
   ```json
   {
     "servers": {
       "opensearch": {
         "type": "http",
         "url": "https://<your-gateway-hostname>/opensearch-mcp-server"
       }
     }
   }
   ```

## Verify

```bash
# All pods running
kubectl get pods -n <namespace> | grep -E "agentless|opensearch"

# Gateway in TLS mode (required)
kubectl exec -n <namespace> -l app=agentless-mcpgw -c log-tailer -- \
  grep "TLS mode" /var/log/procyon/cyonproxy.log

# Tools discovered
kubectl logs -n <namespace> -l app=opensearch-mcp-server | grep "ListToolsRequest"
```

## Uninstall

```bash
helm uninstall agentless-mcpgw -n <namespace>
```
