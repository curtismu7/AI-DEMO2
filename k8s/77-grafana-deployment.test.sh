#!/usr/bin/env bash
# 77-grafana-deployment.test.sh — self-check for the sync-admin-password
# initContainer in 77-grafana-deployment.yaml.
#
# Grafana's DB is on a PVC, and Grafana reads GF_SECURITY_ADMIN_PASSWORD only
# when it creates the DB, so this script is what makes a password rotation
# land. The direction worth proving is FAIL-CLOSED: once a DB exists, a missing
# password or a failed reset must stop the pod — starting would leave the old
# (possibly leaked) password valid on an internet-facing login.
#
# Extracts the script from the manifest itself, so this tests what ships rather
# than a copy, and runs it against a stub `grafana` on PATH. No cluster needed.
#
# Usage: bash k8s/77-grafana-deployment.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/77-grafana-deployment.yaml"
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/data"

# The block scalar under `- |` in the sync-admin-password container, up to its
# env:, with the manifest's 14-space indent stripped.
awk '/name: sync-admin-password/{f=1} f&&/- \|/{s=1;next} s&&/^ *env:/{exit} s{sub(/^              /,""); print}' \
  "$MANIFEST" > "$TMP/init.sh"
if ! grep -q 'reset-admin-password' "$TMP/init.sh"; then
  bad "could not extract the sync-admin-password script from $MANIFEST"
  echo; echo "  $PASS passed, $FAIL failed"; exit 1
fi

# Stub: records that a reset was attempted, exits with $STUB_EXIT.
cat > "$TMP/bin/grafana" <<EOF
#!/bin/sh
cat >/dev/null
touch "$TMP/reset-called"
exit \${STUB_EXIT:-0}
EOF
chmod +x "$TMP/bin/grafana"

# run <name> <expected exit> <expect reset y|n> [VAR=value...]
run() {
  local name=$1 want=$2 want_reset=$3; shift 3
  rm -f "$TMP/reset-called"
  env PATH="$TMP/bin:$PATH" GF_PATHS_DATA="$TMP/data" GF_PATHS_HOME=/h GF_PATHS_CONFIG=/c \
    "$@" sh "$TMP/init.sh" >/dev/null 2>&1
  local got=$? reset=n
  [[ -f "$TMP/reset-called" ]] && reset=y
  if [[ "$got" == "$want" && "$reset" == "$want_reset" ]]; then ok "$name"
  else
    bad "$name"
    printf '       expected: exit %s, reset=%s\n       got:      exit %s, reset=%s\n' "$want" "$want_reset" "$got" "$reset"
  fi
}

echo "sync-admin-password"
run "first boot, no password: starts, no reset"  0 n GF_SECURITY_ADMIN_PASSWORD=
run "first boot, password: starts, no reset"     0 n GF_SECURITY_ADMIN_PASSWORD=pw
touch "$TMP/data/grafana.db"
run "existing DB, password: resets, starts"      0 y GF_SECURITY_ADMIN_PASSWORD=pw
run "existing DB, no password: refuses to start" 1 n GF_SECURITY_ADMIN_PASSWORD=
run "existing DB, reset fails: refuses to start" 1 y GF_SECURITY_ADMIN_PASSWORD=pw STUB_EXIT=1

echo
echo "  $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
