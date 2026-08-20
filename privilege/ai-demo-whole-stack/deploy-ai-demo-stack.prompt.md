---
name: "Deploy AI-DEMO2 Whole Stack + Privilege Gateway"
description: "Deploy or upgrade the whole AI-DEMO2 app (BFF, UI, MCP server, agents, auth/gateway) plus the Privilege MCPGW gateway as one Helm release on the Ping SE AWS cluster. Use when asked to spin up, redeploy, or tear down the whole demo with the gateway included."
agent: "agent"
tools: ["run_in_terminal"]
---

# Deploy AI-DEMO2 Whole Stack + Privilege Gateway

You are deploying the `ai-demo-stack` Helm chart from this same directory, via
`install.sh`.

This chart installs (one release, ~20 Deployments):
- The whole app: frontend, BFF (api-server), mcp-server, mcp-gateway,
  authz-server, agent-service, hitl-service, mcp-resource-server,
  api-resource-server, ping-gateway, jaeger, llm-stack (5 tiers), plus the
  langchain/mastra/openai/pydantic agent variants.
- **mcpgw** — the Privilege proxy gateway (`mcpgw`, `k8s/helm/mcpgw` as a
  subchart dependency named `privgateway`, alongside `deploy-whole-stack.prompt.md`
  and `k8s/aws/deploy.sh` — same proven config, packaged as one chart here).

Unlike a pure Helm hook, two steps run **locally, before Helm** — a Kubernetes
Job can't reach your local `gh auth` session or local gitignored `.env` files,
which both the GHCR pull secret and the app's own secrets need. `install.sh`
does these, then a single `helm upgrade --install` does everything else.

## Step 1 — Collect required values

Ask the user for:

| Value | Description |
|-------|-------------|
| `GITHUB_OWNER` | GHCR owner — images live at `ghcr.io/<owner>/...` |
| `SE_NAMESPACE` | Kubernetes namespace (e.g. `ping-devops-cmuir`) — run `./run-pingaws.sh status` from the repo root first if unsure |
| Proxy token | `ENV_PROXY_TOKEN` from the Privilege console gateway wizard — **optional**; if `ping-mcpgw/procyon/config/proxy-token.env` doesn't exist yet, `install.sh` deploys everything except the gateway (`privgateway.enabled=false`) rather than failing |

If a proxy token is needed and doesn't exist yet, write it first:

```bash
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...<full JWT, single line>' \
  > ping-mcpgw/procyon/config/proxy-token.env
```

## Step 2 — Verify prerequisites

```bash
kubectl config current-context
kubectl get namespace <SE_NAMESPACE>
helm version
gh auth status
```

Stop and report to the user if any check fails.

## Step 3 — Dry-run the chart

```bash
helm dependency update ai-demo-stack
helm template test ai-demo-stack \
  --set imageRegistry=ghcr.io/<GITHUB_OWNER> \
  --set imageTag=latest \
  --set privgateway.mcpgw.proxyToken=dummy-for-dry-run \
  | head -100
```

Show the user the rendered resources and confirm before proceeding — this
does not touch the cluster.

## Step 4 — Install

```bash
GITHUB_OWNER=<owner> SE_NAMESPACE=<namespace> ./install.sh
```

Optional: `IMAGE_TAG=<tag>` (default `latest`), `PUBLIC_APP_URL=<url>` (default
`https://ai-demo.ping-devops.com`).

## Step 5 — Verify

```bash
kubectl get pods -n <SE_NAMESPACE>
kubectl get pods -n <SE_NAMESPACE> | grep mcpgw
kubectl logs -n <SE_NAMESPACE> deployment/ai-demo-stack-mcpgw -c log-tailer --tail=30
```

Confirm app pods are Running. For the gateway, look for `established command
stream to <node>` and a `MedusaLink...LinkStatus:Active` event, no
`level=fatal`. `-c mcpgw` (not `log-tailer`) is normally empty even when
healthy — mcpgw logs to a file; `log-tailer` is the sidecar tailing it.

App: `https://ai-demo.ping-devops.com` · BFF health:
`https://ai-demo.ping-devops.com/api/health` · Gateway path:
`https://ai-demo.ping-devops.com/mcpgw` (needs an MCP application registered
against this node in the Privilege console first — see
`../PRIVILEGE-MCP-CONSOLE-STEPS.md`).

## Teardown

```bash
helm uninstall ai-demo-stack --namespace <SE_NAMESPACE>
```

PVCs are retained — delete manually to reclaim storage. This does **not**
remove `ghcr-pull-secret`, `ping-mcpgw-secrets`, or the other secrets
`create-secrets.sh` created (they're plain `kubectl`-managed, not part of the
Helm release) — re-running `install.sh` reuses them without recreating.

## Relationship to other deploy paths in this repo

- `../deploy-whole-stack.prompt.md` documents the **already-proven, currently
  used** path (`./run-pingaws.sh` → `k8s/aws/deploy.sh`, ~15 `kubectl apply`
  calls + one `helm upgrade --install` for the gateway alone). That path is
  what's actually been verified end-to-end on the SE cluster.
- This chart is the same set of resources expressed as one Helm release
  instead of many `kubectl apply` calls — useful for `helm upgrade`/rollback
  semantics on the whole stack at once. It has **not** been deployed live yet;
  validate with Steps 1-5 above before treating it as the primary path.
