# 2-Tier LLM Proxy

Smart routing proxy for managing 2 local language models through a single endpoint.

## Which backend?

| Context | Backend | How |
|---------|---------|-----|
| **Default** — Docker, K8s, CI, Linux | **llama.cpp** | Omit `LLM_BACKEND` (GGUF tiers + this router) |
| **Mac daily dev** — agent chips, tool loops | **oMLX** | `LLM_BACKEND=omlx ./run.sh` or `./run-docker.sh start` |

Provider id stays `llamacpp` in the UI for all backends (OpenAI-compatible `/v1` on `:8090`).
Docker/K8s clusters always use llama.cpp in-cluster; oMLX is a host-only Mac fast path.

See [oMLX Mac fast path](#omlx-mac-fast-path-recommended-on-apple-silicon) below.

## Architecture

The proxy runs in **swap mode** — only ONE tier is loaded at a time ("smallest
that does the job"). A request is classed by its `model` field (per-agent pin
via `LLAMACPP_MODEL`: BFF → phi-4-mini-instruct, agent-service → gpt-oss-20b)
or, absent a pin, by keyword classification. It is served by the smallest
*loaded* tier that covers the class; if nothing loaded covers it, the router
asks the host `tier-manager.js` (:8097) to swap — unload everything, load the
needed tier — and after 5 idle minutes it decays back to Tier 1. The first
request after a swap pays the model-load pause (a few seconds warm, up to ~30s
cold for gpt-oss).

Two tiers, both US-origin:

- **Tier 1**: Microsoft Phi-4-mini-instruct (3.8B) — small/teaching/classification, "what is", basic Q&A, NL intent
- **Tier 5**: OpenAI gpt-oss-20B (20B MoE) — vibe coding / reasoning / agent brain; complex technical prompts ("demonstrate", token flows), code generation, tool calls. MoE with ~3.6B active params, so fast despite its size

The tier list is defined once in `router.js` (`TIERS`) and the exact GGUF
filenames in `start-local-models.sh`; keep those two in sync when changing models.

## Request Classification

The proxy analyzes incoming requests and routes to the appropriate tier:

```
"what is OAuth?" → Phi-4-mini (small, fast)
"how does token exchange work?" → gpt-oss-20b (reasoning)
"implement a PKCE verifier function" → gpt-oss-20b (code)
"demonstrate HITL approval" → gpt-oss-20b (reasoning)
```

A bigger loaded tier serves smaller classes without a swap; swaps happen only upward, and idle decay brings it back down.

## Setup

### 1. Download Models

Models should be in `/Users/cmuir/models/` as GGUF-quantized files:

```bash
bash demo_llm_proxy/download-models.sh
```

This script checks for required models and provides download links if missing.

**Model files needed (both US-origin):**
- `microsoft_Phi-4-mini-instruct-Q4_K_M.gguf` (~2.5GB)
- `gpt-oss-20b-mxfp4.gguf` (~11GB)

### 2. Update docker-compose.yml

The proxy is included in `docker-compose.yml` by default:

```bash
docker compose up llm-proxy   # Starts proxy (host llama-server backends are separate)
```

### 3. Configure Agent Service

The agent-service automatically uses the proxy when:
- `LLM_PROVIDER=llamacpp`
- `LLAMACPP_BASE_URL=http://llm-proxy:8090` (default)

This is set by `refresh-service-envs.js` during bootstrap.

## Endpoints

### `/health` (GET)

Check proxy and model health:

```bash
curl http://localhost:8090/health
```

Response:

```json
{
  "status": "healthy",
  "models": [
    {"name": "phi-4-mini-instruct", "port": 8091, "healthy": true, "load": 0},
    {"name": "gpt-oss-20b",         "port": 8096, "healthy": false, "load": 0}
  ]
}
```

### `/status` (GET)

Get detailed model information:

```bash
curl http://localhost:8090/status
```

### `/completions` (POST)

Send a prompt — proxy automatically routes to the right model:

```bash
curl -X POST http://localhost:8090/completions \
  -H "Content-Type: application/json" \
  -d '{"prompt":"what is OAuth?"}'
```

The router classifies the prompt and sends to the appropriate tier.

## Load Balancing

- **Load tracking** — counts in-flight requests per model
- **Cascading fallback** — if tier N is full (>3 requests) or unhealthy, try tier N+1
- **Health checks** — pings each instance every 30s

## Monitoring

Watch logs from the proxy:

```bash
docker compose logs -f llm-proxy
```

Watch a specific model:

```bash
docker compose logs -f llm-phi3
```

Check health from host:

```bash
curl http://localhost:8090/health | jq .
```

## Troubleshooting

### Models not found

If llama.cpp instances fail to start, check:

1. Models exist in `/Users/cmuir/models/`
2. Filenames match expected patterns (`microsoft_Phi-4-mini-instruct-Q4_K_M.gguf`, `gpt-oss-20b-mxfp4.gguf`)
3. Model files are readable: `ls -lh /Users/cmuir/models/`

### Proxy can't reach models

If the proxy reports all models unhealthy:

1. Check Docker network: `docker network ls | grep ai-demo`
2. Verify host llama-server backends started: `bash demo_llm_proxy/start-local-models.sh status`
3. Check logs: `tail /tmp/llama-models/llama-*.log`

### Slow responses

- Check load per model: `curl http://localhost:8090/health | jq .models`
- Verify model tier selection is appropriate for your prompts
- Increase context size in `start-local-models.sh` (`--ctx-size` flag)

## Configuration

Edit `demo_llm_proxy/start-local-models.sh` to customize:

- **Threads per model**: the 4th field in each `MODELS` entry (e.g. `4` for Tier 1)
- **GPU layers**: `--n-gpu-layers 33` flag (set to `0` for CPU only)
- **Context size**: `--ctx-size 4096` (larger = more memory, slower startup)

Example: use CPU only by setting `--n-gpu-layers 0` for both tiers.

## Performance Tips

1. **Phi-4-mini for chat** — fastest, good for simple explanations and NL intent classification
2. **gpt-oss-20b for reasoning/code** — complex OAuth/token flows, vibe coding, tool calls

If you're seeing slow responses:

- Reduce `--ctx-size` (uses less VRAM, but shorter context)
- Disable GPU: set `--n-gpu-layers 0`
- Use smaller quantization (Q3 instead of Q4)

## oMLX Mac fast path (recommended on Apple Silicon)

On Apple Silicon, [oMLX](https://github.com/jundot/omlx) is the recommended Mac
backend for agent chip sessions. It serves `:8090` directly (no tier router) with
SSD-persisted KV cache — much faster repeat turns than swap-mode llama.cpp.

```bash
brew tap jundot/omlx https://github.com/jundot/omlx
brew trust jundot/omlx   # required on Homebrew 6.0+
brew install omlx
bash demo_llm_proxy/download-omlx-models.sh fetch
LLM_BACKEND=omlx ./run.sh                    # native
LLM_BACKEND=omlx ./run-docker.sh start       # containers → host.docker.internal:8090
```

After first start, open http://127.0.0.1:8090/admin — pin Phi-4 and alias models
to `phi-4-mini-instruct` (BFF) and `gpt-oss-20b` (agent-service).

Design spec: `docs/superpowers/specs/2026-07-07-omlx-mac-fast-path-design.md`
