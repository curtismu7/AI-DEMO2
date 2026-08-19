# Deployment Guide

Four modes are supported. Pick the one that matches your environment.

| Mode | Command | Docker? | Kubernetes? | Access URL |
| ---- | ------- | ------- | ----------- | ---------- |
| **1 — Native processes** | `./run.sh` | No | No | `https://api.ping.demo:4000` |
| **2 — Docker Compose** | `docker compose up --build` | Yes | No | `https://api.ping.demo:4000` |
| **3 — Mac Kubernetes (OrbStack)** | `./run-k8.sh` | Yes | Local | `https://api.ping.demo:4000` |
| **4 — Ping SE AWS Cluster** | `./run-pingaws.sh` | Yes | Remote | `https://ai-demo.ping-devops.com` |

---

## Option 1 — Native Processes (no Docker)

Runs the BFF, UI dev server, MCP server, and AI agent directly as Node/Python processes on your Mac. The lightest-weight option — no containers involved.

**Prerequisites:** Node 20+, Python 3.11+, mkcert

### Option 1: First-time setup

```bash
curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
# Select option 1 — installs Node, Python, mkcert, bootstraps PingOne automatically
```

Or manually:

```bash
# Install mkcert and trust the local CA
brew install mkcert
sudo mkcert -install

# Add hostname to /etc/hosts
echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts

# Bootstrap PingOne (writes demo_api_server/.env and generates certs/)
cd ~/AI-demo/demo_api_server && npm run pingone:bootstrap
```

### Option 1: Start

```bash
cd ~/AI-demo
./run.sh
```

### Option 1: Commands

```bash
./run.sh             # start all services
./run.sh stop        # stop all services
./run.sh restart     # stop then start
./run.sh status      # live service health check
./run.sh help        # full usage reference
```

### Option 1: Logs

Log files are written to `logs/` in the repo root while services are running. Ctrl+C stops the tail without stopping services.

```bash
./run.sh tail        # interactive picker — choose a service or type 'all'
./run.sh tail all    # tail all services interleaved
./run.sh tail 1      # BFF (banking-api-server)
./run.sh tail 2      # UI dev server
./run.sh tail 3      # MCP server
./run.sh tail 4      # AI agent
cat logs/banking-api-server.log   # read a log file directly
```

---

## Option 2 — Docker Compose

Runs all services in containers. No Kubernetes needed — just Docker Desktop (or OrbStack).

**Prerequisites:** Docker Desktop or OrbStack, mkcert

### Option 2: First-time setup

```bash
# Trust the local CA and add the hostname
brew install mkcert
sudo mkcert -install
echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts

# Bootstrap PingOne (writes demo_api_server/.env and generates certs/)
cd ~/AI-demo/demo_api_server && npm run pingone:bootstrap
```

### Option 2: Start

```bash
cd ~/AI-demo
docker compose up --build    # first run or after code changes
docker compose up            # subsequent runs (no rebuild — faster)
```

### Option 2: Commands

```bash
docker compose up --build          # build + start all services
docker compose up                  # start (no rebuild)
docker compose down                # stop and remove containers
docker compose restart <service>   # restart one service
```

### Option 2: Logs — terminal

```bash
docker compose logs -f                               # all services interleaved
docker compose logs -f banking-api-server            # BFF
docker compose logs -f langchain-agent               # AI agent
docker compose logs -f mcp-gateway                   # MCP gateway
docker compose logs -f mcp-server                    # MCP tools
docker compose logs -f frontend                      # UI (nginx)
docker compose logs -f --tail=100 banking-api-server # last 100 lines + follow
```

### Option 2: Logs — Docker Desktop UI

1. Open **Docker Desktop**
2. Click **Containers** in the left sidebar
3. Click the **ai-demo** stack row to expand it — all containers are listed
4. Click any container name (e.g. `ai-demo-api-server`) to open its live log view
5. Use the **search box** at the top to filter log lines by keyword
6. Click the **download icon** (top-right) to save logs to a file
7. Toggle **Wrap text** to make long JSON lines readable

