#!/usr/bin/env bash
# Unit-style test for scripts/se-capacity-check.sh using a stubbed kubectl (no cluster needed).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/se-capacity-check.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/fx"
PASS=0; FAIL=0

# --- fixtures -------------------------------------------------------------
# node-b1: zone b, 3400m, 2800m requested -> 600m free.   node-b2: zone b, 3400m, 3300m -> 100m free.
# node-a1: zone a, 3400m, 1400m -> 2000m free (wrong zone for the PVs).
# node-b3: zone b, 3400m, 0 requested but cordoned -> must never count.
cat > "$TMP/fx/nodes.json" <<'JSON'
{"items":[
 {"metadata":{"name":"node-b1","labels":{"topology.kubernetes.io/zone":"zone-b"}},"spec":{},"status":{"allocatable":{"cpu":"3400m"},"conditions":[{"type":"Ready","status":"True"}]}},
 {"metadata":{"name":"node-b2","labels":{"topology.kubernetes.io/zone":"zone-b"}},"spec":{},"status":{"allocatable":{"cpu":"3400m"},"conditions":[{"type":"Ready","status":"True"}]}},
 {"metadata":{"name":"node-a1","labels":{"topology.kubernetes.io/zone":"zone-a"}},"spec":{},"status":{"allocatable":{"cpu":"3400m"},"conditions":[{"type":"Ready","status":"True"}]}},
 {"metadata":{"name":"node-b3","labels":{"topology.kubernetes.io/zone":"zone-b"}},"spec":{"unschedulable":true},"status":{"allocatable":{"cpu":"3400m"},"conditions":[{"type":"Ready","status":"True"}]}}
]}
JSON
cat > "$TMP/fx/pods.json" <<'JSON'
{"items":[
 {"metadata":{"name":"big-1","namespace":"other"},"spec":{"nodeName":"node-b1","containers":[{"resources":{"requests":{"cpu":"2"}}},{"resources":{"requests":{"cpu":"300m"}}}]},"status":{"phase":"Running"}},
 {"metadata":{"name":"api-old","namespace":"ping-devops-cmuir","labels":{"app":"ai-demo","component":"api-server"}},"spec":{"nodeName":"node-b1","containers":[{"resources":{"requests":{"cpu":"490m"}}},{"resources":{"requests":{"cpu":"10m"}}}]},"status":{"phase":"Running"}},
 {"metadata":{"name":"big-2","namespace":"other"},"spec":{"nodeName":"node-b2","containers":[{"resources":{"requests":{"cpu":"3300m"}}}]},"status":{"phase":"Running"}},
 {"metadata":{"name":"big-3","namespace":"other"},"spec":{"nodeName":"node-a1","containers":[{"resources":{"requests":{"cpu":"1400m"}}}]},"status":{"phase":"Running"}},
 {"metadata":{"name":"done-1","namespace":"other"},"spec":{"nodeName":"node-a1","containers":[{"resources":{"requests":{"cpu":"9"}}}]},"status":{"phase":"Succeeded"}},
 {"metadata":{"name":"stuck-1","namespace":"other"},"spec":{"containers":[{"resources":{"requests":{"cpu":"1"}}}]},"status":{"phase":"Pending"}},
 {"metadata":{"name":"stuck-2","namespace":"other"},"spec":{"containers":[{"resources":{"requests":{"cpu":"1"}}}]},"status":{"phase":"Pending"}}
]}
JSON
cat > "$TMP/fx/deploy.json" <<'JSON'
{"spec":{"selector":{"matchLabels":{"app":"ai-demo","component":"api-server"}},"template":{"spec":{
 "containers":[{"name":"api-server","resources":{"requests":{"cpu":"490m"}}},{"name":"authz-server","resources":{"requests":{"cpu":"10m"}}}],
 "volumes":[{"name":"bff-logs","persistentVolumeClaim":{"claimName":"bff-logs"}}]}}}}
JSON
echo '{"items":[{"metadata":{"name":"bff-logs"},"spec":{"volumeName":"pv-1"}}]}' > "$TMP/fx/pvcs.json"
echo '{"items":[{"metadata":{"name":"pv-1"},"spec":{"nodeAffinity":{"required":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"topology.kubernetes.io/zone","operator":"In","values":["zone-b"]}]}]}}}}]}' > "$TMP/fx/pvs.json"

