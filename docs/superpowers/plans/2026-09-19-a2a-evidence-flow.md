# A2A Evidence Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the A2A request/response, identity, wire, and task-boundary evidence visible consistently in every step-oriented UI.

**Architecture:** Reuse the existing redacted A2A evidence builder as the source of truth and add a small presentation adapter for short labels, source event IDs, request/response summaries, and transport/task metadata. Every visual surface will consume that adapter while preserving its existing layout and selection behavior.

**Tech Stack:** React, Vitest, existing A2A event metadata, CSS theme tokens.

**Spec:** Approved A2A evidence-flow design from the conversation on 2026-09-19.

## Global Constraints

- Do not change OAuth, sessions, token issuance, or A2A backend behavior.
- Never render raw token values; keep claims redacted and allowlisted.
- Preserve the project emoji allowlist and theme rules.
- UI changes require focused Vitest coverage and `npm run build`.
- Use Super Sports as the default vertical for verification.

### Task 1: Shared A2A evidence presentation model

**Files:**
- Modify: `demo_api_ui/src/utils/a2aChainDetail.js`
- Test: `demo_api_ui/src/utils/a2aChainDetail.test.js`

- [x] Write tests for compact labels, source-event IDs, request/response summaries, transport mode, and the no-token response boundary.
- [x] Run the focused test and verify it fails for the missing adapter.
- [x] Implement a redacted adapter that derives from `buildA2aChainDetail` and existing event metadata.
- [x] Run the focused test and verify it passes.

### Task 2: Topology and sequence selection consistency

**Files:**
- Modify: `demo_api_ui/src/components/TokenTopologyPanel.jsx`
- Modify: `demo_api_ui/src/components/SequenceReelDiagram.jsx`
- Test: existing component tests plus new focused assertions.

- [x] Add failing tests showing A2A topology nodes select the real source event and expose Request/Response details.
- [x] Replace synthetic topology-only evidence with source-linked nodes and correct delegated-bearer wording.
- [x] Add compact A2A request/response labels to sequence nodes while retaining the existing detail panel.
- [x] Run focused component tests.

### Task 3: Movie reel and legacy Agent Flow surfaces

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainPresenter.jsx`
- Modify: `demo_api_ui/src/components/AgentFlowDiagramPanel.js`
- Modify: `demo_api_ui/src/services/agentFlowDiagramService.js`
- Test: focused presenter and Agent Flow tests.

- [x] Add failing tests for A2A request/response summaries and protocol boundary text.
- [x] Render the shared A2A summaries in the presenter and legacy flow only when A2A evidence exists.
- [x] Keep generic non-A2A flows unchanged.
- [x] Run focused tests.

### Task 4: Verification and handoff

- [ ] Run `graphify update .`.
- [ ] Run focused UI tests, `npm run build`, `git diff --check`, and the required topology/hygiene checks if affected.
- [ ] Run the theme contrast audit for touched UI surfaces.
- [ ] Stage only intended files and commit the feature branch.
