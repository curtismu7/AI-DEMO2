#!/usr/bin/env bash
# create-secrets.restart-targets.test.sh — self-check for the "restart only what
# changed" logic.
#
# create-secrets.sh used to rollout-restart nine deployments unconditionally.
# Skipping a restart is the only outcome that can ship stale config, so the
# behaviour worth proving without a cluster is the FAIL-SAFE direction: every
# way of not knowing must still restart. Getting that backwards would be
# silent — the deploy would look clean and serve the old secret.
#
# Sources ONLY the functions under test out of create-secrets.sh (same idiom as
# create-secrets.agentless-oidc.test.sh), so nothing else in that script runs.
#
# Usage: bash k8s/create-secrets.restart-targets.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/create-secrets.sh"
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1"; printf '       expected: [%s]\n       got:      [%s]\n' "$3" "$2"; fi; }

eval "$(awk '/^changed_objects\(\) \{/,/^\}/' "$SCRIPT")"
eval "$(awk '/^deployment_inputs\(\) \{/,/^\}/' "$SCRIPT")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OBJ_SNAPSHOT_BEFORE="$TMP/before"
OBJ_SNAPSHOT_AFTER="$TMP/after"

echo "changed_objects"

# Nothing moved — the whole point of the change.
cat > "$OBJ_SNAPSHOT_BEFORE" <<'EOF'
Secret/ai-demo-secrets 100
Secret/grafana-secrets 200
ConfigMap/ai-demo-config 300
EOF
cp "$OBJ_SNAPSHOT_BEFORE" "$OBJ_SNAPSHOT_AFTER"
check "identical snapshots report nothing changed" "$(changed_objects)" ""

# One object rewritten.
cat > "$OBJ_SNAPSHOT_AFTER" <<'EOF'
Secret/ai-demo-secrets 100
Secret/grafana-secrets 201
ConfigMap/ai-demo-config 300
EOF
check "a bumped resourceVersion is reported" "$(changed_objects)" "Secret/grafana-secrets"

# An object that did not exist before must count as changed, not be ignored.
cat > "$OBJ_SNAPSHOT_AFTER" <<'EOF'
Secret/ai-demo-secrets 100
Secret/grafana-secrets 200
ConfigMap/ai-demo-config 300
Secret/brand-new 1
EOF
check "a newly created object is reported" "$(changed_objects)" "Secret/brand-new"

# FAIL-SAFE: an unreadable after-snapshot must restart everything, never
# silently conclude "nothing changed".
: > "$OBJ_SNAPSHOT_AFTER"
check "empty after-snapshot escalates to __ALL__" "$(changed_objects)" "__ALL__"

# FAIL-SAFE: a missing before-snapshot must escalate too. This one caught a
# real bug: awk's NR==FNR idiom mis-parses an empty first file (the after-file's
# first record also satisfies NR==FNR and is consumed as a "before" entry), so
# the original code UNDER-reported changes and would have skipped restarts while
# knowing nothing.
: > "$OBJ_SNAPSHOT_BEFORE"
cat > "$OBJ_SNAPSHOT_AFTER" <<'EOF'
Secret/ai-demo-secrets 100
Secret/grafana-secrets 200
EOF
check "empty before-snapshot escalates to __ALL__" "$(changed_objects)" "__ALL__"

echo "deployment_inputs"

NS="test-ns"
export PATH="$TMP/bin:$PATH"
mkdir -p "$TMP/bin"

make_kubectl() {  # $1 = file to cat, or "fail"
  if [ "$1" = "fail" ]; then
    printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/bin/kubectl"
  else
    printf '#!/usr/bin/env bash\ncat %s\n' "$1" > "$TMP/bin/kubectl"
  fi
  chmod +x "$TMP/bin/kubectl"
}

cat > "$TMP/deploy.json" <<'EOF'
{ "spec": { "template": { "spec": {
  "containers": [{
    "envFrom": [
      { "secretRef":    { "name": "ai-demo-secrets" } },
      { "configMapRef": { "name": "ai-demo-config" } }
    ],
    "env": [
      { "valueFrom": { "secretKeyRef":    { "name": "gateway-secrets" } } },
      { "valueFrom": { "configMapKeyRef": { "name": "nginx-config" } } }
    ]
  }],
  "volumes": [
    { "secret":    { "secretName": "tls-certs" } },
    { "configMap": { "name": "grafana-dashboards" } }
  ]
} } } }
EOF
make_kubectl "$TMP/deploy.json"
check "reads every reference shape, sorted and deduped" \
  "$(deployment_inputs some-deploy | tr '\n' ' ')" \
  "ConfigMap/ai-demo-config ConfigMap/grafana-dashboards ConfigMap/nginx-config Secret/ai-demo-secrets Secret/gateway-secrets Secret/tls-certs "

# A deployment referencing nothing is indistinguishable from a failed read, so
# both return empty and the caller restarts. Documented here so nobody
# "optimises" the empty case into a skip.
echo '{ "spec": { "template": { "spec": { "containers": [{}] } } } }' > "$TMP/bare.json"
make_kubectl "$TMP/bare.json"
check "a deployment with no references returns empty (caller restarts)" \
  "$(deployment_inputs some-deploy)" ""

# FAIL-SAFE: kubectl failure must not look like "no inputs changed".
make_kubectl fail
check "kubectl failure returns empty (caller restarts)" "$(deployment_inputs some-deploy)" ""

echo
echo "RESULT pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
