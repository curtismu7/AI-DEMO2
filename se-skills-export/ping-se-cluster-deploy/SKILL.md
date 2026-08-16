---
name: ping-se-cluster-deploy
description: >-
  Get access to and deploy an app onto Ping's shared SE DevOps Kubernetes
  cluster (ping-dev-aws-us-east-2). Use when the user wants to push a demo
  or POC to the shared SE cluster, needs first-time cluster access, hits
  kubectl showing only a local context, or needs the GHCR push / undeploy
  routine for that cluster.
---

# Deploying to the Ping SE DevOps shared Kubernetes cluster

Covers the account-setup and operational discipline for the **shared**
`ping-dev-aws-us-east-2` cluster Ping SEs use for demos/POCs. It is not
about any specific app's build — swap in your own image build/push/manifest
steps where noted.

## First-time cluster access

1. **Request a namespace** — file a DEVHELP JIRA:
   - Work type: Service Request
   - Summary: `Grant Access to AWS GTE K8's Cluster`
   - Cluster: `ping-dev-aws-us-east-2` (US / Ohio)
   - Your Ping email

2. **Install tools:**
   ```bash
   brew install int128/kubelogin/kubelogin
   brew tap mike-engel/jwt-cli
   brew install mike-engel/jwt-cli/jwt-cli
   brew install kubectx
   ```

3. **Get a kubeconfig** — Ping's internal Secret Server hosts one per
   engineer/team; download and install it:
   ```bash
   mkdir -p ~/.kube
   cp ~/Downloads/config ~/.kube/config   # adjust for your download path
   chmod 600 ~/.kube/config
   ```
   Keep a backup copy outside the default location (e.g.
   `~/.kube/backups/`) — Secret Server entries can be rotated, and you'll
   want a known-good fallback rather than re-requesting access.

4. **Switch context and authenticate:**
   ```bash
   kubectl config get-contexts          # confirm the SE cluster's context appears
   kubectl config use-context <se-context-name>
   kubens <your-namespace>              # triggers a PingOne browser login
   kubectl get namespace <your-namespace>
   ```
   First PingOne login on a new account: use "Forgotten Password" if no
   password exists yet.

## Deploy routine

From your dev machine, each session:

```bash
# 1. GHCR auth — token expires, refresh before every deploy
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u <your-github-username> --password-stdin

# 2. Build + push your app's images to GHCR
#    (your project's own build script/compose profile goes here)

# 3. Apply manifests
kubectl apply -f <your-k8s-manifests> -n <your-namespace>
```

### Verify

```bash
kubectl get pods -n <your-namespace>
curl -sf https://<your-app-hostname>/health   # or equivalent
```

### Undeploy — required, not optional

The cluster is **shared** across SEs. Tear down when your demo session
ends, or you risk losing publishing rights:

```bash
kubectl delete -f <your-k8s-manifests> -n <your-namespace>
# or your project's equivalent undeploy script
```

## Namespace naming

Namespaces are typically derived from your Ping email localpart (dots
stripped), e.g. `firstname.lastname@pingidentity.com` →
`<team-prefix>-firstnamelastname`. Confirm the exact convention with
whoever grants the DEVHELP request — it varies by team prefix, not just by
name.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No SE context in `kubectl config get-contexts` | Kubeconfig not installed, or wrong file | Re-fetch from Secret Server → `~/.kube/config` |
| `connection refused` on a local-looking port | Still on a local (e.g. OrbStack/minikube) context | `kubectl config use-context <se-context-name>` |
| GHCR login/push denied | Missing `write:packages` scope | `gh auth refresh -h github.com -s write:packages` |
| `context deadline exceeded` on kubectl | OIDC browser popup never completed | Re-run the `kubectl get namespace` command that triggers login; finish the PingOne prompt |
| 503 right after deploy | DNS/ingress not ready yet | Wait a few minutes; check `kubectl get ingress -n <namespace>` |
| Build hangs after "Built", no push output (macOS) | A Docker CLI hook (e.g. Docker AI) intercepting the push | Temporarily disable non-essential `~/.docker/cli-plugins/*` hooks |

## Agent discipline

1. Verify `kubectl config get-contexts` shows the SE cluster's context
   before running any deploy command against it.
2. Never commit secrets (`.env`, kubeconfig tokens, PATs) from this
   workflow into a repo.
3. Remind the user to undeploy when their demo session ends — this is a
   shared resource, not a personal sandbox.
