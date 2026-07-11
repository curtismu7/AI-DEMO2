# Demo Hardening — Agent Prompts, Responses, and Crash Resilience

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Scope:** Four phases, implemented in order 1 → 4 → 2 → 3. Each phase is
independently shippable in its own worktree.

## Problem

Agent prompts and LLM responses break during live demos. Confirmed failure
modes (user-reported, corroborated by REGRESSION_LOG.md and git history):

1. **Malformed LLM output** — raw JSON frames, `{}` dumps, blank bubbles, and
   garbled renders reaching the UI (REGRESSION_LOG: MCP envelope double-wrap;
   "Invalid parameters" JSON.parse throw → "Here are your book appointment.").
2. **Wrong behavior/intent** — LLM emits `kind:"none"` or prose instead of
   routing JSON; prompt-ordering bugs where later-appended role context
   overrode theme instructions (`geminiNlIntent.js` comment at lines 37–44).
3. **Errors/timeouts** — cold model swap (180 s) vs UI budgets (15–60 s),
   silent tier downgrades (fixed for the proxy, but no cross-provider
   uniformity), infinite spinners.
4. **Crashes** — `demo_api_server/server.js:2051` exits the BFF on any
   `unhandledRejection` when `NODE_ENV !== 'production'`, which is exactly how
   `./run.sh` (native demo launcher) runs it; run.sh has no respawn
   supervisor. `demo_agent_service/src/promptStore.ts:75` silently drops all
   curated guardrails if `src/prompts/` is not copied into `dist/`.

## Decisions (locked with user)

- **Demo runtimes:** all three — native `./run.sh`, Docker
  `./run-docker.sh`, SE k8s cluster. Native has the highest crash exposure.
- **Fallback UX:** **silent and seamless.** When the LLM fails, the chip or
  agent answers deterministically with no audience-visible indication.
  Fallback activity is visible only to the presenter via logs and a health
  cue. The agent-mode picker and global mode are never changed by fallback —
  flipping to a visible "Heuristics-only mode" is itself a demo-broke symptom
  (see `agent-demo-triage` skill).

## Guiding invariant

No LLM output reaches a renderer unvalidated. No failure reaches the
audience. No crash takes down the stack. Every failure degrades silently to a
deterministic answer.

---

## Phase 1 — Response contract layer with auto-mend

**New module:** `demo_api_server/services/llmResponseContract.js`.
All LLM output passes through one of three contracts:

| Contract | Shape | Consumers |
|---|---|---|
| `intent` | kind-discriminated routing JSON (matches what `tryParseIntentJson` shape-sniffs today, made explicit as a schema) | `geminiNlIntent.js` |
| `toolPayload` | `{ render, data }` (or `{ error }`) | the 8+ `JSON.parse`-or-raw sites in `demoAgentLangGraphService.js`, `parseMcpToolPayload` consumers |
| `answerText` | non-blank, control/markup-sanitized string | conversational fallback paths, `ensureRenderableAnswer` |

**Mend ladder** (applied in order on validation failure; each step emits a
structured log event with the step name and reason):

1. **Local repair** — promote the existing fence-strip + brace-scan logic;
   add lightweight JSON repair (trailing commas, single→double quotes,
   truncated closing braces). Pure functions, unit-testable.
2. **One re-ask** — resend to the LLM with the exact validation error
   appended: "Your previous output failed validation: <error>. Respond with
   only valid JSON matching the schema." Generalizes the existing
   `JSON_RETRY_NUDGE` (`geminiNlIntent.js:138`). One re-ask maximum per
   request to protect the UI time budget.
3. **Deterministic fallback** — run the original utterance through the
   vertical's heuristics (`parseHeuristic`); if no heuristic matches, return
   a per-contract canned response. Raw unparseable text is never returned to
   a renderer.

**Constrained decoding (llama.cpp only):** the intent-routing call sends the
intent schema as `json_schema`/grammar in the completion request so local
GGUF models cannot emit malformed JSON. Other providers (Helix, Gemini,
LM Studio, oMLX) are unchanged and rely on the mend ladder.

**demo_agent_service:** a small TypeScript mirror (validate + one re-ask +
fallback) wrapped around `reasonOnce` output in `reasoningGraph.ts`, which is
currently single-shot with no validation.

## Phase 4 — Crash-proofing and self-healing

- **Crash guard:** new env `CRASH_GUARD=1`, set by `run.sh` (and compose/k8s
  where not already `NODE_ENV=production`). `server.js` `unhandledRejection`
  handler logs-and-continues when `NODE_ENV === 'production'` **or**
  `CRASH_GUARD === '1'`; dev/test keep the hard exit so bugs surface loudly.
  `uncaughtException` still exits (state is untrustworthy) — recovery comes
  from supervision.
