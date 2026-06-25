# AWS EKS Deployment Guide

## Overview

The app deploys to AWS EKS via GitHub Actions. Images are stored in GHCR (GitHub Container Registry — free, no Docker Hub or ECR needed).

```text
git push main
  → GitHub Actions builds all 12 Docker images
  → pushes to ghcr.io (one image per service)
  → kubectl apply deploys to EKS
  → ALB routes HTTPS traffic to the frontend
```

---

## One-time setup checklist

### 1. EKS cluster

Create a cluster (eksctl is the quickest path):

```bash
eksctl create cluster --name ai-demo-cluster --region us-east-1 --nodes 2
```

### 2. AWS Load Balancer Controller

Required for the ALB Ingress to work. Install it in the cluster:

```text
https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html
```

### 3. GHCR (no setup needed)

Images are stored in GitHub Container Registry (`ghcr.io`). Repos are created automatically on first push — no setup step required.

Authenticate locally once:

```bash
gh auth login
```

### 4. ACM certificate (for HTTPS)

ACM = AWS Certificate Manager. Free TLS certificates that auto-renew. The ALB uses this to terminate HTTPS — your pods run plain HTTP internally.

**Does not require Route 53.** Validate via a CNAME at whatever DNS provider you use.

**Steps:**

1. AWS Console → Certificate Manager → **Request certificate**
2. Enter your domain (e.g. `demo.yourdomain.com`)
3. Choose **DNS validation**
4. AWS gives you a CNAME record — add it at your DNS provider (Cloudflare, GoDaddy, etc.)
5. Wait for status to change to **Issued** (usually a few minutes)
6. Copy the ARN:

```text
arn:aws:acm:us-east-1:123456789012:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

1. Paste it into `k8s/aws/ingress.yaml`:

```yaml
alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:..."
```

### 5. GitHub secrets

Add these in GitHub → Settings → Secrets → Actions:

| Secret         | Value                                        |
|----------------|----------------------------------------------|
| `OIDC_ROLE_ARN`| IAM role ARN for GitHub OIDC (see below)     |

`GITHUB_TOKEN` is automatic — no secret needed for GHCR.

**OIDC role** — allows GitHub Actions to authenticate to AWS without long-lived keys:

```text
https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html
```

The role needs: `eks:DescribeCluster` + `aws-auth` ConfigMap entry.

### 6. PingOne redirect URIs

Update both PingOne apps (Admin + User) to add your new domain:

```text
https://demo.yourdomain.com/api/auth/oauth/callback
https://demo.yourdomain.com/api/auth/oauth/user/callback
```

---

## Day-to-day commands

```bash
# Full deploy from local machine
GITHUB_OWNER=myorg AWS_REGION=us-east-1 EKS_CLUSTER_NAME=ai-demo-cluster \
  ./run-k8.sh aws-all

# Build + push images to GHCR only
./run-k8.sh aws-build        # GITHUB_OWNER auto-detected from git remote

# Deploy manifests only (no rebuild)
GITHUB_OWNER=myorg AWS_REGION=us-east-1 EKS_CLUSTER_NAME=ai-demo-cluster \
  ./run-k8.sh aws-deploy

# Check what's running
kubectl get pods -n ai-demo
kubectl get ingress ai-demo-ingress -n ai-demo   # shows ALB hostname
```

---

## Key files

| File                                  | Purpose                                     |
|---------------------------------------|---------------------------------------------|
| `k8s/aws/deploy.sh`                   | Deploy to EKS (substitutes GHCR image URIs) |
| `k8s/aws/ingress.yaml`                | ALB Ingress — paste ACM cert ARN here       |
| `k8s/aws/nginx-http-configmap.yaml`   | nginx HTTP config for behind-ALB use        |
| `.github/workflows/deploy.yml`        | CI/CD pipeline (GHCR + EKS)                |
