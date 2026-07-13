# Agent Onboarding Flow — Alternate Views + Editable Stickies

**Date:** 2026-07-13
**Status:** Approved — proceeding to implementation

---

## Problem

Earlier redesign exploration (3 HTML mocks: balanced dashboard, dark ops
console, warm subway map) led to a miscommunication — the user's "I like
subway map" was about wanting a *second* view, not replacing the existing
box+arrow diagram (`AgentOnboardingFlowDiagram.jsx`, PR #366), which they
explicitly want kept unchanged ("I want a diagram with boxes and arrows...
I like what we build keep that"). Separately, the user asked to see the
architecture rendered "like a mermaid diagram" (real auto-laid-out arrows)
and, after reviewing that mock, asked for full source-image fidelity:
missing content (an "Identity & Metadata" box was absent from the data
model), vendor/platform logos instead of plain text, and the source image's
yellow sticky-note annotations made visually authentic and **editable**.

## Goal

1. **Two new additive pages**, alongside the unchanged box+arrow diagram:
   - `/agent-onboarding-flow-subway` — subway-map + story-card walkthrough,
     all 4 real flows, reusing `FLOWS` from `agentOnboardingFlows.js`.
   - `/agent-onboarding-flow-mermaid` — the same architecture as a real
     Mermaid.js flowchart (auto-layout, directional arrows), including the
     previously-missing "Identity & Metadata (Ping Identity Platform)" box,
     and vendor/platform logos (Claude, Cursor, VS Code, ChatGPT/OpenAI,
     AWS, Google Cloud, Microsoft Azure) fetched from Simple Icons (CC0) and
     bundled under `demo_api_ui/public/images/vendor-logos/`.
2. **Editable yellow sticky notes** on the existing box+arrow diagram: the
   7 annotation callouts from the source image, corrected to match its
   exact wording, rendered as a real sticky-note visual (rotated, yellow,
   shadowed) instead of plain italic captions, and click-to-edit with
   localStorage persistence (`EditableSticky.jsx`) so a presenter can
   annotate live during a demo.

## Non-Goals

- Does not replace or restructure `AgentOnboardingFlowDiagram.jsx`'s boxes,
  rows, or highlighting logic. The only changes there are: (a) reordering
  elements *within* existing `activeCardKeys` arrays — a no-op for
  highlighting, since it's `Set`-based (order-independent) — so the new
  subway page can derive one "primary station" per step without touching
  the box+arrow diagram's rendered output; (b) two note-text corrections to
  match the source image exactly; (c) swapping plain-text notes for
  `EditableSticky`.
- The user explicitly approved bypassing the project's emoji/icon-asset
  allowlist (`REGRESSION_PLAN.md` §0) for this diagram's vendor logos only —
  not a project-wide change.
- Mermaid page is a static reference render (no step-by-step highlighting) —
  matches what was reviewed and approved as a mock.

## Approach

`agentOnboardingStations.js` adds `STATION_LABELS` (short display name per
box key) and `collapseStations(steps)` (groups consecutive same-key steps
into one subway "station" slot, so the line always advances forward even
when a component like IGA for AI is revisited later in a flow).

`EditableSticky.jsx` is a small reusable component: displays `defaultText`,
click (or its "Edit" button) enters a `contentEditable` state, blur commits
to `localStorage` under `aiDemo.agentOnboardingSticky.<id>` and re-renders;
Escape cancels. No backend — purely a presenter annotation tool.

## Testing / verification

- `cd demo_api_ui && npm run build` exits 0, with both new pages actually
  wired into routes (confirmed via bundle content-string checks — an
  unwired file doesn't get compiled/type-checked by Vite at all).
- Confirmed vendor logo SVGs land in `build/images/vendor-logos/` and the
  runtime `<img src>` template path resolves correctly.
- Confirmed via `git diff` that the only changes to the box+arrow diagram's
  shared data file are array-element reordering (no membership change) and
  two note-text corrections — verified with a Node script that every
  `activeCardKeys` Set still resolves identically.
