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
# Resolve the main checkout via git, not this script's own file location — see
# sync-main-checkout.sh for why: every worktree has its own copy of this file,
# and resolving via BASH_SOURCE silently diffed/restarted against whichever
# worktree ran it instead of the main checkout Docker bind-mounts.
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

DRY_RUN=0
OLD="" NEW=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *) if [ -z "$OLD" ]; then OLD="$a"; elif [ -z "$NEW" ]; then NEW="$a"; fi ;;
  esac
done

# What the CONTAINERS last had deployed, not what the checkout was a moment ago.
# Lives under .git/ deliberately: an untracked file in the working tree makes
# sync-main-checkout.sh back off, which would break the very thing this script
# runs first.
STAMP="$(git rev-parse --path-format=absolute --git-common-dir)/deploy-live.last"

# ── Serialize deploys ────────────────────────────────────────────────────────
# One machine, one Docker project (`ai-demo`), one stamp file — but often several
# agent sessions. Two concurrent runs break each other two ways, both observed
# live on 2026-08-18:
#
#   1. `docker compose` renames the old container before creating the new one, so
#      two overlapping runs collide:
#        Conflict. The container name "/<hash>_ai-demo-mcp-gateway" is already
#        in use by container "<id>"
#      That aborted the run with exit 1, having restarted nothing it was asked to.
#   2. The stamp is global. The other session's run finished and wrote the NEW
#      sha, so the failed run's next attempt read OLD == NEW and reported
#      "containers already serve <sha> — nothing to deploy" while the ui
#      container still served the previous bundle. A failed deploy presented as a
#      completed one, caught only by checking the page by hand.
#
# mkdir is atomic on every filesystem this runs on — that is the whole reason it
# is used here rather than a test-then-create on a plain file. Refuse rather than
# queue: a waiting deploy would still be diffing a range computed before the
# other run moved the stamp.
LOCK="$(git rev-parse --path-format=absolute --git-common-dir)/deploy-live.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null || echo '?')"
  # A crashed run leaves the directory behind. Reclaim it only when the recorded
  # pid is genuinely gone, so a slow-but-alive deploy is never stolen from it.
  if [ "$holder" != "?" ] && ! kill -0 "$holder" 2>/dev/null; then
    echo "[deploy-live] clearing stale lock from pid $holder (no longer running)"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || { echo "[deploy-live] could not take the lock"; exit 1; }
  else
    echo "[deploy-live] another deploy is running (pid $holder) — refusing to run concurrently."
    echo "[deploy-live] Two runs race on the same containers and the same stamp, which"
    echo "[deploy-live] silently leaves services stale under a success line. Wait for it"
    echo "[deploy-live] to finish, then re-run: scripts/deploy-live.sh"
    exit 1
  fi
fi
printf '%s\n' "$$" > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

if [ -z "$OLD" ]; then
  PRE="$(git rev-parse HEAD)"
  ./scripts/sync-main-checkout.sh
  NEW="$(git rev-parse HEAD)"
  # Comparing against PRE is what made this script structurally unable to detect
  # the case it exists for: the 15-minute launchd sync job has usually already
  # advanced the checkout, so PRE == NEW and we reported "nothing to deploy"
  # while the containers still ran the old code. Prefer the last SHA we actually
  # deployed. Fall back to PRE when the stamp is missing (first run) or names a
  # commit this repo no longer has (rebase, force-push, pruned branch).
  if [ -s "$STAMP" ] && git cat-file -e "$(cat "$STAMP")^{commit}" 2>/dev/null; then
    OLD="$(cat "$STAMP")"
  else
    OLD="$PRE"
    STAMP_BOOTSTRAP=1
  fi
else
  NEW="${NEW:-$(git rev-parse HEAD)}"
fi

if [ "$OLD" = "$NEW" ]; then
  if [ "${STAMP_BOOTSTRAP:-0}" = "1" ]; then
    # No stamp yet, so "checkout did not move" is the ONLY signal available —
    # and it is the unreliable one. Say so instead of reporting a clean no-op:
    # if a sync already advanced the checkout, the containers may still be stale.
    echo "[deploy-live] no deploy stamp yet and the checkout did not move this run."
    echo "[deploy-live] Cannot tell whether the containers are current. If they look stale,"
    echo "[deploy-live] deploy an explicit range: scripts/deploy-live.sh <old-sha> ${NEW:0:12}"
    if [ "$DRY_RUN" = "1" ]; then
      echo "[deploy-live] DRY RUN — would stamp ${NEW:0:12} for later runs to compare against."
    else
      printf '%s\n' "$NEW" > "$STAMP"
      echo "[deploy-live] stamped ${NEW:0:12} — later runs will compare against it."
    fi
    exit 0
  fi
  echo "[deploy-live] containers already serve ${NEW:0:12} — nothing to deploy"
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
    demo_api_server/promptfoo/*)
      add_build promptfoo-step-narration ;;
    demo_api_server/*)            add_restart demo-api-server ;;
    demo_api_ui/src/*)            add_restart ui ;;
    demo_api_ui/*)                add_build ui ;;
    ping-gateway/*)               add_restart ping-gateway ;;
    ping-mcpgw/*)                 add_restart ping-mcpgw ;;
    scripts/otel-instrument.js)
      add_restart demo-api-server
      add_restart mcp-server
      add_restart langchain-agent
      add_restart agent-service
      add_restart hitl-service
      add_restart mcp-resource-server
      add_restart mcp-gateway
      add_restart authz-server ;;
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
    # llm-proxy is a real compose service, but run-docker.sh deliberately keeps
    # it OUT of its SERVICES table: clear_stale_host_listeners() kills whatever
    # listens on every port in that table, and with LLM_BACKEND=omlx|mlx the
    # HOST owns :8090. Listing it there would make run-docker.sh shoot the host
    # LLM backend. So route it through docker compose directly, not run-docker.sh.
    demo_llm_proxy/*)
      if [ -z "${LLM_PROXY_NOTED:-}" ]; then
        LLM_PROXY_NOTED=1
        note "demo_llm_proxy changed — run-docker.sh does not manage llm-proxy (see its SERVICES table); rebuild it directly: docker compose up -d --build llm-proxy"
      fi ;;
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
    *) : ;; # docs, tests, host-only scripts, snapshots — nothing to deploy
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
  # Nothing to touch means the running containers already serve this range, so
  # advance the stamp — otherwise every later run re-diffs from the same old SHA.
  [ "$DRY_RUN" = "1" ] || printf '%s\n' "$NEW" > "$STAMP"
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
printf '%s\n' "$NEW" > "$STAMP"
echo "[deploy-live] done — live stack serves ${NEW:0:12}"
