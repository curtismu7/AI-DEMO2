#!/usr/bin/env bash
# stack-generation.test.sh — self-check for scripts/stack-generation.sh.
#
# Stubs `docker` on PATH so this never depends on a running stack, and can
# simulate the thing that actually matters: a container being recreated (new id)
# or restarted (same id, new StartedAt) between two reads.
#
# Usage: bash scripts/stack-generation.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stack-generation.sh"
PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

setup() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  STATE="$ROOT/state"
  # id and StartedAt per container, one "id@started" per line.
  printf 'ui111111111111@2026-08-26T10:00:00Z\napi22222222222@2026-08-26T10:00:00Z\n' > "$STATE"
  mkdir -p "$ROOT/bin"
  cat > "$ROOT/bin/docker" <<STUB
#!/usr/bin/env bash
# docker inspect -f <fmt> <container>
fmt="\$3"; name="\${@: -1}"
case "\$name" in
  ai-demo-ui)         line="\$(sed -n 1p "$STATE")" ;;
  ai-demo-api-server) line="\$(sed -n 2p "$STATE")" ;;
  *) exit 1 ;;
esac
[[ "\$line" == "ABSENT" ]] && exit 1
case "\$fmt" in
  *".Id"*)              echo "\${line%%@*}" ;;
  *".State.StartedAt"*) echo "\${line#*@}" ;;
esac
exit 0
STUB
  chmod +x "$ROOT/bin/docker"
  export PATH="$ROOT/bin:$PATH"
}
teardown() { rm -rf "$ROOT"; }

echo "stack-generation.sh"

# --- generation is stable while nothing moves ----------------------------------
setup
g1="$(bash "$SCRIPT")"
g2="$(bash "$SCRIPT")"
check "same generation when nothing moves" "$g1" "$g2"
out="$(bash "$SCRIPT" --check "$g1" 2>&1)"; rc=$?
check "--check exits 0 against an unchanged stack" "$rc" "0"
case "$out" in *"stack unchanged"*) ok "says the run stands" ;; *) bad "says the run stands" ;; esac
teardown

# --- a RECREATE (new container id) must be caught ------------------------------
setup
g1="$(bash "$SCRIPT")"
printf 'uiFFFFFFFFFFFF@2026-08-26T10:16:41Z\napi22222222222@2026-08-26T10:00:00Z\n' > "$STATE"
out="$(bash "$SCRIPT" --check "$g1" 2>&1)"; rc=$?
check "--check exits 1 after a recreate" "$rc" "1"
case "$out" in *"STACK MOVED"*) ok "calls the run void on recreate" ;;
               *) bad "calls the run void on recreate" ;; esac
case "$out" in *"ai-demo-ui"*) ok "names the container that moved" ;;
               *) bad "names the container that moved" ;; esac
case "$out" in *"ai-demo-api-server"*) bad "does not name containers that did not move" ;;
               *) ok "does not name containers that did not move" ;; esac
teardown

# --- a plain RESTART (same id, new StartedAt) must also be caught ---------------
# This is the half a container-id-only check would miss.
setup
g1="$(bash "$SCRIPT")"
printf 'ui111111111111@2026-08-26T10:17:54Z\napi22222222222@2026-08-26T10:00:00Z\n' > "$STATE"
out="$(bash "$SCRIPT" --check "$g1" 2>&1)"; rc=$?
check "--check exits 1 after a restart with the same container id" "$rc" "1"
teardown

# --- a container that disappears entirely --------------------------------------
setup
g1="$(bash "$SCRIPT")"
printf 'ABSENT\napi22222222222@2026-08-26T10:00:00Z\n' > "$STATE"
out="$(bash "$SCRIPT" --check "$g1" 2>&1)"; rc=$?
check "--check exits 1 when a container is gone" "$rc" "1"
case "$out" in *"absent"*) ok "reports the container as absent rather than blank" ;;
               *) bad "reports the container as absent rather than blank" ;; esac
teardown

# --- misuse is an error, never a false pass ------------------------------------
setup
out="$(bash "$SCRIPT" --check 2>&1)"; rc=$?
check "--check with no argument exits 2, not 0" "$rc" "2"
out="$(bash "$SCRIPT" --nonsense 2>&1)"; rc=$?
check "an unknown argument exits 2, not 0" "$rc" "2"
teardown

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
