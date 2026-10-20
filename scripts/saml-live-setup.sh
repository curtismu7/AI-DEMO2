#!/usr/bin/env bash
# scripts/saml-live-setup.sh -- the owner-run steps of the real-SAML rollout, in one place.
#
# Phases (run in order; each is idempotent and skips itself when already done):
#   sync     merge the mirror (curtismu7) into local main, push origin main        (checklist 4.1-4.3)
#   pf       port-forward the issuing PingFederate, dry-run, apply the SAML objects (3.2-3.5)
#   secrets  add the three SAML keys to the ai-demo-secrets Secret (additive patch)   (3.6)
#   deploy   point demo-api-server and frontend at the source repo's built images     (3.8)
#
# Usage:
#   scripts/saml-live-setup.sh                 # all phases, asks before every write
#   scripts/saml-live-setup.sh --only=pf       # one phase
#   scripts/saml-live-setup.sh --resume        # skip phases recorded as done in ~/.saml-live-setup.state
#   scripts/saml-live-setup.sh --check         # preflight only, changes nothing
#
# Environment (all optional):
#   REPO=<path to your checkout>   PF_NS=ping-devops-curtismuir   PF_PORT=29999
#   APP_NS=ping-devops-cmuir                 OAUTH_MCP_ENTITY=<id>           PF_PF_ENTITY=<id>
#   GHCR_OWNER=cmuir_pingcorp                IMAGE_SHA=<merge commit>        MAX_WAIT_MIN=20
#
# Safety:
#   * Every shared write (git push, PingFederate apply, secret patch, image change) needs you to
#     type "yes". Nothing is changed by default.
#   * Secret values are never printed or logged. The log is ~/.saml-live-setup.log.
#   * Refuses the Acme PingFederate namespace (ping-devops-cmuir) for the PF phase unless
#     FORCE_PF_NS=1: the demo's issuer lives in ping-devops-curtismuir.
#   * "Self-healing" = retries with backoff on network calls, reuses or restarts the
#     port-forward, detects work already done, and stops with a clear message instead of
#     guessing. It never force-pushes, never rewrites history, and aborts a conflicted merge.
#
# NOT verified: this script was written without access to your Mac, the cluster or PingFederate
# and has only been syntax-checked and its untracked-file handling tested in a scratch repo. Read each prompt before typing yes.
set -euo pipefail

REPO="${REPO:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PF_NS="${PF_NS:-ping-devops-curtismuir}"
PF_PORT="${PF_PORT:-29999}"
APP_NS="${APP_NS:-ping-devops-cmuir}"
GHCR_OWNER="${GHCR_OWNER:-cmuir_pingcorp}"
MAX_WAIT_MIN="${MAX_WAIT_MIN:-20}"
LOG="${HOME}/.saml-live-setup.log"
STATE="${HOME}/.saml-live-setup.state"
SECRET_NAME="ai-demo-secrets"
PF_SCRIPT="scripts/pingfederate/configure-saml-idjag.js"
SIGNER_ENV="deploy-local/saml/signer.env"
APP_ENV="demo_api_server/.env"
ONLY=""; RESUME=0; CHECK=0
PF_PID=""

for a in "$@"; do
  case "$a" in
    --only=*) ONLY="${a#--only=}" ;;
    --resume) RESUME=1 ;;
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 64 ;;
  esac
done

