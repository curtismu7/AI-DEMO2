# AI model licenses

Every model this demo downloads or runs itself. Licenses come from each Hugging Face
model card's license metadata (`/api/models/<id>` `cardData.license` and the card page),
checked 2026-09-13.

| Model (upstream card) | Pulled as | Where the repo uses it | License (verified on HF card) | Restrictions to flag |
|---|---|---|---|---|
| [`microsoft/Phi-4-mini-instruct`](https://huggingface.co/microsoft/Phi-4-mini-instruct) | [`bartowski/microsoft_Phi-4-mini-instruct-GGUF`](https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF) (Q4_K_M); [`mlx-community/Phi-4-mini-instruct-4bit`](https://huggingface.co/mlx-community/Phi-4-mini-instruct-4bit) | `demo_llm_proxy` tier 1 (`modelCatalog.js`, `download-models.sh`, `download-omlx-models.sh`, `start-mlx*.sh`); `k8s/54-seed-llm-models.yaml`, `55-llamacpp-deployment.yaml`, `56-llm-stack.yaml`; `LLAMACPP_MODEL=phi-4-mini-instruct` in `docker-compose.yml` and the agent configs | MIT (verified). MLX repo: MIT (verified). GGUF repo: declares no license | None |
| [`openai/gpt-oss-20b`](https://huggingface.co/openai/gpt-oss-20b) | [`ggml-org/gpt-oss-20b-GGUF`](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF) (MXFP4); [`mlx-community/gpt-oss-20b-MXFP4-Q4`](https://huggingface.co/mlx-community/gpt-oss-20b-MXFP4-Q4) | `demo_llm_proxy` tier 5 (same files as above); `k8s/54-seed-llm-models.yaml`, `56-llm-stack.yaml`, `02-configmap.yaml`; `LLAMACPP_MODEL=gpt-oss-20b` in `docker-compose.yml`; `langchain_agent` (`llm_factory.py`, `codegraph/`) | Apache-2.0 (verified). Both re-packagings: Apache-2.0 (verified) | The upstream repo ships a `USAGE_POLICY` file alongside `LICENSE` |
| [`Groq/Llama-3-Groq-8B-Tool-Use`](https://huggingface.co/Groq/Llama-3-Groq-8B-Tool-Use) | [`bartowski/Llama-3-Groq-8B-Tool-Use-GGUF`](https://huggingface.co/bartowski/Llama-3-Groq-8B-Tool-Use-GGUF) (Q4_K_M) | `demo_llm_proxy/modelCatalog.js` tier 3; `k8s/56-llm-stack.yaml` (evaluation tier, A/B only); `langchain_agent/src/codegraph/llm_target.py` | `llama3`, the Meta Llama 3 Community License (verified). GGUF repo: `llama3` (verified) | Not OSI open source. Use must follow Meta's Acceptable Use Policy. Anyone who distributes it must show "Built with Meta Llama 3". Companies above 700M monthly active users need a separate license from Meta |
| [`nomic-ai/nomic-embed-text-v1.5`](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) | [`nomic-ai/nomic-embed-text-v1.5-GGUF`](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) (Q8_0) | `docker-compose.yml` `embeddings` service (`-hf nomic-ai/nomic-embed-text-v1.5-GGUF:Q8_0`) and `EMBEDDING_MODEL`; `k8s/54-seed-llm-models.yaml`, `72-rag-stack.yaml` | Apache-2.0 (verified). GGUF repo: Apache-2.0 (verified) | None |
| [`protectai/deberta-v3-base-prompt-injection-v2`](https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2) | same (Transformers weights, baked in at image build) | `demo_mcp_promptguard/server.py` and `Dockerfile` default `PROMPTGUARD_MODEL` | Apache-2.0 (verified) | None |
| [`meta-llama/Llama-Prompt-Guard-2-86M`](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M) (optional) | same, only when built with `--build-arg PROMPTGUARD_MODEL=... HF_TOKEN=...` | `demo_mcp_promptguard/README.md`, `Dockerfile` (opt-in override) | `other` / `llama4`, the Llama 4 Community License Agreement (verified) | Gated, manual approval: you must accept the license and give your full legal name, date of birth and organization before downloading. Requires "Built with Llama" attribution and Meta's Acceptable Use Policy |

## Notes

- GGUF and MLX files are conversions of the upstream weights, so the upstream license
  applies to them. `bartowski/microsoft_Phi-4-mini-instruct-GGUF` has no license in its
  card metadata, so it inherits Phi-4-mini's MIT license.
- **Hosted, not downloaded:** `GROQ_MODEL=llama-3.3-70b-versatile` (`docker-compose.yml`,
  `k8s/02-configmap.yaml`) runs on Groq's API under Groq's terms. Its upstream card,
  [`meta-llama/Llama-3.3-70B-Instruct`](https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct),
  lists `llama3.3` and is gated. Other hosted providers (Anthropic, OpenAI and so on) are also
  covered by their own terms and are not listed here.
- **Named but never downloaded:** `google/gemma-4-e2b` and `qwen/*` appear only as test
  fixtures (`mastra_agent/tests`, `pydantic_agent/tests`, `openai_agent/tests`,
  `langchain_agent/tests`). `gemma-3-4b` survives only as a legacy routing pin in
  `demo_llm_proxy/router.js`.
