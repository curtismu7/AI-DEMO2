# Agent Privilege: Gateway Release v1.261009 — Demo Runbook

Oct 12, 2026 · @Curtis Muir

## Contents

- [Overview](#overview)
- [Environment](#environment)
- [What was tested](#what-was-tested)
- [1. Model catalog refresh](#1-model-catalog-refresh)
- [2. `llm_policy_response_denied` — the response-side policy denial](#2-llm_policy_response_denied--the-response-side-policy-denial)
- [3. llama.cpp provider — govern a model in your own building](#3-llamacpp-provider--govern-a-model-in-your-own-building)
- [4. Bedrock: mantle provider + deployments route (provisioned demo pending)](#4-bedrock-mantle-provider--deployments-route-provisioned-demo-pending)
- [Retired models — what the demo can and cannot show](#retired-models--what-the-demo-can-and-cannot-show)
- [The AIGuard × AI-policy split (demo-side consequence)](#the-aiguard--ai-policy-split-demo-side-consequence)
- [Quick lookup](#quick-lookup)

## Overview

Every claim in the release inventory for `privilege-aigw:v1.261009` ([GATEWAY-RELEASE-v1.261009.md](GATEWAY-RELEASE-v1.261009.md)), converted to a live-tested demo step or marked blocked-with-reason. Tested on 12 October 2026 against both gateways running v1.261009 (deployed 9 Oct 2026, helm revision 71 / 24).

Four features were demoable the day of release; two (the Bedrock pair) share one missing credential. The demo story of the release in one line: **the gateway now governs models it does not host (newer catalogs), answers it does not write (response-side policy), and hardware it does not rent (llama.cpp) — with the same keys, budgets and logs.**

Ping's own release notes for this build (received 12 Oct 2026) corroborate the binary findings independently: "Agent Registry — additional LLM providers, including OpenAI-compatible custom endpoints", the AI Policies stage hints ("Before inspection, After inspection, On the response") and the hardened Policy Builder all match what the binary strings and the live console showed. The notes also ship features this runbook does not cover (HITL approvals, scope RBAC, Copilot Studio detail pages) — those are console-side and tracked separately.

## Environment

| What | Value |
| --- | --- |
| Gateway image | `public.ecr.aws/s7q1z8z4/privilege-aigw:v1.261009` (both nodes) |
| Console | `local.procyon.ai:8643` — virtual keys live under **Agent Registry** (`/ui/admin/agent-config`), "Manage agent access keys" |
| Gateway host | `mcpgw.ai-demo.ping-devops.com` |
| Existing virtual keys | OpenAI, Anthropic, Google, OpenRouter, and two OpenAI-Compatible (Custom) keys (see [LLM routing & virtual keys](GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) for the key shape) |
| Custom-lane upstream | `https://ai-demo.ping-devops.com/llm-gw` (public ingress → llm-proxy:8090 → llama tier in `ping-devops-cmuir`) |
| Llama model on the tier | Llama-3.2-3B-Instruct Q4_K_M (GGUF), seeded 2026-10-12 |
| Log access | Elasticsearch/Kibana stack — [logging guide](GATEWAY-LOGGING-WITH-ELASTICSEARCH.md) |

Environment notes for whoever runs this next:

- **Virtual keys are in Agent Registry, not a "Virtual Keys" page.** The keys table is the console landing list; per-key provider, allowed models, rate limits and budgets live on the key's Configuration tab and its Edit wizard (step 2, "Gateway & Apps").
- **The custom lane was healthy at test time and is environment-fragile after it.** On the afternoon of 12 Oct a concurrent change repointed the llama tier deployment (`llama-tier5`) at `gpt-oss-20b` (12 GB GGUF) and OOM-killed it at its 16 Gi limit, leaving llm-proxy 503ing through tier-manager timeouts. Check the tier before demoing: `kubectl -n ping-devops-cmuir get deploy llama-tier5` should show the Llama-3.2 GGUF in its args and a Ready 1/1. The runbook's custom-lane claims were captured while Llama-3.2 was live.
- The console died once mid-testing (root-owned zombie `CyonAgent` holding port 8643); recovery was `sudo kill` + relaunch. bsk tabs on this console intermittently throw "Cannot access a chrome-extension:// URL" — close and recreate the tab.
- Rule CRUD on AI policies goes through the console UI session; the tenant API key authorizes `aipolicys` but **not** `llmrules`, `aiguardconfigs`, or `llmmodelrates` (401 on all).

## What was tested

| Claim | Result | When |
| --- | --- | --- |
| The allowed-models dropdown shows the refreshed v9 catalog on an existing Anthropic key | Reproduced: `claude-fable-5-1`, `claude-opus-4-8`, `claude-opus-4-7` … with no `claude-3-*` rows | 12 Oct |
| Same for an OpenAI key, new ids beside old ones | Reproduced: `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4` beside `gpt-4o`, `gpt-4-turbo` | 12 Oct |
| An allowlist edit takes effect immediately (not cached) | Reproduced: PUT `agentaccesskeys/default/openai` (RevisionID 15→16) → the refused id answered 200 on the next call | 12 Oct |
| A model refused pre-edit → 403 `not allowed for this key` → 200 after | Reproduced with `gpt-5.5-2026-04-23` | 12 Oct |
| New models are priced by the builtin table the day they ship | Reproduced: `gpt-5.6-sol` call → `CostUSD:0.000112, PriceSource:"builtin"` | 12 Oct |
| New-generation OpenAI models reject `max_tokens` | Reproduced: provider-shaped `unsupported_parameter` error passed through the gateway verbatim | 12 Oct |
| Refusal is allowlist-driven, not catalog-driven | Reproduced: cataloged-but-unallowed id → 403; old-generation allowed id → 200 | 12 Oct |
| A response-side AI policy denies a completion that carries PII | Reproduced: forced-echo prompt → 400 `content_blocked`, "response withheld by policy" | 12 Oct |
| `llm_policy_response_denied` exists exactly as named, as its own log event | Captured: `AIPolicy` event with `Decision:"deny"`, `PolicyIDs`, `GrantShape:"transaction"` | 12 Oct |
| The upstream still answered when the response was withheld | Captured: paired `LLM request` line shows `HTTPStatus:400, UpstreamStatus:200`, tokens spent, LatencyMs 4310 | 12 Oct |
| Harmless traffic with the policy Active is untouched | Reproduced: "Say OK" → 200 `OK`, no `AIPolicy` event | 12 Oct |
| AIGuard sanitize and AI-policy deny are two different layers | Reproduced: pre-policy run → 200 with `[REDACTED:pii]`; post-policy run → 400 withhold. Both real, switchable per policy state | 12 Oct |
| llama.cpp is fronted through route `/llm/custom/v1/chat/completions` with a virtual key | Reproduced end to end: 200 through key → gateway → ingress → llm-proxy → llama.cpp | 12 Oct |
| Every other guessed llama path is not routable | Reproduced: `/llm/llamacpp` et al. → generic OAuth challenge; wrong path with valid key → `path_not_allowed` | 12 Oct |
| A custom key on another provider's route → 403 `wrong_provider` | Reproduced on `/llm/openai/v1/chat/completions` | 12 Oct |
| The gateway passes `model` through and logs what the upstream served | Captured: `Model` field is the GGUF path, allowlist verdict not echoed (`LLMRule:""`) | 12 Oct |
| Custom providers are not billed | Captured: `CostUSD:0, PriceSource:"unpriced"` on token-bearing calls, `"unmetered"` on 0-token calls; BudgetUSD inert | 12 Oct |
| A self-hosted provider must be reachable from the gateway's pod | Reproduced: loopback upstream 404s; the working upstream is the cluster's public ingress | 12 Oct |
| Provider dropdown offers AWS Bedrock (Mantle) directly as a key provider | Reproduced (screenshot) — mantle routing is key-driven, not URL-driven only | 12 Oct |
| Bedrock mantle + deployments routes carry real traffic | **Blocked** — no Bedrock credential in the environment | 12 Oct |
| A scratch key with a budget on an unpriced-only model refuses or not | **Blocked** — console API rejects a new AgentAccessKey with llm scope unless `Spec.RealKey` is set | 12 Oct |

Not tested: the exact log record for a *budget* refusal on this build, the xAI/Groq/Mistral/DeepSeek/Together provider surfaces that ship in the console dropdown but hold no key here, and anything on the console side of Ping's release notes that postdates this console build (the "Runs at" policy-stage column strings are not in the console bundle tested — console lags the release notes).

## 1. Model catalog refresh

**Narrative:** "The gateway ships its own model list — new models appear on restart, no upgrade to your app. Here are the newest models going through the gateway on the day of release."

The virtual keys live under **Agent Registry** (`/ui/admin/agent-config`). Open a key → Configuration tab shows the allowed chips; Edit → step 2 ("Gateway & Apps") holds the Allowed Models dropdown, grouped "On-Demand — Bare Id" for OpenAI.

| Step | Tested | Evidence |
| --- | --- | --- |
| Anthropic key dropdown shows the v9 catalog | ✅ 12 Oct | `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8/-4-7/-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6/-4-5`, (latest)-tagged 3.5 rows. No `claude-3-opus-20240229`, no `claude-3-5-haiku-20241022` — the retired ids are gone from the list. [Screenshot](../docs/screenshots/privilege-console-setup/v1261009-anthropic-models-dropdown.png) |
| OpenAI key dropdown, new beside old | ✅ 12 Oct | `gpt-5.6-sol` ✅, `gpt-5.6-terra` ✅, `gpt-5.6-luna`, `gpt-5.5` ✅, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` — beside `gpt-4o` ✅, `gpt-4o-mini` ✅, `gpt-4-turbo`, `gpt-3.5-turbo`. [Screenshot](../docs/screenshots/privilege-console-setup/v1261009-openai-models-dropdown.png) |
| Allowlist edit is live | ✅ 12 Oct | `PUT /agentaccesskeys/default/openai` adding `gpt-5.5-2026-04-23` (RevisionID 15→16) → 403 before, 200 after. The audit endpoint itself is not exposed to the tenant API key (`/v1/audit` → "User is not authorized"); the revision bump + immediate gateway effect is the change proof |
| New models priced on day one | ✅ 12 Oct | `{"msg":"LLM request","Provider":"openai","Model":"gpt-5.6-sol","HTTPStatus":200,"UpstreamStatus":200,"LatencyMs":1331,"PromptTokens":8,"CompletionTokens":4,"CostUSD":0.000112,"PriceSource":"builtin"}` |
| Provider-shaped error passthrough | ✅ 12 Oct | `gpt-5.6-sol` rejects `max_tokens`: OpenAI's `{"param":"max_tokens","code":"unsupported_parameter"}` passed through the gateway verbatim — use `max_completion_tokens` on the new generation |

Demo mechanics: the dropdown lists the **provider catalog**, not the key's allowlist — checked rows are the allowlist. The visual is that the unchecked new ids are one click away with no gateway restart: tick, save, call, 200.

Retired models: see [the dedicated section](#retired-models--what-the-demo-can-and-cannot-show) — the console could not be screenshotted showing an absence side by side, so the demo proves the refusal boundary differently.

## 2. `llm_policy_response_denied` — the response-side policy denial

**Narrative:** "Policy now has a distinct verdict on the *response* side. The request was fine — the model's answer tripped the rule, and the log says so by name."

Where it lives: **Access Management → AI Policies** (`/ui/admin/ai-policys`). Sidebar sections expand on hover. Editor at `/ui/admin/ai-policys/create`. Rules are Cedar, authored from template cards — the response-side template is **"LLM — Withhold a completion carrying personal data"** ("Runs on the model's reply. The tokens are already spent, so the completion is withheld rather than the call refused"). Detector ids: `pii-ssn`, `pii-credit-card`, `pii-iban`, `pii-phone`, `pii-email`. States: **Active** (enforced) vs **Candidate** (validated and stored, never enforced).

| Step | Tested | Evidence |
| --- | --- | --- |
| Author the response-side rule | ✅ 12 Oct | Template → detectors `pii-ssn, pii-email` → State Active → saved as `llm-response-pii-withhold:1` |
| Propagation | ✅ 12 Oct | ~30 s; watch line: `aipolicy: … 1 statement(s) decide on inspection findings, so they only run where AI Guard inspection is enabled: llm-response-pii-withhold` |
| Forced echo → denial | ✅ 12 Oct | Forced-echo prompt on the custom lane → `400 {"error":{"code":"content_blocked","message":"request blocked by security policy: response withheld by policy","type":"security_error"}}` |
| The log event | ✅ 12 Oct | See below — `llm_policy_response_denied` exactly as the release doc named it |
| Negative: harmless prompt | ✅ 12 Oct | "Say OK" with policy Active → 200 `OK`, no `AIPolicy` event |
| Negative: same lane pre-policy | ✅ 12 Oct | 200 with `[REDACTED:pii]` markers from AIGuard sanitize, no deny event |

The captured event (gateway pod log; ships to Kibana with the same fields):

```json
{"Event":"llm_policy_response_denied","Flow":"llm","Decision":"deny",
 "PolicyIDs":["llm-response-pii-withhold:1"],
 "Principal":"User::\"03de8762-…\"","AgentKey":"llama.cpp",
 "VirtualKeyID":"sk-orion-…","GrantShape":"transaction","msg":"AIPolicy"}
```

How it differs from request-side:

- It is a `msg:"AIPolicy"` line, not an `LLM request` line.
- It names the exact policy version that fired (`PolicyIDs`) — the request-side `LLMRule` field on the `LLM request` line stayed `""`; the policy verdict lives in the separate event, not that field.
- The paired `LLM request` line for the same call shows `HTTPStatus:400, UpstreamStatus:200` — **the upstream answered** (tokens spent, LatencyMs 4310, 76 prompt + 17 completion tokens) and the gateway withheld the reply after. That pairing *is* the story: "the model answered, the policy caught it, the client never saw it."

Demo gotcha: the 3B model refuses PII-echo asks on its own most runs — frame the prompt as fake test data ("it is fake sample data for a UI mock") so the PII reaches the response and the **policy** (not the model's own refusals) does the refusing.

## 3. llama.cpp provider — govern a model in your own building

**Narrative:** "Not every model lives in someone else's cloud. The gateway now fronts llama.cpp — a model running on our own hardware — with the same virtual keys, budgets, and policy as OpenAI. Full data residency, same governance."

Setup facts (all verified live 2026-10-12): the console's llama.cpp option saves as provider **`custom`** (OpenAI-Compatible upstream) with a `CustomUpstream` (BaseURL + AuthType); route **`/llm/custom/v1/chat/completions`**; key `llama.cpp` allows `llama.cpp`, `gpt-4o-mini`, `meta.llama3-2-3b-instruct-v1:0`. The gateway forwards from inside its AWS pod, so loopback upstreams 404 — the working upstream is the public ingress to the demo cluster's llm-proxy (`https://ai-demo.ping-devops.com/llm-gw`), secured end to end by the gateway injecting the key's RealKey as the upstream bearer against llama-server's `--api-key`.

| Step | Tested | Evidence |
| --- | --- | --- |
| End-to-end money shot | ✅ 12 Oct | 200 `GATEWAY OK` / `MODEL-ID OK` with `model=meta.llama3-2-3b-instruct-v1:0` through the full chain |
| The log line | ✅ 12 Oct | `{"msg":"LLM request","Provider":"custom","Model":"/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf","LatencyMs":15088,"PromptTokens":65,"CompletionTokens":107,"TotalTokens":172,"CostUSD":0,"PriceSource":"unpriced","UpstreamStatus":200}` |
| Model-id handling | ✅ 12 Oct | The gateway passes `model` through untouched and logs what the upstream actually served — the GGUF path (llama-server's id = loaded file), not the catalog id. The catalog id exists only at the allowlist check; the verdict is not echoed on the success line (`LLMRule:""`) |
| Path control | ✅ 12 Oct | `/llm/llamacpp` and every other guess → generic OAuth challenge; wrong path with a valid key → 403 `path_not_allowed` |
| Wrong-provider control | ✅ 12 Oct | Same key on `/llm/openai/v1/chat/completions` → 403 `wrong_provider` |
| Budget interaction | ✅ 12 Oct | The gateway does not bill custom providers: `"CostUSD":0,"PriceSource":"unpriced"` on token-bearing generations, `"unmetered"` on the 0-token call; the key's BudgetUSD=50 is inert. Demo line: "budgets meter cloud providers; your own model rides free — governance still applies" |
| Response-side protection already on | ✅ 12 Oct | The key's AIGuard response screening fired on a PII-generation prompt: `aiguard: sanitized response … category=pii` + JSON `AIGuard` line with compliance mappings (mitre_atlas AML.T0057, nist_ai_rmf MEASURE-2.5, owasp_llm LLM02), client saw 200 with `[REDACTED:pii]` |

Demo consequence for the llm-gateway page: with the Task-2 policy **Active**, the demo's `pii` attack on the custom lane tells the policy-deny story ("Denied by policy", "Never saw the prompt", yellow gateway box); set the policy to **Candidate** to demo the AIGuard redaction story instead ("Allowed, 4 redacted on the way back"). Both are real — pick the state that matches the slide.

## 4. Bedrock: mantle provider + deployments route (provisioned demo pending)

**Narrative (ready, not yet runnable):** "Two new Bedrock surfaces in one demo: a second provider family, and Azure-style deployment URLs that need no code change to target the gateway."

| Step | Status | Notes |
| --- | --- | --- |
| P.1 Obtain a Bedrock-capable AWS key | **Blocked 12 Oct** | No AWS CLI in the environment, `~/.aws` holds only an empty `default` profile, and the whose-account question (Curtis's vs Ping SE) is undecided. Everything below unblocks the moment a key lands |
| P.2 Console: is mantle offered directly? | ✅ 12 Oct | **Yes** — the Add Agent wizard's Provider dropdown offers `AWS Bedrock (Runtime)` and `AWS Bedrock (Mantle)` as separate key providers. [Screenshot](../docs/screenshots/privilege-console-setup/v1261009-provider-dropdown-bedrock.png). The wizard was abandoned without saving (Real Provider Key is required, and no credential existed to put there) |
| P.3 Save key + audit record | Blocked on P.1 | |
| P.4 Sanity call on `/llm/bedrock/...` | Blocked on P.1 | |
| 3.1–3.4 mantle route curls, region header, wrong-provider control, log line | Blocked on P.1 | |
| 4.1–4.4 deployments-route curls, equivalence with the classic route, negative control | Blocked on P.1 | |

One console-side fact captured while blocked: `bedrock-mantle` appearing as its own provider entry corroborates the release doc's `isBedrockFamily` finding — the family now has two first-class surfaces, not one provider with a URL alias.

## Retired models — what the demo can and cannot show

The plan wanted a screenshot of the dropdown with retired ids gone. The console could not be screenshotted showing an *absence* convincingly, so the demo proves the refusal boundary exactly instead:

| Call | Result | Proves |
| --- | --- | --- |
| `gpt-5.5-2026-04-23` (real, in v9 catalog, NOT on the key) → before the allowlist edit | 403 `model "gpt-5.5-2026-04-23" not allowed for this key` | Refusal is allowlist-driven |
| Same id after the allowlist add | 200 `"content":"OK"` | The list is live, not cached |
| `gpt-4-turbo` (old generation, still cataloged and allowed) | 200 `gpt-4-turbo-2024-04-09` | Old-but-present ids keep working; only v1.261008's retired rows vanished |

The v9 catalog's retired-model rows are a dropdown affordance; per-key 403 is the enforcement the demo shows.

## The AIGuard × AI-policy split (demo-side consequence)

Two response-side protections, two different demo stories, both live in this build:

| | AIGuard sanitize | AI policy withhold |
| --- | --- | --- |
| Where it is set | Per-key guardrail thresholds | AI Policies (Cedar), Active state |
| What fires | Threshold scoring on the way back | Rule verdict on the response |
| What the client sees | 200 with `[REDACTED:pii]` inline | 400 `content_blocked`, "response withheld by policy" |
| What the log says | `aiguard: sanitized response` + `AIGuard` JSON with compliance mappings | `llm_policy_response_denied` `AIPolicy` event naming the policy version |
| Tokens spent | Yes | Yes (`UpstreamStatus:200` beside `HTTPStatus:400`) |
| Demo switch | Policy = **Candidate** | Policy = **Active** |

AIGuard sanitizes at its per-key thresholds regardless; the AI policy decides deny/withhold on top, and only its firing writes the `AIPolicy` event.

## Quick lookup

| Symptom | Most likely cause | Fix |
| --- | --- | --- |
| Custom lane 503s through nginx | The llama tier is mid-swap or OOM-crash-looping | `kubectl -n ping-devops-cmuir get deploy llama-tier5` — check args name the Llama-3.2 GGUF and pods are Ready; see the environment notes |
| `/llm/llamacpp` returns an OAuth challenge | Wrong path — only `/llm/custom/v1/` is routable for custom keys | Use `/llm/custom/v1/chat/completions` |
| `Spec.RealKey is required for llm scope` on key create | The console API refuses an llm key with no provider credential | Provide the real key; there is no credential-free scratch key |
| `max_tokens` rejected on new OpenAI models | New generation requires `max_completion_tokens` | Change the parameter; the gateway passes the provider's error through verbatim |
| The model refuses to echo PII | The 3B model's own refusals, not policy | Frame the prompt as fake sample data for a UI mock |
| No `AIPolicy` event although the policy is Active | Rule only runs where AI Guard inspection is enabled | Check the key's AIGuard screening is on (the watch line says so at propagation) |
| Audit endpoint 401s with the tenant key | `/v1/audit` is not tenant-API-authorized | Use the revision bump + live call effect as the change proof |
| Console dead on 8643 | Zombie `CyonAgent` holding the port | User-run `sudo kill` + relaunch |
