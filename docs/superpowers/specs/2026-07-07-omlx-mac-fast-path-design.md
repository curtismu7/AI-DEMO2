# oMLX Mac Fast Path — Design Sketch

**Status:** shipped (llamacpp default + oMLX Mac fast path)  
**Scope:** optional Mac-native LLM backend for `./run.sh` local dev  
**Out of scope:** Docker Compose, K8s, CI — keep llama.cpp there

## Problem

The demo's Mac dev path runs a **2-tier llama.cpp stack**:

```
BFF / agent-service  →  :8090 router  →  :8091 (Phi-4) | :8096 (gpt-oss)
                              ↑
                        tier-manager :8097 (swap mode, one model loaded)
```

Swap mode saves RAM but costs a **model-load pause** on tier upgrades. Agent workloads also **invalidate KV cache** when tool results shift the prefix — llama.cpp recomputes from scratch each time.

[oMLX](https://github.com/jundot/omlx) (MLX on Apple Silicon) targets that second pain with **paged SSD KV caching** + **continuous batching** + **multi-model LRU** — no manual tier swapping on Mac.

## Goal

Add an opt-in `LLM_BACKEND=omlx` path that:

1. Starts oMLX on **`:8090`** (same origin consumers already use)
2. Skips `router.js`, `tier-manager.js`, and `start-local-models.sh`
3. Leaves Docker/K8s on llama.cpp unchanged
4. Keeps provider id `llamacpp` in the app (OpenAI-compatible surface; rename later if desired)

## Architecture

### Default (`LLM_BACKEND=llamacpp`)

Unchanged — swap-mode llama.cpp proxy stack.

### Mac fast path (`LLM_BACKEND=omlx`)

```
BFF / agent-service  →  :8090 oMLX (OpenAI /v1)
                              ├── Phi-4-mini (pinned, BFF NL intent)
                              └── gpt-oss-20b (agent reasoning, LRU load)
```

oMLX owns multi-model memory via its EnginePool (pin + LRU + TTL). The demo router is redundant on Mac when oMLX is the backend.

### Docker (`./run-docker.sh`)

Unchanged. Containers still reach host via `host.docker.internal:8090`. When the host runs oMLX instead of the Node router, the same URL works.

```bash
# Mac host running oMLX
LLM_BACKEND=omlx ./run.sh          # native services, oMLX on :8090

# Docker stack pointing at host oMLX
LLM_BACKEND=omlx ./run-docker.sh start
```

## Environment contract

| Variable | `llamacpp` (default) | `omlx` |
|----------|----------------------|--------|
| `LLM_BACKEND` | unset or `llamacpp` | `omlx` |
| `LLAMACPP_BASE_URL` | `http://localhost:8090` | `http://localhost:8090` (unchanged) |
| `LLAMACPP_MODEL` | `phi-4-mini-instruct` | alias matching oMLX admin pin (see below) |
| `OMLX_PORT` | — | `8090` (avoid retuning all consumers) |
| `OMLX_MODEL_DIR` | — | `~/.omlx/models` (or `$HOME/models/mlx`) |
| `OMLX_SSD_CACHE_DIR` | — | `~/.omlx/cache` |

**Per-service model pins** (unchanged semantics):

- BFF NL intent: `LLAMACPP_MODEL=phi-4-mini-instruct` (or oMLX alias)
- Agent service: `LLAMACPP_MODEL=gpt-oss-20b` (or oMLX alias)

Set aliases in oMLX admin (`/admin`) so `/v1/models` returns ids the demo already expects.

## New files

| File | Purpose |
|------|---------|
| `demo_llm_proxy/start-omlx.sh` | `start \| stop \| status` wrapper around `omlx` CLI |
| `demo_llm_proxy/download-omlx-models.sh` | Pull MLX-format models into `OMLX_MODEL_DIR` |
| This spec | Integration contract + rollout steps |

## `start-omlx.sh` behavior

```bash
# Prerequisites (install once)
brew tap jundot/omlx https://github.com/jundot/omlx
brew install omlx

# Lifecycle
bash demo_llm_proxy/start-omlx.sh start    # omlx serve on :8090 + SSD cache
bash demo_llm_proxy/start-omlx.sh status
bash demo_llm_proxy/start-omlx.sh stop
```

**Start flags (sketch):**

```bash
omlx serve \
  --model-dir "${OMLX_MODEL_DIR:-$HOME/.omlx/models}" \
  --paged-ssd-cache-dir "${OMLX_SSD_CACHE_DIR:-$HOME/.omlx/cache}" \
  --hot-cache-max-size 20% \
  --max-concurrent-requests 16 \
  --port "${OMLX_PORT:-8090}"
```

**Readiness:** `curl -sf http://127.0.0.1:8090/v1/models`

**Mutual exclusion:** if `LLM_BACKEND=omlx`, do not start `router.js` / `tier-manager.js` / `llama-server` on 8090–8097.

## MLX model mapping

GGUF files in `~/models/` are **not** reused. Download MLX subdirectories:

| Demo tier | GGUF (llama.cpp) | MLX (oMLX) | ~size |
|-----------|------------------|------------|-------|
| Tier 1 | `microsoft_Phi-4-mini-instruct-Q4_K_M.gguf` | `mlx-community/Phi-4-mini-instruct-4bit` | ~2.5 GB |
| Tier 5 | `gpt-oss-20b-mxfp4.gguf` | `mlx-community/gpt-oss-20b-MXFP4-Q4` | ~11 GB |

```bash
bash demo_llm_proxy/download-omlx-models.sh fetch
```

Pin Phi-4 in oMLX admin for always-loaded BFF latency; let gpt-oss LRU-load for agent mode.

## `run.sh` integration (sketch patch)

Replace the block at `_start_llm_proxy_stack` with a backend switch:

```bash
local llm_backend="${LLM_BACKEND:-llamacpp}"

_start_local_llm() {
  if [[ "$llm_backend" == "omlx" ]]; then
    if [[ "$(uname)" != "Darwin" ]]; then
      warn "LLM_BACKEND=omlx requires macOS — falling back to llamacpp"
      llm_backend="llamacpp"
    elif ! command -v omlx >/dev/null 2>&1; then
      warn "omlx not found — brew tap jundot/omlx && brew install omlx"
      return 1
    else
      bash "${BASEDIR}/demo_llm_proxy/start-omlx.sh" start && return 0
      return 1
    fi
  fi
  # existing _start_llm_proxy_stack body…
}
```

Probe health the same way (`/v1/models` works for both backends).

## `run-docker.sh` integration (sketch patch)

In `start_llamacpp()`:

```bash
if [[ "${LLM_BACKEND:-llamacpp}" == "omlx" ]]; then
  bash "$(dirname "$_TIERS_SCRIPT")/start-omlx.sh" start
  return
fi
# existing swap-mode llama.cpp path…
```

`stop_llamacpp()` calls `start-omlx.sh stop` when backend is omlx.

## Embeddings

**Phase 1:** leave the compose `embeddings` container on llama.cpp (`nomic-embed-text` GGUF). Unrelated to BFF/agent chat.

**Phase 2 (optional):** add `bge-m3` or `nomic-embed` MLX dir under oMLX; point code-search RAG at `host.docker.internal:8090/v1/embeddings`. Separate change.

## Rollout phases

### Phase 0 — sketch (this doc + scripts)

- [x] Design spec
- [x] `start-omlx.sh` + `download-omlx-models.sh`
- [x] Manual smoke: `LLM_BACKEND=omlx bash demo_llm_proxy/start-omlx.sh start`

### Phase 1 — `run.sh` toggle

- [x] `LLM_BACKEND` branch in `run.sh`
- [x] `run-docker.sh` `start_llamacpp` / `stop_llamacpp` branch
- [x] `.env.example` notes
- [x] `install.sh` optional `ensure_omlx()` on Darwin

### Phase 2 — UX

- [ ] Demo UI Servers panel: "LLM backend: llama.cpp | oMLX" (Mac only)
- [ ] Health probe in `serverInventory.js` accepts oMLX `/v1/models` shape

### Phase 3 — benchmarks

- [ ] Agent chip session: TTFT with oMLX SSD cache vs swap-mode llama.cpp
- [ ] Document when to use which backend in `demo_llm_proxy/README.md`

## Risks

| Risk | Mitigation |
|------|------------|
| oMLX Mac-only | Auto-fallback to `llamacpp` on Linux / in CI |
| Port 8090 clash | `start-omlx.sh` stops router/tier-manager before bind |
| Model id drift | Admin aliases match `phi-4-mini-instruct` / `gpt-oss-20b` |
| Tool calling format | gpt-oss harmony template — verify agent tool loop on oMLX before Phase 2 |
| RAM pressure | oMLX memory guard + pin only Phi-4; gpt-oss on demand |

## Smoke test checklist

```bash
# 1. Install + models
brew tap jundot/omlx https://github.com/jundot/omlx && brew install omlx
bash demo_llm_proxy/download-omlx-models.sh fetch

# 2. Start oMLX backend
LLM_BACKEND=omlx bash demo_llm_proxy/start-omlx.sh start
curl -s http://127.0.0.1:8090/v1/models | jq .

# 3. Native stack
LLM_BACKEND=omlx ./run.sh

# 4. Docker stack (host oMLX, containers via host.docker.internal)
LLM_BACKEND=omlx ./run-docker.sh start

# 5. Agent mode "llama.cpp only" — chip + tool call, watch TTFT on 2nd+ turn
```

## Decision

**Worth doing** as an opt-in Mac fast path. Minimal surface area: two scripts, one env var, small `run.sh` / `run-docker.sh` branches. No provider-id rename, no Compose/K8s churn.

Default stays **llamacpp** until oMLX is proven on agent tool loops in this repo.