# --- kubectl stub: answers `get` only, logs every call, refuses anything else ---
cat > "$TMP/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
[ -n "${STUB_FAIL:-}" ] && { echo "boom" >&2; exit 1; }
args=" $* "
case "$args" in
  *" get nodes "*)  cat "$STUB_FX/nodes.json" ;;
  *" get pods "*)   cat "$STUB_FX/pods.json" ;;
  *" get deploy "*) cat "$STUB_FX/deploy.json" ;;
  *" get pvc "*)    cat "$STUB_FX/pvcs.json" ;;
  *" get pv "*)     cat "$STUB_FX/pvs.json" ;;
  *) echo "stub kubectl: unexpected call: $*" >&2; exit 9 ;;
esac
STUB
chmod +x "$TMP/bin/kubectl"
export STUB_FX="$TMP/fx" STUB_LOG="$TMP/calls.log" PATH="$TMP/bin:$PATH"

# --- helpers ----------------------------------------------------------------
run() { OUT="$("$SUT" "$@" 2>&1)"; RC=$?; }
ok()   { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL - $1"; echo "       exit=$RC output: $OUT" | head -12; }
expect_rc() { [ "$RC" = "$2" ] && ok "$1" || bad "$1 (wanted exit $2)"; }
expect_has() { case "$OUT" in *"$2"*) ok "$1" ;; *) bad "$1 (missing: $2)" ;; esac; }
expect_lacks() { case "$OUT" in *"$2"*) bad "$1 (unexpected: $2)" ;; *) ok "$1" ;; esac; }

# 1. default N = live deployment total (490m+10m = 500m); node-b1 has 600m free in zone-b
run
expect_rc "default request (500m from deployment) fits on node-b1" 0
expect_has "reports the deployment-derived 500m" "requesting 500m"
expect_has "restricts to the PV zone" "only nodes in zone zone-b count"
expect_has "counts Pending pods" "Pending pods cluster-wide: 2"
expect_has "node-b1 free = 3400 - (2000+300+490+10) = 600" "       600"
expect_has "completed pod does not count (node-a1 free 2000, not negative)" "      2000"

# 2. bigger than any zone-b node: zone-a has 2000m but the volume pins us to zone-b
run 800
expect_rc "800m does not fit in zone-b" 1
expect_has "says it cannot be scheduled" "can NOT be scheduled now"
expect_lacks "never counts the other zone" "node-a1 would"
expect_has "points at the old pod's slot (600+500=1100 >= 800)" "old pod's own slot"

# 3. explicit zone overrides the volume zone
run 800 --zone zone-a
expect_rc "800m fits when zone-a is allowed" 0

# 4. cordoned node never counts even though it is empty
run 3000 --zone zone-b
expect_rc "cordoned empty node-b3 is not offered" 1

# 5. bare number is millicores, suffix m is millicores, and quiet prints only the verdict
run -q 600
expect_rc "600m fits exactly (free 600)" 0
[ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" = 1 ] && ok "-q prints one line" || bad "-q prints one line"
run -q 601m
expect_rc "601m does not fit" 1

# 6. kubectl failing is "cannot tell" (2), not "no room"
STUB_FAIL=1 run
expect_rc "kubectl failure exits 2" 2

# 7. only read verbs were ever sent to kubectl
if grep -E -q '(^| )(apply|patch|set|scale|delete|edit|annotate|label|create|replace|rollout|exec|cordon|drain)( |$)' "$STUB_LOG"; then
  RC=0; OUT="$(cat "$STUB_LOG")"; bad "kubectl was only ever called with 'get'"
else
  ok "kubectl was only ever called with 'get'"
fi
! grep -v -E '^(-n [^ ]+ )?get ' "$STUB_LOG" | grep -q . && ok "every kubectl call starts with get" || { RC=0; OUT="$(cat "$STUB_LOG")"; bad "every kubectl call starts with get"; }

# 8. unknown option
run --bogus
expect_rc "unknown option exits 2" 2

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
