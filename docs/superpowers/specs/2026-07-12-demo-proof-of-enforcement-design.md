# Demo Proof-of-Enforcement — Design

## Problem

For the 27 demoable use cases (22 `works` + 5 `flag-gated` in `demo_api_server/config/useCases.js`), the only thing a live audience sees today is the agent's chat reply ("Sure, here's your balance"). Whether the RFC 8693 token chain actually ran, whether PingOne Authorize actually rendered the decision, whether a DENY was actually enforced — none of that is visible in the moment. This repo has a documented history of the chat *looking* successful while the real control silently didn't fire (chips-discovery banking-only fallback, `authorize_mode` degrading to `pingone_fallback_simulated`, see `docs/SILENT_FAILURE_REVIEW_GUIDE.md`). "The agent said PERMIT" is not proof.

Existing evidence surfaces — `FloatingTokenChainPanel`/`TokenChainPanel` (token-exchange trace) and `ActivityLogPanel`/`ActivityLogPage` (broader event feed) — exist but are generic: neither is scoped to "the use case that was just triggered," so a presenter has to already know which panel to open and manually match its contents against the catalog's declared `evidence.tokenChain`/`evidence.activity`.

## Goal

At the instant a use case fires — via a chip, the Use-Case Launcher, or an attack simulation, in any agent mode (Heuristics, llama.cpp, any other LLM backend) — the UI shows an unmissable, specific verdict: this use case's declared evidence chain either fully appeared and matched the expected outcome, or it didn't, and if not, what's missing or wrong.

## Scope

