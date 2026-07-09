# Plan: Three-tier LLM backend, selected by `LLM_BACKEND`

Status: proposed (2026-07-07). Owner: LLM/agent infra.

## Goal

One env var selects which OpenAI-compatible server owns host **:8090**. Everything
downstream is unchanged — BFF, agent, and containers all reach the LLM at
`host.docker.internal:8090`, and the model is chosen server-side via the
`LLAMACPP_MODEL` alias. The backend is a swappable detail, not a stack change.

## Why all three (tiered, not co-equal)

| Backend  | `LLM_BACKEND` | Role                                                        | Status today            |
|----------|---------------|-------------------------------------------------------------|-------------------------|
| llama.cpp| unset (default)| Cross-platform, Docker/K8s/CI, regression baseline         | Wired + running         |
| oMLX     | `omlx`        | Preferred Mac-dev (SSD KV cache → better agent TTFT/tool loops)| Wired on main, not installed |
| mlx-lm   | `mlx`         | Apple-official fallback if oMLX trust/maintenance breaks     | Validated, not wired    |

mlx-lm is **not** a primary — on its own it is a lateral move from llama.cpp (same
swap-router pauses, weaker agent cache than oMLX). It earns its place only as a
supported safety net for when oMLX has trust/maintenance issues.

## Validated facts (grounding — from the 2026-07-07 spike)

- `run-docker.sh` already has the `LLM_BACKEND` switch; `demo_llm_proxy/start-omlx.sh`
  and `download-omlx-models.sh` already exist on `main` (the `feat/omlx-mac-fast-path`
  work merged). The `omlx` branch skips the `llm-proxy` container so host oMLX can
  own :8090.
- The demo is **backend-agnostic**: consumers hit `:8090` (OpenAI-compatible) and the
  model is resolved server-side (BFF alias `phi-4-mini-instruct`, agent alias
  `gpt-oss-20b`). Swapping :8090's owner *is* the whole integration — no agent/BFF
  code change.
- The `jundot/omlx` **Homebrew tap does not exist** (`github.com/jundot/homebrew-omlx`
  → 404), but the **source repo does** (`github.com/jundot/omlx`, with
  `[project.scripts] omlx = "omlx.cli:main"` and a `Formula/` dir). The install path
  must be resolved (Phase 1.1).
- oMLX ships mlx-lm + transformers 5.13 with a real import bug; `start-omlx.sh`
  already sed-patches `tokenizer_utils.py`. Cleaner alternative proven this session:
  pin `transformers>=5.0,<5.13` (5.12.1) instead of patching.
- mlx-lm 0.31.3 works end-to-end: OpenAI-compatible on :8090, `/health` + `/v1/models`
  pass, and the demo's aliases resolve via a **symlink-farm + server cwd** trick
  (`model:"phi-4-mini-instruct"` resolves to a local dir). Note: `mlx_lm.server`
  resolves the request `model` field as an HF repo id / local path — it does NOT fall
  back to the loaded model, so an alias must resolve to a path.
- Both MLX models are already downloaded and shared by oMLX and mlx-lm:
  `mlx-community/Phi-4-mini-instruct-4bit` and `mlx-community/gpt-oss-20b-MXFP4-Q4`.

## Phase 1 — Stand up oMLX (priority; wiring already exists)

1. **Resolve the real install** (one quick test decides the path):
   - Try `brew tap jundot/omlx https://github.com/jundot/omlx` (explicit-URL tap so
     Homebrew uses the repo's `Formula/`), then `brew install jundot/omlx/omlx`.
   - Fallback: `pipx install git+https://github.com/jundot/omlx` (exposes the `omlx`
     CLI that `run-docker.sh` probes with `command -v omlx`).
   - Update `start-omlx.sh`'s prereq comment to whichever actually works.
2. **Models into `~/.omlx/models/`**: `download-omlx-models.sh` expects subdirs
   `Phi-4-mini-instruct-4bit` and `gpt-oss-20b-MXFP4-Q4`. Relink from the HF cache
   already populated this session to avoid re-downloading ~13 GB.
3. **Run + verify**: `LLM_BACKEND=omlx ./run-docker.sh start` → confirm
   `:8090/v1/models`, then drive one real agent turn end-to-end; set the two aliases
   in the oMLX admin so they match `LLAMACPP_MODEL` (BFF `phi-4-mini-instruct`, agent
   `gpt-oss-20b`).
4. **Fallback-safety**: confirm `./run-docker.sh` (unset) brings llama.cpp back cleanly
   (llm-proxy container + host tiers on :8090/:8091/:8096).

## Phase 2 — Add mlx-lm as `LLM_BACKEND=mlx` (cheap; validated)

1. Author `demo_llm_proxy/start-mlx.sh`, mirroring `start-omlx.sh`: venv bootstrap,
   pin `transformers>=5.0,<5.13`, alias symlink-farm, `mlx_lm.server` on :8090 with
   that dir as cwd, plus pidfile / stop / status.
2. Add the `mlx` branch to `run-docker.sh` (mirror the `omlx` branch: skip the
   `llm-proxy` container, run `start-mlx.sh`).
3. Reuse `~/.omlx/models/` (or symlink) so models are not duplicated.
4. Verify `LLM_BACKEND=mlx ./run-docker.sh start` end-to-end.

## Phase 3 — Docs + guardrails

- Document the 3-way switch and "when to use each" in `README` / `CLAUDE.md`.
- Keep **default unset = llama.cpp** so regression tests, CI, and K8s are unaffected.

## Risks / open decisions

- **oMLX install method** (brew-URL tap vs pipx) — ~5-min test; gates Phase 1.
- **oMLX trust/maintenance** — the reason the mlx-lm fallback exists.
- **RAM**: gpt-oss-20b (20B) + phi-4 co-resident on the M4 Max — expected fine, confirm
  under load.
- **Do not** make mlx-lm primary, and **do not** change the default backend.

## Explicitly parked (out of scope here)

- LLM-proxy hardening (review issue #1) stays parked — it conflicts with a
  host-owns-:8090 backend and is not needed for this work.

## Sequencing recommendation

Phase 1 (oMLX) first — it is the daily driver and the wiring already exists, so it is
mostly install + verify. Phase 2 (mlx-lm fallback) is small and additive and can follow
immediately. Phase 3 docs land with whichever phase ships.