---

## Option 3 — Mac Kubernetes (OrbStack)

Runs all services in a local Kubernetes cluster. Uses the same Docker images and manifests as the SE cluster — useful for testing K8s config before pushing to AWS.

**Prerequisites:** OrbStack with Kubernetes enabled, `kubectl`

### Option 3: First-time setup

```bash
curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
# Select option 2 — installs OrbStack, kubectl, bootstraps PingOne
```

### Option 3: Start

```bash
cd ~/AI-demo
./run-k8.sh
```

`./run-k8.sh` builds Docker images, applies K8s manifests to the `ai-demo` namespace, and starts port-forwards that auto-respawn if dropped.

### Option 3: Commands

```bash
./run-k8.sh                          # build + deploy + forward (full start)
./run-k8.sh build                    # rebuild images only
./run-k8.sh deploy                   # re-apply manifests + restart pods (no rebuild)
./run-k8.sh forward                  # restart port-forwards only
./run-k8.sh restart                  # rebuild + rolling redeploy + forward
./run-k8.sh stop                     # scale all pods to 0 (keeps config; frees memory)
./run-k8.sh status                   # show pod and service status
./run-k8.sh destroy                  # delete the ai-demo namespace entirely

# Switch AI agent without rebuilding:
./run-k8.sh deploy --agent=langchain   # default
./run-k8.sh deploy --agent=mastra
./run-k8.sh deploy --agent=openai
./run-k8.sh deploy --agent=pydantic
```

### Option 3: Logs

```bash
kubectl logs -n ai-demo deploy/banking-api-server -f             # BFF
kubectl logs -n ai-demo deploy/frontend -f                       # UI
kubectl logs -n ai-demo deploy/mcp-gateway -f                    # MCP gateway
kubectl logs -n ai-demo deploy/mcp-gateway -c authz-server -f   # authz sidecar
kubectl logs -n ai-demo deploy/langchain-agent -f                # AI agent
kubectl logs -n ai-demo -l app=ai-demo --all-containers --prefix -f   # everything
kubectl logs -n ai-demo deploy/<name> --previous                 # after a crash
kubectl get deploy -n ai-demo                                    # list all deployments
```

---

## Option 4 — Ping SE AWS Cluster

Deploys to the shared Ping SE DevOps cluster (`ping-dev-aws-us-east-2`). Images are built locally, pushed to GHCR, and deployed to your personal namespace.

**Live URL:** `https://ai-demo.ping-devops.com`

### Prerequisites

| Tool | Install |
| ---- | ------- |
| Docker Desktop | Required to build images |
| `kubectl` | `brew install kubectl` |
| `kubectx` + `kubelogin` | `brew install kubectx int128/kubelogin/kubelogin` |
| `gh` CLI | `brew install gh` then `gh auth login` |
| SE cluster context | `kubectl config use-context us` |
| SE namespace | File a **JIRA DEVHELP** ticket — you get `ping-devops-<yourname>` |

```bash
# Or install everything automatically:
curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
# Select option 3
```

### Deploy

```bash
cd ~/AI-demo

# Re-authenticate to GHCR before every deploy (token expires)
gh auth token | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build images + push to GHCR + apply K8s manifests
./run-pingaws.sh
# same as: ./run-pingaws.sh start  (wraps ./run-k8.sh se-all)
```

Your namespace is auto-derived from your Ping email:

- `cmuir@pingidentity.com` → `ping-devops-cmuir`
- Bootstrap writes `PING_EMAIL` to `demo_api_server/.env` (from git config when `user.email` ends in `@pingidentity.com`, or from the interactive bootstrap prompt)
- Override: `SE_NAMESPACE=ping-devops-yourname ./run-pingaws.sh`

### Split build and deploy

