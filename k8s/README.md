# AI Demo — Kubernetes Deployment Guide

## Resource Profiles

The default manifests are tuned for a **high-memory machine** (64GB+ RAM, 16 cores — e.g. Mac Studio / Mac Pro running OrbStack):

| Component | Memory limit | CPU limit |
|---|---|---|
| Namespace quota | 48Gi | 16 cores |
| api-server | 2Gi | 2 cores |
| langchain-agent | 4Gi | 2 cores |
| python agents (×3) | 1Gi each | 1 core each |

To run on a **smaller machine** (16GB RAM, 8 cores — MacBook Pro, cloud VM), apply the small overlay after the main manifests:

```bash
kubectl apply -f k8s/
kubectl apply -f k8s/overlays/small/
```

This reverts the namespace quota to 16Gi/8 CPU and all pod limits to their original conservative values.

## Optional: MLX (Apple) agent mode on OrbStack

The **MLX (Apple)** agent mode talks to a host-side `mlx_lm.server` on `:8098`
(not the in-cluster `llm-proxy`). On OrbStack / Docker Desktop, pods reach it via
`MLX_LM_BASE_URL=http://host.docker.internal:8098` (set in `02-configmap.yaml`).

```bash
# On the Mac host (one-time + start)
bash demo_llm_proxy/setup-mlx-venv.sh
bash demo_llm_proxy/start-mlx-lm.sh start

# After changing the ConfigMap, restart consumers so they pick up the env:
kubectl -n ai-demo rollout restart deployment/demo-api-server deployment/agent-service
```

On remote clusters (no Mac host), leave the URL as-is — the mode stays unavailable.

## Overview

This guide provides complete instructions for deploying the AI Demo platform (a multi-vertical AI agent security demo — banking, healthcare, retail, workforce, and more) on Kubernetes using the provided manifests and Docker images.

## Architecture

The platform deploys to the `ai-demo` namespace and consists of the following
components (12 Deployments + Redis). Each name below is the Kubernetes
Deployment name (`metadata.name`) — what `kubectl ... deployment/<name>` and
`k8s/update.sh <name>` expect.

| Deployment | Manifest | Build context | Role |
| --- | --- | --- | --- |
| `frontend` | `10-frontend-deployment.yaml` | `./demo_api_ui` | React SPA served by Nginx |
| `banking-api-server` | `20-api-server-deployment.yaml` | `.` (repo root) | Node.js Express BFF |
| `mcp-server` | `30-mcp-server-deployment.yaml` | `./demo_mcp_server` | WebSocket MCP protocol server |
| `langchain-agent` | `40-agent-service-deployment.yaml` | `./langchain_agent` | Python LangChain/LangGraph agent |
| `redis` | `50-redis-deployment.yaml` | (stock image) | Session storage and caching |
| `mcp-gateway` | `60-mcp-gateway-deployment.yaml` | `.` (repo root) | MCP authorization gateway |
| `agent-service` | `61-agent-service-deployment.yaml` | `./demo_agent_service` | Node agent service |
| `hitl-service` | `62-hitl-service-deployment.yaml` | `./demo_hitl_service` | Human-in-the-loop consent service |
| `mcp-invest` | `63-mcp-invest-deployment.yaml` | `./demo_mcp_invest` | Investment MCP server |
| `mortgage-service` | `64-mortgage-service-deployment.yaml` | `./demo_mortgage_service` | Mortgage demo service |
| `mastra-agent` | `65-mastra-agent-deployment.yaml` | `./mastra_agent` | Mastra agent runtime |
| `openai-agent` | `66-openai-agent-deployment.yaml` | `./openai_agent` | OpenAI agent runtime |
| `pydantic-agent` | `67-pydantic-agent-deployment.yaml` | `./pydantic_agent` | Pydantic-AI agent runtime |

> Compose service names match the Deployment names, except the UI is `ui` in
> `docker-compose.yml` but `frontend` in Kubernetes. `k8s/update.sh` accepts either.

## Prerequisites

### Kubernetes Cluster
- Kubernetes 1.24+ with Ingress controller
- kubectl configured to access cluster
- StorageClass named `fast-ssd` (or modify manifests)

### Docker Images
All images and their build contexts are defined in `docker-compose.yml`. Build
with Compose rather than running `docker build` per directory:
```bash
# Build every image
docker compose build

# …or build specific services (compose service names; UI is `ui`)
docker compose build banking-api-server ui mcp-server langchain-agent
```

