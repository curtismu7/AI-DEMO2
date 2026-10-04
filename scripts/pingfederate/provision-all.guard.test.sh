#!/usr/bin/env bash
# provision-all.guard.test.sh — provision-all.sh must refuse unsafe targets BEFORE any docker/curl/node call.
# No Docker or PF needed: docker, curl, node and python3 are shims that log a call and fail.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin"
for tool in docker curl node python3; do
  printf '#!/bin/sh\necho "%s $*" >> "%s/calls.log"\nexit 99\n' "$tool" "$TMP" > "$TMP/bin/$tool"
  chmod +x "$TMP/bin/$tool"
done
: > "$TMP/calls.log"
fails=0
# usage: expect_refusal <label> <message-fragment> [VAR=value ...]
expect_refusal() {
  local label="$1" frag="$2"; shift 2
  set +e
  env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$HOME" "$@" bash "$HERE/provision-all.sh" >"$TMP/out.log" 2>&1
  local rc=$?
  set -e
  if [[ $rc -ne 0 && -s "$TMP/out.log" ]] && grep -q "$frag" "$TMP/out.log" && [[ ! -s "$TMP/calls.log" ]]; then
    echo "ok   $label (exit $rc, no docker/curl/node call)"
  else
    echo "FAIL $label (exit $rc, calls: $(cat "$TMP/calls.log"), output: $(cat "$TMP/out.log"))"; fails=$((fails+1))
  fi
}
expect_refusal "no overrides" "no default target"
expect_refusal "only PF_BASE" "BOTH PF_BASE" PF_BASE=https://localhost:19999/pf-admin-api/v1
expect_refusal "only container" "BOTH PF_BASE" PINGFEDERATE_CONTAINER_NAME=pf-fresh-pingfederate
expect_refusal "live port 9999" "live local PF" PF_BASE=https://localhost:9999/pf-admin-api/v1 PINGFEDERATE_CONTAINER_NAME=pf-fresh-pingfederate
expect_refusal "live container" "live local PF" PF_BASE=https://localhost:19999/pf-admin-api/v1 PINGFEDERATE_CONTAINER_NAME=ai-demo-pingfederate
expect_refusal "non-local host" "not a local demo host" PF_BASE=https://pf.example.com:19999/pf-admin-api/v1 PINGFEDERATE_CONTAINER_NAME=pf-fresh-pingfederate
[[ $fails -eq 0 ]] && echo "PASS provision-all.guard.test.sh"
exit "$fails"
