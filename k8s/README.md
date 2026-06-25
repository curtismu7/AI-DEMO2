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
