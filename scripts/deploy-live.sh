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
#   scripts/deploy-live.sh --services=ui,demo-api-server  sync, then deploy only those services
#   scripts/deploy-live.sh <old> <new>          deploy an explicit git range (no sync)

set -euo pipefail
# Resolve the main checkout via git, not this script's own file location — see
# sync-main-checkout.sh for why: every worktree has its own copy of this file,
# and resolving via BASH_SOURCE silently diffed/restarted against whichever
# worktree ran it instead of the main checkout Docker bind-mounts.
cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
. "$(git rev-parse --show-toplevel)/scripts/deploy-live.serviceState.sh"

DRY_RUN=0
OLD="" NEW="" TARGET_SERVICES="" TARGET_MODE=0
while [ "$#" -gt 0 ]; do
  a="$1"
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    --services=*) TARGET_SERVICES="${a#*=}"; TARGET_MODE=1 ;;
    --services)
      shift
      [ "$#" -gt 0 ] || { echo "[deploy-live] --services requires a comma-separated value" >&2; exit 2; }
      TARGET_SERVICES="$1"
      TARGET_MODE=1 ;;
    *) if [ -z "$OLD" ]; then OLD="$a"; elif [ -z "$NEW" ]; then NEW="$a"; else
         echo "[deploy-live] unexpected argument: $a" >&2; exit 2
       fi ;;
  esac
  shift
done
TARGET_SERVICES="$(printf '%s' "$TARGET_SERVICES" | tr ',' ' ' | xargs 2>/dev/null || true)"

# Deployment state lives under .git deliberately: an untracked file in the
# working tree would make sync-main-checkout.sh back off. Per-service markers
# are authoritative; the old global marker is retained only as a migration
# fallback for services that have not been deployed since this change.
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
STATE_ROOT="$GIT_COMMON_DIR/deploy-live"
STAMP="$GIT_COMMON_DIR/deploy-live.last"

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
# Extended below once the temp files exist; keep a lock-only trap until then so
# an early exit still releases it.
trap 'rm -rf "$LOCK"' EXIT

if [ -z "$OLD" ]; then
  PRE="$(git rev-parse HEAD)"
  ./scripts/sync-main-checkout.sh
  NEW="$(git rev-parse HEAD)"
else
  NEW="${NEW:-$(git rev-parse HEAD)}"
fi

# The per-range checks below only see services the deployed range touched. The
# observed failure (2026-08-18, ping-gateway; jaeger + mcp-server found the same
# way) was a container in `created` with NO changes in range — invisible to every
# per-range check on every subsequent run, so the skip sustained itself forever.
# This asserts the WHOLE compose project on every terminal path. A container that
# does not exist is a profiled service deliberately off; one in `created` was
# asked for and never started — except for the opt-in SPIFFE profile, whose
# containers are outside deploy-live's service map. `exited` may be an operator's
# deliberate stop mid-debug, so it warns rather than fails.
assert_stack_health() {
  local rows name state status created="" unhealthy="" stopped=""
  rows="$(docker ps -a --filter label=com.docker.compose.project=ai-demo \
          --format '{{.Names}}\t{{.State}}\t{{.Status}}' 2>/dev/null || true)"
  while IFS=$'\t' read -r name state status; do
    [ -z "$name" ] && continue
    case "$state" in
      created)
        deploy_live_created_service_is_optional_profile "$name" && continue
        created="$created $name" ;;
      restarting) created="$created $name" ;;
      exited|paused|dead) stopped="$stopped $name" ;;
      running) case "$status" in *"(unhealthy)"*) unhealthy="$unhealthy $name" ;; esac ;;
    esac
  done <<<"$rows"
  [ -n "${stopped// /}" ] && echo "[deploy-live] note: stopped containers (deliberate? verify):$stopped"
  if [ -n "${created// /}" ] || [ -n "${unhealthy// /}" ]; then
    echo "[deploy-live] STACK UNHEALTHY —${created:+ created-but-never-started:$created}${unhealthy:+ unhealthy:$unhealthy}"
    echo "[deploy-live] This is independent of the deployed range: the stack is NOT fully serving."
    echo "[deploy-live] Fix: ./run-docker.sh restart <svc>   (container names above, minus the ai-demo- prefix)"
    return 1
  fi
  return 0
}

