# Demo Check Unify Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Make `/check` the single SE Demo check page: READY = blocking stack + PERMIT gate + DENY gate, with `nextAction` + deep detail; redirect Test Lab.

**Architecture:** Extend `checkService` result shape and `aggregateVerdict`; add `usecaseCheck.js` (PERMIT + DENY); light CheckPage UI for nextAction + label; redirect `/ping-ai-test-lab`.

**Tech Stack:** Node/Express BFF, Jest, React CheckPage.

**Spec:** `docs/superpowers/specs/2026-07-15-demo-check-unify-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `demo_api_server/services/checks/usecaseCheck.js` | Gate PERMIT + DENY descriptors |
| `demo_api_server/services/checks/index.js` | Require usecaseCheck |
| `demo_api_server/services/checks/gatewayCheck.js` | Drop `heavy: true` so PingGateway path runs in default when flag on |
| `demo_api_server/services/checkService.js` | Forward `nextAction`; severity-aware verdict |
| `demo_api_server/tests/checkService.test.js` (+ usecase tests) | Verdict + usecase behavior |
| `demo_api_ui/src/pages/CheckPage.jsx` (+ cards/rail) | Label, nextAction display |
| `demo_api_ui/src/App.js` | Nav + redirect Test Lab |

### Task 1: Verdict + nextAction in checkService
### Task 2: usecaseCheck PERMIT + DENY gates
### Task 3: gateway.real_path not heavy
### Task 4: CheckPage UI + redirect
### Task 5: Tests green, commit