The 27 demoable use cases (`maturity: 'works'` or `'flag:*'`) across `foundations`, `demo`, `controls`, `attacks`, `hitl` tracks, plus `tools`/`learn` tracks (evidence-empty today; the engine simply never fires for them, which is correct — they're tutorial pages, not enforcement demos). The 7 `needs-build` use cases are out of scope until built.

## Architecture

Two layers: close the backend tagging gaps so every in-scope use case's full trace is attributable, then build one client-side verdict engine that every UI surface reads from.

```
┌─────────────────────────────────────────────────────────────────┐
│ Backend (mode-agnostic — chip path, agent-tool path, launcher,   │
│ attack-simulator all funnel through here)                        │
│                                                                    │
│  trigger.text lookup (per useCases.js, all verticals)             │
│         │                                                          │
│         ▼                                                          │
│  useCaseId resolved ──► stampUseCaseId() [shared module]           │
│         │                        │                                 │
│         │                        ├─► tokenEvents[].useCaseId        │
│         │                        ├─► trace.authorize.useCaseId  (NEW)│
│         │                        └─► appEventService.logEvent(      │
│         │                              ..., {useCaseId})  (NEW: no  │
│         │                              longer opt-in per call site) │
│         ▼                                                          │
│  flowTraceId correlates all events from ONE trigger                │
└─────────────────────────────────────────────────────────────────┘
                              │  (SSE / poll, already exists)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Client — ProofOfEnforcementEngine (extends TokenChainContext)     │
│                                                                    │
│  watches tagged events, keyed by flowTraceId                      │
│  on new useCaseId seen  → look up useCases.js catalog entry        │
│  as events arrive       → check off against evidence.tokenChain /  │
│                            evidence.activity                       │
│  on completion/timeout  → compute verdict:                         │
│    verified | denied-as-expected | mismatch | incomplete | untagged│
└─────────────────────────────────────────────────────────────────┘
                              │  one verdict object per trigger
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      A: Inline strip   B: Token Chain    C: Verified banner
      (under chat msg)  panel (upgraded,  (room-facing, expands
                         use-case-aware)   into B's detail)
```

All three UI components are pure renderers of the engine's verdict object — none re-derives success independently. All three fire together, always, on every trigger (no per-demo mode toggle).

## Backend changes

1. **Trigger-text → useCaseId map.** `demo_api_server/config/useCases.js` already declares each use case's exact chip `trigger.text` per vertical (via `chipOverrides`/`READ_TRIGGER_BY_VERTICAL`/`amountTriggerByVertical`). Build a `deriveUseCaseIdFromTrigger(text, vertical)` lookup from that data and call it alongside the existing tool+amount-band `deriveUseCaseId` in `server.js:1928` and `bffMcpToolExecutor.js:184-186` (client-supplied `useCaseId` still wins when present and valid; trigger-text match is next; tool+amount match last, for cases with no chip trigger e.g. derived/organic tool calls). This is the single source of truth already authored for all 27 in-scope use cases — no new authoring.
2. **Tag the authorize decision.** `trace.authorize` (populated in `mcpToolPipeline.js` around `mcpAuthorizeEvaluation`, currently only `decisionContext`/`decisionId`) needs a `useCaseId` field. Since useCaseId is resolved earlier in the request (trigger-text/tool match happens before the pipeline runs, not after as today in `bffMcpToolExecutor.js`), thread it into `ctx` so `mcpToolPipeline.js` can stamp it directly onto the authorize payload, not just onto `tokenEvents` post-hoc.
3. **Consolidate `attackSimulatorService`'s duplicate.** Replace its private `_stampUseCaseId` (13 call sites) with the shared `services/useCaseTagging.js` module so attack-sim traces use the same tagging path as chip/agent traces — removes existing drift.
4. **Make activity-log tagging non-opt-in.** Any call site that already has a resolved `useCaseId` in scope (chip path, agent-tool path, attack-sim, launcher) must pass it to `appEventService.logEvent(..., {useCaseId})`. Audit existing call sites; this is a mechanical pass, not new logic.

## Client changes

**`ProofOfEnforcementEngine`** (new module, likely `demo_api_ui/src/context/ProofOfEnforcementContext.js`, sibling to `TokenChainContext.js` and consuming its event stream rather than duplicating polling):

- Groups incoming tagged events by `flowTraceId` (not bare `useCaseId` — two quick clicks of the same use case must not cross-contaminate).
- On first event carrying a `useCaseId`, resolves the catalog entry (`resolveUseCase(id, vertical)`) and its declared `evidence.tokenChain` / `evidence.activity` / `expectedOutcome`.
- As further events arrive for that `flowTraceId`, checks them off against the declared evidence lists.
- Verdict, computed once the trigger settles (all steps seen, or an 8s timeout, whichever first):
  - **`verified`** — all declared steps observed, terminal outcome matches `expectedOutcome`.
  - **`denied-as-expected`** — for attack/deny use cases where `expectedOutcome` is itself a DENY/blocked state and that's what happened.
  - **`mismatch`** — evidence arrived but the outcome differs from `expectedOutcome` (e.g. catalog expects DENY, got PERMIT). This is the highest-value state: it's the live signal that would have caught the chips-discovery-style silent fallback.
  - **`incomplete`** — trigger fired but expected steps didn't fully arrive before the timeout.
  - **`untagged`** — no useCaseId resolved at all (shouldn't happen for in-scope use cases post-fix, but the engine must stay silent rather than guess, per existing "never fake evidence" posture).
- Exposes the current verdict (and a short history) via context, same consumption pattern as `TokenChainContext`.

## UI components

Confirmed via mockups (`https://claude.ai/code/artifact/97f83b56-27d9-400f-9fe1-b38962b13fce`):

- **A — Inline proof strip**: renders under the triggering chat bubble in `AIAgent.js`/`UserDashboard.js`; shows the checked-off evidence chain compactly. Reuses existing chat bubble layout.
- **B — Token Chain panel, upgraded**: `FloatingTokenChainPanel`/`TokenChainPanel` gain a use-case-aware header pill (`UC7 · STEP-UP`) and a per-step checklist row rendered from the engine's verdict, plus a "N / M steps matched" summary line. DENY/STEP-UP/CIBA outcomes get distinct coloring from PERMIT.
- **C — Verified banner**: new component, portal-rendered top-of-viewport, large/high-contrast for room visibility. Shows verdict headline + one-line detail, auto-collapses to a pinned pill after ~6s, "View trace" expands B. `mismatch`/`incomplete` verdicts render in warning/error styling (not the green "verified" treatment) so a real failure is exactly as visible as a success.

All three subscribe to the same `ProofOfEnforcementContext`; none polls or re-derives independently.

## Edge cases

- **Multiple rapid triggers**: scoped by `flowTraceId`, so overlapping verdicts render independently (e.g. stacked banners, or the latest wins visually while history is preserved in B).
- **Use case with empty `evidence` arrays** (tools/learn tracks): engine never computes a verdict for these — no useCaseId ever resolves for them (no `trigger.text` requiring proof), so A/B/C simply don't fire. Not an error state.
- **`needs-build`/not-yet-implemented use cases**: excluded from the trigger-text map entirely (out of scope per above).
- **Attack simulator flows**: same engine, fed by the consolidated stamping (backend change #3); `expectedOutcome` for these is typically the blocked/DENY state, so the common verdict is `denied-as-expected`.

## Testing

- **Backend**: unit tests for the new trigger-text lookup (covering all 27 use cases × relevant verticals), the authorize-trace tagging, and the attack-simulator consolidation (assert it now calls the shared `stampUseCaseId`, not the private duplicate).
- **Client**: unit tests on `ProofOfEnforcementEngine`, one per verdict state (`verified`, `denied-as-expected`, `mismatch`, `incomplete`, `untagged`), plus the `flowTraceId` isolation case (two concurrent triggers of the same useCaseId don't cross-contaminate).
- **Automated pre-demo gate**: extend `scripts/preflight-demo.sh`'s existing replay (all `mode:'both'` chips × all verticals) to assert every replay reaches `verified` or `denied-as-expected` — never `mismatch` or `incomplete`. This turns "prove we did the use case" into a scripted gate that runs before every demo, not just a live visual during one.
- **Manual/live**: trigger a representative use case from each track (foundations, controls, attacks, hitl) via chip, launcher, and attack-sim, in both Heuristics and an LLM mode, and confirm A/B/C all render the same verdict.

## Non-goals

- Presenter-configurable toggling of which surface(s) show (all three always fire together, per decision).
- Extending proof coverage to the 7 `needs-build` use cases (design applies once they're built; not built now).
- Changing the underlying enforcement logic (P1AZ, gateway, token exchange) itself — this is purely a visibility layer on top of existing, already-correct enforcement.
