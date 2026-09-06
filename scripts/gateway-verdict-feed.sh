#!/usr/bin/env bash
# scripts/gateway-verdict-feed.sh — live guardrail-verdict feed from the Privilege
# AI Gateway (Procyon / cyonproxy), for demoing Alert/Sanitize decisions that the
# LLM response never shows the caller.
#
# WHY THIS EXISTS: on the /llm/<provider>/v1/chat/completions path the gateway
# returns only a BLOCK (HTTP 400) to the caller. Alert and Sanitize verdicts are
# emitted ONLY as structured JSON on the gateway pod's stdout ("msg":"AIGuard").
# This tails that log and pretty-prints each verdict, so an SE can run it in a
# terminal beside the demo and watch every fired attack's real verdict land live.
#
# The VirtualKeyID in the raw log is a credential (sk-orion-...) — this script
# NEVER prints it. It shows time, verdict (BLOCKED/ALERT/SANITIZED), detector,
# direction (request = prompt scan, response = model-output scan).
#
# Requires: a kubectl context with read access to the gateway namespace, and jq.
#
# Usage:
#   scripts/gateway-verdict-feed.sh          # follow live (default)
#   FOLLOW= scripts/gateway-verdict-feed.sh  # one-shot snapshot of recent history
#   GATEWAY_NS=other-ns scripts/gateway-verdict-feed.sh
set -u

NS="${GATEWAY_NS:-ping-devops-curtismuir}"     # namespace hosting mcpgw.ai-demo.ping-devops.com
DEPLOY="${GATEWAY_DEPLOY:-deploy/agentless-mcpgw}"
TAIL="${TAIL:-30}"                             # history lines to show first
FOLLOW="${FOLLOW--f}"                          # default follow; set FOLLOW= (empty) for one-shot

command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }

echo "Guardrail verdict feed — ns=$NS $DEPLOY  (Ctrl-C to stop)" >&2
echo "time                  verdict    detector            direction" >&2
echo "--------------------------------------------------------------" >&2

# grep --line-buffered keeps the feed flowing line-by-line under -f. jq prints one
# tidy row per AIGuard verdict; the VirtualKeyID is never selected, so never shown.
kubectl logs -n "$NS" "$DEPLOY" --tail="$TAIL" $FOLLOW 2>/dev/null \
  | grep --line-buffered AIGuard \
  | jq -rc 'select(.msg=="AIGuard")
      | "\(.time)  \((.Event|sub("llm_request_";"")|ascii_upcase|(.+"         ")[0:9]))  \(((.Category)+"                  ")[0:18])  \(.Direction)"'
