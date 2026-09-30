# Server Topology Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive React Flow architecture page that realizes the user-approved GitHub Actions graph-style server map.

**Architecture:** A focused catalog module stores service and connection facts, with canonical network addresses read from the repo's `service-topology.json`. A route-level React component renders the graph, filters and detail panel; a page stylesheet carries the approved dark GitHub-style graph appearance while honoring application theme tokens.

**Tech Stack:** React 19, `@xyflow/react`, Vite, plain JSX and CSS.

**Spec:** `planning/server-topology-map-mock.html` (user-approved visual and facts model).

## Global Constraints

- Preserve existing sign-in, session, route guards, and architecture pages.
- Use the existing root `service-topology.json`; do not edit generated topology output.
- Use the existing `@xyflow/react` dependency; do not add dependencies.
- Respect `REGRESSION_PLAN.md` §0: emoji allowlist, theme tokens, 10px minimum type scale, and no inline themeable colors.
- Do not add or run tests; run the required UI production build and repo-required graph refresh.
- This change is a UI page only; no deployment, live-cluster health, or runtime topology discovery.

---

### Task 1: Add the source-grounded topology catalog

**Files:**
- Create: `demo_api_ui/src/components/serverTopologyData.js`
- Read: `service-topology.json`, `docker-compose.yml`, `k8s/01-namespace.yaml`, and the approved HTML mock.

- [ ] Define service records with stable IDs, service names, role, group, optional profile, layout position, local address, Kubernetes address, protocol, network, security, and relevant RFC/spec references.
- [ ] Define connection records with source/target IDs and protocol, network, security, RFC and spec details.
- [ ] Derive core declared addresses from `service-topology.json`; clearly mark external endpoints and optional or profile-specific services.
- [ ] Keep NetworkPolicy and mTLS facts explicit and qualified; standards links are references, not conformance claims.

### Task 2: Build the React Flow topology page

**Files:**
- Create: `demo_api_ui/src/components/ServerTopologyPage.jsx`
- Create: `demo_api_ui/src/components/ServerTopologyPage.css`

- [ ] Render catalog services and connections in React Flow with GitHub Actions-style dark cards, dotted graph background, groups, color-keyed edges, and responsive detail panel.
- [ ] Give the graph a wide, tall work area sized for the full topology, with fit-to-map and pan/zoom controls.
- [ ] Add Local Docker / Hosted Kubernetes switch, service category filters, and single-active protocol / network / security / RFC-spec label selector.
- [ ] Add request-path playback scenarios with play/pause, previous, next, and restart controls; animate the active connection and focus the current hop details.
- [ ] Selecting a service or connection displays role, active deployment address, protocol, network path, security and linked RFC/spec references.
- [ ] Add non-live/static evidence annotations for NetworkPolicy and mTLS deployment differences.
- [ ] Use app theme tokens for page surfaces and text; keep semantic connection colors as accents and font sizes on the project scale.

### Task 3: Expose the page as a new architecture destination

**Files:**
- Modify: `demo_api_ui/src/routes/EducationRoutes.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`

- [ ] Add `/architecture/server-topology` without changing existing route behavior.
- [ ] Add a diagram navigation item beside the current architecture pages.

### Task 4: Review and build

**Files:** all files above.

- [ ] Inspect the focused diff and check for broken service IDs, missing connection endpoints, or unsupported security claims.
- [ ] Run `cd demo_api_ui && npm run build` as required by the UI contract.
- [ ] Refresh the repository code graph with `graphify update .` as required by root `CLAUDE.md`.
- [ ] Run the `THEMING.md` §1.4 readability audit on the new page in light and dark themes if a local page preview is available; record any environment limitation accurately.
- [ ] Stage only the intended mock, plan, catalog, page, styles, and routing/navigation files when preparing a commit.
