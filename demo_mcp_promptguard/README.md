# demo_mcp_promptguard — External ML guardrail sidecar

An HTTP server that runs a prompt-injection classifier as the **External Guardrail
→ ML Sidecar** for the PingOne Privilege AI Gateway. Default model is ProtectAI's
public `deberta-v3-base-prompt-injection-v2` (no HF token needed); Meta Prompt-Guard
works too but is gated (see build note). It runs as an `extraContainers`
sidecar in the `agentless-mcpgw` pod (port **8086**); the gateway reaches it over
pod loopback at `http://localhost:8086/inspect`, exactly like the other sidecars.

## The contract (reverse-engineered — see privilege/AGENTLESS-CONFIGURATION.md)

Request the gateway POSTs to `/inspect`:

```json
{ "tenant": "...", "user": "...", "app_name": "anthropic",
  "units": [ { "role": "user_prompt", "direction": "request", "text": "..." } ] }
```

Response it expects — **empty `findings` = allow**; a finding at/above the
category's block threshold makes the gateway block:

```json
{ "findings": [ { "category": "prompt_injection", "severity": "high",
                  "location": { "index": 0 }, "messages": ["..."], "contents": ["..."] } ] }
```

`GET /health` → 200. On an internal error the server returns 502 and the console's
**Sidecar Fail Closed** toggle decides whether that blocks or allows.

## Tunables (env)

| Var | Default | Note |
|---|---|---|
| `PROMPTGUARD_MODEL` | `protectai/deberta-v3-base-prompt-injection-v2` | any text-classification model |
| `PROMPTGUARD_THRESHOLD` | `0.9` | non-benign score at/above this = finding |
| `PROMPTGUARD_BENIGN_LABELS` | `benign,label_0,safe` | labels that never fire |
| `PORT` | `8086` | 8080–8085 are taken by other sidecars |

Labels differ by model — ProtectAI deberta emits SAFE/INJECTION, Meta Prompt-Guard-1
BENIGN/INJECTION/JAILBREAK, Prompt-Guard-2 BENIGN/MALICIOUS — so the benign set and
threshold are the calibration knobs; tune them to the model you bake in.

## Test / build

```bash
python3 test_server.py            # mapping check, no model/torch needed

# Default model (ProtectAI) is public — no token. For a GATED model
# (e.g. Meta Prompt-Guard) accept its licence on huggingface.co and add
# --build-arg HF_TOKEN=hf_xxx --build-arg PROMPTGUARD_MODEL=meta-llama/Llama-Prompt-Guard-2-86M
docker buildx build --platform linux/arm64 \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  -t ghcr.io/curtismu7/ai-demo-mcp-promptguard:latest --push .
```

Then add the sidecar to `pingone-privgateway-helm-main/agentless/sidecars.values.yaml`
and `helm upgrade` (see that file's header), and set the console's **ML Sidecar
URL** to `http://localhost:8086/inspect` with the External Guardrail detector on.
