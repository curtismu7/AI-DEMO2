---
name: se-k8-deploy
description: >-
  Deploy and undeploy the AI Demo to the Ping SE DevOps Kubernetes cluster
  (ping-dev-aws-us-east-2). Use when the user asks to push to Ping K8, run se-all,
  se-deploy, se-build, se-undeploy, or troubleshoot SE cluster access, GHCR push,
  kubectl context us, or https://ai-demo.ping-devops.com.
---

# SE K8 Deploy — Ping DevOps cluster

Deploy this repo to the **shared Ping SE DevOps cluster** (`ping-dev-aws-us-east-2`).
This is **not** local OrbStack K8 and **not** Docker Compose on a test Mac.

| Target | Command | URL |
|--------|---------|-----|
| **SE cluster** | `./run-k8.sh se-all` | `https://ai-demo.ping-devops.com` |
| Local OrbStack | `./run-k8.sh` | `https://api.ping.demo:4000` |
| Docker Compose | `./run-docker.sh start full` | `https://api.ping.demo:4000` |

Canonical script: **`run-k8.sh`**. Read its header and `docs/user-guide/deployment.md`
Option 4 before changing deploy behavior.

## When this applies

- User says "push to Ping K8", "deploy to SE", "se-all", or similar
- kubectl shows only `orbstack` — user needs SE cluster setup first
- GHCR push fails or hangs after `docker compose build`
- Post-deploy OAuth callbacks still point at `api.ping.demo:4000`

## Prerequisites checklist

Run through in order. Do not skip to `se-all` until kubectl reaches the SE cluster.

| # | Requirement | Verify |
|---|-------------|--------|
| 1 | **DEVHELP namespace** | JIRA ticket → email with `ping-devops-<you>` |
| 2 | **Kubeconfig** | Secret Server config in `~/.kube/config` |
| 3 | **Tools** | `kubelogin`, `kubectx`, `kubectl`, `gh`, Docker Desktop |
| 4 | **kubectl context `us`** | `kubectl config get-contexts` shows `us` |
| 5 | **OIDC login** | `kubens ping-devops-cmuir` completes (browser popup) |
| 6 | **GHCR push scope** | `gh auth refresh -h github.com -s write:packages` |
| 7 | **Repo `.env`** | `demo_api_server/.env` provisioned (`npm run setup:fresh` or copied from dev); includes `PING_EMAIL` for namespace derivation |

### First-time cluster access (Ping runbook)

1. **Request namespace** — DEVHELP JIRA:
   - Work type: Service Request
   - Summary: `Grant Access to AWS GTE K8's Cluster`
   - Cluster: `ping-dev-aws-us-east-2` (US / Ohio)
   - Ping email: e.g. `cmuir@pingidentity.com`
   - Runbook: https://docs.google.com/document/d/1hRo0WQiX9oUC-AmYXGvVrWWpCaR8dy3YxZNicSOE2JE/edit

2. **Install tools**:
   ```bash
   brew install int128/kubelogin/kubelogin
   brew tap mike-engel/jwt-cli
   brew install mike-engel/jwt-cli/jwt-cli
   brew install kubectx
   ```

3. **Kubeconfig** — download from Ping Secret Server and install:
   ```bash
   mkdir -p ~/.kube
   cp ~/Downloads/config ~/.kube/config   # adjust download path
   chmod 600 ~/.kube/config
   ```
   Secret Server entry: https://pingidentity.delinea.app/view/vault/secrets/32608/general

   **Stored backups** (refresh after re-download from Secret Server):
   - Repo-local (gitignored): `.local/kube/ping-se-devops-config`
   - Home: `~/.kube/backups/ping-se-devops-config`
   - Restore anytime: `./scripts/install-se-kubeconfig.sh`

4. **Switch context and authenticate**:
   ```bash
   kubectl config get-contexts          # must show `us` (not only orbstack)
   kubectl config use-context us
   kubens ping-devops-cmuir             # PingOne browser login
   kubectl get namespace ping-devops-cmuir
   ```
   First PingOne login: use "Forgotten Password" if no password exists yet.

## Deploy routine

From repo root on the **Dev Mac** (needs Docker + `gh` + SE kubectl):

