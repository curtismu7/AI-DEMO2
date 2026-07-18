# Commitment-Grounding Guardrail — Design

Date: 2026-07-12

## Problem

The "AI Attacks" showcase in the agent chat panel (`demo_api_ui/src/components/AIAgent.js`,
drawer content in `demo_api_ui/src/components/education/AiAttacksPanel.js`) exercises several
attack scenarios. An audit of all of them found every one *except* "Unauthorized Commitments"
is already backed by real enforcement (real PingOne Authorize denials, real MCP gateway scope/
audience checks, real HITL receipt binding, real actor-chain validation — see prior investigation
in this session; no code changes were needed there).

"Unauthorized Commitments" (the Air Canada pattern) is different: it isn't a technical-access
problem. `request_fee_waiver` (`demo_mcp_server/src/tools/BankingToolRegistry.ts:519`) already
does the right thing mechanically — it only logs a request for human review and cannot grant a
waiver. But nothing verifies that the LLM's natural-language reply doesn't claim more than that
("I've waived your fee!") when no tool exists to actually do so. PingOne Authorize / the MCP
gateway cannot fix this — there's no unauthorized *action* to deny, only a potentially untrue
*sentence*. This requires an output-grounding check on the LLM's reply itself.

## Goal

Add a "commitment-grounding" guardrail, backed by the `guardrails-ai` OSS library, to each of the
three Python agent runtimes that demo this banking-agent pattern:

- `langchain_agent`
- `openai_agent`
- `pydantic_agent`

`mastra_agent` (Node/TS) is explicitly out of scope — `guardrails-ai` is Python-only, and these
three are independent, deliberately-parallel framework demos (no shared library between them by
existing repo convention), so `mastra_agent` would need a separate future effort if ever wanted.

## Detection design

The check is a **general commitment-grounding rule**, not narrowly hard-coded to the fee-waiver
scenario: any reply phrased as a completed action/commitment ("I've waived...", "I've opened...",
"discount applied...") must be backed by a real tool call this turn whose actual result supports
that specific claim. This generalizes to any future "request-only" tool without new code per
scenario.

Two-stage pipeline, run once per assistant reply after its tool-calling loop completes:

1. **Regex/keyword pre-filter** (deterministic, near-zero cost) scans the reply text for
   commitment-completion phrasing, generalized from the patterns already documented in
   `AiAttacksPanel.js` (lines ~429-431): completion verbs ("waived", "granted", "applied",
   "opened", "removed", "refunded", "credited", "processed", etc.) combined with first-person /
   completed-tense framing ("I've", "I'll", "Done", "Your ... has been ..."). Runs on every reply;
   the common case (no such phrasing) costs nothing further.
2. **LLM grounding call** — only invoked when the pre-filter matches. A single combined call
   (same model tier as the conversation — no new routing config) receives the draft reply plus
   this turn's **real** tool results, and returns either the reply unchanged (grounded) or a
   corrected version. One call does both judging and correction — no separate reask round-trip.

**Ground truth for the LLM call** is the actual tool call result captured at the BFF-tool-adapter
call site in each service (`bff_tool_adapter.py`'s `_invoke()` / `_make_tool()` in
`openai_agent`/`pydantic_agent`; the equivalent tool-execution point in `langchain_agent`) — this
is where the real HTTP response from the BFF tool is known. It is **not** taken from the model's
own self-reported tool-call/output events, which only prove the model *invoked* something, not
what it actually *returned*.

## Correction delivery

Live token-by-token streaming to the browser is unchanged — no UX regression on ordinary replies.
The grounding check runs after the stream completes. If it flags/corrects the reply:

- Emit a new AG-UI `CUSTOM` event: `{"type": "CUSTOM", "name": "grounding_correction", "value":
  {"original": "...", "corrected": "...", "correctionNote": "..."}}`, alongside the existing
  `on_usage`/`llm_detail` custom events, right before `RUN_FINISHED`/`on_run_end`.
- The BFF (`demo_api_server/routes/agentRun.js`) already pipes SSE chunks through verbatim
  (`agentRes.on('data', ...)` — `_recordTraceEvents()` only observes, never reshapes) — no BFF
  change needed for the event to reach the browser.
