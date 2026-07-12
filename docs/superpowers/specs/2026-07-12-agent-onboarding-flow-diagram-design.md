# Agent Onboarding Flow Diagram — Design Specification

**Date:** 2026-07-12
**Status:** Approved — proceeding to implementation
**Source material:** Whiteboard + slide diagrams by Tarun Madiraju, "Enterprise AI
Onboarding & Governance Architecture" (not yet implemented in this repo — see
gap analysis below).

---

## Problem

Tarun Madiraju's diagram proposes a target-state architecture: any AI agent —
enterprise-user-launched, developer-built, or discovered running unmanaged in a
cloud platform or browser/desktop — should automatically become a managed
enterprise identity with governance, privileges, and security applied
throughout its lifecycle. The diagram names three onboarding flows (Enterprise
AI User, Developer/Agent Builder, Security/Identity Admin discovery) that route
through a proposed **Agent Studio** portal into **IGA for AI**, the **Privileges
MCP Gateway**, **PingGateway MCP Security Gateway**, and **PingAuthorize**.

A repo survey (general-purpose agent, 2026-07-12) found most of these pieces do
not exist in AI-DEMO2 today:

| Component | Status | Evidence |
| --- | --- | --- |
| Agent Studio (unified 3-persona portal) | PARTIAL | 3 disconnected flows: `AgentBuilderPage.jsx`, `clientRegistration.js`, `adminAgentRoutes.js` |
| IGA for AI | MISSING | narrative-only in `AgentGuardrailsDiagram.jsx`; no inventory/lifecycle/certification code |
| P1 Privileges MCP Gateway | PARTIAL | `PrivilegeDemoPage` demos privilege approval, not wired into the main MCP request path |
| PingGateway MCP Security Gateway | EXISTS | `docker-compose.yml` `ping-gateway` service, token exchange/validation |
| PingAuthorize | EXISTS | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`, `pingAuthorizeGuard.ts` |
| Cloud Discovery (admin) | MISSING | no shadow-agent detection in Foundry/AWS/Vertex |
| Browser/Device Discovery | MISSING | `UngovernedAgentPage.js` is a static before/after page, not a live detector |
| Enterprise Runtime enforcement | EXISTS | core of the demo — every MCP/tool call validated via gateway → PingOne Authorize |

Given this, there is no live backend data to trace. The ask is a **presentation
/ talk-track page**, in the same family as `AgentGuardrailsDiagram.jsx` and
`UngovernedAgentPage.js`, that walks a viewer through Tarun's three flows
step-by-step against a diagram — not a live-wired trace like
`TokenChainTraceRail`.

## Goal

A new page, `AgentOnboardingFlowDiagram.jsx`, that:

1. Renders Tarun's proposed architecture as a lane/card diagram (visual
   language reused from `AgentGuardrailsDiagram.jsx`).
2. Lets the presenter pick one of the three flows (Enterprise AI User /
   Developer-Agent Builder / Security Admin discovery) via tabs.
3. Steps through that flow's numbered steps with Prev / Next / Play controls —
   the active step highlights its diagram card(s) and shows its narrative text,
   visually similar to `TraceStepCard`'s step-card treatment but scripted, not
   event-driven.
4. Can be popped out to a real separate browser window for screen-sharing, by
   reusing the existing `FloatingPanel` component (no new pop-out plumbing).
5. Is visibly labeled as a proposed/illustrative architecture, distinct from
   the real, backend-wired Token Chain rail.

## Non-Goals

- No changes to auth, session, token exchange, or any protected area in
  `REGRESSION_PLAN.md` §1.
- No new backend routes, no live data — this is static, scripted content.
- Does not attempt to build any of the MISSING/PARTIAL components identified
  above (Agent Studio portal, IGA for AI, cloud/browser discovery). This page
  only *depicts* them for discussion purposes.
- No change to `TokenChainTraceRail.jsx`, `AgentGuardrailsDiagram.jsx`, or
  `UngovernedAgentPage.js` — new, additive page only.

## Approach

New standalone page mirroring `AgentGuardrailsDiagram.jsx`'s card/lane grid
(chosen over a Mermaid-rendered diagram, to stay visually consistent with the
rest of the "Learn & Present" nav group) plus a step-through control bar
adapted from `TokenChainTraceRail`'s step-list interaction model.

## 1. Data model

`demo_api_ui/src/data/agentOnboardingFlows.js` exports:

- `LANES` — the diagram's columns (Actors, Agent Studio, Governance & Runtime
  Enforcement, Enterprise Resources), each with card definitions (`key`,
  `title`, `body`) matching the components from Tarun's diagram.
- `FLOWS` — keyed `enterpriseUser` / `developer` / `admin`, each an ordered
  array of step objects transcribed from Tarun's Flow 1/2/3 sticky notes:
  `{ id, title, narrative, activeCardKeys: [...] }`. `activeCardKeys` maps a
  step to the diagram card(s) it should highlight.

## 2. Component

`AgentOnboardingFlowDiagram.jsx` (+ `.css`):

- Flow-selector tabs (Enterprise AI User / Developer / Security Admin).
- Diagram grid: lanes of cards; a card is `active` when its key is in the
  current step's `activeCardKeys`, `done` if a prior step in this run touched
  it, otherwise neutral — mirrors `AgentGuardrailsDiagram`'s
  active/muted card states.
- Step control bar: Prev / Next / Play (auto-advance, ~2.5s/step, pauses on
  manual interaction) / Reset, plus a step counter ("Step 3 of 7") and the
  current step's narrative text.
- Static banner: "Proposed architecture (T. Madiraju) — illustrative
  walkthrough, not a live trace."
- Wrapped in `FloatingPanel` (`title="Agent Onboarding Flow"`) so the whole
  page content can be popped into its own browser window via the existing
  🪟 pop-out affordance.

## 3. Wiring

- Route `/agent-onboarding-flow` in `App.js`, alongside `/agent-guardrails`.
- Nav entry in `AdminSideNav.jsx`'s "Learn & Present" group (`learn-present`
  path list + a `{ label: "Agent Onboarding Flow", path: "/agent-onboarding-flow" }`
  entry), next to "Agent Guardrails".

## Testing / verification

- `cd demo_api_ui && npm run build` must exit 0 (regression-guard UI build gate).
- Manual click-through of all three flows' Prev/Next/Play controls in a
  running dev server.