# ---------- helpers ----------
ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { printf '%s\n' "$*"; printf '[%s] %s\n' "$(ts)" "$*" >>"$LOG"; }
die() { printf 'ERROR: %s\n' "$*" >&2; printf '[%s] ERROR: %s\n' "$(ts)" "$*" >>"$LOG"; exit 1; }
confirm() {
  local prompt="$1" ans
  read -r -p "$prompt Type yes to continue: " ans
  [ "$ans" = "yes" ] || { say "Stopped at your request."; exit 0; }
}
retry() { # retry <tries> <cmd...>
  local n="$1" i=1 delay=2; shift
  until "$@"; do
    [ "$i" -ge "$n" ] && return 1
    say "  retry $i/$n in ${delay}s: $1 ..."; sleep "$delay"; delay=$((delay * 2)); i=$((i + 1))
  done
}
phase_done() { grep -qx "$1" "$STATE" 2>/dev/null; }
mark_done() { grep -qx "$1" "$STATE" 2>/dev/null || echo "$1" >>"$STATE"; }
want() { # should this phase run?
  [ -z "$ONLY" ] || [ "$ONLY" = "$1" ] || return 1
  if [ "$RESUME" = 1 ] && phase_done "$1"; then say "[$1] already done (state file); skipping"; return 1; fi
  return 0
}
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 ($2)"; }
cleanup() { if [ -n "$PF_PID" ] && kill -0 "$PF_PID" 2>/dev/null; then kill "$PF_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
env_has() { # env_has <file> <VAR>  -> true when VAR=<non-empty> is present; prints nothing
  [ -f "$1" ] && grep -Eq "^(export )?$2=.+" "$1"
}
env_get() { # env_get <file> <VAR>  -> value on stdout (callers must not echo it)
  grep -E "^(export )?$2=" "$1" | tail -1 | sed -E "s/^(export )?$2=//; s/^['\"]//; s/['\"]$//"
}

# ---------- preflight ----------
preflight() {
  say "== preflight =="
  need git "install Xcode command line tools"; need node "Node >= 22"; need curl ""; need openssl ""
  [ -d "$REPO/.git" ] || die "REPO=$REPO is not a git checkout (set REPO=...)"
  cd "$REPO"
  git remote get-url origin >/dev/null 2>&1 || die "no 'origin' remote"
  if ! git remote get-url curtismu7 >/dev/null 2>&1; then
    say "adding the missing 'curtismu7' remote"
    git remote add curtismu7 https://github.com/curtismu7/AI-DEMO2.git
  fi
  [ "$(git branch --show-current)" = "main" ] || die "switch to main first (currently $(git branch --show-current))"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    die "tracked files have uncommitted changes; commit or stash them first (git status)"
  fi
  # Untracked files are not an error. Keep generated secrets out of git for good, and report the rest.
  mkdir -p .git/info; touch .git/info/exclude
  grep -qx 'deploy-local/' .git/info/exclude || echo 'deploy-local/' >>.git/info/exclude
  local untracked; untracked="$(git ls-files --others --exclude-standard)"
  if [ -n "$untracked" ]; then
    say "untracked files (left alone unless the merge needs their path):"; printf '%s\n' "$untracked" | sed 's/^/  /' | tee -a "$LOG"
  fi
  [ "$PF_NS" = "ping-devops-cmuir" ] && [ "${FORCE_PF_NS:-0}" != 1 ] && \
    die "PF_NS=ping-devops-cmuir is the ACME PingFederate. The demo issuer is ping-devops-curtismuir. Set FORCE_PF_NS=1 only if you are sure."
  say "preflight ok (repo $REPO, PF namespace $PF_NS, app namespace $APP_NS)"
}

# ---------- phase: sync ----------
# An untracked file at a path the merge will add makes git refuse ("would be overwritten").
# Move such files into a timestamped backup (never delete), keeping their relative paths.
park_colliding_untracked() { # park_colliding_untracked <ref>
  local ref="$1" f hits="" bak
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    git ls-tree -r --name-only "$ref" -- "$f" | grep -qx -- "$f" && hits="${hits}${f}"$'\n'
  done < <(git ls-files --others --exclude-standard)
  [ -n "$hits" ] || return 0
  bak="$HOME/saml-live-setup-untracked-backup-$(date +%Y%m%d-%H%M%S)"
  say "These untracked files sit where the merge adds a file:"; printf '%s' "$hits" | sed 's/^/  /' | tee -a "$LOG"
  confirm "Move them to $bak (nothing is deleted; the merge brings in the tracked version)?"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$bak/$(dirname "$f")"; mv -- "$f" "$bak/$f"
  done <<<"$hits"
  say "moved to $bak"
}
phase_sync() {
  want sync || return 0
  say "== sync: merge the mirror into local main =="
  cd "$REPO"
  retry 4 git fetch origin  || die "git fetch origin failed (network or credentials)"
  retry 4 git fetch curtismu7 || die "git fetch curtismu7 failed (network or credentials)"
  git merge --ff-only origin/main >/dev/null 2>&1 || die "local main has commits origin/main lacks, or diverged. Resolve by hand; this script will not force anything."
  if git merge-base --is-ancestor curtismu7/main HEAD; then
    say "mirror main is already contained in local main"
  else
    say "mirror-only commits:"; git log --oneline HEAD..curtismu7/main | sed 's/^/  /' | tee -a "$LOG"
    confirm "Merge curtismu7/main into local main?"
    park_colliding_untracked curtismu7/main
    if ! git merge --no-edit curtismu7/main >>"$LOG" 2>&1; then
      say "Merge conflicts in:"; git diff --name-only --diff-filter=U | sed 's/^/  /' | tee -a "$LOG"
      git merge --abort || true
      die "merge aborted, nothing changed. Send me that file list (no secrets) and I will say how to resolve it."
    fi
    say "merged"
  fi
  [ -f "$PF_SCRIPT" ] || die "$PF_SCRIPT is still missing after the merge"
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    confirm "Push local main to origin (cmuir_pingcorp)? This starts the source repo's Build images."
    retry 3 git push origin main || die "git push origin main failed"
  else
    say "origin/main already equals local main"
  fi
  mark_done sync
}

# ---------- phase: pf ----------
start_port_forward() {
  need kubectl "brew install kubectl, and log in to the SE cluster"
  kubectl -n "$PF_NS" get svc pingfederate-admin >/dev/null 2>&1 || {
    say "service pingfederate-admin not found in $PF_NS. PingFederate services there:"
    kubectl -n "$PF_NS" get svc 2>&1 | grep -i pingfederate || true
    die "fix PF_NS or the service name"
  }
  if port_open "$PF_PORT"; then
    say "port $PF_PORT already answers; reusing it (assuming it is the port-forward to $PF_NS)"
    return 0
  fi
  local i
  for i in 1 2 3; do
    kubectl -n "$PF_NS" port-forward svc/pingfederate-admin "$PF_PORT:9999" >>"$LOG" 2>&1 &
    PF_PID=$!
    local w=0
    while [ "$w" -lt 20 ]; do
      port_open "$PF_PORT" && { say "port-forward up on $PF_PORT (attempt $i)"; return 0; }
      kill -0 "$PF_PID" 2>/dev/null || break
      sleep 1; w=$((w + 1))
    done
    say "port-forward attempt $i did not come up; retrying"; kill "$PF_PID" 2>/dev/null || true; sleep 2
  done
  die "could not open the port-forward to $PF_NS (see $LOG)"
}
pf_script() { node "$PF_SCRIPT" --ns="$PF_NS" --port="$PF_PORT" "$@"; }

phase_pf() {
  want pf || return 0
  say "== pf: SAML objects on the issuing PingFederate ($PF_NS) =="
  cd "$REPO"; [ -f "$PF_SCRIPT" ] || die "$PF_SCRIPT missing; run the sync phase first"
  start_port_forward
  if [ -z "${OAUTH_MCP_ENTITY:-}" ] || [ -z "${PF_PF_ENTITY:-}" ]; then
    say "-- discovery (reads only): the script prints candidate SP connections and exits before writing"
    set +e; pf_script --dry-run 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}; set -e
    [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || die "dry run failed (exit $rc). Paste the output above to me, without secrets."
    say "Per the roadmap the demo's two ID-JAG connections have entity ids cmuir-mcp and local:9031. Confirm against the list above."
    read -r -p "oauth-mcp mode entity id [cmuir-mcp]: " OAUTH_MCP_ENTITY; OAUTH_MCP_ENTITY="${OAUTH_MCP_ENTITY:-cmuir-mcp}"
    read -r -p "pf-pf mode entity id [local:9031]: " PF_PF_ENTITY; PF_PF_ENTITY="${PF_PF_ENTITY:-local:9031}"
  fi
  say "-- dry run with entities $OAUTH_MCP_ENTITY / $PF_PF_ENTITY (reads only)"
  set +e; pf_script --dry-run --oauth-mcp-entity="$OAUTH_MCP_ENTITY" --pf-pf-entity="$PF_PF_ENTITY" 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}; set -e
  [ "$rc" -eq 0 ] || die "dry run with entities failed (exit $rc). Do not apply. Paste the output to me, without secrets."
  [ "$CHECK" = 1 ] && { say "--check: stopping before any write"; return 0; }
  confirm "Apply these SAML objects to the SHARED PingFederate in $PF_NS?"
  set +e; pf_script --oauth-mcp-entity="$OAUTH_MCP_ENTITY" --pf-pf-entity="$PF_PF_ENTITY" 2>&1 | tee -a "$LOG"; rc=${PIPESTATUS[0]}; set -e
  if [ "$rc" -ne 0 ]; then
    say "apply failed (exit $rc). The script is idempotent: fix the cause and re-run this phase."
    say "To undo what it created:  node $PF_SCRIPT --ns=$PF_NS --port=$PF_PORT --remove"
    exit "$rc"
  fi
  say "-- verify: a second apply must report only 'keep'"
  pf_script --dry-run --oauth-mcp-entity="$OAUTH_MCP_ENTITY" --pf-pf-entity="$PF_PF_ENTITY" 2>&1 | tee -a "$LOG" >/dev/null || say "(verify dry run returned non-zero; read $LOG)"
  env_has "$APP_ENV" PF_SAML_CLIENT_SECRET || say "WARN: PF_SAML_CLIENT_SECRET not found in $APP_ENV after apply"
  { env_has "$SIGNER_ENV" SAML_SIGNING_KEY_PEM_B64 || env_has "$APP_ENV" SAML_SIGNING_KEY_PEM_B64; } || say "WARN: no SAML signing key found in $SIGNER_ENV or $APP_ENV"
  mark_done pf
}