> **Building the `langchain_agent` image:** its Dockerfile copies
> `langchain_agent/repo-src/` — the staged source the Code Explorer agent reads.
> That directory is generated (gitignored); run `npm run setup:fresh` (or
> `python3 scripts/build-codegraph.py --stage-src langchain_agent/repo-src`)
> before `docker build`, or the image build fails at the COPY step.

Images are tagged `:latest` with `imagePullPolicy: IfNotPresent`, so after a
rebuild the running pods must be recreated to pick up the new image. The helper
script `k8s/update.sh` does both (rebuild + rollout restart) — see Maintenance.

### Secrets Configuration
Copy and configure secrets:
```bash
cp k8s/03-secrets.yaml.template k8s/03-secrets.yaml
# Edit k8s/03-secrets.yaml with actual values
```

## Deployment Steps

> **Recommended:** `./k8s/deploy.sh` does a full deploy of all manifests in the
> correct order. Companion commands: `./k8s/deploy.sh status` (pod/service/ingress
> status), `./k8s/deploy.sh forward` (port-forward all services to localhost),
> `./k8s/deploy.sh destroy` (delete the namespace). The manual steps below apply
> only the core services (Redis, api-server, mcp-server, langchain-agent, frontend)
> — use `kubectl apply -f k8s/` or `deploy.sh` to apply the full set.

### 1. Create Namespace and Infrastructure
```bash
kubectl apply -f k8s/01-namespace.yaml
kubectl apply -f k8s/02-configmap.yaml
kubectl apply -f k8s/03-secrets.yaml
```

### 2. Deploy Redis (Backend Services First)
```bash
kubectl apply -f k8s/50-redis-deployment.yaml
```

Wait for Redis to be ready:
```bash
kubectl wait --for=condition=ready pod -l component=redis -n ai-demo --timeout=300s
```

### 3. Deploy Backend Services
```bash
kubectl apply -f k8s/20-api-server-deployment.yaml
kubectl apply -f k8s/30-mcp-server-deployment.yaml
kubectl apply -f k8s/40-agent-service-deployment.yaml
```

Wait for backend services:
```bash
kubectl wait --for=condition=ready pod -l component=api-server -n ai-demo --timeout=300s
kubectl wait --for=condition=ready pod -l component=mcp-server -n ai-demo --timeout=300s
kubectl wait --for=condition=ready pod -l component=langchain-agent -n ai-demo --timeout=300s
```

### 4. Deploy Frontend
```bash
kubectl apply -f k8s/10-frontend-deployment.yaml
```

Wait for frontend:
```bash
kubectl wait --for=condition=ready pod -l component=frontend -n ai-demo --timeout=300s
```

## Verification

### Check All Pods
```bash
kubectl get pods -n ai-demo
```

Expected output:
```
NAME                                      READY   STATUS    RESTARTS   AGE
langchain-agent-xxxxxxxxxx-xxxxx    1/1     Running   0          2m
banking-api-server-xxxxxxxxxx-xxxxx       1/1     Running   0          2m
frontend-xxxxxxxxxx-xxxxx          1/1     Running   0          1m
mcp-server-xxxxxxxxxx-xxxxx        1/1     Running   0          2m
redis-0                                   1/1     Running   0          3m
```

### Check Services
```bash
kubectl get services -n ai-demo
```

### Check Ingress
```bash
kubectl get ingress -n ai-demo
```

### Test Endpoints
```bash
# Frontend health
kubectl exec -n ai-demo deployment/frontend -- curl -s http://localhost:3000 | head -10

# API server health
kubectl exec -n ai-demo deployment/banking-api-server -- curl -s http://localhost:3001/health

# MCP server health
kubectl exec -n ai-demo deployment/mcp-server -- curl -s http://localhost:8080/.well-known/mcp-server

# Agent service health
kubectl exec -n ai-demo deployment/langchain-agent -- curl -s http://localhost:8080/health
```

## Configuration

### Environment Variables
Key configuration in `k8s/02-configmap.yaml`:
- Frontend URLs and API endpoints
- Service ports and hosts
- Feature flags
- Banking configuration

### Secrets
Sensitive data in `k8s/03-secrets.yaml`:
- PingOne credentials
- Database passwords
- JWT secrets
- API keys

