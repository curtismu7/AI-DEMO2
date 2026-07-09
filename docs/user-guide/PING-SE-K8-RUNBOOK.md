# Ping SE Kubernetes — Runbook (AI Demo)

Deploy and run the AI Demo **only** on the shared Ping SE DevOps cluster (`ping-dev-aws-us-east-2`).  
**Live URL:** https://ai-demo.ping-devops.com

This runbook does **not** cover OrbStack, local `./run-k8.sh`, or Docker Compose on a test Mac.

---

## Prerequisites

| Item | Notes |
|------|--------|
| Mac with Docker Desktop | Builds and pushes images |
| `gh` CLI | Logged in as `curtismu7` |
| DEVHELP namespace | `ping-devops-cmuir` (from `cmuir@pingidentity.com`) |
| SE kubeconfig | From Ping Secret Server |
| Repo checkout | `~/Development/AI-DEMO2` |
| `demo_api_server/.env` | Provisioned (`npm run setup:fresh` or copied from dev machine) |

Install tools (once):

```bash
brew install kubectl kubectx int128/kubelogin/kubelogin
brew tap mike-engel/jwt-cli
brew install mike-engel/jwt-cli/jwt-cli
brew install gh
```

---

## One-time setup

### 1. Request namespace (if you do not have one)

1. JIRA → **DEVHELP** → Service Request  
2. Summary: `Grant Access to AWS GTE K8's Cluster`  
3. Cluster: `ping-dev-aws-us-east-2`  
4. Ping email: `cmuir@pingidentity.com`  
5. Wait for email with namespace `ping-devops-cmuir`

### 2. Download and store kubeconfig

1. Open Secret Server: https://pingidentity.delinea.app/view/vault/secrets/32608/general  
2. Download the config file to `~/Downloads/config`  
3. Store a permanent copy:

```bash
mkdir -p ~/Development/AI-DEMO2/.local/kube
cp ~/Downloads/config ~/Development/AI-DEMO2/.local/kube/ping-se-devops-config
cp ~/Downloads/config ~/.kube/backups/ping-se-devops-config
chmod 600 ~/Development/AI-DEMO2/.local/kube/ping-se-devops-config ~/.kube/backups/ping-se-devops-config
```

### 3. Install kubeconfig and log in to PingOne

Run in **Terminal.app** (browser popup required — not Cursor’s integrated terminal):

```bash
cd ~/Development/AI-DEMO2
./scripts/install-se-kubeconfig.sh
kubectl config use-context us
kubectl get namespaces
```

Complete PingOne login in the browser when it opens. First time: use **Forgotten Password** to set a password.

Set your namespace:

```bash
kubens ping-devops-cmuir
kubectl get namespace ping-devops-cmuir
```

Expected: namespace listed with status `Active`.

### 4. GitHub Container Registry (GHCR)

```bash
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin
```

Re-run GHCR login before **every** deploy (token expires).

### 5. Ping email for deploy scripts (optional but recommended)

Add to `demo_api_server/.env`:

```bash
PING_EMAIL=cmuir@pingidentity.com
```

Or export before deploy:

```bash
export SE_NAMESPACE=ping-devops-cmuir
```

---

## Deploy (every time)

Run from repo root in **Terminal.app**:

```bash
cd ~/Development/AI-DEMO2

# Avoid Docker AI hook hang after build
mv ~/.docker/cli-plugins/docker-ai ~/.docker/cli-plugins/docker-ai.disabled 2>/dev/null || true

# GHCR (required each deploy)
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin

# SE cluster auth (browser popup if session expired)
kubectl config use-context us
kubens ping-devops-cmuir

# Deploy env
export SE_NAMESPACE=ping-devops-cmuir
export COMPOSE_PROFILES=demo-auth,agents

# Build 13 images → push GHCR → apply manifests (~15–30 min first run)
./run-k8.sh se-all
```

### Split deploy (push succeeded, deploy failed)

```bash
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin
./run-k8.sh se-build
kubectl config use-context us && kubens ping-devops-cmuir
export SE_NAMESPACE=ping-devops-cmuir
./run-k8.sh se-deploy
```

---

## Verify

```bash
kubectl config current-context          # should be us or ping-dev-aws-us-east-2-oidc
kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'   # ping-devops-cmuir
kubectl get pods -n ping-devops-cmuir
kubectl get ingress -n ping-devops-cmuir
curl -sf https://ai-demo.ping-devops.com/api/health
```

Open in browser: **https://ai-demo.ping-devops.com**

DNS/ingress may take ~5 minutes after first deploy.

---

## PingOne callbacks (if login redirects to localhost)

```bash
cd ~/Development/AI-DEMO2
./se-update-pingone.sh
```

Confirm in PingOne app settings:

- Redirect: `https://ai-demo.ping-devops.com/callback`
- Post-logout: `https://ai-demo.ping-devops.com`

---

## Undeploy (required when done)

