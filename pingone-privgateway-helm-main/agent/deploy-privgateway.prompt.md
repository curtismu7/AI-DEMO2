---
name: "Deploy PrivGateway"
description: "Deploy or upgrade an OpenSearch MCP gateway using the privgateway Helm chart. Use when asked to spin up, install, upgrade, or tear down a gateway instance."
agent: "agent"
tools: ["run_in_terminal"]
---

# Deploy PrivGateway

You are deploying `privgateway-0.1.0.tgz` from the same directory as this file.

This chart installs:
- **mcpgw** — Priv privilege proxy (`cyonproxy`)
- **opensearch** — Single-node OpenSearch 2.x
- **opensearch-mcp-server** — FastMCP server exposing OpenSearch tools over SSE

All resource names are prefixed with the Helm release name so multiple releases can coexist in the same namespace.

## Step 1 — Collect required values

Ask the user for:

| Value | Description |
|-------|-------------|
| Release name | Unique name for this deployment (e.g. `my-gateway`) |
| Namespace | Kubernetes namespace |
| Hostname | Public FQDN (e.g. `my-gateway.example.com`) |
| Proxy token | `ENV_PROXY_TOKEN` value from the Priv console docker run command |

## Step 2 — Write secrets file

Write the proxy token to `/tmp/secrets.yaml` (never log or echo its value):

```yaml
mcpgw:
  proxyToken: "<PROXY_TOKEN>"
```

## Step 3 — Verify prerequisites

```bash
kubectl config current-context
kubectl get clusterissuer letsencrypt-pdo
kubectl get ingressclass nginx-public
```

Stop and report to the user if any check fails.

## Step 4 — Dry-run

```bash
helm upgrade --install <RELEASE_NAME> privgateway-0.1.0.tgz \
  --namespace <NAMESPACE> \
  --create-namespace \
  --set mcpgw.hostname=<HOSTNAME> \
  --set mcpgw.serverUrl=https://<HOSTNAME> \
  --values /tmp/secrets.yaml \
  --dry-run 2>&1 | head -60
```

Show the user the rendered resources and confirm before proceeding.

## Step 5 — Install

```bash
helm upgrade --install <RELEASE_NAME> privgateway-0.1.0.tgz \
  --namespace <NAMESPACE> \
  --create-namespace \
  --set mcpgw.hostname=<HOSTNAME> \
  --set mcpgw.serverUrl=https://<HOSTNAME> \
  --values /tmp/secrets.yaml
```

## Step 6 — Verify

```bash
kubectl get pods -n <NAMESPACE> | grep <RELEASE_NAME>
kubectl logs -n <NAMESPACE> deployment/<RELEASE_NAME>-mcpgw -c log-tailer --tail=20
```

Confirm all three pods are Running. Check mcpgw logs show a successful link to the Priv mesh node.

## Step 7 — Register MCP server in Priv console

Tell the user to register the OpenSearch MCP server in the Priv console using this backend URL:

```
http://<RELEASE_NAME>-opensearch-mcp-server.<NAMESPACE>.svc.cluster.local/sse
```

## Teardown

```bash
helm uninstall <RELEASE_NAME> --namespace <NAMESPACE>
```

PVCs are retained — delete manually to reclaim storage.

