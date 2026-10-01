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

printf '\nThird-party pod image references and observed runtime image IDs:\n'
"${KUBECTL[@]}" get pods -n "$NS" -o json | python3 -c '
import json, sys
pods = json.load(sys.stdin).get("items", [])
images = {}
first_party_count = 0
for pod in pods:
    status = pod.get("status", {})
    by_name = {}
    for key in ("containerStatuses", "initContainerStatuses", "ephemeralContainerStatuses"):
        by_name.update({item.get("name"): item.get("imageID", "") for item in status.get(key, [])})
    spec = pod.get("spec", {})
    for key in ("containers", "initContainers", "ephemeralContainers"):
        for container in spec.get(key, []):
            image = container.get("image", "")
            if image.startswith("ghcr.io/cmuir_pingcorp/"):
                first_party_count += 1
                continue
            images.setdefault(image, set()).add(by_name.get(container.get("name")) or "(imageID unavailable)")
print(f"Pods: {len(pods)}; first-party container entries: {first_party_count}")
if not images:
    print("(no third-party pod images)")
for image, ids in sorted(images.items()):
    print("{} => {}".format(image, "; ".join(sorted(ids))))
'

printf '\nJob image references (including seed jobs retained in the API):\n'
"${KUBECTL[@]}" get jobs -n "$NS" -o 'custom-columns=JOB:.metadata.name,STATUS:.status.conditions[-1].type,IMAGES:.spec.template.spec.containers[*].image,INIT_IMAGES:.spec.template.spec.initContainers[*].image' --no-headers

printf '\nNetworkPolicies currently present:\n'
"${KUBECTL[@]}" get networkpolicies -n "$NS" -o 'custom-columns=NAME:.metadata.name,POD_SELECTOR:.spec.podSelector.matchLabels,INGRESS:.spec.ingress[*].ports[*].port,EGRESS:.spec.egress[*].ports[*].port' --no-headers

printf '\nEvidence limits:\n'
printf '%s\n' '- Namespace labels show namespace-scoped Pod Security Admission settings only; cluster-wide admission policy may also apply.' '- NetworkPolicy objects do not prove the CNI enforces them. Confirm enforcement with the cluster operator.' '- This report intentionally does not read Secret objects, secret environment values, or service-account tokens.'
