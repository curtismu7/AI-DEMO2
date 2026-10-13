# Agent Privilege: ML Sidecar Rollout Across Agent Registry

Oct 12, 2026 · @Curtis Muir

## Contents

- [Overview](#overview)
- [The recipe](#the-recipe)
- [What was tested](#what-was-tested)
- [Per-key state after the rollout](#per-key-state-after-the-rollout)
- [What the rollout surfaced](#what-the-rollout-surfaced)
- [Quick lookup](#quick-lookup)

## Overview

On 12 October 2026 the demo_mcp_promptguard sidecar — the NeMo-rails + ProtectAI-deberta detector already live in the gateway's pod (`mcp-promptguard` container, port 8086, `/inspect`) — was wired into **every Agent Registry key** on the console, not just the one key it had been configured on before. Ten keys, including the expired one and the a2a-only one, all now carry the same inspection policy:

- **External Guardrail** detector on (External Inspection 1/1 Active)
- **ML Sidecar URL** `http://localhost:8086/inspect`, timeout 1000 ms, no auth header
- **Block Agreement = `off` — ML Blocks Alone** (a detector finding blocks on its own)
- Sidecar Fail Closed and the guardrail-level Fail Closed stay **off** (fail open)

The per-detector behaviour, the `/inspect` wire contract and the Block Agreement semantics are measured in the guardrails guides — this page is the rollout record: what was set, on which keys, and what the bulk edit surfaced. The llama.cpp key's end-to-end block (harmless → 200 with sidecar `allow`; injection → 400 `content_blocked`, sidecar logged `INJECTION (1.00)`, gateway `AIGuard` JSON with mitre_atlas / nist_ai_rmf / owasp_llm mappings) was tested the same day and lives in the [v1.261009 demo runbook](GATEWAY-RELEASE-v1.261009-DEMO.md).

Why Block Agreement `off`: it is the only mode where the external detector can be *proven* to block — under `unit`/`inspection` a built-in must agree, which makes the sidecar unfalsifiable in a demo. The built-ins run in every mode, so obvious injections are blocked either way; `off` adds the detector's own verdicts as a third, independent block source.

## The recipe

Console → Agent Registry → key row → **Edit** → **Continue** ×2 to step 3 (Runtime Protection):

1. Expand **External Inspection** → click the **External Guardrail** chip (0/1 → 1/1 Active). The console then warns "ML Sidecar URL is Required When The External Guardrail Detector Is Enabled" until step 2 is done.
2. Expand **Advanced — ML Sidecar** → **ML Sidecar URL** `http://localhost:8086/inspect`, **Sidecar Timeout (ms)** `1000`, **Auth Header** blank.
3. **Block Agreement** → **Off — ML Blocks Alone**. Leave **Sidecar Fail Closed** unchecked.
4. **Continue** → review shows "Payload threat protection: Enabled Yes, Fail closed No (fail open)", ML Sidecar URL/timeout, Sidecar Fail Closed No, Block Agreement off → **Save Changes**.

The same screen and fields exist on the **Add Agent** wizard; a new key created after this rollout should get the same five settings there. Console walkthrough with screenshots: [AIGuard (Runtime Protection)](GATEWAY-AIGUARD.md).

## What was tested

| Claim | Result | When |
| --- | --- | --- |
| The recipe saves on an llm-scoped key and takes effect immediately | Reproduced end to end on the llama.cpp key (block + allow halves) | 12 Oct |
| The recipe saves on an mcp+a2a-scoped key | Reproduced (google, local, ollama, main-agent, LM-Stuidio) | 12 Oct |
| An **a2a-only** key (no `llm` scope) still gets the full AIGuard step in the Edit wizard | Reproduced: langchain-caller's wizard offered the identical Runtime Protection screen; recipe applied and saved | 12 Oct |
| An **expired** key can still be edited | Reproduced with a catch: the wizard refuses to leave step 1 ("Custom Expiry Must Be A Future Date And Time", Continue disabled) until the expiry is bumped — see [below](#what-the-rollout-surfaced) | 12 Oct |
| A key whose External Guardrail was already on keeps its URL/timeout but may carry a different Block Agreement | Reproduced: anthropic had the sidecar wired (URL + 1000 ms) with Block Agreement `inspection` — changed to `off` | 12 Oct |
| Sidecar Timeout `0` is accepted and means the default | Reproduced: main-agent saved with 0 ms on the review line, field help "0 uses the default (1000 ms)"; normalized to 1000 for consistency | 12 Oct |
| Saves persist across a console restart | Verified by re-reading the AIGuard tab after the desktop app dropped and was relaunched (one save was eaten mid-outage and re-applied) | 12 Oct |

Not tested here: whether an a2a-only key actually *invokes* the sidecar on A2A traffic (the A2A guardrail path is measured in the A2A guardrails guide; the detector call on that path with this key was not exercised), and per-key threshold tuning — every key kept its existing thresholds.

## Per-key state after the rollout

Read off the live keys table and each key's AIGuard tab, 12 October 2026:

| Key | Provider | Scopes | Note |
| --- | --- | --- | --- |
| `llama.cpp` | OpenAI-Compatible (Custom) | llm | Live-verified block/allow same day |
| `meta.llama3-2-3b-instruct` | OpenAI-Compatible (Custom) | llm | Second custom key |
| `openai` | OpenAI | llm | |
| `anthropic` | Anthropic | llm | Guardrail already on; Block Agreement changed `inspection` → `off` |
| `google` | Google | llm + mcp | |
| `ollama` | OpenRouter | llm + mcp + a2a | |
| `local` | Anthropic | llm + mcp + a2a | First save eaten by console outage; re-applied |
| `main-agent` | Anthropic | llm + mcp + a2a | Timeout normalized 0 → 1000 |
| `langchain-caller` | — | a2a only | Wizard offers AIGuard on a2a-only keys too |
| `LM-Stuidio` | OpenAI | llm | Expired; expiry bumped 2026-10-05 → 2026-11-12 to save |

## What the rollout surfaced

- **The Edit wizard is per-key uniform.** Scope mix (llm / mcp / a2a) and expiry state do not change step 3 — every key gets the same detector catalogue. The only wizard-level gate hit was the expired key's expiry field.
- **Expired keys are edit-locked on step 1, not step 3.** To apply the recipe to `LM-Stuidio` the Custom Expiry had to be moved to a future date (2026-11-12). An expired key therefore cannot be reconfigured without also being renewed — flag this before relying on it.
- **Pre-existing sidecar configs survive untouched** but their Block Agreement does not match the recipe: `anthropic` had been wired earlier with `inspection`. Any key configured before this rollout needs its Block Agreement checked, not assumed.
- **The review step's "0 ms" timeout is not a misconfiguration** — the field help states 0 uses the default 1000 ms. Normalizing to an explicit 1000 keeps the fleet table unambiguous.
- **The console app can eat a save on its way down.** One key (`local`) showed External Inspection 0/1 after the app's "Reconnecting" modal, despite a completed Save. The AIGuard tab is the cheap post-save check: the External Inspection row should read **1 / 1 Active**.

## Quick lookup

| Symptom | Most likely cause | Fix |
| --- | --- | --- |
| Wizard won't Continue on step 1 of an expired key | "Custom Expiry Must Be A Future Date And Time" | Set a future Custom Expiry (bump it), then proceed |
| "ML Sidecar URL is Required When The External Guardrail Detector Is Enabled" | Guardrail chip on, URL empty | Fill the Advanced — ML Sidecar URL before Continue |
| Sidecar fields greyed out | External Guardrail not enabled yet | Enable the chip first — the screen enforces detector-before-endpoint |
| External Inspection reads 0/1 after a save | Console outage ate the save | Check the key's AIGuard tab; re-run the recipe |
| Detector never blocks although the key points at it | Block Agreement `unit`/`inspection` needs a built-in to agree | Set Block Agreement `off` (this rollout's setting) |
| Sidecar config right but no verdicts in its log | Sidecar container down / wrong port | `kubectl -n <gw-ns> logs <gw-pod> -c mcp-promptguard`; URL is `http://localhost:8086/inspect` inside the gateway pod |
