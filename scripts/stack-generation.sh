#!/usr/bin/env bash
# stack-generation.sh — is the stack still the one you started against?
#
# The problem this solves (TECH_DEBT 2026-08-19): several Claude sessions share
# one Docker stack, and any of them can recreate `ui` / `demo-api-server` at will,
# mid-request, under whoever is driving the browser. From the driver's side that
# is invisible and actively misleading — the browser gets a 404 or 502, the BFF
# has no trace of the request because it was not running when it arrived, and
# `docker logs` afterwards reads the NEW container. It looks exactly like an
# application bug in whatever code path happened to be executing. One measured
# instance cost about an hour chasing a consent-challenge 404 through session
# lookup, TTL, single-use consumption and hitl-service — every hypothesis
# server-side, for a fault that was not.
#
# The generation is DERIVED from docker, not stamped by deploy-live.sh as that
# entry first proposed. That matters: in the incident that motivated this, the
# restarts did not come from deploy-live.sh at all (its ledger recorded only two,
# both `ui`, at different times). A counter written by deploy-live.sh would have
# missed the exact case it was meant to catch. Reading the containers catches a
# recreate from any source — deploy-live.sh, run-docker.sh restart,
# serve-worktree.sh, or somebody's bare `docker compose up`.
#
# This changes no locking behaviour and blocks nothing. It only makes the ground
# checkable, which is step 1 of that entry's own "smallest useful first" plan.
#
# Usage:
#   scripts/stack-generation.sh                 # print the current generation
#   scripts/stack-generation.sh --check <gen>   # exit 1 if it has moved since <gen>
#
#   gen="$(npm run -s stack:generation)"
#   ... drive the UI, run the probe, present ...
#   npm run -s stack:generation -- --check "$gen" || echo "run is VOID, not a finding"
set -uo pipefail

# The only two services that bind-mount source, and therefore the only two a
# deploy recreates. Every other service runs from its built image.
CONTAINERS=(ai-demo-ui ai-demo-api-server)

# Container ID *and* StartedAt: the id changes on a recreate, StartedAt changes on
# a plain restart of the same container. Either one invalidates a run, so both are
# in the generation.
generation() {
  local out="" id started c
  for c in "${CONTAINERS[@]}"; do
    id="$(docker inspect -f '{{.Id}}' "$c" 2>/dev/null || true)"
    started="$(docker inspect -f '{{.State.StartedAt}}' "$c" 2>/dev/null || true)"
    if [[ -z "$id" ]]; then
      out+="$c=absent;"
    else
      out+="$c=${id:0:12}@${started};"
    fi
  done
  printf '%s' "$out"
}

# A human-readable diff of what actually moved, so the message names the service
# rather than making someone eyeball two hash strings.
explain_drift() {
  local before="$1" after="$2" c b a
  for c in "${CONTAINERS[@]}"; do
    b="$(printf '%s' "$before" | tr ';' '\n' | grep "^$c=" || true)"
    a="$(printf '%s' "$after"  | tr ';' '\n' | grep "^$c=" || true)"
    [[ "$b" == "$a" ]] && continue
    echo "  $c"
    echo "    was: ${b#*=}"
    echo "    now: ${a#*=}"
  done
}

case "${1:-}" in
  --check)
    before="${2:-}"
    if [[ -z "$before" ]]; then
      echo "usage: stack-generation.sh --check <generation>" >&2
      exit 2
    fi
    after="$(generation)"
    if [[ "$before" == "$after" ]]; then
      echo "stack unchanged — the run stands"
      exit 0
    fi
    echo "STACK MOVED under this run — treat it as VOID, not as a finding." >&2
    explain_drift "$before" "$after" >&2
    echo >&2
    echo "Another session recreated the stack mid-run. Any 404/502 you saw, and any" >&2
    echo "absence of server-side evidence, is explained by this. Re-run against a" >&2
    echo "stable stack before believing anything the run reported." >&2
    exit 1
    ;;
  -h|--help)
    sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "")
    generation
    echo
    ;;
  *)
    echo "unknown argument: $1 (expected --check <generation>)" >&2
    exit 2
    ;;
esac