### Resource Limits
Each deployment includes resource limits:
- Frontend: 128-256Mi memory, 100-200m CPU
- API Server: 256-512Mi memory, 200-500m CPU
- MCP Server: 256-512Mi memory, 200-500m CPU
- Agent Service: 512Mi-2Gi memory, 300-1000m CPU
- Redis: 128-512Mi memory, 100-300m CPU

## Scaling

### Horizontal Pod Autoscaling
API Server has HPA configured:
```bash
kubectl get hpa -n ai-demo
```

Manual scaling:
```bash
kubectl scale deployment banking-api-server --replicas=3 -n ai-demo
```

### Resource Adjustments
Modify `resources` sections in deployment manifests as needed.

## Monitoring and Logging

### Pod Logs
```bash
# Frontend logs
kubectl logs -n ai-demo deployment/frontend -f

# API server logs
kubectl logs -n ai-demo deployment/banking-api-server -f

# MCP server logs
kubectl logs -n ai-demo deployment/mcp-server -f

# Agent service logs
kubectl logs -n ai-demo deployment/langchain-agent -f

# Redis logs
kubectl logs -n ai-demo statefulset/redis -f
```

### Health Checks
All services include liveness and readiness probes. Check status:
```bash
kubectl describe pod -n ai-demo -l component=api-server
```

## Troubleshooting

### Common Issues

#### Pod Not Starting
```bash
kubectl describe pod -n ai-demo <pod-name>
kubectl logs -n ai-demo <pod-name>
```

#### Service Not Accessible
```bash
kubectl get endpoints -n ai-demo
kubectl describe service -n ai-demo <service-name>
```

#### Ingress Not Working
```bash
kubectl describe ingress -n ai-demo
kubectl logs -n ingress-nginx-controller ingress-nginx-controller
```

#### Redis Connection Issues
```bash
kubectl exec -n ai-demo deployment/banking-api-server -- ping redis-service
kubectl exec -n ai-demo deployment/banking-api-server -- telnet redis-service 6379
```

### Debug Commands
```bash
# Port forward to local
kubectl port-forward -n ai-demo service/frontend 3000:3000
kubectl port-forward -n ai-demo service/banking-api-server 3001:3001

# Exec into pod
kubectl exec -it -n ai-demo deployment/banking-api-server -- /bin/sh

# Check events
kubectl get events -n ai-demo --sort-by='.lastTimestamp'
```

## Maintenance

### Updates
The simplest path is the helper script, which rebuilds the image(s) and rolls the
matching deployment(s) — required because images are `:latest` / `IfNotPresent`:
```bash
# Rebuild + restart everything
./k8s/update.sh

# …or only specific services
./k8s/update.sh banking-api-server frontend
```

To do it manually:
```bash
docker compose build banking-api-server
kubectl rollout restart deployment/banking-api-server -n ai-demo
kubectl rollout status  deployment/banking-api-server -n ai-demo
```

### Rollbacks
```bash
kubectl rollout undo deployment/frontend -n ai-demo
```

### Backup Redis
```bash
kubectl exec -n ai-demo redis-0 -- redis-cli BGSAVE
kubectl cp ai-demo/redis-0:/data/dump.rdb ./redis-backup.rdb
```

## Security

### Network Policies
Namespace includes network policy restricting traffic to same namespace and ingress controller.

### Pod Security
All pods run as non-root users with proper security contexts.

### Secrets Management
Use Kubernetes secrets for sensitive data. Never commit actual secrets to version control.

## Cleanup

Remove all resources:
```bash
kubectl delete namespace ai-demo
```

Or remove individual components:
```bash
kubectl delete -f k8s/10-frontend-deployment.yaml
kubectl delete -f k8s/20-api-server-deployment.yaml
kubectl delete -f k8s/30-mcp-server-deployment.yaml
kubectl delete -f k8s/40-agent-service-deployment.yaml
kubectl delete -f k8s/50-redis-deployment.yaml
kubectl delete -f k8s/02-configmap.yaml
kubectl delete -f k8s/01-namespace.yaml
```

## Production Considerations

### High Availability
- Use multiple replicas for stateless services
- Configure Redis clustering for HA
- Use persistent storage with backup strategy

### Performance
- Enable resource monitoring
- Configure appropriate resource limits
- Use CDN for static assets

### Security
- Enable RBAC
- Use network policies
- Regular security updates
- Audit logging

### Monitoring
- Deploy Prometheus + Grafana
- Configure alerting
- Log aggregation with ELK stack

## Support

