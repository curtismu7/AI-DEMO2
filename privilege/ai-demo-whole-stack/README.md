# ai-demo-stack

> **Not the current cmuir Agentless deployment.** Use
> [`../AGENTLESS-CONFIGURATION.md`](../AGENTLESS-CONFIGURATION.md) for the live
> `agentless-mcpgw` release, `/cmuir/mcp` endpoint, and mode separation. This
> whole-stack chart remains an undeployed packaging experiment.

Deploy the whole AI-DEMO2 app plus the Privilege MCPGW gateway as one Helm
release, on the Ping SE AWS cluster.

## What gets deployed

- The whole app (~19 Deployments): frontend, BFF, mcp-server, mcp-gateway,
  authz-server, agent-service, hitl-service, mcp-resource-server,
  api-resource-server, ping-gateway, jaeger, llm-stack (5 tiers), and the
  langchain/mastra/openai/pydantic agent variants.
- **mcpgw** — the Privilege proxy gateway (`mcpgw`), as a Helm subchart
  dependency on `../../k8s/helm/mcpgw` (its internal chart name is
  `privgateway`, from the originally vendored source — see `Chart.yaml`).

**Not standalone like the reference `PingOnePrivAgentHelmPkg`** — the chart
declares its mcpgw dependency by relative path (`file://../../../k8s/helm/mcpgw`),
so `helm dependency update` only resolves inside this repo checkout, with this
folder staying at `privilege/ai-demo-whole-stack/`. The packaged `.tgz` already
has the subchart vendored in, though, so `helm upgrade --install ai-demo-stack
ai-demo-stack-0.1.0.tgz ...` directly (skipping `helm dependency update`) does
work standalone, extracted anywhere — `install.sh` uses the source directory
instead, for `helm template`/dry-run convenience.

## Deploy

Two steps run locally before Helm (GHCR pull secret from your `gh auth`
session, app secrets from local gitignored `.env` files) — a Kubernetes-native
Helm hook can't reach either. `install.sh` does both, then one
`helm upgrade --install` for everything else:

```bash
GITHUB_OWNER=curtismu7 SE_NAMESPACE=ping-devops-cmuir ./install.sh
```

Optional env vars: `IMAGE_TAG` (default `latest`), `PUBLIC_APP_URL` (default
`https://ai-demo.ping-devops.com`).

If `ping-mcpgw/procyon/config/proxy-token.env` doesn't exist yet, the gateway
is skipped (`privgateway.enabled=false`) and the rest of the stack still
deploys — see `deploy-ai-demo-stack.prompt.md` for the full step-by-step.

## Teardown

```bash
helm uninstall ai-demo-stack --namespace <namespace>
```

PVCs are retained. `ghcr-pull-secret`, `ping-mcpgw-secrets`, and the other
secrets `create-secrets.sh` created are plain `kubectl`-managed, not part of
the Helm release — they survive `helm uninstall` and are reused by the next
`install.sh` run.

## Status

Chart validated with `helm lint` / `helm template` (20 resources render
clean — 19 app workloads + the mcpgw subchart). **Not yet deployed live** —
the proven, currently-used path is `./run-pingaws.sh` /
`../deploy-whole-stack.prompt.md` (many `kubectl apply` calls + one
`helm upgrade --install` for the gateway alone, not this whole-stack chart).
Validate this chart end-to-end (Steps 1-5 in `deploy-ai-demo-stack.prompt.md`)
before treating it as primary.
