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
  # Pick the BIGGEST tier by declared size, preferring one that is already
  # healthy.
  #
  # This used to take models[-1], on the assumption that last-in-list is the big
  # tier. That held with two tiers. It stopped holding the moment router.js
  # appended the experimental Llama-3-Groq-8B tier (:8093) LAST, deliberately, so
  # it would never affect class-0/class-1 routing and would load only via an
  # explicit LLM_PROXY_PIN_TIER=8093. Warmup then targeted exactly the tier that
  # must not load: it is outside LLM_PROXY_RESIDENT_TIERS=8091,8096, so loading it
  # would EVICT a resident tier — the thing that setting exists to prevent — and
  # it never goes healthy on its own, so warmup could only ever burn its full
  # 240s timeout and report failure. Positional selection was the bug; size is
  # what the script always meant.
  #
  # Preferring a healthy tier keeps warmup from evicting a loaded resident to
  # load a bigger non-resident one. With no healthy tiers (cold proxy) it falls
  # back to the biggest overall, which is the resident big tier.
  health | python3 -c '
import json,sys
def size(m):
    try: return float(str(m.get("size") or "0").upper().rstrip("B"))
    except Exception: return 0.0
try:
    models=[m for m in (json.load(sys.stdin).get("models") or []) if m.get("name")]
    pool=[m for m in models if m.get("healthy")] or models
    print(max(pool, key=size)["name"] if pool else "")
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

# After the tier is healthy, poke /refresh and run a short prefix completion so
# llama-server's prompt cache has a warm slot before showtime.
finish_warm() {
  curl -s --max-time 15 -X POST "${PROXY}/refresh" >/dev/null 2>&1 || true
  curl -s --max-time 60 -X POST "${PROXY}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${TARGET}\",\"messages\":[{\"role\":\"system\",\"content\":\"You are a concise demo assistant.\"},{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":1}" \
    >/dev/null 2>&1 || true
  echo "[llm-warmup] ${TARGET} warm (loaded + prefix cached)"
}

if [[ "$(is_loaded)" == "yes" ]]; then
  echo "[llm-warmup] ${TARGET} already healthy (loaded/serving in swap mode) — refreshing prefix cache"
  finish_warm
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
    finish_warm
    exit 0
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

echo "[llm-warmup] TIMEOUT: ${TARGET} not healthy after ${TIMEOUT_S}s — check the proxy log" >&2
exit 1
