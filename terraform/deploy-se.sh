#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTEXT="${KUBERNETES_CONTEXT:-us}"

if [[ -z "${SE_NAMESPACE:-}" ]]; then
  printf "Existing SE Kubernetes namespace (Terraform will not create it): " >/dev/tty
  read -r SE_NAMESPACE </dev/tty || true
fi

[[ "$SE_NAMESPACE" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || {
  echo "Invalid Kubernetes namespace: ${SE_NAMESPACE:-<empty>}" >&2
  exit 1
}

kubectl --context "$CONTEXT" get namespace "$SE_NAMESPACE" >/dev/null
echo "Using existing SE namespace: $SE_NAMESPACE"

if [[ ! -f "$REPO_ROOT/demo_api_server/.env" ]]; then
  echo "demo_api_server/.env is missing. Run ./install.sh --mode se-terraform first." >&2
  exit 1
fi

echo "Preparing namespace-scoped secrets..."
K8S_NAMESPACE="$SE_NAMESPACE" bash "$REPO_ROOT/k8s/create-secrets.sh"

export TF_VAR_target=se
export TF_VAR_namespace="$SE_NAMESPACE"
export TF_VAR_kubernetes_context="$CONTEXT"

terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=ai-demo.tfplan
terraform apply ai-demo.tfplan
