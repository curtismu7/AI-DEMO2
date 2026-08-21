# PrivGateway

Deploy an OpenSearch MCP gateway backed by the Priv platform using Helm.

## What gets deployed

- **mcpgw** — Priv privilege proxy (`cyonproxy`)
- **opensearch** — Single-node OpenSearch 2.x
- **opensearch-mcp-server** — FastMCP server exposing OpenSearch tools over SSE

## Deploy

**1. Create a `secrets.yaml` file (never commit this):**

```yaml
mcpgw:
  proxyToken: "<paste ENV_PROXY_TOKEN from the Priv console docker run command>"
```

**2. Install:**

```bash
helm install <release-name> privgateway-0.1.0.tgz \
  --namespace <namespace> \
  --set mcpgw.hostname=<hostname> \
  --set mcpgw.serverUrl=https://<hostname> \
  --values secrets.yaml
```

Example:

```bash
helm install cj-mcpgw privgateway-0.1.0.tgz \
  --namespace ping-devops-cjmuir \
  --set mcpgw.hostname=cj-mcpgw.ping-devops.com \
  --set mcpgw.serverUrl=https://cj-mcpgw.ping-devops.com \
  --values secrets.yaml
```

## Teardown

```bash
helm uninstall <release-name> --namespace <namespace>
```

PVCs are retained — delete manually if you want to reclaim storage.