- UI: add a `grounding_correction` case to the `CUSTOM` event switch in
  `demo_api_ui/src/hooks/useAgentState.js` (alongside the existing `token_usage`/`llm_detail`
  cases), storing the latest correction in state. Add a `useEffect` in `AIAgent.js` mirroring the
  existing error-bubble effect (~line 1854) that calls `addMessage("token-event", "⚠️ Correction:
  ...")` once per correction — the same visual pattern already used for the other real attack
  demos (⚠️/⛔/✅ token-event messages).
- Net effect: the user sees the original streamed reply, then — in the same turn — a follow-up
  token-event message correcting the record if it overclaimed. This was chosen over buffering the
  entire reply server-side before streaming (which would give a seamless invisible rewrite but
  regress live-typing UX on *every* reply, in all three agents, just to cover one narrow attack
  scenario).

## Per-service hook points

Only the currently-active code path in each service is instrumented — not legacy/unused paths:

- **langchain_agent**: `MessageProcessor.process_agui_message()` in `src/api/message_processor.py`
  (the AG-UI SSE path the BFF actually uses today). The legacy WebSocket path
  (`process_message_with_tracing` / `_handle_chat_message`) is NOT touched — it isn't in the
  BFF's active routing.
- **openai_agent**: the `async for event in result.stream_events()` loop in `run_agent()`
  (`src/run_handler.py`).
- **pydantic_agent**: the `stream_events()` inner function (`src/run_handler.py`).

In each case: accumulate the streamed text deltas into a local buffer as they're emitted (as
today), and once the stream ends, run the two-stage check against the buffered final text plus
the turn's captured tool results, before deciding whether to emit `grounding_correction`.

## Dependency

Add `guardrails-ai` to:
- `langchain_agent/Pipfile`
- `openai_agent/requirements.txt`
- `pydantic_agent/requirements.txt`

All three Dockerfiles run `python:3.11-slim` — compatible with `guardrails-ai`'s minimum version
requirement. No other services are affected.

## Failure handling

If the LLM grounding call itself errors (timeout/network/model unavailable): **fail open with
loud logging**. The original (unvalidated) reply is sent as-is; the error is logged server-side
for follow-up. This is safe because the real authorization for the underlying write already
happened via P1AZ/HITL — this guardrail only checks output truthfulness after the fact, so
failing open here does not reopen any access-control gap, it only risks an unflagged overclaim in
a rare error case. This differs from the P1AZ fail-open bugs documented in
`docs/SILENT_FAILURE_REVIEW_GUIDE.md`, which were genuine authorization decisions defaulting to
allow — there is no equivalent authorization decision here.

## Testing

Follow each service's existing pytest conventions:
- `langchain_agent`: pattern from `tests/test_message_processor.py`
  (`mock_agent`/`mock_websocket_handler` fixtures).
- `openai_agent` / `pydantic_agent`: pattern from `tests/test_run_handler.py` (mocked
  `build_agent`/`Runner`, `TestClient`, local `_parse_sse()` helper).

New tests per service:
- A manufactured overclaiming reply (e.g. draft text says "I've waived your fee" while the
  captured tool result is a `request_fee_waiver` "logged for review" payload) produces a
  `grounding_correction` CUSTOM event before `RUN_FINISHED`.
- An ordinary grounded reply (no commitment-completion phrasing, or phrasing that matches the
  real tool result) produces no `grounding_correction` event.
- The regex pre-filter alone is unit-testable without invoking the LLM call (no false trigger on
  ordinary replies with no completion phrasing).

## Out of scope

- `mastra_agent` (Node/TS) — no `guardrails-ai` equivalent wired in this pass.
- Any change to the streaming architecture itself (still token-by-token, unchanged).
- Narrowing/hard-coding to the fee-waiver tool specifically — the check is general.
- Any change to the P1AZ/gateway/HITL enforcement paths already confirmed real in the initial
  audit (scope escalation, wrong audience, confused deputy, HITL replay, prompt/indirect
  injection, cross-vertical authz deny) — those need no changes.