# ---------- phase: secrets ----------
phase_secrets() {
  want secrets || return 0
  say "== secrets: add the three SAML keys to $SECRET_NAME in $APP_NS (additive patch) =="
  cd "$REPO"; need kubectl ""
  local key cert sec src
  for v in SAML_SIGNING_KEY_PEM_B64 SAML_SIGNING_CERT_PEM_B64; do
    if env_has "$SIGNER_ENV" "$v"; then src="$SIGNER_ENV"; elif env_has "$APP_ENV" "$v"; then src="$APP_ENV"; else die "$v not found in $SIGNER_ENV or $APP_ENV; run the pf phase first"; fi
    if [ "$v" = SAML_SIGNING_KEY_PEM_B64 ]; then key="$(env_get "$src" "$v")"; else cert="$(env_get "$src" "$v")"; fi
  done
  env_has "$APP_ENV" PF_SAML_CLIENT_SECRET || die "PF_SAML_CLIENT_SECRET not found in $APP_ENV; run the pf phase first"
  sec="$(env_get "$APP_ENV" PF_SAML_CLIENT_SECRET)"
  kubectl -n "$APP_NS" get secret "$SECRET_NAME" >/dev/null 2>&1 || die "secret $SECRET_NAME not found in $APP_NS (set APP_NS=...)"
  local have; have="$(kubectl -n "$APP_NS" get secret "$SECRET_NAME" -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=Object.keys(JSON.parse(s).data||{});console.log(["SAML_SIGNING_KEY_PEM_B64","SAML_SIGNING_CERT_PEM_B64","PF_SAML_CLIENT_SECRET"].filter(x=>k.includes(x)).join(","))})')"
  say "keys already in the secret: ${have:-none}"
  [ "$CHECK" = 1 ] && { say "--check: stopping before any write"; return 0; }
  confirm "Patch $SECRET_NAME in $APP_NS with the three SAML keys (existing keys are left alone)?"
  local tmp; tmp="$(mktemp)"; chmod 600 "$tmp"
  K="$key" C="$cert" S="$sec" node -e 'process.stdout.write(JSON.stringify({stringData:{SAML_SIGNING_KEY_PEM_B64:process.env.K,SAML_SIGNING_CERT_PEM_B64:process.env.C,PF_SAML_CLIENT_SECRET:process.env.S}}))' >"$tmp"
  retry 3 kubectl -n "$APP_NS" patch secret "$SECRET_NAME" --type merge --patch-file "$tmp" >/dev/null || { rm -f "$tmp"; die "patch failed"; }
  rm -f "$tmp"
  say "secret patched. Restarting demo-api-server so it reads the new keys."
  kubectl -n "$APP_NS" rollout restart deployment/demo-api-server >>"$LOG" 2>&1 || say "WARN: rollout restart failed; restart it by hand"
  mark_done secrets
}

