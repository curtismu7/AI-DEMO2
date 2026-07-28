# Secrets Management Hardening

Three-layer defense: never store secrets locally, encrypt at rest in K8s, rotate via secret manager.

## Overview

| Layer | Mechanism | Safety |
|-------|-----------|--------|
| **Local Dev** | 1Password CLI OR `.env.local` | Secrets never in git; validated at deploy time |
| **Docker Compose** | Startup script pulls from 1Password/manager | No hardcoded secrets in containers |
| **Kubernetes** | Sealed-Secrets encrypts at rest in etcd | Secrets safe to commit (encrypted form); controller decrypts on pod start |

## 1. Local Development Setup

### Prerequisites
```bash
# Install 1Password CLI
brew install 1password-cli
op signin

# Verify connection
op account get
```

### Option A: Use 1Password (recommended)
```bash
# Load secrets from 1Password before running Docker
source scripts/load-secrets-docker.sh

# Then start Compose as usual
docker compose up
```

This script:
1. Connects to 1Password vault "Banking Demo"
2. Exports each service's secrets as environment variables
3. Exports to the current shell (no .env file created)
4. Falls back to `.env.local` if 1Password unavailable

### Option B: Use `.env.local` (dev fallback)
```bash
# Copy template to .env and fill with real values
cp demo_api_server/.env.template demo_api_server/.env
# Edit .env with secrets from 1Password
vi demo_api_server/.env

# .env.local is gitignored — never add it to git
docker compose up
```

## 2. Docker Compose Security

### Current State
- Each service loads from `env_file:` (e.g., `demo_api_server/.env`)
- `.env` files are gitignored (safe)
- Secrets visible in `docker inspect` (acceptable for local dev only)

### Hardening
1. **Never commit `.env` files** — already enforced by `.gitignore`
2. **Use 1Password for any shared dev environment** — `scripts/load-secrets-docker.sh`
3. **Validate no `.env` in git history** — run `git log --all --full-history -- '*.env'` (should be empty)

## 3. Kubernetes Deployment

### Install Sealed-Secrets Controller
Encrypts K8s secrets at rest in etcd (not just base64-encoded). Controller auto-decrypts for pods.

```bash
# Apply sealed-secrets controller (one-time setup)
kubectl apply -f k8s/00-sealed-secrets-install.yaml

# Verify it's running
kubectl get deploy -n kube-system sealed-secrets-controller
```

### Seal Secrets Before Commit
```bash
# Generate encrypted sealed-secret from local .env
k8s/sealed-secrets.sh

# Output: k8s/04-sealed-secrets.yaml (encrypted, safe to commit)
```

### Deploy to Cluster
```bash
# Apply namespace + secrets + deployments
kubectl apply -f k8s/01-namespace.yaml
kubectl apply -f k8s/04-sealed-secrets.yaml
kubectl apply -f k8s/05-deployments.yaml  # references sealed secret
```

### How It Works
1. `sealed-secrets.sh` reads local `.env` (unencrypted)
2. Encrypts it using the controller's public key
3. Writes `04-sealed-secrets.yaml` (encrypted blob, safe to commit)
4. At deploy time, controller's private key (in-cluster only) decrypts
5. Pods receive plain Secret objects (only in memory)

## 4. Security Properties

### ✅ What's Protected
- Secrets never in git history (audit confirmed clean)
- Secrets encrypted at rest in K8s etcd (sealed-secrets)
- Local secrets not exposed to `docker inspect` (1Password sourcing)
- K8s secret YAML is encrypted (safe to commit)

### ❌ What's NOT Protected (by design)
- Secrets visible in `docker logs` (acceptable for local dev; disable in prod)
- Secrets visible to pods via environment variables (intentional; pods need them)
- Secrets visible in K8s events/kubectl describe (use RBAC to restrict access)

## 5. Secret Rotation

### Local Dev
```bash
# Update secret in 1Password
op item edit "demo-api-server secrets"

# Restart containers to pick up new value
docker compose restart demo-api-server
```

### Kubernetes
```bash
# Update local .env
vi demo_api_server/.env  # or pull from 1Password

# Reseal and deploy
k8s/sealed-secrets.sh
kubectl apply -f k8s/04-sealed-secrets.yaml

# Pods receive new secret on next restart
kubectl rollout restart deployment/banking-api-server -n ai-demo
```

## 6. Audit & Compliance

### Verify No Secrets in Git
```bash
# Should be empty (already audited clean 2026-07-28)
git log --all --full-history -- '*.env' '*.env.local'
```

### Verify Sealed-Secrets Is Working
```bash
# Check sealed secret is encrypted (base64 blob)
kubectl get sealedsecrets ai-demo-secrets -n ai-demo -o yaml | grep -A5 spec.encryptedData

# Check pod received decrypted secret
kubectl exec -it <pod> -n ai-demo -- env | grep PINGONE_ENVIRONMENT_ID
```

### Check RBAC Restricts Secret Access
```bash
# Only sealed-secrets controller and admins should see secrets
kubectl auth can-i get secrets -n ai-demo --as=system:serviceaccount:ai-demo:default
# Should be: no
```

## 7. Troubleshooting

### "1Password CLI not found"
```bash
brew install 1password-cli
op signin
```

### "sealed-secrets-controller not running"
```bash
# Install controller
kubectl apply -f k8s/00-sealed-secrets-install.yaml

# Wait for it to start
kubectl wait --for=condition=available --timeout=60s deployment/sealed-secrets-controller -n kube-system
```

### "kubeseal command not found"
```bash
# Install kubeseal CLI
brew install kubeseal
```

### Pod not receiving secret
```bash
# Check the pod's secret volume (if using) vs env vars
kubectl exec <pod> -n ai-demo -- env | grep PINGONE

# Check sealed secret was decrypted
kubectl get secret ai-demo-secrets -n ai-demo -o yaml | grep PINGONE_ENVIRONMENT_ID
```

## References

- [Sealed-Secrets GitHub](https://github.com/getsops/sealed-secrets)
- [1Password CLI Docs](https://developer.1password.com/docs/cli)
- [Kubernetes Secrets Best Practices](https://kubernetes.io/docs/concepts/configuration/secret/)
