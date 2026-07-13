# Agent Studio (Preview) — Design Specification

**Date:** 2026-07-13
**Status:** Approved — proceeding to implementation
**Source material:** Gap analysis in [[ai-demo2-tarun-onboarding-architecture]] memory;
HTML mock review (3 visual directions, Option 3 "Guided Wizard" chosen by user).

---

## Problem

`AgentOnboardingFlowDiagram.jsx` (merged 2026-07-12) illustrates Tarun Madiraju's
proposed architecture as a scripted walkthrough, but a repo gap-analysis survey
found most of it isn't implemented: no unified Agent Studio portal, no IGA for
AI, no cloud/browser-device discovery, and the Privileges MCP Gateway isn't
wired into the real request path. The user asked to "mock all this" as real,
clickable simulated pages (not just narrated diagram steps), so the demo can
actually walk a customer through the 1-year-target experience.

## Goal

Five new pages under a new "Agent Studio (Preview)" nav group:

1. **Agent Studio** (`/agent-studio-preview`) — 3 persona tabs (Enterprise
   User, Developer, Admin). User/Developer tabs are guided wizards through
   `FLOWS.enterpriseUser` / `FLOWS.developer` (from `agentOnboardingFlows.js`
   — same step data as the diagram page). Admin tab reviews agents surfaced
   by Discovery.
2. **Discovery** (`/discovery-preview`) — Story A / Story B wizards through
   `FLOWS.admin.stories.browserDevice` / `.cloud`.
3. **IGA for AI** (`/iga-for-ai`) — inventory of every agent from both pages,
   with lifecycle status and a certify action.
4. **Privileges Gateway** (`/privileges-gateway-preview`) — mock enforcement
   audit log.
5. **Platform Gaps** (`/platform-gaps`) — the 5 Ping Identity *platform-level*
   gaps (distinct from the app gaps these 4 pages mock) — not a Ping product
   today: unified Agent Studio, IGA for AI, AI-agent discovery, a distinct
   Privileges MCP Gateway, and a federated cross-product Agent Identity.

## Non-Goals

- No real backend calls — entirely client-side simulated state.
- Does not modify `AgentOnboardingFlowDiagram.jsx`, `AgentGuardrailsDiagram.jsx`,
  or any existing page.
- Does not re-author flow step data — reuses `FLOWS`/`LANES` from
  `agentOnboardingFlows.js` as the single source of truth.

## Approach

**Shared mock store** (`agentStudioMockStore.js`, localStorage-backed under
`aiDemo.agentStudioPreview.v1`) — Agent Studio writes registered agents;
Discovery writes pending agents; Admin tab approves; IGA for AI certifies.
All 5 pages subscribe to the same store, so completing a flow on one page is
immediately visible on another (this is what makes the preview feel like one
pipeline instead of 5 disconnected screens).

**Visual direction (Option 3 of 3 HTML mocks reviewed):** warm/amber palette
(nod to the diagram's yellow sticky notes — not the demo's brand blue, kept
deliberately distinct so "preview" content is visually separable from the
real product), horizontal step-progress + single-step card + Back/Next for
the two step-sequence pages (Agent Studio, Discovery), calmer row-card lists
for the two state-view pages (IGA for AI, Privileges Gateway) since those are
inventories, not sequences. Chosen for teaching: one step visible at a time
with the whole sequence still shown as a progress bar, versus a stacked list
or dense console (the two alternatives reviewed).

**Shared components:** `WizardStepper.jsx` (progress + step card + Back/Next,
used by all 4 flows), `PreviewBanner.jsx` (persistent "simulated — see
Platform Gaps" banner on every page except Platform Gaps itself).

## Testing / verification

- `cd demo_api_ui && npm run build` must exit 0.
- Console-error check via Playwright against `vite preview` confirmed no
  errors specific to the new pages (the only errors present are pre-existing
  502s from auth/session endpoints with no backend running — same on
  `/agent-guardrails`, a known-good existing page).
