#!/usr/bin/env bash
# serve-worktree.test.sh — self-check for scripts/serve-worktree.sh.
#
# Runs the real script against a stub `docker` on PATH, so nothing here touches
# the shared stack. Two properties are worth pinning, both from the 2026-08-19
# TECH_DEBT entry:
#
#   1. the BFF's gitignored .env is copied into the worktree being served
#      (without it every OAuth login fails with invalid_client);
#   2. a recreate that does NOT actually move the mounts fails loudly instead of
#      reporting success — the silent-wrong-source failure the entry describes.
#
# Usage: bash scripts/serve-worktree.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/serve-worktree.sh"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# Build a throwaway main checkout + a target directory, and a stub docker whose
# reported mount root lives in a file the stub's `compose up` may or may not move.
setup() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  MAIN="$ROOT/main"; TARGET="$ROOT/wt"
  mkdir -p "$MAIN/demo_api_server" "$MAIN/demo_api_ui" "$TARGET/demo_api_server" "$TARGET/demo_api_ui"
  printf 'PINGONE_ADMIN_CLIENT_SECRET=from-main\n' > "$MAIN/demo_api_server/.env"
  git -C "$MAIN" init -q
  git -C "$MAIN" commit -q --allow-empty -m init

  STATE="$ROOT/mount-root"; echo "$MAIN" > "$STATE"
  SRC_STATE="$ROOT/mount-src-root"; echo "$MAIN" > "$SRC_STATE"
  mkdir -p "$ROOT/bin"
  cat > "$ROOT/bin/docker" <<STUB
#!/usr/bin/env bash
if [[ "\$1" == "inspect" ]]; then
  root="\$(cat "$STATE")"
  src_root="\$(cat "$SRC_STATE")"
  case "\${@: -1}" in
    ai-demo-api-server) echo "\$root/demo_api_server" ;;
    ai-demo-ui)
      # The UI has two mounts and they are reported separately: /app and the
      # /app/src it actually serves from.
      case "\$*" in
        *"/app/src"*) echo "\$src_root/demo_api_ui/src" ;;
        *)            echo "\$root/demo_api_ui" ;;
      esac ;;
  esac
  exit 0
fi
# compose up: honour the mount move only when the harness says the recreate takes.
if [[ "\$1" == "compose" && "\$STUB_RECREATE_TAKES" == "1" ]]; then
  echo "\${WORKTREE_SRC_ROOT:-$MAIN}" > "$STATE"
  # STUB_SRC_LAGS=1 reproduces the observed split: /app moves, /app/src does not.
  [[ "\${STUB_SRC_LAGS:-0}" == "1" ]] || echo "\${WORKTREE_SRC_ROOT:-$MAIN}" > "$SRC_STATE"
fi
exit 0
STUB
  # The script waits on the BFF healthz before exiting 0; keep the test fast.
  cat > "$ROOT/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$ROOT/bin/docker" "$ROOT/bin/curl"
  export PATH="$ROOT/bin:$PATH"
}

teardown() { rm -rf "$ROOT"; }

echo "serve-worktree.sh"

# --- 1. the recreate takes: .env copied, mounts verified, exit 0 ----------------
setup
out="$(cd "$MAIN" && STUB_RECREATE_TAKES=1 bash "$SCRIPT" "$TARGET" 2>&1)"; rc=$?
check "exits 0 when the mounts actually move" "$rc" "0"
if [[ -f "$TARGET/demo_api_server/.env" ]]; then
  check "copies the BFF .env into the served worktree" \
        "$(cat "$TARGET/demo_api_server/.env")" "PINGONE_ADMIN_CLIENT_SECRET=from-main"
else
  bad "copies the BFF .env into the served worktree (file absent)"
fi
case "$out" in *"copied demo_api_server/.env"*) ok "says it copied the .env" ;;
               *) bad "says it copied the .env" ;; esac
teardown

# --- 2. the recreate silently does not take: must fail, not report success ------
setup
out="$(cd "$MAIN" && STUB_RECREATE_TAKES=0 bash "$SCRIPT" "$TARGET" 2>&1)"; rc=$?
check "exits non-zero when the mounts never move" "$rc" "1"
case "$out" in *"is NOT serving"*) ok "names the wrong-source failure out loud" ;;
               *) bad "names the wrong-source failure out loud" ;; esac
case "$out" in *"retrying once"*) ok "retries once before giving up" ;;
               *) bad "retries once before giving up" ;; esac
teardown

# --- 3. handing back to main needs no .env copy and still verifies --------------
setup
echo "$TARGET" > "$STATE"   # start out serving the worktree
out="$(cd "$MAIN" && STUB_RECREATE_TAKES=1 bash "$SCRIPT" main 2>&1)"; rc=$?
check "exits 0 handing the stack back to main" "$rc" "0"
case "$out" in *"copied demo_api_server/.env"*) bad "does not copy .env when target is main" ;;
               *) ok "does not copy .env when target is main" ;; esac
teardown

# --- 3b. the UI's /app moves but /app/src lags: the exact 2026-08-19 symptom ----
# Reporting only /app would call this a success while the UI still serves main.
setup
out="$(cd "$MAIN" && STUB_RECREATE_TAKES=1 STUB_SRC_LAGS=1 bash "$SCRIPT" "$TARGET" 2>&1)"; rc=$?
check "exits non-zero when /app moves but /app/src does not" "$rc" "1"
case "$out" in *"MOUNT SPLIT"*) ok "names the /app vs /app/src split" ;;
               *) bad "names the /app vs /app/src split" ;; esac
teardown

# --- 4. status mode reports the live mount, and never recreates -----------------
setup
out="$(cd "$MAIN" && STUB_RECREATE_TAKES=0 bash "$SCRIPT" 2>&1)"; rc=$?
check "status exits 0" "$rc" "0"
case "$out" in *"main checkout"*) ok "status names the main checkout when that is mounted" ;;
               *) bad "status names the main checkout when that is mounted" ;; esac
teardown

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
