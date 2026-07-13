# Agent Onboarding Flow Diagram v2 — Design Specification

**Date:** 2026-07-13
**Status:** Approved — proceeding to implementation
**Source material:** A cleaner render of the same source diagram (box layout +
arrows now legible), shared by the user with the note that the diagram should
be interactive and based on it directly.

---

## Problem

The merged `AgentOnboardingFlowDiagram.jsx` (2026-07-12) rendered Tarun
Madiraju's architecture as an abstracted 4-lane card grid (Actors /
Onboarding / Governance & Enforcement / Runtime) — a simplification, not the
actual box layout from the source diagram. The user shared a clearer render
of the same diagram and asked for the in-app page to match it box-for-box,
while keeping the existing interactive step walkthrough (forward/back/pause).

## Goal

Replace the 4-lane grid with a 6-row layout matching the reference image:

1. **Entry row** (triple) — Enterprise Users / Developers / Cloud Discovery (Admin).
2. **Agent Studio** (single, wide) — 3-column persona breakdown.
3. **Orchestration bar** — 5-step "Agent Studio orchestrates onboarding across
   the Ping platform" sequence.
4. **Governance row** (triple) — P1 Privileges MCP Gateway / PingGateway MCP
   Security Gateway / PingAuthorize.
5. **Discovery + IGA row** (split) — Story A/B discovery boxes on the left,
   IGA for AI (wide) on the right.
6. **Runtime row** (single, wide) — Enterprise AI Runtime.

Each row's `note` field reproduces the reference diagram's yellow side-note
callouts. A numbered legend (1–7) matches the reference diagram's own legend.
The existing Prev/Next/Play/Reset step controls are unchanged — only the
diagram's visual structure and the underlying `ROWS` data model changed
(previously `LANES`).

## Non-Goals

- Does not attempt pixel-perfect reproduction of the source image (icons,
  exact arrow routing) — a live HTML/CSS/SVG recreation, not an embedded
  raster image, chosen for dark-mode support and crisp text at any zoom.
- Does not update `ping_agent_onboarding_flow_diagram.html` (the standalone
  public GitHub Pages twin) — now out of sync with this row layout; a
  follow-up if the public page needs the same visual update.
- Does not change `AgentGuardrailsDiagram.jsx` or Agent Studio (Preview) —
  those already reuse `FLOWS` from `agentOnboardingFlows.js` unchanged (only
  key names shifted: `discovered-agent` split into `privilege-discovery` +
  `cloud-discovery-iga`, which both consumers already used only via `FLOWS`,
  not `LANES`, so they needed no code changes).

## Approach

`agentOnboardingFlows.js` exports `ROWS` (replacing `LANES`) — an array of 6
row descriptors, each with a `kind` (`triple` | `single` | `orchestration` |
`split`) that a new `DiagramRow` renderer switches on, plus `LEGEND` (7
numbered categories). `Box` is a generic renderer handling every field shape
a box can have (`tags`, `bullets`, `columns` as either a plain string list or
`{heading, items}` objects, `note`). Active/visited highlighting logic is
unchanged — same `activeKeys`/`visitedKeys` Sets, just applied to the new,
more granular box keys (12 total, up from 10).

## Testing / verification

- `cd demo_api_ui && npm run build` exits 0.
- Bundle confirmed to contain all new row/box content strings.
- Data-consistency check: every `activeCardKeys` value across all 4 flows'
  steps resolves to an actual `ROWS` box key, and every box key is
  highlighted by at least one step (verified via a Node ESM script — see
  commit).
- Full interactive/visual Playwright check not possible in this environment:
  `vite preview` has no backend, and the app shell blocks on session-check
  modals even on known-good existing pages (confirmed by comparing against
  `/agent-guardrails`) — not specific to this change.
