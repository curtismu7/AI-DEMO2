# Multi-Model LLM Proxy

Smart routing proxy for managing 4 different language models through a single endpoint.

## Architecture

The proxy implements **smart classification and cascading fallback**:

- **Tier 1**: Phi-2 (2.7B) — simple explanations, "what is", basic Q&A
- **Tier 2**: Phi-3 (3.8B) — moderate complexity, "how does", multi-step reasoning
- **Tier 3**: Qwen3-8b (8B) — complex technical, "demonstrate", token flows
- **Tier 4**: Gemma-4-12B (12B) — advanced, fallback for overloaded tiers

## Request Classification

The proxy analyzes incoming requests and routes to the **smallest model that can handle it**:

```
"what is OAuth?" → Phi-2 (fastest)
"how does token exchange work?" → Phi-3 (balanced)
"demonstrate HITL approval" → Qwen (accurate)
```

If the selected tier is unavailable or overloaded, it cascades to the next larger model automatically.

## Setup

### 1. Download Models

Models should be in `/Users/cmuir/models/` as GGUF-quantized files:

```bash
bash demo_llm_proxy/download-models.sh
```

This script checks for required models and provides download links if missing.

**Model files needed:**
- `phi-2.gguf` (or similar, ~5.5GB)
- `phi-3.gguf` (or similar, ~2.3GB)
- `qwen3-8b.gguf` or `Qwen2.5-Coder-*-Q4_K_M.gguf` (~8B)
- `gemma-4-12b-it-UD-Q4_K_XL.gguf` (~6.9GB)

### 2. Update docker-compose.yml

The proxy is included in `docker-compose.yml` by default:

```bash
docker compose up llm-proxy   # Starts proxy + 4 model instances
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
    {"name": "phi-2", "port": 8091, "healthy": true, "load": 0},
    {"name": "phi-3", "port": 8092, "healthy": true, "load": 1},
    {"name": "qwen3-8b", "port": 8093, "healthy": true, "load": 0},
    {"name": "gemma-4-12b", "port": 8094, "healthy": false, "load": 0}
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

- **Round-robin** within each model tier
- **Load tracking** — counts in-flight requests per model
- **Cascading fallback** — if tier N is full (>3 requests), try tier N+1
- **Health checks** — pings each instance every 10s

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
2. Filenames match expected patterns (e.g., `*phi-2*.gguf`)
3. Model files are readable: `ls -lh /Users/cmuir/models/`

### Proxy can't reach models

If the proxy reports all models unhealthy:

1. Check Docker network: `docker network ls | grep ai-demo`
2. Verify containers started: `docker ps | grep llm-`
3. Check logs: `docker compose logs llm-phi2`

### Slow responses

- Check load per model: `curl http://localhost:8090/health | jq .models`
- Verify model tier selection is appropriate for your prompts
- Increase context size in `docker-compose.yml` for larger models (qwen, gemma)

## Configuration

Edit `docker-compose.yml` to customize:

- **Threads per model**: `LLAMA_ARG_THREADS`
- **GPU layers**: `LLAMA_ARG_N_GPU_LAYERS` (0 = CPU only)
- **Context size**: `LLAMA_ARG_CTX_SIZE` (larger = more memory, slower startup)

Example: use CPU only by setting `N_GPU_LAYERS=0` in all llm-* services.

## Performance Tips

1. **Phi-2 for chat** — fastest, good for simple explanations
2. **Phi-3 for reasoning** — balanced speed/quality
3. **Qwen for technical** — complex OAuth/token flows
4. **Gemma as fallback** — only when others are overloaded

If you're seeing slow responses:

- Reduce `LLAMA_ARG_CTX_SIZE` (uses less VRAM, but shorter context)
- Disable GPU: set `N_GPU_LAYERS=0`
- Use smaller quantization (Q3 instead of Q4)
