# Tell the user when an answer is truncated

Date: 2026-07-17
Status: Design approved
Branch: `feat/truncation-notice`

## Problem

A truncated answer is currently **indistinguishable from a complete one**. The model
hits its token ceiling, the reply is cut mid-sentence, and the BFF returns it as
`success: true`. Nobody — user or engineer — is told.

This is the same class of bug the codebase already calls out in
`bankingAgentLangGraphService.js`: reporting an LLM failure as success once
"misreported an LLM outage as 'Heuristics-only mode' and sent whoever debugged it
down the wrong path". Truncation is that bug, still open.

## Requirement (from the user)

> "I never want a truncated response, we need to do everything we can not to get
> them, but if it does. Tell the user"

So: **prevention first, honest reporting as the safety net.**

## Prevention: why the cap stays at 2560

Truncation is not caused by the cap — it happened *before* it. Uncapped, gpt-oss
generated until it hit the `--ctx-size 8192` wall: llama logged
`n_tokens = 8191, truncated = 1` after **155s**. "No cap" is not the
no-truncation option; it is the slower, worse-truncation option.

Measured on an M4 Max:

| constraint | value |
|---|---|
| Largest legitimate agent answer observed | 2313 tokens |
| Current cap (`LLAMACPP_MAX_TOKENS`) | 2560 (~10% headroom) |
| Worst observed generation rate | ~44 tok/s |
| 2560 at that rate | ~58s — fits the BFF's 70s timeout |
| Cap raised to 4096 | ~93s — **BFF times out instead** |

2560 is the largest cap that still returns *before* `runReasonLoop`'s 70s axios
timeout. Raising it does not buy longer answers; it converts truncation into a
timeout, which is strictly worse (no partial answer at all).

Why truncation should not occur in the live path at all:

- The **agent** never writes long-form: an education question ("Explain OAuth 2.0
  token exchange") returns a call to the `explain_topic` **tool** in 59 tokens /
  1.2s. Largest with-tools response observed: 2313 tokens, under the cap.
- The **BFF** pins phi (`LLAMACPP_MODEL=phi-4-mini-instruct`) and caps
  `max_tokens: 256` in `llamacppLlmService`, so open-ended prose never reaches
  gpt-oss.

Genuinely longer answers would require raising **both** the cap and the 70s
timeout — a slow demo. Out of scope; the two dials are documented instead.

## Design

Detect the signal every provider already returns, and stop discarding it.

### 1. Contract (`demo_agent_service/src/reasonContract.ts`)

Add `truncated?: boolean` to the `final` variant, mirroring the existing
`reasoningUnavailable?: boolean`:

```ts
| { type: 'final'; answer: string; messages: ReasonMessage[];
    reasoningUnavailable?: boolean; truncated?: boolean; ... }
```

Optional, so every existing caller and provider is unaffected when absent.

### 2. Detection (`demo_agent_service/src/reasoningGraph.ts`)

Each provider signals truncation differently:

| provider | signal |
|---|---|
| llamacpp / lmstudio / openai-compatible | `response_metadata.finish_reason === 'length'` |
| anthropic | `response.stop_reason === 'max_tokens'` |
| google | `finishReason === 'MAX_TOKENS'` |
| helix | passthrough — no reliable signal; not claimed |

A single local helper `isTruncated(response)` reads the LangChain
`response_metadata`, covering llamacpp/lmstudio/google. Anthropic is checked
inline against its own SDK field. Set on the `final` return only — a `tool_calls`
return is not a user-visible answer.

All providers are covered, not just llamacpp: anthropic's `max_tokens: 4096` can
truncate silently today, which is the same bug.

### 3. Propagation (`demo_api_server/services/agentReasoningClient.js`)

`runReasonLoop` already returns `{ ok: true, answer, inputTokens, outputTokens }`
on `type === 'final'`. Pass `truncated` through unchanged.

### 4. User-facing notice (`bankingAgentLangGraphService.js`, `adminAgentService.js`)

**Keep the partial answer** — it is usually mostly useful — and append an explicit
notice, so `success` stays `true`:

```
<the partial answer>

⚠️ This answer was cut off — it reached the response length limit.
Ask a narrower question, or raise LLAMACPP_MAX_TOKENS.
```

`⚠️` is on the REGRESSION_PLAN §0 emoji allowlist.

Also log via `appEventService.logEvent('agent', 'warning', ...)` with tag
`agent/truncated`, matching the existing `agent/recursion_limit` pattern, so
recurrence is visible rather than invisible.

## Explicitly not doing

- **No auto-retry at a higher cap.** It doubles latency on the slowest path and
  cannot succeed: a 6147-token answer needs ~140s, past the 70s timeout.
- **No `success: false`.** Discarding a mostly-complete answer serves the user
  worse than labelling it.
- **No cap or timeout changes.** 2560 is already sized to the timeout; see above.

## Success criteria

1. A call that truncates (`finish_reason === 'length'`) returns `truncated: true`
   from `reasonOnce`.
2. The user-visible reply contains the partial answer **and** the notice.
3. A normal (`finish_reason === 'stop'`) call is byte-for-byte unchanged — no
   notice, no flag.
4. `appEventService` records a `agent/truncated` warning when it fires.
5. `npx tsc --noEmit` clean; `docker compose build agent-service` succeeds.
6. Verified in the running container, not just in source.
