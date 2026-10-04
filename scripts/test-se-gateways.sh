#!/bin/bash
# Runnable check for scripts/se-gateways.sh. Run: bash scripts/test-se-gateways.sh
# helm and kubectl are stubbed on PATH, so nothing here can reach a cluster; the
# assertions are about what WOULD have been called.

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
STUB="$(mktemp -d)"; LOG="$STUB/calls.log"; export LOG RENDER_DROP=""
trap 'rm -rf "$STUB"' EXIT

# helm stub: --dry-run prints every sidecar name except $RENDER_DROP; a real upgrade is logged.
cat > "$STUB/helm" <<'EOF'
#!/bin/bash
case " $* " in
  *" --dry-run "*) awk '/^extraContainers:/{on=1;next} on&&/^  - name: /{print $3}' \
      "$BASEDIR/pingone-privgateway-helm-main/agentless/sidecars.values.yaml" \
      | grep -v "^${RENDER_DROP:-NONE}\$" | sed 's/^/- name: /' ;;
  *) echo "helm $*" >> "$LOG" ;;
esac
EOF
# kubectl stub: the source namespace has every secret but mcp-grafana-secrets; the
# destination already has brave-secrets.
cat > "$STUB/kubectl" <<'EOF'
#!/bin/bash
echo "kubectl $*" >> "$LOG"
case "$*" in
  *" apply "*) cat >/dev/null ;;
  *"-n ping-devops-curtismuir get secret mcp-grafana-secrets"*) exit 1 ;;
  *"-n ping-devops-curtismuir get secret"*"-o json"*) echo '{"metadata":{"name":"x","uid":"u"},"data":{}}' ;;
  *"-n ping-devops-cmuir get secret brave-secrets"*) exit 0 ;;
  *"-n ping-devops-cmuir get secret"*) exit 1 ;;
esac
EOF
chmod +x "$STUB/helm" "$STUB/kubectl"
export BASEDIR PATH="$STUB:$PATH"

check() { [ "$2" = "$3" ] || { echo "FAIL: $1 — expected '$2', got '$3'"; FAIL=1; }; }
upgrades() { grep -c '^helm upgrade' "$LOG"; }

# 1. No --apply: render is checked, nothing is upgraded.
: > "$LOG"; "$BASEDIR/scripts/se-gateways.sh" upgrade >/dev/null 2>&1
check "dry run exits 0" 0 $?
check "dry run upgrades nothing" 0 "$(upgrades)"

# 2. --apply with a complete render upgrades both releases.
: > "$LOG"; "$BASEDIR/scripts/se-gateways.sh" upgrade --apply >/dev/null 2>&1
check "--apply upgrades both" 2 "$(upgrades)"
check "gateway 2 gets landingPage off" 1 "$(grep -c 'agentless-mcpgw2.*landingPage.enabled=false' "$LOG")"

# 3. A render that lost a sidecar aborts before any upgrade — the 2026-09-07 failure.
: > "$LOG"; RENDER_DROP=mcp-pingone "$BASEDIR/scripts/se-gateways.sh" upgrade --apply >/dev/null 2>&1
check "dropped sidecar exits non-zero" 1 $([ $? -ne 0 ] && echo 1 || echo 0)
check "dropped sidecar upgrades nothing" 0 "$(upgrades)"

# 4. secrets: copies missing ones, keeps existing, reports the one absent at the source.
: > "$LOG"; out="$("$BASEDIR/scripts/se-gateways.sh" secrets 2>&1)"; rc=$?
check "missing source secret exits non-zero" 1 $([ $rc -ne 0 ] && echo 1 || echo 0)
check "existing secret kept" 1 "$(grep -c '^kept     brave-secrets' <<<"$out")"
check "absent secret reported" 1 "$(grep -c 'MISSING in ping-devops-curtismuir: mcp-grafana-secrets' <<<"$out")"
check "banking secret copied" 1 "$(grep -c '^copied   banking-rest-secrets' <<<"$out")"

[ $FAIL -eq 0 ] && echo "se-gateways: all checks passed"
exit $FAIL
