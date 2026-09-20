#!/usr/bin/env bash
# Regression checks for deploy-live's per-service state and target selection.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/deploy-live.serviceState.sh"
fails=0
ok()  { echo "  ok   — $1"; }
bad() { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "deploy-live per-service state:"

if [ -f "$LIB" ]; then ok "service-state helper exists"; else bad "service-state helper is missing"; fi

# shellcheck disable=SC1090
source "$LIB"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/services"
printf '%s\n' legacysha > "$tmp/legacy"
printf '%s\n' bffsha > "$tmp/services/demo-api-server.sha"

[ "$(deploy_live_service_stamp "$tmp" demo-api-server)" = "$tmp/services/demo-api-server.sha" ] \
  && ok "service stamp path is stable" \
  || bad "service stamp path is wrong"

[ "$(deploy_live_service_old "$tmp" demo-api-server "$tmp/legacy")" = bffsha ] \
  && ok "service stamp wins over legacy stamp" \
  || bad "legacy stamp unexpectedly overrides service stamp"

[ "$(deploy_live_service_old "$tmp" mcp-gateway "$tmp/legacy")" = legacysha ] \
  && ok "missing service stamp falls back to legacy stamp" \
  || bad "missing service stamp did not use legacy fallback"

TARGET_SERVICES="demo-api-server mcp-gateway"
deploy_live_service_selected demo-api-server \
  && ok "selected service is accepted" \
  || bad "selected service was rejected"
deploy_live_service_selected ui \
  && bad "unselected service was accepted" \
  || ok "unselected service is excluded"

printf '%s\n' newsha > "$tmp/services/demo-api-server.sha"
[ "$(cat "$tmp/services/demo-api-server.sha")" = newsha ] \
  && ok "service stamp can be advanced independently" \
  || bad "service stamp could not be advanced independently"

# Exercise the real deploy planner in a throwaway repository. A BFF-targeted
# dry run must not schedule an MCP gateway rebuild merely because both paths
# changed in the same Git range.
fixture="$tmp/fixture"
mkdir -p "$fixture/scripts" "$fixture/demo_api_server" "$fixture/demo_mcp_gateway"
cp "$HERE/deploy-live.sh" "$HERE/deploy-live.serviceState.sh" "$fixture/scripts/"
cat > "$fixture/docker" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"ps -a"*|*"ps --format"*) printf '%s\n' ai-demo-api-server ai-demo-mcp-gateway ;;
esac
EOF
chmod +x "$fixture/docker"
cat > "$fixture/run-docker.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fixture/run-docker.sh"
git -C "$fixture" init -q
git -C "$fixture" config user.email test@example.invalid
git -C "$fixture" config user.name test
git -C "$fixture" add .
git -C "$fixture" commit -qm base
old_sha="$(git -C "$fixture" rev-parse HEAD)"
printf 'bff\n' > "$fixture/demo_api_server/server.js"
printf 'gateway\n' > "$fixture/demo_mcp_gateway/server.ts"
git -C "$fixture" add .
git -C "$fixture" commit -qm changes
new_sha="$(git -C "$fixture" rev-parse HEAD)"
planner_output="$(cd "$fixture" && PATH="$fixture:$PATH" bash scripts/deploy-live.sh --dry-run --services=demo-api-server "$old_sha" "$new_sha" 2>&1)"
case "$planner_output" in
  *"DRY RUN — would run: ./run-docker.sh restart demo-api-server"*) ok "targeted dry run schedules the selected service" ;;
  *) bad "targeted dry run did not schedule demo-api-server" ;;
esac
case "$planner_output" in
  *mcp-gateway*) bad "targeted dry run scheduled unrelated mcp-gateway" ;;
  *) ok "targeted dry run excludes unrelated mcp-gateway" ;;
esac

mkdir -p "$fixture/.git/deploy-live/services"
printf '%s\n' "$old_sha" > "$fixture/.git/deploy-live/services/demo-api-server.sha"
printf '%s\n' "$new_sha" > "$fixture/.git/deploy-live/services/mcp-gateway.sha"
cat > "$fixture/scripts/sync-main-checkout.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fixture/scripts/sync-main-checkout.sh"
planner_output="$(cd "$fixture" && PATH="$fixture:$PATH" bash scripts/deploy-live.sh --dry-run 2>&1)"
case "$planner_output" in
  *"DRY RUN — would run: ./run-docker.sh restart demo-api-server"*) ok "independent stamps schedule the stale BFF" ;;
  *) bad "independent stamps did not schedule the stale BFF" ;;
esac
case "$planner_output" in
  *mcp-gateway*) bad "independent stamps scheduled the current mcp-gateway" ;;
  *) ok "independent stamps leave the current mcp-gateway alone" ;;
esac

printf '%s\n' "$new_sha" > "$fixture/.git/deploy-live/services/demo-api-server.sha"
if noop_output="$(cd "$fixture" && PATH="$fixture:$PATH" bash scripts/deploy-live.sh --services=demo-api-server 2>&1)"; then
  case "$noop_output" in
    *"no running service is affected by this range"*) ok "a no-op deployment completes without set-u failure" ;;
    *) bad "no-op deployment completed without its expected status" ;;
  esac
else
  bad "a no-op deployment exited non-zero"
fi

echo
[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"; exit 1
