# Side Navigation Inspectors and Governance Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the side nav and Mission Control use one consistent catalog of product groups, 13 use-case groups, related diagrams, existing inspectors, and a new Governance Timeline.

**Architecture:** Add a small presentation-only catalog that maps each use-case group to product ownership, existing inspector routes, diagrams, and planned/live status. Mission Control reads the catalog for contextual links; the side nav uses the product mapping and keeps existing inspector routes canonical. Governance Timeline is a new read-only page backed by existing activity/evidence APIs or deterministic demo evidence.

**Tech Stack:** React, React Router, Vitest, existing AdminSideNav and DemoStepsDropdown catalogs.

**Spec:** Approved design in the conversation: Employee and SaaS-Embedded remain visible as planned lanes; existing Authorize and Agent Gateway inspectors are reused; Governance Timeline is new.

## Global Constraints

- Preserve existing routes and inspector behavior.
- Keep Employee Agent and SaaS-Embedded Agent visible but explicitly planned.
- Do not replace or merge the existing PingOne Authorize and Agent Gateway inspectors.
- UI changes require `cd demo_api_ui && npm run build`.
- Use the isolated worktree and preserve the project emoji allowlist.
- Mission Control retains exactly 13 one-click groups.

### Task 1: Shared inspector and diagram catalog

**Files:**
- Create: `demo_api_ui/src/config/missionControlCatalog.js`
- Test: `demo_api_ui/src/config/__tests__/missionControlCatalog.test.js`

- [x] Write a failing test asserting the 13 groups, product ownership, planned status, and representative diagram/inspector links.
- [x] Run the catalog test and verify it fails because the catalog does not exist.
- [x] Add catalog records with stable IDs, `status`, `product`, `useCaseIds`, `inspectors`, and `diagrams`.
- [x] Run the catalog test and verify it passes.

### Task 2: Mission Control contextual links

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx`
- Modify: `demo_api_ui/src/components/AIAgent.css`
- Test: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`

- [x] Write a failing test that selects Personal Agent and sees inspector/diagram links plus planned messaging for Employee Agent.
- [x] Run the focused component test and verify the new assertions fail.
- [x] Render catalog links for the active group without changing existing `onSelect` behavior.
- [x] Render a planned-lane notice when the selected group has no live cards.
- [x] Run the focused component test and verify it passes.

### Task 3: Product-oriented side nav alignment

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/config/navPagePaths.js`
- Test: `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx`

- [x] Write failing assertions for product-owned inspector search results and canonical diagram labels.
- [x] Run the focused side-nav tests and verify the assertions fail.
- [x] Reorganize only labels/ownership and add contextual search aliases; preserve existing paths and duplicate-route behavior where required for discoverability.
- [x] Add the Governance Timeline child under Evidence & Governance.
- [x] Run side-nav and catalog drift tests and verify they pass.

### Task 4: Governance Timeline page

**Files:**
- Create: `demo_api_ui/src/pages/GovernanceTimelinePage.jsx`
- Create: `demo_api_ui/src/pages/GovernanceTimelinePage.css`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/config/navPagePaths.js`
- Test: `demo_api_ui/src/pages/__tests__/GovernanceTimelinePage.test.jsx`

- [x] Write failing tests for the timeline heading, lifecycle filters, event rows, and empty state.
- [x] Run the page test and verify it fails because the route/page does not exist.
- [x] Implement a read-only timeline using existing evidence data/services with filters for identity, authorization, privilege, and governance.
- [x] Register `/governance-timeline` and add its side-nav link.
- [x] Run the page test and verify it passes.

### Task 5: Verification

- [x] Run the focused UI tests, broader affected UI tests, and production build.
- [x] Run `npm run authz:verify`, `npm run topology:verify`, and `git diff --check`.
- [x] Mark this plan complete with test evidence.
