# "What's Happening" Activity Narration Panel — Design

**Date:** 2026-06-19
**Status:** Approved (design), ready for implementation planning
**Scope:** Phase 1 (frontend) is the shippable increment; Phase 2 (backend enrichment) is additive.

## Problem

The demo already has a token-chain visualization that shows the *gritty technical detail* (RFC 8693 exchanges, scopes, audiences). That panel is for the deep-dive. It does not tell a non-technical viewer, in plain English, *what the app is doing right now* as the AI agent works.

We need a friendly, scrolling activity window — a chatty running commentary — aimed at demos and learning. It is the deliberate opposite of the token-chain panel: no jargon, just the story.

## Goals

- Narrate the agent's work in plain, friendly English, one short sentence per step.
- Cover the full story: happy-path pipeline steps, security decisions (deny / step-up / human approval), the delegation angle (the AI is acting *as you*, with limited permission), and errors/recoveries.
- Read correctly in every vertical ("the bank" / "the clinic" / "the store"), resolved from the active vertical.
- Ship a complete, demoable feature with **zero backend changes** first; enrich from the backend later.
- Gate behind a feature flag so it can be turned off.

## Non-Goals (YAGNI)

- **No localStorage persistence.** The token chain already does recovery; this narration is ephemeral demo color and resets with the demo.
- **No per-step deep-link into the token panel.** A "reveal the gritty detail" bridge is appealing but is deferred (potential Phase 3).
- **No re-narration of the token chain's technical content.** This panel stays plain-English; the two panels are complementary, not redundant.

## Voice & Tone

- One short sentence per step, no jargon. Example: "Asking the bank for permission to read your balance…".
- Present tense while a step runs (`⟳ Reading your balance…`); flips to past tense + check when it finishes (`✓ Read your balance`).
- Vertical-aware nouns via an `{institution}` token resolved from the active vertical's manifest, so the same template reads right in every skin.

## Architecture — Hybrid Source of Content

The agent already streams rich events over SSE (`TOOL_CALL_START/RESULT/END`, token events, `authorizeDecisions`, `archTrace`, `RUN_ERROR`, `RUN_FINISHED`) via `useAgentRun` → `useAgentState`. The narration rides this existing stream.

**Frontend templates own the deterministic pipeline.** Identity, the authorize/permission decision, tool call, result, denial, step-up, HITL, delegation, and errors are all *derivable* from events the agent already emits. A pure mapper turns each into a friendly sentence. This alone yields a fully working panel with no backend changes.

**Backend `ACTIVITY_STEP` events enrich it (Phase 2).** A new SSE event the agent service emits only where the LLM has genuinely narrative color the frontend cannot derive (e.g. planning/reasoning). Tagged `source: 'agent'` and interleaved by sequence. Templated phases are a fixed enum, so backend lines never double-narrate a frontend-owned moment.

### Data Flow

```
agent SSE stream ─┬─ existing events ─→ activityNarration.js (templates) ─┐
                  └─ ACTIVITY_STEP (Phase 2) ─────────────────────────────┤
                                                                          ▼
                                              ActivityNarrativeContext (requests[])
                                                                          ▼
                                                       ActivityNarrativePanel (floating)
```

## Components (Frontend)

| Unit | Responsibility | Depends on |
|---|---|---|
| `activityVocab.js` | Friendly-sentence templates keyed by phase / decision / obligation, with the `{institution}` token. Follows the existing vocab-extraction pattern. | active-vertical institution noun |
| `activityNarration.js` | Pure mapper `(event, ctx) → step \| null`. No side effects, no React. Unit-testable from event fixtures. | `activityVocab.js` |
| `ActivityNarrativeContext.js` | Holds `requests[]`, each `{ id, prompt, steps[], status, collapsed }`. Methods: `startRequest(prompt)`, `pushStep(step)`, `finishRequest(status)`, `reset()`. Reducer logic for accumulate + auto-collapse. | — |
| `ActivityNarrativePanel.jsx` + `.css` | Floating panel reusing `FloatingTokenChainPanel` positioning. Auto-scrolls to latest, auto-collapses finished requests to a one-line summary ("You asked: pay rent — 5 steps, approved"), current request expanded. | `ActivityNarrativeContext` |

**Wire-in:** a thin addition to the existing `useAgentRun`/`useAgentState` handlers — taps on events already dispatched, plus a new `onActivityStep` handler (used in Phase 2). The only change to `AIAgent.js` is mounting the panel and adding the header toggle.

## Behavior

- **Step lifecycle:** each step has a `status` (`running` → `done` | `failed`) and a phase tag. Running steps render present-tense; completed flip to past-tense + status icon.
- **History:** accumulate across the session, grouped per request. Finished requests auto-collapse to a one-line summary; the current request stays expanded. `reset()` clears everything (wired to the existing demo-reset action).
- **What gets narrated:**
  - Happy-path: confirming identity → getting the {institution}'s permission → calling a tool → reading data → returning the answer.
  - Security decisions: deny ("The {institution} said no — that's not allowed"), step-up ("The {institution} wants you to approve this on your phone first"), HITL ("This needs your explicit OK").
  - Delegation: "The assistant is acting as you, but only allowed to read — not move money."
  - Errors/recoveries: "That didn't work, trying another way…", "The {institution} was slow, asking again."

## Feature Flag

- New flag **`ff_activity_narration`** gates the whole feature (panel mount + header toggle + event taps). Default value chosen at implementation time (proposed: on, since it is presenter-facing and additive).

## Header Toggle

- A toggle control in the **agent header** (not a generic floating toggle) shows/hides the panel. Follows the app's control standard. When `ff_activity_narration` is off, the toggle is not rendered.

## Testing

- `activityNarration.js`: fixture-driven unit tests — feed representative SSE events (happy path, deny, step-up, HITL, error) and assert the produced sentences.
- `ActivityNarrativeContext.js`: reducer unit tests for accumulate + auto-collapse + reset.
- `ActivityNarrativePanel.jsx`: React Testing Library render test (renders grouped requests, collapses finished, auto-scrolls).
- UI build gate must stay green (`cd demo_api_ui && npm run build`).

## Phasing

1. **Phase 1 (this spec's shippable increment):** all frontend units, fed entirely by existing SSE events. Feature-flagged, header toggle, fully demoable.
2. **Phase 2 (additive):** agent service emits `ACTIVITY_STEP`; BFF proxy passes it through; `onActivityStep` interleaves backend color.
3. **Phase 3 (optional, not committed):** per-step deep-link bridge into the token-chain panel.

## Open Decisions Resolved

- Source: **hybrid** (frontend templates + backend enrichment), frontend first.
- Placement: **floating panel** (mirrors token-chain panel), toggled from the **agent header**.
- Coverage: **all four** moment types (happy path, security decisions, delegation, errors).
- History: **accumulate with auto-collapse** of finished requests.
- Gating: **`ff_activity_narration`** feature flag.