```bash
cd ~/Development/AI-DEMO2

# 1. GHCR auth (token expires — run before every deploy)
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin

# 2. Disable Docker AI hook (hangs after docker compose build on some Macs)
mv ~/.docker/cli-plugins/docker-ai ~/.docker/cli-plugins/docker-ai.disabled 2>/dev/null || true

# 3. Namespace + full image set (gateway, authz, alternate agents)
export SE_NAMESPACE=ping-devops-cmuir
export COMPOSE_PROFILES=demo-auth,agents
# Or rely on PING_EMAIL in demo_api_server/.env (written by bootstrap)

# 4. Build + push 13 images to GHCR + apply manifests
./run-k8.sh se-all
```

**Live URL:** https://ai-demo.ping-devops.com (DNS may take ~5 min)

### Split build and deploy

Use when push succeeded but deploy failed, or GHCR token expired mid-push:

```bash
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin
./run-k8.sh se-build     # build + push only
./run-k8.sh se-deploy    # kubectl apply only
```

### Verify

```bash
kubectl get pods -n ping-devops-cmuir
curl -sf https://ai-demo.ping-devops.com/api/health
```

### Undeploy (required)

The SE cluster is shared. **Always undeploy when done** or publishing rights may be revoked.

```bash
./run-k8.sh se-undeploy
```

Re-enable Docker AI after deploy if desired:

```bash
mv ~/.docker/cli-plugins/docker-ai.disabled ~/.docker/cli-plugins/docker-ai
```

## PingOne callback fix after deploy

If login redirects to `localhost` or `api.ping.demo:4000` instead of the SE URL:

```bash
./se-update-pingone.sh
# or
PUBLIC_APP_URL=https://ai-demo.ping-devops.com npm run pingone:bootstrap
```

Expected public URLs in PingOne app settings:
- Redirect: `https://ai-demo.ping-devops.com/callback`
- Post-logout: `https://ai-demo.ping-devops.com`

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `no context exists with the name: "us"` | SE kubeconfig not installed | Secret Server config → `~/.kube/config` |
| `127.0.0.1:26443 connection refused` | Still on **orbstack** context | `kubectl config use-context us` |
| Stuck after `Built` lines, no `Pushing...` | **docker-ai** CLI hook hung | Disable plugin (see deploy routine step 2) |
| Only 10 images built, push fails on tag | Missing compose profiles | `export COMPOSE_PROFILES=demo-auth,agents` |
| GHCR login / push denied | Missing `write:packages` | `gh auth refresh -h github.com -s write:packages` |
| `context deadline exceeded` on kubectl | OIDC browser popup not completed | Run `kubectl get namespace ping-devops-cmuir` in terminal; complete PingOne login |
| 503 after deploy | DNS / ingress not ready | Wait 5 min; check `kubectl get ingress -n ping-devops-cmuir` |
| Agent pod crash | Host LLM proxy `:8090` down | `se-all` tries to start it; or run `bash demo_llm_proxy/start-local-models.sh ensure 8091` |

## Namespace derivation

Auto-derived from Ping email localpart (dots stripped):

- `cmuir@pingidentity.com` → `ping-devops-cmuir`
- Override: `SE_NAMESPACE=ping-devops-yourname ./run-k8.sh se-all`
- Bootstrap writes `PING_EMAIL` to `demo_api_server/.env` by default (git config or interactive prompt)

Git `user.email` is **not** used unless it ends in `@pingidentity.com`.

## Logs (replace namespace as needed)

```bash
kubectl logs -n ping-devops-cmuir deploy/demo-api-server -f
kubectl logs -n ping-devops-cmuir deploy/frontend -f
kubectl logs -n ping-devops-cmuir deploy/mcp-gateway -f
kubectl logs -n ping-devops-cmuir deploy/mcp-gateway -c authz-server -f
kubectl logs -n ping-devops-cmuir deploy/langchain-agent -f
kubectl logs -n ping-devops-cmuir -l app=ai-demo --all-containers --prefix -f
```

## Do not confuse with

- **Test Mac Docker workflow** — `git push` / `git pull` + `./run-docker.sh start full`; no SE cluster
- **Local K8 (OrbStack)** — `./run-k8.sh` without `se-` prefix; context `orbstack`
- **LAN remote browsing** — Dev Mac → Test Mac over SSH/LAN was blocked by MDM; SE deploy is separate

## Agent discipline

1. Verify `kubectl config get-contexts` shows `us` before running `se-deploy` / `se-all`.
2. Never commit secrets (`.env`, kubeconfig tokens, PATs).
3. Warn user to `./run-k8.sh se-undeploy` when demo session ends.
4. If `se-all` hangs at build with no push output, check for `docker-ai` plugin first.