The SE cluster is shared. **Always undeploy** when finished.

```bash
cd ~/Development/AI-DEMO2
kubectl config use-context us
kubens ping-devops-cmuir
./run-k8.sh se-undeploy
```

---

## Logs

```bash
kubectl logs -n ping-devops-cmuir deploy/demo-api-server -f
kubectl logs -n ping-devops-cmuir deploy/frontend -f
kubectl logs -n ping-devops-cmuir deploy/mcp-gateway -f
kubectl logs -n ping-devops-cmuir deploy/langchain-agent -f
kubectl logs -n ping-devops-cmuir -l app=ai-demo --all-containers --prefix -f
```

---

## Error reference

### `no context exists with the name: "us"`

**Cause:** SE kubeconfig not installed.

**Fix:**

```bash
./scripts/install-se-kubeconfig.sh
kubectl config get-contexts
```

---

### `127.0.0.1:26443 connection refused`

**Cause:** kubectl is on **OrbStack**, not SE.

**Fix:**

```bash
./scripts/install-se-kubeconfig.sh
kubectl config use-context us
kubectl get namespaces
```

Do not use OrbStack for Ping SE deploy.

---

### `context deadline exceeded` / `authcode-browser error`

**Cause:** PingOne browser login did not complete in time.

**Fix:**

1. Run in **Terminal.app** (not Cursor).
2. Retry:

```bash
kubectl config use-context us
kubectl get namespaces
```

3. Complete PingOne login in the browser before the tab closes.
4. First login: use **Forgotten Password** on PingOne.

---

### `namespace "ping-devops-cmuir" not found`

**Cause:** DEVHELP namespace not provisioned yet.

**Fix:** File or follow up on DEVHELP ticket. Until the namespace exists, you cannot deploy.

---

### Stuck after `Built` — no `Pushing ai-demo-ui → ghcr.io/...`

**Cause:** Docker AI CLI hook hung after `docker compose build`.

**Fix:**

```bash
# Ctrl+C to stop
mv ~/.docker/cli-plugins/docker-ai ~/.docker/cli-plugins/docker-ai.disabled
./run-k8.sh se-all
```

---

### GHCR login failed / push denied / `denied: permission_denied`

**Cause:** Missing `write:packages` on `gh` token.

**Fix:**

```bash
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u curtismu7 --password-stdin
./run-k8.sh se-build
```

---

### `Error response from daemon: No such image: ai-demo-mcp-gateway`

**Cause:** Compose profiles not set — gateway/authz/agents not built.

**Fix:**

```bash
export COMPOSE_PROFILES=demo-auth,agents
./run-k8.sh se-all
```

---

### `503` at https://ai-demo.ping-devops.com

**Cause:** Pods not ready, ingress pending, or DNS not propagated.

**Fix:**

```bash
kubectl get pods -n ping-devops-cmuir
kubectl get ingress -n ping-devops-cmuir
kubectl describe ingress -n ping-devops-cmuir
```

Wait 5 minutes. Check failing pods:

```bash
kubectl logs -n ping-devops-cmuir deploy/demo-api-server --tail=50
kubectl logs -n ping-devops-cmuir deploy/frontend --tail=50
```

---

### Login works but redirects to `api.ping.demo:4000` or `localhost`

**Cause:** PingOne app still has local redirect URIs.

**Fix:**

```bash
./se-update-pingone.sh
```

Update PingOne app redirect URIs to `https://ai-demo.ping-devops.com/callback`.

---

### Agent pod crash / Code Explorer fails

**Cause:** Host LLM proxy `:8090` not running (Code Explorer uses local llama.cpp during dev; on SE the agent container may need LLM env configured).

**Fix:** Check agent logs:

```bash
kubectl logs -n ping-devops-cmuir deploy/langchain-agent --tail=100
```

Re-deploy after fixing env or scaling agent:

```bash
./run-k8.sh se-deploy
```

---

## Quick command cheat sheet

```bash
# Install / restore kubeconfig
./scripts/install-se-kubeconfig.sh

# Auth + namespace
kubectl config use-context us
kubens ping-devops-cmuir

# Full deploy
export SE_NAMESPACE=ping-devops-cmuir COMPOSE_PROFILES=demo-auth,agents
./run-k8.sh se-all

# Status
kubectl get pods -n ping-devops-cmuir
open https://ai-demo.ping-devops.com

# Undeploy
./run-k8.sh se-undeploy
```

---

## Related files

| File | Purpose |
|------|---------|
| `run-k8.sh` | `se-all`, `se-build`, `se-deploy`, `se-undeploy` |
| `scripts/install-se-kubeconfig.sh` | Restore SE kubeconfig |
| `.local/kube/ping-se-devops-config` | Gitignored config backup |
| `.claude/skills/se-k8-deploy/SKILL.md` | Agent skill for SE deploy |
| `se-update-pingone.sh` | Fix OAuth URLs for SE URL |