# ---------- phase: deploy ----------
image_exists() { command -v docker >/dev/null 2>&1 && docker manifest inspect "$1" >/dev/null 2>&1; }
set_image() { # set_image <deployment> <image>
  local dep="$1" img="$2" ctr cur
  ctr="$(kubectl -n "$APP_NS" get deploy "$dep" -o jsonpath='{.spec.template.spec.containers[0].name}')"
  cur="$(kubectl -n "$APP_NS" get deploy "$dep" -o jsonpath='{.spec.template.spec.containers[0].image}')"
  say "$dep: container $ctr, current image $cur"
  say "$dep: new image     $img"
  kubectl -n "$APP_NS" set image "deployment/$dep" "$ctr=$img" >>"$LOG" 2>&1 || die "set image failed for $dep"
  if ! kubectl -n "$APP_NS" rollout status "deployment/$dep" --timeout=300s 2>&1 | tee -a "$LOG"; then
    say "rollout of $dep did not finish."
    read -r -p "Roll $dep back to its previous revision? Type yes to undo: " a
    [ "$a" = "yes" ] && kubectl -n "$APP_NS" rollout undo "deployment/$dep"
    die "stopped after $dep"
  fi
}
phase_deploy() {
  want deploy || return 0
  say "== deploy: bff + frontend images from ghcr.io/$GHCR_OWNER =="
  cd "$REPO"; need kubectl ""
  local sha="${IMAGE_SHA:-$(git rev-parse HEAD)}"
  local bff="ghcr.io/$GHCR_OWNER/ai-demo-demo-api-server:sha-$sha" fe="ghcr.io/$GHCR_OWNER/ai-demo-frontend:sha-$sha"
  say "commit to deploy: $sha"
  if command -v docker >/dev/null 2>&1; then
    local waited=0
    until image_exists "$bff" && image_exists "$fe"; do
      [ "$waited" -ge $((MAX_WAIT_MIN * 60)) ] && die "images for sha-$sha not found after ${MAX_WAIT_MIN} min. Check the source repo's Build images run (and docker login ghcr.io)."
      say "  waiting for both images to exist ... (${waited}s)"; sleep 30; waited=$((waited + 30))
    done
    say "both images exist"
  else
    say "docker not installed: cannot check that the images exist. Check the source repo's Build images run yourself."
  fi
  [ "$CHECK" = 1 ] && { say "--check: stopping before any write"; return 0; }
  confirm "Deploy demo-api-server and frontend at sha-$sha in $APP_NS?"
  set_image demo-api-server "$bff"
  set_image frontend "$fe"
  say "deployed. Now test both modes in a browser (sign out and in first), as in the checklist 3.9."
  mark_done deploy
}

preflight
phase_sync
phase_pf
phase_secrets
phase_deploy
say "== done =="
