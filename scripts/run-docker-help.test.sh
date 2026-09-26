#!/usr/bin/env bash
# Regression checks for the grouped optional-service help in run-docker.sh.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/run-docker.sh"
output="$(bash "$SCRIPT" help 2>&1)"
fails=0

ok() { echo "  ok   — $1"; }
bad() { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "run-docker.sh help:"

for heading in "Data and search" "Identity and gateways" "Observability and tracing"; do
  if [[ "$output" == *"$heading"* ]]; then ok "shows $heading group"; else bad "shows $heading group"; fi
done

for group in rag spiffe demo-auth mcpgw observability tracing; do
  if [[ "$output" == *"$group"* ]]; then ok "lists optional group $group"; else bad "lists optional group $group"; fi
done

if [[ "$output" != *"optional start agents"* ]]; then
  ok "does not advertise unsupported agents group"
else
  bad "does not advertise unsupported agents group"
fi

if [[ "$output" != *"build notebooklm"* ]]; then
  ok "no longer advertises the removed NotebookLM service"
else
  bad "no longer advertises the removed NotebookLM service"
fi

if [[ "$output" == *"./run-docker.sh optional start spiffe"* ]]; then
  ok "shows the SPIFFE start example"
else
  bad "shows the SPIFFE start example"
fi

if [[ "$output" == *"./run-docker.sh optional status"* ]]; then
  ok "shows the optional status example"
else
  bad "shows the optional status example"
fi

if [[ "$fails" -eq 0 ]]; then
  echo "all checks passed"
  exit 0
fi
echo "$fails check(s) failed"
exit 1
