#!/usr/bin/env bash
# Read-only hosted security evidence collection. This script never reads Secrets
# or changes cluster resources.
set -euo pipefail

NS="${K8S_NAMESPACE:-}"
CONTEXT="${KUBE_CONTEXT:-}"

if [[ -z "$NS" ]]; then
  echo "Set K8S_NAMESPACE to the intended hosted namespace." >&2
  exit 2
fi

KUBECTL=(kubectl)
if [[ -n "$CONTEXT" ]]; then
  KUBECTL+=(--context "$CONTEXT")
fi

ACTIVE_CONTEXT="${CONTEXT:-$("${KUBECTL[@]}" config current-context)}"
printf 'Context: %s\nNamespace: %s\n' "$ACTIVE_CONTEXT" "$NS"

printf '\nNamespace Pod Security labels:\n'
"${KUBECTL[@]}" get namespace "$NS" -o 'jsonpath={.metadata.labels.pod-security\.kubernetes\.io/enforce}  {.metadata.labels.pod-security\.kubernetes\.io/enforce-version}  {.metadata.labels.pod-security\.kubernetes\.io/warn}  {.metadata.labels.pod-security\.kubernetes\.io/warn-version}  {.metadata.labels.pod-security\.kubernetes\.io/audit}  {.metadata.labels.pod-security\.kubernetes\.io/audit-version}{"\n"}'

printf '\nWorkload container images and runtime image IDs:\n'
"${KUBECTL[@]}" get pods -n "$NS" -o 'custom-columns=POD:.metadata.name,PHASE:.status.phase,CONTAINERS:.spec.containers[*].name,IMAGES:.spec.containers[*].image,IMAGE_IDS:.status.containerStatuses[*].imageID,INIT_IMAGES:.spec.initContainers[*].image,INIT_IMAGE_IDS:.status.initContainerStatuses[*].imageID' --no-headers

printf '\nJob image references (including seed jobs retained in the API):\n'
"${KUBECTL[@]}" get jobs -n "$NS" -o 'custom-columns=JOB:.metadata.name,STATUS:.status.conditions[-1].type,IMAGES:.spec.template.spec.containers[*].image,INIT_IMAGES:.spec.template.spec.initContainers[*].image' --no-headers

printf '\nNetworkPolicies currently present:\n'
"${KUBECTL[@]}" get networkpolicies -n "$NS" -o 'custom-columns=NAME:.metadata.name,POD_SELECTOR:.spec.podSelector.matchLabels,INGRESS:.spec.ingress[*].ports[*].port,EGRESS:.spec.egress[*].ports[*].port' --no-headers

printf '\nEvidence limits:\n'
printf '%s\n' '- Namespace labels show namespace-scoped Pod Security Admission settings only; cluster-wide admission policy may also apply.' '- NetworkPolicy objects do not prove the CNI enforces them. Confirm enforcement with the cluster operator.' '- This report intentionally does not read Secret objects, secret environment values, or service-account tokens.'
