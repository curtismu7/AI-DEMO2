#!/usr/bin/env bash
# Bring PingFederate up in the SE cluster. Called by run-k8.sh se-deploy / se-all (and so by
# run-pingaws.sh start|deploy), so every cluster deploy also brings PF up: ID-JAG (UC40) runs on it.
#
# Idempotent and soft: a running PF is left alone (only its sign-on theme is re-applied), and any
# problem is a warning, never a failed deploy.
#
#   SKIP_PINGFEDERATE=1          skip
#   PINGFEDERATE_NAMESPACE       where PF runs (default: your SE namespace; pin it in demo_api_server/.env)
#   PINGFEDERATE_HOST            public engine hostname (default: <namespace-suffix>-pf.ping-devops.com)
#   PINGFEDERATE_PROFILE_PATH    local PF profile holding the license (default ~/pingfederate-profile)
#
# This only starts the workload. A brand-new PF still needs its license agreement accepted and the
# configuration imported once: see k8s/pingfederate/README.md.
set -uo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
say()  { echo "[pingfederate] $*" >&2; }
warn() { echo "[pingfederate] WARN: $*" >&2; }

[[ "${SKIP_PINGFEDERATE:-}" == "1" ]] && { warn "SKIP_PINGFEDERATE=1 - not starting PingFederate; ID-JAG will not work here."; exit 0; }
command -v kubectl >/dev/null 2>&1 || { warn "kubectl not found; PingFederate not started."; exit 0; }

env_file="$BASEDIR/demo_api_server/.env"
env_value() { [[ -f "$env_file" ]] && grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- | tr -d '"' || true; }

app_ns="${SE_NAMESPACE:-$(env_value SE_NAMESPACE)}"
ns="${PINGFEDERATE_NAMESPACE:-$(env_value PINGFEDERATE_NAMESPACE)}"
ns="${ns:-$app_ns}"
[[ -n "$ns" ]] || { warn "no namespace (set SE_NAMESPACE or PINGFEDERATE_NAMESPACE); PingFederate not started."; exit 0; }

host="${PINGFEDERATE_HOST:-$(env_value PINGFEDERATE_HOST)}"
host="${host:-${ns#ping-devops-}-pf.ping-devops.com}"

# The Ping sign-on theme lives in PF's volume, and a fresh volume or a PF upgrade restores PF's stock
# pages, so it is re-applied on every deploy (idempotent, no restart).
login_theme() {
  bash "$BASEDIR/scripts/pingfederate/apply-login-theme.sh" --k8s "$ns" >/dev/null 2>&1 \
    || warn "sign-on theme not applied in $ns; run: bash scripts/pingfederate/apply-login-theme.sh --k8s $ns"
}

# Already running: leave the workload alone.
if [[ "$(kubectl -n "$ns" get statefulset pingfederate -o jsonpath='{.status.readyReplicas}' 2>/dev/null)" == "1" ]]; then
  say "already running in $ns (https://$host)."
  login_theme
  exit 0
fi

# Secrets are created only when missing, so a re-run never rotates the admin password.
if ! kubectl -n "$ns" get secret pingfederate-license >/dev/null 2>&1; then
  lic="${PINGFEDERATE_PROFILE_PATH:-$HOME/pingfederate-profile}/instance/server/default/conf/pingfederate.lic"
  [[ -f "$lic" ]] || { warn "no license at $lic (set PINGFEDERATE_PROFILE_PATH); PingFederate not started in $ns."; exit 0; }
  kubectl -n "$ns" create secret generic pingfederate-license --from-file=pingfederate.lic="$lic" >/dev/null \
    || { warn "could not create the license secret in $ns."; exit 0; }
  say "created secret pingfederate-license in $ns."
fi
if ! kubectl -n "$ns" get secret pingfederate-admin >/dev/null 2>&1; then
  pw="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
  kubectl -n "$ns" create secret generic pingfederate-admin --from-literal=password="$pw" >/dev/null \
    || { warn "could not create the admin secret in $ns."; exit 0; }
  unset pw
  say "created secret pingfederate-admin in $ns (read it with: kubectl -n $ns get secret pingfederate-admin -o jsonpath='{.data.password}' | base64 -d)."
fi

say "applying PingFederate to $ns (host $host)..."
if ! sed "s/cmuir-pf\.ping-devops\.com/$host/g" "$BASEDIR/k8s/pingfederate/pingfederate.yaml" | kubectl -n "$ns" apply -f - >/dev/null; then
  warn "kubectl apply failed; PingFederate not started."
  exit 0
fi
if kubectl -n "$ns" rollout status statefulset/pingfederate --timeout=300s >/dev/null 2>&1; then
  say "up in $ns: https://$host (admin is private: kubectl -n $ns port-forward svc/pingfederate-admin 9999:9999)."
  login_theme
else
  warn "started but not ready within 5 minutes; check: kubectl -n $ns logs pingfederate-0"
fi
exit 0
