# LLM Resident Tiers — remove the swap stall from the agent path

Date: 2026-07-14
Status: Design approved, pending implementation
Branch: `feat/llm-resident-tiers`

## Problem

The demo agent was reported as "works but way too long", and separately as
"falling back to heuristics". Measurement showed these are **one defect**, not
two.

The llm-proxy runs in swap mode: at most one llama-server tier is loaded at a
time. The BFF pins `phi-4-mini-instruct` (tier `:8091`); the agent-service pins
`gpt-oss-20b` (tier `:8096`). Only one of those can be resident, so whichever
surface is used second pays a full model swap — unload one model, load the other
from disk.

When the agent's swap overruns the caller's patience, the BFF applies its
heuristic floor and renders the "Heuristics-only mode — no LLM" catalog card.
So the swap produces *both* reported symptoms: slow when it completes, heuristics
when it doesn't.

## Evidence (measured 2026-07-14, M4 Max / 64GB, llama.cpp backend)

| Path | Observed |
|---|---|
| Warm `phi-4-mini` via proxy `:8090` | **1.3s** |
| Warm `gpt-oss-20b` via proxy `:8090` | **1.9s** (200 tokens, ~105 tok/s) |
| Tier swap (`/ensure?port=8096`) | **7.3s** with warm page cache; ~30s cold |

Warm inference is fast on both tiers. There is **no throughput problem**. Nothing
in the `llama-server` flag set needs tuning, and no model needs replacing.

## Non-causes (checked and ruled out)

These looked like causes and are not. Recorded so nobody re-investigates them.

- **`LLM_PROVIDER=none` in `demo_agent_service/.env`** — gates nothing. The value
  is consumed in exactly one place, a `console.log` at `demo_agent_service/src/index.ts:108`.
  The startup banner `[Agent] LLM provider: none` is cosmetic. The provider used
  for reasoning arrives per-request from the BFF (`reasonContract.ts:20`).
- **`LLM_MODEL=qwen3-8b`** — also banner-only. The variable that actually routes
  is `LLAMACPP_MODEL`, correctly set to `gpt-oss-20b`.
- **"`LLM_PROVIDER=llamacpp` crash-loops the agent-service"** — stale note.
  `llamacpp` is in `VALID_LLM_PROVIDERS` (`config.ts:52-59`) and requires no API
  key, so it cannot throw at startup.
- **`Helix not configured — heuristics-only` BFF startup warning** — a generic
  boot warning, not the active path. `AGENT_MODE=llamacpp` resolves the provider
  to `llamacpp`, not `helix`.

## Design

Introduce a **resident set**: a list of tier ports that are loaded at boot and
never evicted.

```
LLM_PROXY_RESIDENT_TIERS=8091,8096
```

The router already selects the smallest *loaded* tier that covers a request's
class. With both tiers loaded it therefore never swaps: phi-4-mini serves the
BFF's cheap calls, gpt-oss serves the agent's reasoning, and the agent's reasoning
call no longer times out — so the heuristic floor stops firing.

Memory cost is ~14GB resident (2.5GB phi + 11GB gpt-oss).

### Changes

1. **`demo_llm_proxy/start-local-models.sh`** — new `ensure-set <ports...>` action:
   start every listed tier, stop every unlisted one. The existing single-port
   `ensure` is unchanged.

2. **`demo_llm_proxy/router.js`** — the idle-decay timer (line ~244) skips decay
   for any tier in the resident set. Today decay is skipped only when
   `LLM_PROXY_PIN_TIER` is set; residency gets the same treatment, for the same
   reason already documented there ("the pin's whole point is keeping that tier
   warm").

3. **`demo_llm_proxy/supervise-swap.sh`** — at boot, load the resident set rather
   than only the smallest tier. This is the actual gap: nothing currently
   pre-loads the agent's tier, so even a pinned tier pays a swap on first request.

### Compatibility

`LLM_PROXY_RESIDENT_TIERS` unset ⇒ behavior is **byte-for-byte today's**: swap
mode, smallest-tier boot, 5-minute idle decay. Docker and K8s are therefore
untouched by default, which matters because the K8s tiers run at `replicas: 0` on
CPU-only nodes and are deliberately out of scope here.

## Explicit non-goals

- **AWS/K8s cold start is not addressed.** There the tiers run at `replicas: 0`
  (`k8s/56-llm-stack.yaml:71`) with no GPU request, so the first hit is a pod
  scale-from-zero plus a PVC model pull. Fixing that means running tiers warm at
  idle cluster cost — declined for now. This design only guarantees we do not
  *regress* that path.
- **No llama-server flag tuning.** Warm throughput is already good; changing
  `--threads`, `--n-gpu-layers`, `--ctx-size`, or quantization is unjustified by
  the measurements.
- **No model changes.** phi-4-mini and gpt-oss-20b both perform well warm.

## Success criteria

1. With `LLM_PROXY_RESIDENT_TIERS=8091,8096` set, `curl localhost:8090/health`
   reports **both** tiers `healthy:true` after boot, with no request sent.
2. Alternating a phi-pinned request and a gpt-oss-pinned request produces **no**
   `[proxy] swap →` line in the llm-proxy log.
3. After 6+ idle minutes (past `IDLE_DECAY_MS`), both tiers are still
   `healthy:true` — no `[proxy] idle … decaying` line.
4. An agent reasoning call returns real LLM prose, not the heuristic catalog card.
5. With the env var unset, the swap/decay behavior is unchanged (regression check).
