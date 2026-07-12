#!/usr/bin/env bash
# scripts/llm-warmup.sh — load the demo LLM tier BEFORE showtime so the cold
# model swap (up to ~180s) never happens during a live demo.
#
#   PROXY URL:   LLAMACPP_BASE_URL   (default http://localhost:8090)
#   TARGET:      LLM_WARMUP_MODEL    (default: LAST model in /health list — the big tier)
#   TIMEOUT:     LLM_WARMUP_TIMEOUT_S (default 240)
#
# How it works: POST a 1-token completion naming the target model — the proxy's
# router treats an explicit model pin as a tier request and runs its swap/load
# machinery — then poll /health until that tier reports healthy (loaded/serving
# in swap mode — router.js /health has no separate "loaded" field; a healthy
# tier IS the loaded/serving tier).
# When LLM_PROXY_PIN_TIER is set the router already boot-loads the pinned tier;
# this script then just confirms and exits fast.
#
# SE k8s note: the cluster proxy pod sets LLM_PROXY_PIN_TIER (see the deploy
# scripts), so warmup there is automatic at pod start; this script is for
# native/local runs (run.sh calls it in the background) and manual pre-demo
# checks: ./scripts/llm-warmup.sh && echo ready.
set -u

PROXY="${LLAMACPP_BASE_URL:-http://localhost:8090}"
TIMEOUT_S="${LLM_WARMUP_TIMEOUT_S:-240}"

health() { curl -s --max-time 3 "${PROXY}/health" 2>/dev/null; }

resolve_target() {
  # Default to the LAST tier in /health (the biggest model).
  health | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    models=d.get("models") or []
    print(models[-1]["name"] if models else "")
except Exception:
    print("")'
}

TARGET="${LLM_WARMUP_MODEL:-$(resolve_target)}"
if [[ -z "$TARGET" ]]; then
  echo "[llm-warmup] proxy not reachable at ${PROXY} or no models listed — aborting" >&2
  exit 1
fi

is_loaded() {
  # Swap mode: a healthy tier IS the loaded/serving tier (router.js /health
  # exposes {name, port, size, healthy, load} — no separate "loaded" boolean).
  health | TARGET="$TARGET" python3 -c '
import json,os,sys
try:
    d=json.load(sys.stdin)
    for m in d.get("models") or []:
        if m.get("name")==os.environ["TARGET"] and m.get("healthy"):
            print("yes"); break
except Exception:
    pass'
}

if [[ "$(is_loaded)" == "yes" ]]; then
  echo "[llm-warmup] ${TARGET} already healthy (loaded/serving in swap mode) — nothing to do"
  exit 0
fi

echo "[llm-warmup] requesting load of ${TARGET} (timeout ${TIMEOUT_S}s)..."
# Fire the loading completion in the background; the proxy holds the request
# through the swap, so don't block the poll loop on it.
curl -s --max-time "$TIMEOUT_S" -X POST "${PROXY}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${TARGET}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":1}" \
  > /dev/null 2>&1 &

elapsed=0
while [[ $elapsed -lt $TIMEOUT_S ]]; do
  if [[ "$(is_loaded)" == "yes" ]]; then
    echo "[llm-warmup] ${TARGET} healthy (loaded/serving in swap mode) after ${elapsed}s"
    exit 0
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

echo "[llm-warmup] TIMEOUT: ${TARGET} not healthy after ${TIMEOUT_S}s — check the proxy log" >&2
exit 1
