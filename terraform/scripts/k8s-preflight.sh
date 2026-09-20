#!/usr/bin/env bash
set -euo pipefail

: "${AI_DEMO_K8S_NAMESPACE:?AI_DEMO_K8S_NAMESPACE is required}"
: "${AI_DEMO_K8S_CONTEXT:?AI_DEMO_K8S_CONTEXT is required}"

kubectl_args=(--context "$AI_DEMO_K8S_CONTEXT")
if [[ -n "${KUBECONFIG:-}" ]]; then
  export KUBECONFIG
fi

kubectl "${kubectl_args[@]}" get namespace "$AI_DEMO_K8S_NAMESPACE" >/dev/null
kubectl "${kubectl_args[@]}" auth can-i create deployments --namespace "$AI_DEMO_K8S_NAMESPACE" >/dev/null
kubectl "${kubectl_args[@]}" auth can-i create persistentvolumeclaims --namespace "$AI_DEMO_K8S_NAMESPACE" >/dev/null

if ! kubectl "${kubectl_args[@]}" get secret ai-demo-secrets --namespace "$AI_DEMO_K8S_NAMESPACE" >/dev/null 2>&1; then
  echo "Kubernetes secret ai-demo-secrets is missing in namespace $AI_DEMO_K8S_NAMESPACE." >&2
  echo "Run: K8S_NAMESPACE=$AI_DEMO_K8S_NAMESPACE ./k8s/create-secrets.sh" >&2
  exit 1
fi

echo "SE namespace preflight passed: $AI_DEMO_K8S_NAMESPACE"