echo "[deploy-live] checkout at ${NEW:0:12}"

# Compose service -> action, derived from docker-compose.yml (2026-08-03):
# bind-mounted source => restart; baked COPY => build. Keep in step with compose.
RESTART_SET=""
BUILD_SET=""
NOTES=""
SERVICE_CANDIDATES="demo-api-server promptfoo-step-narration ui ping-gateway ping-mcpgw mcp-server mcp-gateway mcp-jwt-verifier mcp-proxy mcp-resource-server mcp-weather demo-mcp-code-search api-resource-server authz-server agent-service hitl-service langchain-agent llamaindex-agent ungoverned-agent mcp-brave prometheus alertmanager alloy grafana llm-proxy"
[ -n "${TARGET_SERVICES// /}" ] || TARGET_SERVICES="$SERVICE_CANDIDATES"
for _requested in $TARGET_SERVICES; do
  case " $SERVICE_CANDIDATES " in
    *" $_requested "*) ;;
    *) echo "[deploy-live] unknown service in --services: $_requested" >&2; exit 2 ;;
  esac
done

# Compose services that run-docker.sh deliberately does NOT manage.
#
# llm-proxy is a real compose service, but run-docker.sh keeps it out of its
# SERVICES table on purpose: clear_stale_host_listeners() kills whatever listens
# on every port in that table, and with LLM_BACKEND=omlx|mlx the HOST owns
# :8090 — listing it would make run-docker.sh shoot the host LLM backend.
#
# Both places that can schedule work must consult this. The path-based dispatch
# below always knew; the compose-env diff did not, and called
# `./run-docker.sh restart llm-proxy` whenever an env block of its changed.
# run-docker.sh answers "Unknown service" and exits 1, which aborted the ENTIRE
# deploy — after earlier services had already been rebuilt, so the deploy
# half-applied and stopped. Seen live 2026-09-08 (BFF never restarted).
UNMANAGED_BY_RUN_DOCKER=" llm-proxy "
is_unmanaged_by_run_docker() { case "$UNMANAGED_BY_RUN_DOCKER" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Returns non-zero, and schedules nothing, for a service run-docker.sh cannot
# take — the ONE choke point, so a future caller cannot reintroduce the abort.
add_restart() {
  [ -z "${CURRENT_SERVICE:-}" ] || [ "$1" = "$CURRENT_SERVICE" ] || return 0
  if is_unmanaged_by_run_docker "$1"; then
    note "$1 needs recreating but run-docker.sh does not manage it — do it directly: docker compose up -d $1"
    return 1
  fi
  case " $RESTART_SET " in *" $1 "*) ;; *) RESTART_SET="$RESTART_SET $1" ;; esac
  return 0
}
add_build()   { [ -z "${CURRENT_SERVICE:-}" ] || [ "$1" = "$CURRENT_SERVICE" ] || return 0; case " $BUILD_SET "   in *" $1 "*) ;; *) BUILD_SET="$BUILD_SET $1"   ;; esac; }
note()        { NOTES="${NOTES}[deploy-live] note: $1"$'\n'; }