If the push fails mid-way (token expired) or you want to deploy without rebuilding:

```bash
# Re-auth and push only (build is cached — fast)
gh auth token | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
./run-pingaws.sh build     # build + push to GHCR
./run-pingaws.sh deploy    # apply manifests to SE cluster
```

### kubectl auth timeout

The SE cluster uses PingOne OIDC — the browser popup must complete interactively. If you see `context deadline exceeded`:

```bash
kubectl config use-context us
kubectl get namespace ping-devops-cmuir   # triggers browser login — complete it
./run-pingaws.sh deploy                   # then deploy
```

### Check status

```bash
./run-pingaws.sh status
./run-pingaws.sh rag on    # build, push, and start the RAG stack
./run-pingaws.sh rag off   # stop RAG pods; preserve indexes in PVCs
# or:
kubectl get pods -n ping-devops-cmuir
kubectl get ingress -n ping-devops-cmuir
```

### Option 4: Logs

Replace `ping-devops-cmuir` with your actual namespace.

```bash
kubectl logs -n ping-devops-cmuir deploy/banking-api-server -f             # BFF
kubectl logs -n ping-devops-cmuir deploy/frontend -f                       # UI
kubectl logs -n ping-devops-cmuir deploy/mcp-gateway -f                    # MCP gateway
kubectl logs -n ping-devops-cmuir deploy/mcp-gateway -c authz-server -f   # authz sidecar
kubectl logs -n ping-devops-cmuir deploy/langchain-agent -f                # AI agent
kubectl logs -n ping-devops-cmuir -l app=ai-demo --all-containers --prefix -f   # everything
kubectl logs -n ping-devops-cmuir deploy/<name> --previous                 # after a crash
```

### Undeploy

**Always undeploy when finished.** The SE cluster is shared infrastructure and leaving the app running may result in loss of your publishing rights.

```bash
./run-pingaws.sh undeploy   # removes all app resources; preserves the namespace
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| GHCR push fails: `unauthenticated` | `gh auth token \| docker login ghcr.io -u YOUR_USERNAME --password-stdin` then retry |
| kubectl: `context deadline exceeded` | Run any kubectl command in your terminal to trigger the OIDC browser login, then retry |
| Docker: `Cannot connect to daemon` | Open Docker Desktop, wait for it to start, retry |
| `zsh: command not found: nvm` | `source ~/.zshrc` or open a new terminal |
| Browser cert error | `sudo mkcert -install` then restart browser |
| `api.ping.demo` doesn't resolve | `echo '127.0.0.1 api.ping.demo' \| sudo tee -a /etc/hosts` |
| 503 after SE deploy | Wait ~5 min for DNS; check `kubectl get pods -n ping-devops-<you>` |
| `ImagePullBackOff` on SE cluster | Re-create the GHCR pull secret: `gh auth token \| docker login ghcr.io -u USERNAME --password-stdin` then re-deploy |
| Pod stuck `Pending` | `kubectl describe pod -n <ns> <pod>` → check Events for PVC or resource issues |
| `CrashLoopBackOff` | `kubectl logs -n <ns> deploy/<name> --previous` to see crash output |

---

## PingOne Bootstrap

Provisions all PingOne resources (resource servers, scopes, apps, demo users) and writes credentials to `demo_api_server/.env`. Safe to re-run — idempotent.

```bash
cd ~/AI-demo/demo_api_server
npm run pingone:bootstrap       # interactive (opens browser form)
npm run pingone:bootstrap:ci    # non-interactive (reads PINGONE_BOOTSTRAP_* env vars)
```

---

## Related

- [README](../../README.md) — Quick-start How to Run section
- [Environment Variables](ENV_VARS.md) — All configuration options
- [PingOne Configuration](PINGONE_CONFIG.md) — Client IDs, redirect URIs, scopes
- [Architecture](../ARCHITECTURE.md) — Service map and token flow
