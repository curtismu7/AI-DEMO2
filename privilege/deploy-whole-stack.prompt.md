---
name: "Deploy Whole Stack + Privilege Gateway"
description: "Deploy the full AI-DEMO2 app (BFF, UI, MCP server, agents) together with the Privilege MCPGW gateway on the SE AWS cluster. Use when asked to stand up, redeploy, or tear down the whole demo with the gateway included."
agent: "agent"
tools: ["run_in_terminal"]
---

# Deploy Whole Stack + Privilege Gateway

Unlike `deploy-privgateway.prompt.md` (`~/Downloads/PingOnePrivAgentHelmPkg/` on
this machine — not in this repo), which deploys the gateway **standalone** via a
chart that lives outside this repo,
this prompt documents the flow that brings up **everything together** — the whole
app plus the gateway — using what's actually committed here. There is no separate
"whole-stack chart": `k8s/aws/deploy.sh` applies ~15 plain Kubernetes manifests for
the app, then runs one `helm upgrade --install` against the in-repo chart
[`k8s/helm/mcpgw`](../k8s/helm/mcpgw) for the gateway. One script, one command,
both together.

## What gets deployed

Applied as plain manifests, in order (`k8s/aws/deploy.sh`):
jaeger, mcp-server, mcp-resource-server, api-resource-server, hitl-service,
llm-stack, api-server (BFF), mcp-gateway, ping-gateway, agent-service (x2 — one
is a duplicate apply, harmless), mastra-agent, openai-agent, pydantic-agent,
frontend (UI).

Deployed via Helm, as one release (`k8s/helm/mcpgw`, cyonproxy binary):
mcpgw Deployment + Service + Secret + PVC. OpenSearch and the chart's own
ingress/certificate templates are disabled by default — see
[`k8s/helm/mcpgw/values.yaml`](../k8s/helm/mcpgw/values.yaml).

## Step 1 — Prerequisites

```bash
kubectl config current-context          # should be able to switch to "us"
gh auth status                          # GITHUB_OWNER images live in GHCR
helm version                            # required for the gateway step
```

Namespace is auto-derived from your PingOne email (`cmuir@pingidentity.com` →
`ping-devops-cmuir`). Override with `SE_NAMESPACE=ping-devops-yourname`.

## Step 2 — Gateway enrollment token (one-time, or on re-enrollment)

The Helm step in `deploy.sh` reads `ENV_PROXY_TOKEN` out of the `ping-mcpgw-secrets`
K8s Secret — it does **not** prompt for a token itself. That secret is created by
`k8s/create-secrets.sh` from `ping-mcpgw/procyon/config/proxy-token.env`
(gitignored, format `ENV_PROXY_TOKEN=eyJ...`). If that file doesn't exist yet or the
token has expired, get a fresh one from the Privilege console (**Cloud > Gateways >
Add via Docker**) and write it:

```bash
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...<full JWT, single line, do not add newlines>' \
  > ping-mcpgw/procyon/config/proxy-token.env
```

If this file is absent, `deploy.sh` skips the gateway step entirely and logs a
warning — the rest of the stack still deploys.

## Step 3 — Deploy

```bash
./run-pingaws.sh          # build + push + deploy everything, including the gateway
# or, if images are already current in GHCR:
./run-pingaws.sh deploy
```

Equivalent low-level form, if you need to pass extra env vars:

```bash
GITHUB_OWNER=curtismu7 K8S_NAMESPACE=ping-devops-cmuir \
PUBLIC_APP_URL=https://ai-demo.ping-devops.com ./k8s/aws/deploy.sh
```

## Step 4 — Verify

```bash
./run-pingaws.sh status
kubectl get pods -n <namespace> | grep ping-mcpgw
kubectl logs -n <namespace> deployment/ping-mcpgw-mcpgw -c log-tailer --tail=30
```

Look for `established command stream to <node>` and a `MedusaLink...LinkStatus:Active`
event in the gateway logs, no `level=fatal`. `-c mcpgw` (not `log-tailer`) is
normally empty even when healthy — cyonproxy logs to a file; `log-tailer` is the
sidecar tailing it.

App: `https://ai-demo.ping-devops.com` · BFF health:
`https://ai-demo.ping-devops.com/api/health` · Gateway path:
`https://ai-demo.ping-devops.com/mcpgw`.

## Teardown

```bash
./run-k8.sh se-undeploy
```

**Caveat:** this runs `kubectl delete deployments,services,ingresses,configmaps,secrets
--all` in the namespace — it deletes the Helm-managed gateway's underlying objects
(including Helm's own release-state Secret, `sh.helm.release.v1.ping-mcpgw.*`)
without going through `helm uninstall`. The namespace itself is preserved
(cluster-managed). To redeploy the gateway cleanly afterward, `helm upgrade
--install` will recreate it fine — Helm reconciles from the chart, it doesn't need
its own prior release-state Secret to still exist for a fresh install. If you only
want the gateway gone and the rest of the app running, use `helm uninstall
ping-mcpgw --namespace <namespace>` instead of `se-undeploy`.

## Known gaps

- The gateway (cyonproxy) has no MCP OAuth challenge support — see
  [`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md) for the untested `privilege-mcpgw`
  binary lead and why it isn't wired in here yet.
- `mcpgw-agentless-ingress.yaml` (agentless/self-hosted-frontend mode) is not
  applied by `deploy.sh` — it targets that untested binary specifically and would
  502 forever against cyonproxy. Kept in the repo for whenever that binary is
  verified.
