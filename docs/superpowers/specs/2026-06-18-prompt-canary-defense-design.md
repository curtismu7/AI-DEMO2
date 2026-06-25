# Prompt-Injection Canary Tripwire — Design Spec

**Date:** 2026-06-18
**Status:** Approved design, pre-implementation
**Author:** brainstormed with Curtis

## 1. Summary

Add a deterministic **prompt-injection canary tripwire** to the Super Banking demo as a
new teaching scenario. A per-session canary token is injected into the agent's system
prompt; if that token ever surfaces in an outbound MCP **tool argument**, the agent was
manipulated into exfiltrating its own instructions, and the call is blocked.

The scenario is framed as a second, complementary defense **layer** beside PingOne
Authorize:

- **Authorize = permission layer** — *is the agent allowed to do this?* (scope, account,
  thresholds, valid `act` delegation chain).
- **Canary = integrity layer** — *was the agent manipulated into doing this?* — catches
  exfiltration **even when the action is fully authorized**.

The gem the demo makes vivid: a transfer with the canary smuggled into its `memo` is a
*perfectly authorized* action (valid token, write scope, valid act chain), so Authorize
correctly returns **PERMIT** — and the canary is the **only** layer that catches it.

Idea origin: the layered injection defense in
[garrytan/gstack](https://github.com/garrytan/gstack). We adopt **only** the deterministic
canary-on-tool-args mechanic — no ML classifier, no DeBERTa, no Haiku consensus, no
tool-result or reply scanning. ~5% of gstack's footprint for ~80% of the teaching value.

## 2. Goals / Non-goals

### Goals
- A deterministic, stage-reliable demo that shows prompt-injection exfiltration being
  caught on the **real** enforcement pipeline (real token exchange, real Authorize gate).
- An attack-vs-defense toggle: same scripted attack, defense ON (blocked) vs OFF (exfil
  succeeds), to make the contrast legible.
- A standalone **learning page** explaining how Authorize + the canary together protect
  the end user.
- Works across every agent mode/provider, including the no-LLM heuristic path.
- Generic across verticals (each vertical declares its own exfil vehicle).

### Non-goals (YAGNI)
- No ML / DeBERTa / Haiku transcript classifier.
- No scanning of tool **results** or the agent **reply** text (tool **args** only).
- No production-grade injection defense — this is a teaching layer (see §8 fail-open note).
- No PingOne Authorize console changes — purely BFF-side.

## 3. Key decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Framing | Contrast-with-Authorize (integrity vs permission) **and** attack-vs-defense toggle |
| D2 | Scan surface | **Tool args only** (deterministic, near-zero false positives) |
| D3 | Attack trigger | **Deterministic scripted scenario** (reliable on every provider incl. heuristic) |
| D4 | Exfil vehicle | **Generic across verticals** — each manifest declares `{ tool, field }` |
| D5 | Mechanism | **Approach A** — synthetic tool-call injection at the BFF; runs the real pipeline |
| D6 | Scan ordering | Scan **after** the Authorize gate, so the UI shows `Authorize → PERMIT → Canary → BLOCK` |
| D7 | Learning page | Standalone user-centric education page, in addition to the in-context EDU panel |

## 4. Components

| Piece | Location | Responsibility |
|---|---|---|
| Manifest field | each vertical `config/verticals/<id>/manifest.json` | `securityDemo.exfilVehicle = { tool, field }` (banking: `transfer` / `memo`). Unset → scenario unavailable for that vertical |
| Canary lifecycle | `buildReasonSystemPrompt` ([bankingAgentLangGraphService.js:484](../../../demo_api_server/services/bankingAgentLangGraphService.js)) | mint `req.session.promptCanary = PCANARY-<hex>` lazily; inject one instruction line into the prompt; **redact from the streamed transcript** at the stream sink |
| Detector | new `demo_api_server/services/promptCanaryGuard.js` | pure `scanForCanary(canary, params)` deep-walks arg values, returns `{ field, path }` or `null`. No deps, unit-testable |
| Pipeline hook | `runMcpToolPipeline` ([mcpToolPipeline.js:117](../../../demo_api_server/services/mcpToolPipeline.js)) | gated by `ff_prompt_canary`; positioned **after** the Authorize gate; on hit → card + SSE + `{ kind:'block', httpStatus:403, body:{ error:'prompt_injection_blocked', field } }` |
| Scenario harness | new route `POST /api/security/injection-scenario` | resolve active vertical's vehicle → ensure session canary → build tool call with canary planted in `field` → call `executeBffTool` with the real `req` → return outcome + tokenEvents |
| Token-chain cards | existing SSE → `TokenChainContext` (token-education) | ON+blocked: red "Prompt-Injection Tripwire — BLOCKED". OFF+leaked: amber "Canary Leaked — system prompt exfiltrated" showing the canary in the outbound arg |
| EDU panel | new `PromptInjectionEducation`, registered in `EducationBar` | mirrors `ActorTokenEducation`; in-context explanation + the ON/OFF toggle control |
| Learning page | new `AgentDefenseInDepthPage.js` + App.js wildcard route + nav entry | standalone user-facing "how you're protected" page (see §6) |
| Feature flag | `ff_prompt_canary` in configStore, default **ON** | togglable via `/config` like other `ff_` flags; the EDU-panel toggle flips it |

## 5. Data flow

Operator clicks **Run injection attack** → `POST /api/security/injection-scenario`:

1. Harness reads the active vertical, resolves `securityDemo.exfilVehicle = { tool, field }`.
   If unset → return `{ unavailable: true, reason }` (graceful, no crash).
2. Ensure `req.session.promptCanary` exists (mint if absent).
3. Build the tool call: `{ name: tool, args: { ...defaults, [field]: <canary> } }`.
   This stands in for a successfully-jailbroken agent — framed honestly in the UI as
   "imagine the agent was tricked into exactly this call."
4. `executeBffTool({ name, args, req, ... })` → `runMcpToolPipeline(ctx)`.
5. Pipeline runs for real: token exchange → **Authorize gate** → (new) **canary scan**.

**Defense ON (`ff_prompt_canary` truthy):**
`Authorize → PERMIT` (cards published as today) → `scanForCanary` hits →
emit `{ phase: 'canary_leak', field }` → build red token-event card via
`deps.buildTokenEvent('canary-tripwire', 'Prompt-Injection Tripwire — BLOCKED', 'error', …)`
→ `deps.publishTokenEventsToSse(flowTraceId, [card])` →
return `{ kind: 'block', httpStatus: 403, body: { error: 'prompt_injection_blocked', field, tokenEvents } }`.
No tool executes; no money moves. Agent loop surfaces the block to the UI.

**Defense OFF (`ff_prompt_canary` falsy):**
no scan → tool executes → canary lands in the result + persisted record →
emit amber `buildTokenEvent('canary-leaked', 'Canary Leaked — system prompt exfiltrated', 'warning', …)`.
Authorize still returns PERMIT, proving the canary was the sole catch.

### Why scan after Authorize (D6)
Pure security would block earliest (pre-exchange). We deliberately scan **after** the
Authorize PERMIT so the token-chain UI renders the full pedagogical sequence
`Authorize → PERMIT → Canary → BLOCK`. Blocking before exchange would hide the contrast
that is the entire point.

## 6. Learning page — "How your AI agent is protected"

New standalone page at route `/agent-defense-in-depth`, wired like the existing
`mcp-tools` / `agentic-trust` pages (declared in the App.js wildcard `<Routes>`, with a
nav entry). User-centric, not operator-centric. Teaches two complementary layers and
the defense-in-depth matrix:

| Agent is… | Authorized & honest | Unauthorized | Authorized but **manipulated** |
|---|---|---|---|
| What happens | Proceeds | **Authorize blocks** | **Canary blocks** |
| Why you're safe | normal operation | can't exceed granted permissions | jailbreak / exfil caught even though policy said PERMIT |

Sections:
1. **Authorize — the permission layer.** Every tool call is policy-checked (scope, account,
   amount/step-up/HITL thresholds, valid `act` delegation chain). Ties to the existing
   RFC 8693 chain + PingOne Authorize story.
2. **Canary — the integrity layer.** Catches the agent being *manipulated* into leaking its
   instructions or smuggling data, even when the action is authorized.
3. **The matrix** (above) — what each layer covers and the gap the other leaves.
4. **What this means for your money & data** — plain-language close: a jailbroken agent
   still can't exceed its granted permissions, and telltale exfiltration is caught.
5. **Deep-link** to run the live attack-vs-defense scenario.

## 7. Feature flag & config

- `ff_prompt_canary` — configStore, default **ON**. Togglable via `/config` and via the
  EDU-panel toggle (which flips the flag then re-runs the scenario).
- Independent of the live PingOne Authorize path; no P1AZ console change.

## 8. Error handling

- **No vehicle declared:** scenario returns `{ unavailable: true }`; UI shows
  "scenario unavailable for this vertical."
- **Detector exception:** logs + proceeds (fail-open) — this is a teaching layer, not a real
  control. Spec note: a production deployment would **fail-closed**.
- **Canary never leaks to teaching channels:** redaction at the stream sink ensures the
  intentional raw-token streaming (token-visibility teaching) never carries the canary.

## 9. Testing

- **Unit** (`promptCanaryGuard.test.js`): `scanForCanary` — hit, miss, nested/array args,
  substring vs exact, empty/null params.
- **Real-api-test** (`tests/real/`): scenario route with `ff_prompt_canary` ON →
  HTTP 403 `prompt_injection_blocked`, and the canary appears in **no** minted token or
  `token`-type chain card. With flag OFF → tool executes, canary present in result, Authorize
  card shows PERMIT.
- **Regression note:** `runMcpToolPipeline` and `bankingAgentLangGraphService.js` are on the
  REGRESSION_PLAN protected list — minimal diff, state the change before editing, log a Bug
  Fix entry if anything is touched. Plus an explicit assertion the canary never appears in the
  streamed transcript.
- **UI build gate:** `cd demo_api_ui && npm run build` must be 0 errors.

## 10. Out-of-scope / future
- ML / DeBERTa / Haiku ensemble (gstack's heavier layers).
- Tool-result and agent-reply scanning (indirect injection via poisoned data sources).
- Fail-closed productionization of the detector.
