#!/usr/bin/env bash
# k8s/aws/ecr-setup.sh — One-time: create ECR repos for all AI Demo services.
#
# Usage:
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=us-east-1 ./k8s/aws/ecr-setup.sh
#
# Run once per AWS account. Idempotent — safe to re-run.

set -euo pipefail

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID}"
AWS_REGION="${AWS_REGION:-us-east-1}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }

REPOS=(
  ai-demo/frontend
  ai-demo/demo-api-server
  ai-demo/mcp-server
  ai-demo/mcp-gateway
  ai-demo/agent-service
  ai-demo/hitl-service
  ai-demo/mcp-resource-server
  ai-demo/api-resource-server
  ai-demo/langchain-agent
  ai-demo/openai-agent
  ai-demo/mastra-agent
  ai-demo/pydantic-agent
)

for repo in "${REPOS[@]}"; do
  if aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" &>/dev/null; then
    info "Repo already exists: $repo"
  else
    aws ecr create-repository \
      --repository-name "$repo" \
      --region "$AWS_REGION" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 \
      --output json | jq -r '.repository.repositoryUri' | xargs -I{} echo "[OK] Created: {}"
  fi
done

success "All ECR repos ready in ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
