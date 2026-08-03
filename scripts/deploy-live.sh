#!/usr/bin/env bash
# scripts/deploy-live.sh — make the running Docker stack serve what just merged,
# touching ONLY the services the merged diff affects (a full restart takes minutes).
#
#   1. Fast-forward the main checkout (scripts/sync-main-checkout.sh — backs off
#      untouched if anything unexpected is dirty).
#   2. Diff old..new HEAD and map changed paths to compose services.
#   3. Bind-mounted services  → ./run-docker.sh restart <svc>   (recreate, fast)
#      Baked-image services   → ./run-docker.sh build <svc>     (rebuild + restart)
#   4. Only services whose container is RUNNING are touched — a stopped optional
#      profile service is never started as a side effect.
#
# Run from anywhere; operates on the MAIN checkout (the one Docker bind-mounts).
# Safe to re-run: no drift → "nothing to deploy".
#
# Usage:
#   scripts/deploy-live.sh            sync, then deploy the synced range
#   scripts/deploy-live.sh --dry-run  sync, then print what WOULD run
#   scripts/deploy-live.sh <old> <new>          deploy an explicit git range (no sync)

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY_RUN=0
OLD="" NEW=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *) if [ -z "$OLD" ]; then OLD="$a"; elif [ -z "$NEW" ]; then NEW="$a"; fi ;;
  esac
done

if [ -z "$OLD" ]; then
  OLD="$(git rev-parse HEAD)"
  ./scripts/sync-main-checkout.sh
  NEW="$(git rev-parse HEAD)"
else
  NEW="${NEW:-$(git rev-parse HEAD)}"
fi

if [ "$OLD" = "$NEW" ]; then
  echo "[deploy-live] checkout already at ${NEW:0:12} — nothing to deploy"
  exit 0
fi

CHANGED="$(git diff --name-only "$OLD".."$NEW")"
echo "[deploy-live] ${OLD:0:12} -> ${NEW:0:12} ($(wc -l <<<"$CHANGED" | tr -d ' ') files)"

# Compose service -> action, derived from docker-compose.yml (2026-08-03):
# bind-mounted source => restart; baked COPY => build. Keep in step with compose.
RESTART_SET=""
BUILD_SET=""
NOTES=""

add_restart() { case " $RESTART_SET " in *" $1 "*) ;; *) RESTART_SET="$RESTART_SET $1" ;; esac; }
add_build()   { case " $BUILD_SET "   in *" $1 "*) ;; *) BUILD_SET="$BUILD_SET $1"   ;; esac; }
note()        { NOTES="${NOTES}[deploy-live] note: $1"$'\n'; }

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    # ── bind-mounted: recreate/restart picks up the new files ────────────────
    demo_api_server/Dockerfile|demo_api_server/package.json|demo_api_server/package-lock.json)
      add_build demo-api-server ;;
    demo_api_server/*)            add_restart demo-api-server ;;
    demo_api_ui/src/*)            add_restart ui ;;
    demo_api_ui/*)                add_build ui ;;
    ping-gateway/*)               add_restart ping-gateway ;;
    ping-mcpgw/*)                 add_restart ping-mcpgw ;;
    LLM2.json|llm-timeouts.json|.env)
      add_restart demo-api-server ;;
    # ── baked images: restart serves the OLD code — must rebuild ─────────────
    demo_agent_service/*)         add_build agent-service ;;
    demo_api_resource_server/*)   add_build api-resource-server ;;
    demo_authz_server/*)          add_build authz-server ;;
    demo_mcp_code_search/*)       add_build demo-mcp-code-search ;;
    demo_hitl_service/*)          add_build hitl-service ;;
    langchain_agent/*)            add_build langchain-agent ;;
    llamaindex_agent/*)           add_build llamaindex-agent ;;
    demo_llm_proxy/*)             add_build llm-proxy ;;
    mastra_agent/*)               add_build mastra-agent ;;
    demo_mcp_brave/*)             add_build mcp-brave ;;
    demo_mcp_gateway/*)           add_build mcp-gateway ;;
    demo_mcp_jwt_verifier/*)      add_build mcp-jwt-verifier ;;
    demo_mcp_proxy/*)             add_build mcp-proxy ;;
    demo_mcp_resource_server/*)   add_build mcp-resource-server ;;
    oauth-mcp/*)                  add_build mcp-server ;;
    demo_mcp_weather/*)           add_build mcp-weather ;;
    openai_agent/*)               add_build openai-agent ;;
    pydantic_agent/*)             add_build pydantic-agent ;;
    demo_ungoverned_agent/*)      add_build ungoverned-agent ;;
    # ── needs a human decision ───────────────────────────────────────────────
    docker-compose.yml|docker-compose.*.yml)
      note "compose file changed ($f) — decide the blast radius yourself (./run-docker.sh restart <svc> or full restart)" ;;
    *) : ;; # docs, tests, scripts, snapshots — nothing to deploy
  esac
done <<<"$CHANGED"

# Only touch services whose container is actually running.
running_containers="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
container_of() {
  case "$1" in
    demo-api-server) echo ai-demo-api-server ;;
    demo-mcp-code-search) echo ai-demo-mcp-code-search ;;
    tier-manager-k8) echo tier-manager-k8 ;;
    *) echo "ai-demo-$1" ;;
  esac
}
filter_running() {
  local out="" svc
  for svc in $1; do
    if grep -qx "$(container_of "$svc")" <<<"$running_containers"; then
      out="$out $svc"
    else
      note "$svc changed but its container is not running — skipped (start it via run-docker.sh if wanted)"
    fi
  done
  echo "$out"
}
RESTART_SET="$(filter_running "$RESTART_SET")"
BUILD_SET="$(filter_running "$BUILD_SET")"
# A service being rebuilt is already recreated by `build` — drop it from restart.
for svc in $BUILD_SET; do
  RESTART_SET="$(sed "s/ $svc\b//" <<<" $RESTART_SET")"
done

[ -n "$NOTES" ] && printf '%s' "$NOTES"

if [ -z "${RESTART_SET// /}" ] && [ -z "${BUILD_SET// /}" ]; then
  echo "[deploy-live] no running service is affected by this range — done"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  [ -n "${BUILD_SET// /}" ]   && echo "[deploy-live] DRY RUN — would run: ./run-docker.sh build$BUILD_SET"
  [ -n "${RESTART_SET// /}" ] && echo "[deploy-live] DRY RUN — would run: ./run-docker.sh restart$RESTART_SET"
  exit 0
fi

# Build first (slow, recreates), then restart the cheap ones.
if [ -n "${BUILD_SET// /}" ]; then
  echo "[deploy-live] ./run-docker.sh build$BUILD_SET"
  # shellcheck disable=SC2086
  ./run-docker.sh build $BUILD_SET
fi
if [ -n "${RESTART_SET// /}" ]; then
  echo "[deploy-live] ./run-docker.sh restart$RESTART_SET"
  # shellcheck disable=SC2086
  ./run-docker.sh restart $RESTART_SET
fi
echo "[deploy-live] done — live stack serves ${NEW:0:12}"
