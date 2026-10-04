#!/usr/bin/env bash
# se-gateways.sh — keep the two Privilege AI Gateway nodes on the same sidecar list.
#
# Gateway 1 (release agentless-mcpgw, ping-devops-curtismuir) and gateway 2 (release
# agentless-mcpgw2, ping-devops-cmuir) are two nodes of ONE mesh cluster, and a sidecar
# app's backend is `localhost` in whichever pod takes the call. So both releases need
# the same sidecars (sidecars.values.yaml) and the sidecars' secrets in both namespaces.
# See privilege/GATEWAY-LOAD-BALANCER.md section 00.
#
# Usage:
#   scripts/se-gateways.sh secrets [--force]    copy sidecar secrets gateway 1 ns -> gateway 2 ns
#   scripts/se-gateways.sh upgrade [--apply]    render-check both releases; --apply upgrades them
#   scripts/se-gateways.sh status               release revisions and pod readiness
#
# Without --apply, `upgrade` only runs `helm upgrade --dry-run` and checks the render.
# `secrets` never overwrites an existing secret unless --force, and never prints a value.
# Env: SE_KUBE_CONTEXT (default us), GW1_NS, GW2_NS, GW1_RELEASE, GW2_RELEASE.

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
AG="$BASEDIR/pingone-privgateway-helm-main/agentless"
CHART="$AG/agentless-mcpgw"   # the source dir, never the .tgz: the packaged chart goes stale
CTX="${SE_KUBE_CONTEXT:-us}"
GW1_NS="${GW1_NS:-ping-devops-curtismuir}"; GW1_REL="${GW1_RELEASE:-agentless-mcpgw}"
GW2_NS="${GW2_NS:-ping-devops-cmuir}";      GW2_REL="${GW2_RELEASE:-agentless-mcpgw2}"
SECRETS=(brave-secrets banking-rest-secrets pingone-mcp-secrets mcp-grafana-secrets ghcr-pull-secret)

# Sidecar containers the render must contain: read from the values file, so adding one
# there needs no edit here.
sidecar_names() { awk '/^extraContainers:/{on=1; next} on && /^  - name: /{print $3}' "$AG/sidecars.values.yaml"; }

cmd_secrets() {
  local force=0 s n=0 skipped=0
  [[ "${1:-}" == "--force" ]] && force=1
  for s in "${SECRETS[@]}"; do
    if ! kubectl --context "$CTX" -n "$GW1_NS" get secret "$s" >/dev/null 2>&1; then
      echo "MISSING in $GW1_NS: $s (nothing to copy)" >&2; skipped=$((skipped+1)); continue
    fi
    if [[ $force -eq 0 ]] && kubectl --context "$CTX" -n "$GW2_NS" get secret "$s" >/dev/null 2>&1; then
      echo "kept     $s (already in $GW2_NS)"; continue
    fi
    # Strip server-set metadata so the object applies cleanly in the other namespace.
    kubectl --context "$CTX" -n "$GW1_NS" get secret "$s" -o json \
      | python3 -c 'import json,sys; o=json.load(sys.stdin); m=o["metadata"]; o["metadata"]={"name":m["name"],"namespace":sys.argv[1]}; print(json.dumps(o))' "$GW2_NS" \
      | kubectl --context "$CTX" apply -f - >/dev/null
    echo "copied   $s -> $GW2_NS"; n=$((n+1))
  done
  # A gateway reads these at pod start, so copying alone does not reach a running pod.
  [[ $n -gt 0 ]] && echo "Copied $n. Run '$0 upgrade --apply' (or restart gateway 2) so its pod picks them up."
  [[ $skipped -eq 0 ]] || { echo "$skipped secret(s) missing in $GW1_NS" >&2; return 1; }
}

# upgrade_one <ns> <release> <extra helm args...>: dry-run, check the render, optionally apply.
upgrade_one() {
  local ns="$1" rel="$2"; shift 2
  local args=(upgrade "$rel" "$CHART" --kube-context "$CTX" -n "$ns" --reuse-values
              -f "$AG/sidecars.values.yaml" "$@")
  local render name missing=()
  render="$(helm "${args[@]}" --dry-run 2>&1)" || { echo "$render" >&2; echo "FAIL $rel: dry-run errored" >&2; return 1; }
  # `helm get values` reports values a stale template never consumed; only the render is proof.
  while read -r name; do
    grep -q "name: $name\$" <<<"$render" || missing+=("$name")
  done < <(sidecar_names)
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "FAIL $rel: render is missing sidecar(s): ${missing[*]} — upgrading would drop them" >&2
    return 1
  fi
  echo "OK   $rel ($ns): render contains all $(sidecar_names | wc -l | tr -d ' ') sidecars"
  if [[ "$APPLY" == 1 ]]; then helm "${args[@]}"; fi
}

cmd_upgrade() {
  APPLY=0; [[ "${1:-}" == "--apply" ]] && APPLY=1
  # Gateway 2 first: it is the node that is not carrying the apps while it restarts.
  upgrade_one "$GW2_NS" "$GW2_REL" -f "$AG/gateway2-mesh.values.yaml" --set landingPage.enabled=false
  upgrade_one "$GW1_NS" "$GW1_REL" -f "$AG/gateway1-lb.values.yaml"
  [[ $APPLY -eq 1 ]] || echo "Dry run only. Re-run with --apply to upgrade."
}

cmd_status() {
  local ns rel
  for pair in "$GW1_NS $GW1_REL" "$GW2_NS $GW2_REL"; do
    read -r ns rel <<<"$pair"
    helm --kube-context "$CTX" -n "$ns" list -f "^${rel}\$" 2>&1 | tail -n +2
    kubectl --context "$CTX" -n "$ns" get pods -l app=agentless-mcpgw --no-headers 2>&1 || true
  done
}

case "${1:-}" in
  secrets) shift; cmd_secrets "$@" ;;
  upgrade) shift; cmd_upgrade "$@" ;;
  status)  cmd_status ;;
  *) sed -n 2,19p "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