For issues with the AI Demo Kubernetes deployment:

1. Check this guide for common solutions
2. Review pod logs and events
3. Verify configuration in ConfigMaps and Secrets
4. Ensure all prerequisites are met

The deployment is designed to be production-ready with proper resource management, health checks, and security configurations.

---

# DevOps Command Reference: kubectl, git & gh

A comprehensive guide for day-to-day development and operations workflows beyond this project's specific deploy scripts.

---

## kubectl — Cluster Management Commands

### Context & Configuration

| Command | When to Use |
|---------|-------------|
| `kubectl config get-contexts` | See all configured clusters/namespaces you can switch between |
| `kubectl config current-context` | Confirm which cluster you're pointed at before running commands |
| `kubectl config use-context <ctx>` | Switch to a different cluster (e.g., dev → staging → prod, or `us` for SE cluster) |
| `kubectl config set-context --current --namespace=<ns>` | Change your default namespace so you don't have to pass `-n` every time |

### Viewing Resources

| Command | When to Use |
|---------|-------------|
| `kubectl get pods -n <ns>` | Quick health check — see pod status, restarts, age |
| `kubectl get pods -o wide` | Need node placement and IP info for debugging networking |
| `kubectl get deployments` | See desired vs available replica counts |
| `kubectl get services` | Find ClusterIPs, LoadBalancer IPs, and port mappings |
| `kubectl get ingress` | Check external routing rules and hostnames |
| `kubectl get all -n <ns>` | Broad survey of everything in a namespace |
| `kubectl get events --sort-by=.lastTimestamp` | Diagnose why a pod won't start (image pull errors, scheduling failures) |
| `kubectl describe pod <pod>` | Deep dive into a specific pod — events, conditions, volumes, env |
| `kubectl describe deployment <dep>` | See rollout strategy, selector, current conditions |
| `kubectl top pods` | Check CPU/memory consumption (requires metrics-server) |
| `kubectl top nodes` | Cluster-level resource pressure check |

### Logs & Debugging

| Command | When to Use |
|---------|-------------|
| `kubectl logs <pod>` | Read stdout/stderr from a running or recently crashed pod |
| `kubectl logs <pod> -c <container>` | Multi-container pod — target the sidecar or init container |
| `kubectl logs <pod> --previous` | Pod crash-looped — read logs from the *last* run |
| `kubectl logs -f <pod>` | Stream logs in real-time while reproducing a bug |
| `kubectl logs -l app=<label>` | Aggregate logs from all pods behind a service |
| `kubectl exec -it <pod> -- /bin/sh` | Get a shell inside a running pod for interactive debugging |
| `kubectl exec <pod> -- <cmd>` | Run a one-off command (e.g., `curl localhost:8080/health`) |
| `kubectl port-forward svc/<svc> 8080:80` | Access a cluster-internal service from your laptop |
| `kubectl cp <pod>:/path ./local` | Pull a file (heap dump, config) out of a pod |

### Deployments & Rollouts

| Command | When to Use |
|---------|-------------|
| `kubectl apply -f <file.yaml>` | Deploy or update resources declaratively from manifests |
| `kubectl apply -k <dir>` | Apply a kustomize overlay (environment-specific patches) |
| `kubectl rollout status deployment/<dep>` | Wait and confirm a deployment fully rolled out (use in CI) |
| `kubectl rollout history deployment/<dep>` | See previous revisions and change causes |
| `kubectl rollout undo deployment/<dep>` | Immediate rollback to the prior revision during an incident |
| `kubectl rollout undo deployment/<dep> --to-revision=<n>` | Roll back to a specific known-good revision |
| `kubectl rollout restart deployment/<dep>` | Force pods to recreate (pick up new ConfigMap/Secret, refresh image with `imagePullPolicy: Always`) |
| `kubectl set image deployment/<dep> <ctr>=<image>:<tag>` | Quick image bump without editing YAML (good for hotfixes) |
| `kubectl scale deployment/<dep> --replicas=<n>` | Manual horizontal scaling (load spike, or scale to 0 to stop traffic) |

### Namespace & Resource Management

| Command | When to Use |
|---------|-------------|
| `kubectl create namespace <ns>` | Stand up a new isolated environment |
| `kubectl delete pod <pod> -n <ns>` | Kill a stuck pod and let the deployment recreate it |
| `kubectl delete -f <file.yaml>` | Tear down resources you previously applied |
| `kubectl label pod <pod> status=debug` | Temporarily tag a pod (e.g., to exclude from service selector) |
| `kubectl annotate deployment <dep> kubernetes.io/change-cause="..."` | Document *why* a change was made (shows in rollout history) |