UNINITIALIZED_FILE="$(mktemp)"
SERVICES_TO_STAMP=""
for CURRENT_SERVICE in $SERVICE_CANDIDATES; do
  deploy_live_service_selected "$CURRENT_SERVICE" || continue
  SERVICE_OLD="$OLD"
  if [ -z "$SERVICE_OLD" ]; then
    SERVICE_OLD="$(deploy_live_service_old "$STATE_ROOT" "$CURRENT_SERVICE" "$STAMP")"
  fi
  if [ -z "$SERVICE_OLD" ]; then
    SERVICE_OLD="${PRE:-$NEW}"
    [ "$SERVICE_OLD" = "$NEW" ] && echo "$CURRENT_SERVICE" >> "$UNINITIALIZED_FILE"
  elif ! git cat-file -e "$SERVICE_OLD^{commit}" 2>/dev/null; then
    echo "[deploy-live] ignoring invalid stamp for $CURRENT_SERVICE; using the checkout pre-sync point"
    SERVICE_OLD="${PRE:-$NEW}"
    [ "$SERVICE_OLD" = "$NEW" ] && echo "$CURRENT_SERVICE" >> "$UNINITIALIZED_FILE"
  fi
  CHANGED="$(git diff --name-only "$SERVICE_OLD".."$NEW")"
  if [ -n "$CHANGED" ]; then
    echo "[deploy-live] $CURRENT_SERVICE ${SERVICE_OLD:0:12} -> ${NEW:0:12} ($(wc -l <<<"$CHANGED" | tr -d ' ') files)"
  fi

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
    # llm-proxy is handled by is_unmanaged_by_run_docker() above — see the
    # reason there. Route it through docker compose directly, not run-docker.sh.
    demo_llm_proxy/*)
      if [ -z "${LLM_PROXY_NOTED:-}" ]; then
        LLM_PROXY_NOTED=1
        note "demo_llm_proxy changed — run-docker.sh does not manage llm-proxy (see its SERVICES table); rebuild it directly: docker compose up -d --build llm-proxy"
      fi ;;
    demo_mcp_brave/*)             add_build mcp-brave ;;
    demo_mcp_gateway/*)           add_build mcp-gateway ;;
    demo_mcp_jwt_verifier/*)      add_build mcp-jwt-verifier ;;
    demo_mcp_proxy/*)             add_build mcp-proxy ;;
    demo_mcp_resource_server/*)   add_build mcp-resource-server ;;
    oauth-mcp/*)                  add_build mcp-server ;;
    demo_mcp_weather/*)           add_build mcp-weather ;;
    demo_ungoverned_agent/*)      add_build ungoverned-agent ;;
    # ── monitoring configs: bind-mounted, but none of these three containers
    # watches its file for changes — a restart is the only way they pick one up.
    # Prometheus (prometheus.yml, alerts.yml) even runs with
    # --web.enable-lifecycle, which exists for exactly this and is unused
    # anywhere in this repo; a restart is still correct, just a few seconds
    # noisier than the /-/reload that flag enables. Confirmed live 2026-09-08:
    # a Prometheus container kept scraping its ORIGINAL 5 targets for hours
    # after prometheus.yml grew 5 more scrape jobs, because nothing had
    # restarted it since — this file's silent catch-all is exactly why nobody
    # noticed. Grafana dashboard JSON is deliberately NOT listed here: its file
    # provider re-polls every 30s on its own (monitoring/grafana/provisioning/
    # dashboards/dashboards.yml, updateIntervalSeconds: 30), so restarting for
    # it would be redundant, not just unnecessary.
    monitoring/prometheus.yml|monitoring/alerts.yml)
      add_restart prometheus ;;
    monitoring/alertmanager.yml)  add_restart alertmanager ;;
    monitoring/alloy/*)           add_restart alloy ;;
    # Datasource/provider YAML, unlike dashboard JSON, is read once at Grafana
    # startup — no equivalent poller re-reads it.
    monitoring/grafana/provisioning/*)
      add_restart grafana ;;
    monitoring/grafana/dashboards/*)
      : ;; # self-polled every 30s — see the block comment above
    # ── needs a human decision ───────────────────────────────────────────────
    # Note only — never withhold the stamp for this. The diff is repo-wide, so
    # doing that marked EVERY service, nothing was stamped, and the next run
    # saw the same compose change again: a permanent full-backlog redeploy.
    docker-compose.yml|docker-compose.*.yml)
      note "compose file changed ($f) — decide the blast radius yourself (./run-docker.sh restart <svc> or full restart)" ;;
    *) : ;; # docs, tests, host-only scripts, snapshots — nothing to deploy
  esac
done <<<"$CHANGED"

# ── compose env: the case the path mapping above structurally cannot see ─────
# `environment:`, `env_file:` and `build.args` edits change no path under any
# service sourceDir, so the loop above matches only the generic compose arm and
# RESTART_SET stays empty. This script then stamped the range as deployed and
# exited 0 while the running container kept its old values — container env is
# frozen at create. Observed twice on 2026-08-28 wiring the audit door
# (GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID merged, "deployed", still <unset>),
# and it reads as a product bug, which is where the time goes.
#
# `run-docker.sh restart` recreates, which is exactly what picks new env up — so
# deploy rather than warn. compose-env-diff.js answers which services changed.
if grep -qx 'docker-compose.yml' <<<"$CHANGED"; then
  _old_compose="$(mktemp)"; _new_compose="$(mktemp)"
  git show "$SERVICE_OLD:docker-compose.yml" > "$_old_compose" 2>/dev/null || : > "$_old_compose"
  git show "$NEW:docker-compose.yml" > "$_new_compose" 2>/dev/null || : > "$_new_compose"
  # Never let this fail silently: a swallowed error here restores exactly the
  # invisible staleness the block exists to end.
  if _env_svcs="$(node scripts/compose-env-diff.js "$_old_compose" "$_new_compose" 2>&1)"; then
    for _svc in $_env_svcs; do
      # add_restart refuses services run-docker.sh cannot take and notes why,
      # so this loop does not need its own special case.
      if add_restart "$_svc"; then
        note "compose env changed for $_svc — recreating (container env is frozen at create, so a code-only deploy would leave it stale)"
      fi
    done
  else
    note "could not compare compose env blocks: $_env_svcs"
    note "  env-only compose edits will NOT deploy themselves — check by hand: ./run-docker.sh restart <svc>"
  fi
  rm -f "$_old_compose" "$_new_compose"
fi
  SERVICES_TO_STAMP="$SERVICES_TO_STAMP $CURRENT_SERVICE"
done

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
# A container that EXISTS but is not running is a different thing from one that
# was never started, and conflating them is what let a dead service pass for a
# current one. `docker ps` lists only running containers, so a service sitting in
# `Created` or `Exited` looked identical to an optional profile service that is
# deliberately off: both got skipped with a note, and the run went on to stamp
# the new SHA as deployed. Observed 2026-08-18 — ping-gateway sat in `Created`
# while deploy-live reported "nothing to deploy" on the next run.
all_containers="$(docker ps -a --format '{{.Names}}' 2>/dev/null || true)"

# filter_running is invoked as `X="$(filter_running "$X")"`, and command
# substitution runs in a SUBSHELL — anything it assigns to a variable is
# discarded when that subshell exits. The script's own note() calls from inside
# this function have therefore never printed: every "changed but its container is
# not running" warning has been silently dropped. Side effects go through files,
# which survive the subshell.
BROKEN_FILE="$(mktemp)"
SKIP_NOTES_FILE="$(mktemp)"
UNAVAILABLE_FILE="$(mktemp)"
trap 'rm -rf "$LOCK" "$BROKEN_FILE" "$SKIP_NOTES_FILE" "$UNAVAILABLE_FILE" "$UNINITIALIZED_FILE"' EXIT

filter_running() {
  local out="" svc name
  for svc in $1; do
    name="$(container_of "$svc")"
    if grep -qx "$name" <<<"$running_containers"; then
      out="$out $svc"
    elif grep -qx "$name" <<<"$all_containers"; then
      # Exists but is not up: this service HAS changes and cannot take them.
      # Distinct from "never started" — an optional profile service that is
      # deliberately off is fine to skip, a half-deployed one is not. Recorded so
      # the stamp is withheld rather than claiming the containers serve code this
      # service is not running.
      echo "$svc" >> "$BROKEN_FILE"
      echo "[deploy-live] note: $svc changed but its container exists and is NOT running — it cannot take this deploy" >> "$SKIP_NOTES_FILE"
    else
      echo "$svc" >> "$UNAVAILABLE_FILE"
      echo "[deploy-live] note: $svc changed but its container is not running — skipped (start it via run-docker.sh if wanted)" >> "$SKIP_NOTES_FILE"
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
[ -s "$SKIP_NOTES_FILE" ] && cat "$SKIP_NOTES_FILE"
BROKEN_SET="$(sort -u "$BROKEN_FILE" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')"
UNAVAILABLE_SET="$(sort -u "$UNAVAILABLE_FILE" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')"
UNINITIALIZED_SET="$(sort -u "$UNINITIALIZED_FILE" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')"
NOT_UP=""

stamp_successful_services() {
  local svc
  [ "$DRY_RUN" = "1" ] && return 0
  for svc in $SERVICES_TO_STAMP; do
    case " $BROKEN_SET $UNAVAILABLE_SET $UNINITIALIZED_SET $NOT_UP " in
      *" $svc "*) continue ;;
    esac
    deploy_live_write_service_stamp "$STATE_ROOT" "$svc" "$NEW"
  done
  # Keep the legacy marker useful for older checkouts and as the migration
  # fallback, but never let a targeted deployment claim the whole stack.
  if [ "$TARGET_MODE" = "0" ] && [ -z "${BROKEN_SET// /}" ] && [ -z "${UNAVAILABLE_SET// /}" ] && [ -z "${UNINITIALIZED_SET// /}" ] && [ -z "${NOT_UP// /}" ]; then
    printf '%s\n' "$NEW" > "$STAMP"
  fi
}

if [ -z "${RESTART_SET// /}" ] && [ -z "${BUILD_SET// /}" ]; then
  # "Nothing to touch" is only good news when nothing NEEDED touching. If a
  # service has changes in this range and its container is down, stamping here
  # would record those changes as deployed and every later run would skip them —
  # the stale-under-a-success-line failure this script exists to end.
  if [ -n "${BROKEN_SET// /}" ]; then
    echo "[deploy-live] NOT stamping:${BROKEN_SET:+ $BROKEN_SET changed but is not running.}"
    echo "[deploy-live] Start it, then re-run — until then this range is undeployed:"
    [ -n "${BROKEN_SET// /}" ] && echo "[deploy-live]   ./run-docker.sh restart $BROKEN_SET"
    exit 1
  fi
  stamp_successful_services
  echo "[deploy-live] no running service is affected by this range — done"
  assert_stack_health || exit 1
  exit 0
fi

# Which of the services about to move would break someone's live browser run?
# Computed BEFORE the dry-run branch on purpose: "would this void a live run?"
# is exactly what a dry run exists to answer, and the first version of this
# guard sat below the exit and was invisible to --dry-run.
DRIVE_AFFECTING=""
for _svc in $BUILD_SET $RESTART_SET; do
  case "$_svc" in ui|demo-api-server) DRIVE_AFFECTING="$DRIVE_AFFECTING $_svc" ;; esac
done

# The flock above stops two DEPLOYS racing. It does nothing about a deploy
# racing another session's live UI/browser run, and that collateral is expensive
# because it is indistinguishable from a product bug: requests issued while `ui`
# (nginx — serves the SPA AND proxies /api) or `demo-api-server` is restarting
# die in front of the BFF, so the browser sees an inexplicable 404/502 and
# `docker logs ai-demo-api-server` shows NOTHING for them. That reads as "the
# request never reached the server", sending the investigator into the
# proxy/base-URL layer where there is nothing to find.
#
# Cost 2026-08-19: a concurrent session spent an investigation on a HITL
# consent-confirm 404 (correctly ruling out TTL, single-use and the session
# store from 120 minutes of BFF logs) while ai-demo-ui had restarted at
# 03:06:10Z and the failing run was ~03:06Z. The endpoint was fine.
#
# Warn only — never block: the deploy is usually the right thing to do, and a
# guard that refuses would be worked around.
warn_drive_affecting() {
  [ -n "${DRIVE_AFFECTING// /}" ] || return 0
  echo "[deploy-live] ⚠️  restarting:$DRIVE_AFFECTING — this VOIDS any live UI/browser run"
  echo "[deploy-live]     in progress on this machine. Requests in the window fail in FRONT"
  echo "[deploy-live]     of the BFF: 404/502 with no server-side log line, which looks like"
  echo "[deploy-live]     a routing bug and is not one. Tell peers if someone is driving."
  echo "[deploy-live]     Check after any live run:"
  echo "[deploy-live]       docker inspect ai-demo-ui ai-demo-api-server --format '{{.Name}} {{.State.StartedAt}}'"
}

if [ "$DRY_RUN" = "1" ]; then
  [ -n "${BUILD_SET// /}" ]   && echo "[deploy-live] DRY RUN — would run: ./run-docker.sh build$BUILD_SET"
  [ -n "${RESTART_SET// /}" ] && echo "[deploy-live] DRY RUN — would run: ./run-docker.sh restart$RESTART_SET"
  warn_drive_affecting
  exit 0
fi

warn_drive_affecting

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

# Append what we just disturbed to a durable log. The warning above only helps
# whoever is watching THIS terminal; the person who loses an hour is the one
# reading a browser failure later with no idea a deploy happened. `docker
# inspect ... StartedAt` answers "did it restart" but not "why, and as part of
# what" — and it is overwritten by the NEXT restart, so a second deploy erases
# the evidence for the first. This file is append-only and survives that.
# In .git/ deliberately: never committed, per-clone, and already where
# deploy-live.last lives.
if [ -n "${DRIVE_AFFECTING// /}" ]; then
  {
    printf '%s  deploy %s  restarted:%s' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$NEW" | cut -c1-12)" "$DRIVE_AFFECTING"
    for _svc in $DRIVE_AFFECTING; do
      _started=$(docker inspect "ai-demo-$_svc" --format '{{.State.StartedAt}}' 2>/dev/null || echo 'unknown')
      printf '  %s@%s' "$_svc" "$_started"
    done
    printf '\n'
  } >> "$(dirname "$STAMP")/deploy-live.restarts" 2>/dev/null || true
fi

# The stamp is a claim that the containers serve $NEW. Verify it instead of
# assuming it: `run-docker.sh restart` has returned success while leaving a
# container in `Created` (2026-08-18, ping-gateway), and the stamp written on
# that run made the next one report "nothing to deploy" over a dead service.
# Re-read docker rather than trusting our own exit codes.
# Poll rather than sampling once: a just-recreated container takes a moment to
# move from Created to running, and a single immediate check would fail good
# deploys. A guard that cries wolf gets ignored, which would cost more than the
# silence it replaced. 15s is far longer than the observed transition and still
# far shorter than any real startup hang.
NOT_UP=""
for _ in $(seq 1 15); do
  after_containers="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  NOT_UP=""
  for svc in $RESTART_SET $BUILD_SET; do
    grep -qx "$(container_of "$svc")" <<<"$after_containers" || NOT_UP="$NOT_UP $svc"
  done
  [ -z "${NOT_UP// /}" ] && break
  sleep 1
done
if [ -n "${NOT_UP// /}" ] || [ -n "${BROKEN_SET// /}" ]; then
  echo "[deploy-live] deploy INCOMPLETE — not up:${NOT_UP:-  (none)}${BROKEN_SET:+  not running: $BROKEN_SET}"
  echo "[deploy-live] affected service stamps were left behind so the next run retries them."
  exit 1
fi
# Stamp only services that completed successfully; an unrelated service can
# remain behind without causing this service to rebuild on the next run.
stamp_successful_services
assert_stack_health || exit 1

# Content verification — the 2026-09-26 UC2 incident: deploy-live baked the
# changed file into the image, but the running node process kept serving the
# OLD module for ~40 minutes (docker restart skipped; node does not hot-reload,
# and a file-diff alone cannot catch a stale process). Compare the md5 of every
# bind-mounted/baked BFF service file against the container's copy; a mismatch
# means the container is not serving this tree.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx ai-demo-api-server; then
  DRIFT=""
  for f in services/mcpToolPipeline.js services/mcpGatewayClient.js services/a2aProtocolClient.js; do
    [ -f "demo_api_server/$f" ] || continue
    HOST_MD5="$(md5 -q "demo_api_server/$f" 2>/dev/null || md5sum "demo_api_server/$f" | cut -d' ' -f1)"
    CTR_MD5="$(docker exec ai-demo-api-server md5sum "/app/$f" 2>/dev/null | cut -d' ' -f1)"
    if [ -n "$HOST_MD5" ] && [ -n "$CTR_MD5" ] && [ "$HOST_MD5" != "$CTR_MD5" ]; then
      DRIFT="$DRIFT $f"
    fi
  done
  if [ -n "${DRIFT// /}" ]; then
    echo "[deploy-live] WARNING — container code drift detected (container is NOT serving this tree):$DRIFT"
    echo "[deploy-live] Fix: docker restart ai-demo-api-server, then re-run this script."
  fi
fi

echo "[deploy-live] done — live stack serves ${NEW:0:12}"
