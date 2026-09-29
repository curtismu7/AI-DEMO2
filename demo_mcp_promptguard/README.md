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

## Docker startup

`./run-docker.sh start` starts the sidecar as part of the core stack and binds
`127.0.0.1:8086`. NeMo Guardrails is installed by default so both detector
choices are available in the UI. For a classifier-only image, set
`PROMPTGUARD_INSTALL_NEMO=0` before the sidecar image is built.

The local Kubernetes startup includes the same NeMo-enabled image and
Deployment. `./run-k8.sh` builds the images and deploys the stack to the active
local Kubernetes context. The PromptGuard Deployment has no ClusterIP Service;
the namespace Service quota is full, and the UI connects through the
`localhost:8086` port-forward.

The config panel is on the AI Demo's **LLM Gateway** page at
`https://local.ping-devops.com:4000/llm-gateway`. Select **NeMo Guardrails** and
apply the change there. The panel also controls the demo trigger phrase and its
allow/block outcome. It does not require a separate NeMo account or console.

## Local runtime profiles

Direct Docker builds default to the built-in classifier only; add the build arg
to install NeMo. Compose enables the optional dependency by default. Both
profiles bake the configured classifier model into the image, so startup does
not need to download model weights.

Run these commands from the repository root:

```bash
docker build --build-arg PROMPTGUARD_INSTALL_NEMO=0 \
  -t promptguard:local-classifier demo_mcp_promptguard
docker build --build-arg PROMPTGUARD_INSTALL_NEMO=1 \
  -t promptguard:local-nemo demo_mcp_promptguard
```

The NeMo build installs `requirements-nemo.txt` and verifies the package import
during the image build. A classifier-only build does not install or require
`nemoguardrails`.

The sidecar exposes these local endpoints on port 8086:

- `GET /health` reports that the server is responding.
- `POST /inspect` accepts the Privilege gateway request and returns its findings.
- `GET /demo/config` returns the active detector and demo rule; `PUT /demo/config`
  updates them. The browser UI calls this endpoint directly at
  `http://localhost:8086/demo/config`.

For the UI to reach the Kubernetes sidecar, install the login LaunchAgent
port-forward with `bash scripts/install-promptguard-port-forward-launchd.sh`.
It targets the local `orbstack` context and keeps `localhost:8086` forwarded to
the Deployment after login. Apply sends the edited config to the running
sidecar. Only successfully applied values are saved as a localStorage draft;
unsaved edits may be lost on reload. A new browser or storage reset reads the
active config from the endpoint. While open, the panel checks connection and
shared state every 15 seconds, with a 5-second read timeout, and preserves the
draft through outages and sidecar restarts without applying it.

If a detector switch and restoration both fail, the config endpoint returns
409 and reports the previous detector unavailable. Inspections return 502
until recovery. Restart the sidecar, or retry initialization by sending
`PUT /demo/config` with the previous engine and a valid demo config.

The configurable trigger phrase is a demo-only override. It applies to matching
request-direction user prompts and is process-global to this sidecar instance,
so all clients using that instance share the same rule. It is not per-user or
per-session policy.

## Test / build

```bash
python3 test_server.py            # mapping check, no model/torch needed

# Default model (ProtectAI) is public — no token. For a GATED model
# (e.g. Meta Prompt-Guard) accept its licence on huggingface.co and add
# --build-arg HF_TOKEN=hf_xxx --build-arg PROMPTGUARD_MODEL=meta-llama/Llama-Prompt-Guard-2-86M
```

Then add the sidecar to `pingone-privgateway-helm-main/agentless/sidecars.values.yaml`
and `helm upgrade` (see that file's header), and set the console's **ML Sidecar
URL** to `http://localhost:8086/inspect` with the External Guardrail detector on.
