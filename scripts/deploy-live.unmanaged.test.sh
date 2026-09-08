#!/usr/bin/env bash
# Self-check for deploy-live.sh's unmanaged-service guard.
#   bash scripts/deploy-live.unmanaged.test.sh
#
# The failure this guards is NOT a wrong service list — it is an ABORT.
# `./run-docker.sh restart llm-proxy` answers "Unknown service" and exits 1,
# and deploy-live runs under `set -e`, so the whole deploy dies mid-run after
# earlier services have already been rebuilt. Observed live 2026-09-08: the
# BFF never restarted and the deploy reported exit 1 with a half-applied stack.
#
# Sourcing the real script is not possible (it locks, syncs and deploys), so
# this extracts the guard's definitions and exercises them directly — the point
# is that the definitions themselves behave, and that both are in the file.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/deploy-live.sh"
fails=0
ok()  { echo "  ok   — $1"; }
bad() { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "deploy-live unmanaged-service guard:"

bash -n "$SCRIPT" 2>/dev/null && ok "deploy-live.sh parses" || bad "deploy-live.sh has a syntax error"

# The definitions must come BEFORE add_restart's body runs, or
# UNMANAGED_BY_RUN_DOCKER is empty at call time and the guard silently
# disables itself while still looking present.
def_line=$(grep -n '^UNMANAGED_BY_RUN_DOCKER=' "$SCRIPT" | head -1 | cut -d: -f1)
use_line=$(grep -n '^add_restart()' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -n "$def_line" ] && [ -n "$use_line" ] && [ "$def_line" -lt "$use_line" ]; then
  ok "the unmanaged list is defined before add_restart ($def_line < $use_line)"
else
  bad "UNMANAGED_BY_RUN_DOCKER ($def_line) must be defined before add_restart ($use_line)"
fi

# add_restart is the single choke point — a future caller must inherit the
# guard rather than needing its own copy.
grep -q 'is_unmanaged_by_run_docker' <(sed -n "${use_line},\$p" "$SCRIPT" | head -12) \
  && ok "add_restart consults the guard itself" \
  || bad "add_restart no longer consults the guard — a new caller could reintroduce the abort"

# Behaviour, against the real definitions lifted out of the script.
eval "$(sed -n '/^UNMANAGED_BY_RUN_DOCKER=/p; /^is_unmanaged_by_run_docker()/p' "$SCRIPT")"
NOTES=""
note() { NOTES="${NOTES}$1"$'\n'; }

# Bound the extraction. On the pre-guard ONE-LINER form this awk range never
# sees its closing "^}" and swallows the rest of the file, which then fails on
# some unrelated variable instead of failing as this guard — a confusing red
# that hides which check actually broke.
add_restart_src="$(awk '/^add_restart\(\)/,/^\}/' "$SCRIPT")"
if [ "$(printf '%s\n' "$add_restart_src" | wc -l | tr -d ' ')" -gt 20 ]; then
  bad "could not isolate add_restart (extraction ran away — is it still a multi-line function?)"
  add_restart_src='add_restart() { case " $RESTART_SET " in *" $1 "*) ;; *) RESTART_SET="$RESTART_SET $1" ;; esac; }'
fi
eval "$add_restart_src"
RESTART_SET=""

if add_restart demo-api-server; then
  case " $RESTART_SET " in *" demo-api-server "*) ok "a managed service is scheduled and returns 0" ;;
    *) bad "demo-api-server was not scheduled" ;; esac
else
  bad "add_restart returned non-zero for a managed service"
fi

if add_restart llm-proxy; then
  bad "add_restart returned 0 for llm-proxy — the caller would schedule it and abort the deploy"
else
  case " $RESTART_SET " in
    *" llm-proxy "*) bad "llm-proxy was scheduled anyway — run-docker.sh will exit 1 on it" ;;
    *) ok "llm-proxy is refused and never scheduled" ;;
  esac
  case "$NOTES" in
    *"docker compose up -d llm-proxy"*) ok "the refusal names the direct command to run instead" ;;
    *) bad "refusal did not tell the operator how to recreate it" ;;
  esac
fi

# Idempotence, unchanged by the guard.
add_restart demo-api-server >/dev/null 2>&1
count=$(printf '%s' " $RESTART_SET " | grep -o 'demo-api-server' | wc -l | tr -d ' ')
[ "$count" = "1" ] && ok "repeat scheduling stays deduplicated" || bad "demo-api-server scheduled $count times"

echo
[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"; exit 1