### Secrets & ConfigMaps

| Command | When to Use |
|---------|-------------|
| `kubectl get secrets -n <ns>` | List available secrets |
| `kubectl get secret <name> -o jsonpath='{.data.<key>}' \| base64 -d` | Read a secret value (careful in shared terminals!) |
| `kubectl create secret generic <name> --from-literal=key=val` | Quick secret creation for dev/test |
| `kubectl create configmap <name> --from-file=<path>` | Load config files into a ConfigMap |
| `kubectl edit configmap <name>` | Modify config in-place (pods need restart to pick up changes) |

### Multi-Service Rollout Restart (Common Pattern)

When a deploy script updates one service but smoke checks detect stale pods on others:

```bash
# Restart all stale deployments at once
kubectl rollout restart deployment svc1 svc2 svc3 -n <namespace>

# Wait for all of them to finish
kubectl rollout status deployment svc1 svc2 svc3 -n <namespace>
```

**AI Demo example** (from smoke check #2 failure):
```bash
kubectl rollout restart deployment embeddings frontend hitl-service \
  llama-tier5 llamaindex-agent llm-proxy mcp-code-search mcp-invest \
  tier-manager weaviate -n ping-devops-cmuir

kubectl rollout status deployment embeddings frontend hitl-service \
  llama-tier5 llamaindex-agent llm-proxy mcp-code-search mcp-invest \
  tier-manager weaviate -n ping-devops-cmuir
```

---

## git — Version Control

### Setup & Configuration

| Command | When to Use |
|---------|-------------|
| `git config --global user.name "Name"` | First-time setup or when changing identity |
| `git config --global user.email "email"` | Associate commits with your GitHub/work email |
| `git config --global pull.rebase true` | Keep history linear by default (team preference) |
| `git config --list --show-origin` | Debug which config file is setting a value |
| `git clone <url>` | Get a copy of a remote repo to start working |
| `git clone --depth 1 <url>` | Fast shallow clone when you only need latest code (CI, quick edits) |

### Daily Workflow

| Command | When to Use |
|---------|-------------|
| `git status` | Before every commit — see what's staged, modified, untracked |
| `git diff` | Review unstaged changes before deciding what to stage |
| `git diff --staged` | Review what you're about to commit |
| `git add <file>` | Stage specific files (prefer over `git add .` for clarity) |
| `git add -p` | Interactively stage hunks — split unrelated changes into separate commits |
| `git commit -m "message"` | Commit staged work with a concise description |
| `git commit --amend` | Fix the last commit message or add a forgotten file (before pushing) |
| `git push origin <branch>` | Share your branch with the team / open a PR |
| `git push -u origin <branch>` | First push of a new branch — sets up tracking |
| `git pull` | Fetch + integrate remote changes into your current branch |
| `git fetch` | Download remote updates without merging (safe to run anytime) |

### Branching

| Command | When to Use |
|---------|-------------|
| `git branch` | List local branches and see which one you're on |
| `git branch -a` | See all branches including remote tracking branches |
| `git checkout -b <branch>` | Start a new feature/fix branch from current HEAD |
| `git checkout <branch>` | Switch to an existing branch |
| `git switch <branch>` | Modern alternative to checkout for switching (Git 2.23+) |
| `git switch -c <branch>` | Modern alternative to `checkout -b` |
| `git branch -d <branch>` | Delete a merged branch (cleanup after PR merge) |
| `git branch -D <branch>` | Force-delete an unmerged branch (abandoned work) |

### Merging & Rebasing

| Command | When to Use |
|---------|-------------|
| `git merge <branch>` | Integrate another branch (creates merge commit) |
| `git rebase main` | Replay your branch commits on top of latest main (cleaner history) |
| `git rebase -i HEAD~<n>` | Squash, reorder, or edit recent commits before PR |
| `git merge --abort` | Bail out of a conflicted merge |
| `git rebase --abort` | Bail out of a conflicted rebase |
| `git cherry-pick <sha>` | Pull a single commit from another branch (hotfix backport) |

### Undoing & Recovering

| Command | When to Use |
|---------|-------------|
| `git stash` | Temporarily shelve changes to switch context |
| `git stash pop` | Restore stashed changes |
| `git stash list` | See all stashed work |
| `git reset HEAD <file>` | Unstage a file (keep working changes) |
| `git reset --soft HEAD~1` | Undo last commit but keep changes staged (fix commit split) |
| `git reset --hard HEAD~1` | **Destructive** — discard last commit and changes entirely |
| `git revert <sha>` | Create a new commit that undoes a previous one (safe for shared branches) |
| `git reflog` | Find "lost" commits after a bad reset or rebase |
| `git restore <file>` | Discard working directory changes for a file (Git 2.23+) |
| `git clean -fd` | Remove untracked files and directories (use with caution) |

### Inspecting History

| Command | When to Use |
|---------|-------------|
| `git log --oneline` | Quick commit overview |
| `git log --oneline --graph` | Visualize branch topology |
| `git log -p <file>` | See full change history for one file |
| `git log --author="name"` | Filter commits by author |
| `git log --since="2 weeks ago"` | Time-bound history search |
| `git blame <file>` | Find who last changed each line (debugging regressions) |
| `git show <sha>` | Inspect a single commit's diff |
| `git diff main...<branch>` | See all changes a branch introduces vs main |

### Tags & Releases

| Command | When to Use |
|---------|-------------|
| `git tag v1.2.3` | Mark a release point (lightweight tag) |
| `git tag -a v1.2.3 -m "Release notes"` | Annotated tag with metadata (preferred for releases) |
| `git push origin --tags` | Push tags to remote (needed for CI release triggers) |

---

## gh — GitHub CLI

### Authentication & Setup

| Command | When to Use |
|---------|-------------|
| `gh auth login` | First-time setup or token refresh |
| `gh auth status` | Verify you're authenticated and which account |
| `gh auth switch` | Switch between multiple GitHub accounts |

### Repository Operations

| Command | When to Use |
|---------|-------------|
| `gh repo clone <owner/repo>` | Clone with automatic auth (no SSH key config needed) |
| `gh repo fork` | Fork the current repo to your account |
| `gh repo create <name> --public` | Create a new remote repository |
| `gh repo view` | Quick info about the current repo |
| `gh repo view --web` | Open the repo in your browser |

### Pull Requests

| Command | When to Use |
|---------|-------------|
| `gh pr create` | Open a PR interactively from current branch |
| `gh pr create --title "..." --body "..."` | Non-interactive PR creation (CI/scripts) |
| `gh pr create --draft` | Open a WIP PR for early feedback |
| `gh pr list` | See open PRs in the repo |
| `gh pr list --author @me` | Find your own open PRs |
| `gh pr view <number>` | Read PR description, status, checks |
| `gh pr view <number> --web` | Open PR in browser for full review |
| `gh pr checkout <number>` | Pull down someone's PR branch to test locally |
| `gh pr diff <number>` | View PR diff in terminal |
| `gh pr merge <number>` | Merge a PR (prompts for strategy) |
| `gh pr merge <number> --squash` | Squash merge — clean single-commit history |
| `gh pr merge <number> --rebase` | Rebase merge — linear history, individual commits |
| `gh pr merge <number> --delete-branch` | Merge and clean up the remote branch |
| `gh pr close <number>` | Close without merging (abandoned work) |
| `gh pr ready <number>` | Convert draft PR to ready for review |
| `gh pr review <number> --approve` | Approve a PR |
| `gh pr review <number> --request-changes -b "reason"` | Request changes with comment |
| `gh pr checks <number>` | See CI check status for a PR |

### Issues

| Command | When to Use |
|---------|-------------|
| `gh issue create` | File a bug or feature request interactively |
| `gh issue create --title "..." --body "..." --label bug` | Script-friendly issue creation |
| `gh issue list` | See open issues |
| `gh issue list --assignee @me` | Find issues assigned to you |
| `gh issue list --label "priority:high"` | Filter by label |
| `gh issue view <number>` | Read issue details and comments |
| `gh issue close <number>` | Close a resolved issue |
| `gh issue reopen <number>` | Reopen a prematurely closed issue |
| `gh issue comment <number> --body "..."` | Add a comment to an issue |

### Workflows & Actions

| Command | When to Use |
|---------|-------------|
| `gh run list` | See recent workflow runs and their status |
| `gh run view <id>` | Inspect a specific run's jobs and steps |
| `gh run view <id> --log-failed` | Get logs for failed steps only (fast debugging) |
| `gh run watch <id>` | Stream live status updates for an in-progress run |
| `gh run rerun <id>` | Re-trigger a failed workflow |
| `gh run rerun <id> --failed` | Re-run only the failed jobs (faster) |
| `gh workflow list` | See available workflows |
| `gh workflow run <workflow>` | Manually trigger a workflow_dispatch workflow |

### Releases

| Command | When to Use |
|---------|-------------|
| `gh release list` | See existing releases |
| `gh release create <tag> --title "..." --notes "..."` | Create a release with a tag |
| `gh release create <tag> --generate-notes` | Auto-generate release notes from merged PRs |
| `gh release download <tag>` | Download release assets |
| `gh release delete <tag> --yes` | Remove a botched release |

### Gists & Misc

| Command | When to Use |
|---------|-------------|
| `gh gist create <file>` | Quick code/log sharing |
| `gh gist create <file> --public` | Publicly shareable snippet |
| `gh api <endpoint>` | Hit any GitHub REST/GraphQL API directly |
| `gh alias set <name> '<command>'` | Create shortcuts for frequent operations |
| `gh extension install <ext>` | Add community CLI extensions |

---

## Common Workflow Recipes

### Feature Development (End-to-End)

```bash
# 1. Start from latest main
git checkout main && git pull

# 2. Create feature branch
git checkout -b feat/my-feature

# 3. Make changes, commit
git add src/feature.ts
git commit -m "feat: add new feature"

# 4. Push and create PR
git push -u origin feat/my-feature
gh pr create --title "feat: add new feature" --body "Description of changes"

# 5. After approval, merge
gh pr merge --squash --delete-branch
```

### Hotfix to Production

```bash
# 1. Branch from production tag
git checkout -b hotfix/critical-bug v2.3.1

# 2. Fix and commit
git add .
git commit -m "fix: resolve critical null pointer in auth"

# 3. Push, PR, merge quickly
git push -u origin hotfix/critical-bug
gh pr create --title "fix: critical auth null pointer" --label "hotfix"

# 4. After merge, tag the release
git checkout main && git pull
git tag -a v2.3.2 -m "Hotfix: auth null pointer"
git push origin --tags
gh release create v2.3.2 --generate-notes
```

### Deploying to Ping SE DevOps Cluster

```bash
# 1. Ensure prerequisites
gh auth status
kubectl config use-context us

# 2. Full build + deploy (first time or major changes)
./run-pingaws.sh start

# 3. Incremental update (backend only)
./run-pingaws.sh update code bff

# 4. Incremental update (frontend only)
./run-pingaws.sh update code frontend

# 5. Config/secrets change (no rebuild)
./run-pingaws.sh update config

# 6. Check status
./run-pingaws.sh status

# 7. Verify live
curl https://ai-demo.ping-devops.com/api/health
```

### Debugging a Failed Deployment

```bash
# 1. Check what's running
kubectl get pods -n <namespace>
kubectl get events --sort-by=.lastTimestamp -n <namespace>

# 2. Read logs from the failing pod
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> --previous  # if crash-looping

# 3. Check the deployment status
kubectl rollout status deployment/<name> -n <namespace>

# 4. If stuck, rollback
kubectl rollout undo deployment/<name> -n <namespace>

# 5. Or restart to pick up config changes
kubectl rollout restart deployment/<name> -n <namespace>
```

### Investigating CI Failures

```bash
# 1. Find the failed run
gh run list --status failure

# 2. Get the failed logs
gh run view <run-id> --log-failed

# 3. If it's flaky, re-run just failed jobs
gh run rerun <run-id> --failed
```

---

## Quick Decision Guide

| I want to... | Use |
|--------------|-----|
| See what's broken in the cluster | `kubectl get pods` + `kubectl describe` + `kubectl logs` |
| Deploy new code | `kubectl apply` or `kubectl set image` |
| Deploy to Ping SE cluster | `./run-pingaws.sh` or `./run-pingaws.sh update code <svc>` |
| Rollback a bad deploy | `kubectl rollout undo` |
| Force pods to refresh | `kubectl rollout restart` |
| Save my code changes | `git add` + `git commit` |
| Share code for review | `git push` + `gh pr create` |
| Undo a mistake locally | `git reset` or `git stash` |
| Undo a mistake on shared branch | `git revert` |
| Check CI status | `gh run list` + `gh run view` |
| Quickly debug someone's PR | `gh pr checkout` |

---

*Last updated: July 2026*
