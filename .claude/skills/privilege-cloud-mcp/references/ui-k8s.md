# UI page and K8s deployment

Referenced from SKILL.md.

## UI — PrivilegeMcpClientPage

- Route: `/privilege-mcp-client`
- Shows "Access Denied" modal when refreshTools gets a 401 "not authorized"
- If the underlying error is `403 … doesn't have access to MCP app`, that is a
  policy gap — assign the user a policy in the Privilege Cloud console (and check an
  existing one has not silently expired)
- If it is `401 … JWT signature validation failed`, no policy will help: this page
  sends a **PingOne** token, which the gateway rejects on `kid`. See "The PingOne
  token wall". The console-token path (`scripts/privilege-smoke.sh`) is what
  currently demonstrates the chain

## K8s deployment

Manifest: `k8s/75-ping-mcpgw-deployment.yaml`
- Reads `ENV_PROXY_TOKEN` from K8s secret `ping-mcpgw-secrets`
- Hostname: `ai-demo.ping-devops.com`
- Persists SSL state via `ssl-certs` volume
- Runs `mcpgw` on `:8623`, matching the local docker-compose swap (see "Read this
  first" item 0)

⚠️ **Was never actually deployed on the SE cluster until fixed.** The manifest
existed but `k8s/aws/deploy.sh` (the real SE deployer — not the local-only
`k8s/deploy.sh`) never included it in its apply loop, and `create-secrets.sh`
checked a pre-move token path, so `ping-mcpgw-secrets` was silently never created
either. An `ai-demo-mcpgw-ingress` routed `/mcpgw` to a service that didn't exist —
`503` end to end. Both fixed; deploying still needs a **fresh, unexpired**
enrollment token, since this cluster has no prior `ping-mcpgw-ssl` PVC (first
enrollment on a new host, unlike a restart on an already-enrolled one).