- **run.sh supervision:** respawn loop with exponential backoff (cap: 3
  restarts / 5 min per service, then mark failed) around each launched
  service, plus a health watchdog that polls each service's `/health` and
  restarts a service that is dark or hung. Docker (`restart: unless-stopped`)
  and k8s already restart dead processes; the watchdog pattern additionally
  catches *hung* processes. For Docker, add/verify compose `healthcheck`
  blocks on LLM-path services so the engine restarts unhealthy containers.
- **promptStore self-mend:** on missing `dist/` prompts, log a startup error,
  set a health flag, and fall back to reading `src/prompts/` directly before
  ever degrading to the one-line inline prompt (`promptStore.ts:75`).
- **Presenter health cue:** aggregate `GET /api/demo/health` (per-service
  status + LLM tier loaded + prompt-store status + recent mend-ladder
  activity) and a small presenter-only status dot in the existing log/status
  UI surface. Must comply with REGRESSION_PLAN §0 (emoji allowlist, minimal
  diff); exact placement decided at implementation via regression-guard.

## Phase 2 — Fallback ladder, circuit breaker, warmup

- **Uniform provider hardening:** port the `helixLlmService.js` pattern
  (per-request AbortController timeout, one transport retry on a fresh
  connection, one 429/5xx retry with backoff/Retry-After) into
  `llamacppLlmService.js`, `lmStudioLlmService.js`, `mlxLlmService.js`,
  `googleGeminiLlmService.js`. Timeout budgets aligned to the real UI
  limits (15 s chip paths, 60 s SPA) so the server always answers before the
  client gives up.
- **Circuit breaker:** per-provider; after N consecutive failures (default
  3) requests route straight to the deterministic fallback for a cooldown
  window (default 60 s), then a half-open probe. Per-request and silent —
  never flips global agent mode or the mode picker.
- **Guaranteed heuristic per chip:** audit all demo chips/use-cases for
  heuristic coverage; add missing heuristics; add a test that fails if any
  chip lacks a deterministic answer.
- **Pre-demo warmup:** a warmup step hooked into `run.sh`/`run-docker.sh`
  (and an SE-cluster variant in the `se-update-*` flow) that pins the model
  tier (`LLM_PROXY_PIN_TIER`) and issues a small completion so the 180 s cold
  swap never happens live.

## Phase 3 — Prompt consolidation and preflight harness

- **Dedupe:** collapse the ~6 near-duplicate inline "knowledgeable
  assistant" prompts in `geminiNlIntent.js` into one shared constant/module.
- **Ordering:** centralize system-prompt assembly (base → theme → role
  context) in one function with a regression test encoding the documented
  ordering bug (role note must not override theme instructions).
- **Build gate:** test + build step asserting `demo_agent_service/src/prompts/`
  is present in `dist/` after build.
- **`./preflight-demo.sh`:** replays every demo chip/use-case through the
  NL-intent path against the live backend; asserts intent schema and render
  kind per chip; also checks service health, loaded LLM tier, and prompt
  files. Prints a red/green table. Run ~10 minutes before presenting.

## Testing

Each phase lands in its own worktree with regression tests, keeping existing
suites green (`tryParseIntentJson`, `geminiNlIntent.*`,
`agentReasoningLoop.regression`, `llmProviderResolver.regression`,
`promptGuard`, `bffMcpEnvelopeUnwrap.regression`, etc.). New coverage:

- Contract module: schema pass/fail per contract; each mend-ladder step;
  fallback never returns raw text; re-ask happens at most once.
- Crash guard: rejection with `CRASH_GUARD=1` logs and continues; without it,
  dev behavior unchanged.
- promptStore: missing `dist/` prompts → loud log + `src/` fallback.
- Breaker: opens after N failures, half-open probe, silent per-request
  fallback, mode picker untouched.
- Chip coverage: every chip has a heuristic (enforced forever).

## Success criteria

1. Fault-injection tests (malformed JSON, blank reply, slow reply beyond
   budget, provider 500/timeout) never produce a blank bubble, raw JSON dump,
   or spinner past the UI budget on any agent path.
2. A thrown rejection or `kill -9` of any LLM-path service self-recovers
   without operator action on native run.sh and Docker.
3. `./preflight-demo.sh` runs green end-to-end against the Docker stack.

## Out of scope

- OAuth/permission scope changes (standing constraint: make existing scopes
  work).
- Changes to the demo narrative, mode picker, or UI surfaces beyond the
  presenter health dot.
- Cross-provider failover (e.g., Helix → Gemini); fallback is always to the
  deterministic layer, not another LLM.
