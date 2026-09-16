# OAuth Visualizer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the supplied OAuth Visualizer as a dashboard surface with embedded, pop-out, both, and none modes plus shared light/dark and font-size controls.

**Architecture:** Adapt the standalone visualizer's flow data and browser-side step model into focused React modules. A new host component owns flow selection, run state, Mermaid rendering, details, and presentation controls; AIAgent owns the four-way surface preference and passes embedded/pop-out state through existing dashboard events. Pop-outs use `DraggableModal` and all visualizer styling uses dashboard theme tokens.

**Tech Stack:** React 19, Vite 8, Mermaid 11, Vitest, existing `DraggableModal`, `ThemeContext`, and dashboard CSS variables.

**Spec:** `docs/superpowers/specs/2026-09-16-oauth-visualizer-integration-design.md`

## Global Constraints

- Preserve the BFF as the sole browser-token custodian for existing dashboard flows.
- Use the existing `DraggableModal` for pop-outs.
- Use `:root[data-theme="dark"]` and dashboard theme tokens; never `prefers-color-scheme`.
- Keep font sizes at or above `var(--font-size-3xs)` and do not theme colors, backgrounds, or font sizes through inline styles.
- Respect the project emoji allowlist; use only `☀️` and `🌙` for the mode toggle.
- Run `cd demo_api_ui && npm run test:unit && npm run build` before completion.

---

### Task 1: Create pure OAuth Visualizer domain adapters

**Files:**
- Create: `demo_api_ui/src/components/oauthVisualizer/oauthVisualizerFlows.js`
- Create: `demo_api_ui/src/components/oauthVisualizer/oauthVisualizerModel.js`
- Create: `demo_api_ui/src/components/oauthVisualizer/__tests__/oauthVisualizerModel.test.js`

**Interfaces:**
- Produces `OAUTH_VISUALIZER_FLOWS`, `createInitialRun(flow)`, `getStepStatus(run, stepId)`, `advanceRun(run, result)`, and `getDiagramArrowIndexes(flow, stepId)`.

- [ ] **Step 1: Write failing tests** for flow inventory, initial pending state, active/done/error transitions, and 1-based `stepMsgs` arrow lookup.
- [ ] **Step 2: Run** `cd demo_api_ui && npx vitest run src/components/oauthVisualizer/__tests__/oauthVisualizerModel.test.js`; expect missing-module failures.
- [ ] **Step 3: Port the supplied ZIP's flow metadata and step definitions** into plain dashboard-safe modules. Preserve the supplied flow IDs, names, RFC links, diagrams, and step message mappings; replace direct DOM writes with returned request/response/data/notes objects.
- [ ] **Step 4: Implement the immutable run model** so a step can be selected for preview, marked running, completed, skipped, or failed without exposing credentials to logs or unrelated dashboard stores.
- [ ] **Step 5: Run the focused test** and confirm it passes.
- [ ] **Step 6: Commit** `git add demo_api_ui/src/components/oauthVisualizer && git commit -m "feat: add OAuth visualizer flow model"`.

### Task 2: Build the visualizer panel and details model

**Files:**
- Create: `demo_api_ui/src/components/OAuthVisualizerPanel.jsx`
- Create: `demo_api_ui/src/components/OAuthVisualizerPanel.css`
- Create: `demo_api_ui/src/components/oauthVisualizer/MermaidFlowDiagram.jsx`
- Create: `demo_api_ui/src/components/oauthVisualizer/OAuthVisualizerDetails.jsx`
- Create: `demo_api_ui/src/components/__tests__/OAuthVisualizerPanel.test.jsx`

**Interfaces:**
- `OAuthVisualizerPanel({ instanceId, embedded, onRequestPopout })` renders a complete panel and owns selected flow, selected step, run state, theme mode, and font-size state.
- `MermaidFlowDiagram({ flow, activeStepId, theme, onRenderError })` renders the flow diagram and highlights `getDiagramArrowIndexes(flow, activeStepId)`.

- [ ] **Step 1: Write failing component tests** for flow selection, preview selection, run controls, step statuses, request/response/details tabs, and diagram error fallback.
- [ ] **Step 2: Run** `cd demo_api_ui && npx vitest run src/components/__tests__/OAuthVisualizerPanel.test.jsx`; expect failures because the components do not exist.
- [ ] **Step 3: Implement the panel shell** with a flow selector, diagram region, step list, run/start-over controls, details region, and visible light/dark plus A-/A+ controls.
- [ ] **Step 4: Implement Mermaid rendering** using the already-installed Mermaid dependency, scoped instance IDs, current `data-theme`, and arrow classes/data attributes rather than unsafe HTML interpolation.
- [ ] **Step 5: Implement details** for request, response, data, notes, and error states; render a high-contrast fallback when a diagram fails.
- [ ] **Step 6: Add responsive CSS** using existing theme tokens and the 10px floor; keep embedded and modal layouts usable without fixed viewport assumptions.
- [ ] **Step 7: Run the focused test** and confirm it passes.
- [ ] **Step 8: Commit** `git add demo_api_ui/src/components/OAuthVisualizerPanel.jsx demo_api_ui/src/components/OAuthVisualizerPanel.css demo_api_ui/src/components/oauthVisualizer/MermaidFlowDiagram.jsx demo_api_ui/src/components/oauthVisualizer/OAuthVisualizerDetails.jsx demo_api_ui/src/components/__tests__/OAuthVisualizerPanel.test.jsx && git commit -m "feat: render OAuth visualizer panel"`.

### Task 3: Wire four-way surfaces into Quick Config and dashboard hosts

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js`
- Modify: `demo_api_ui/src/components/UserDashboardPing2026.js`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/__tests__/AIAgent.chips.test.js`
- Create: `demo_api_ui/src/utils/__tests__/oauthVisualizerSurface.test.js`

**Interfaces:**
- Surface preference key: `ba_oauth_visualizer_surface`.
- Event: `oauth-visualizer-surface-change` with `{ surface }` detail.
- Existing `SURFACE_OPTIONS` remains the source of truth: `none`, `embedded`, `popout`, `both`.

- [ ] **Step 1: Add failing tests** covering default `none`, persistence, the four selector values, legacy-safe reload behavior, and event-driven embedded/pop-out visibility.
- [ ] **Step 2: Run focused tests** and confirm failure.
- [ ] **Step 3: Add state and selector wiring** to `AIAgent.js`, reusing `SurfaceSelector` and the existing Quick Config grouping; use label `OAuth Visualizer` and descriptive surface text so the menu explains embedded versus pop-out.
- [ ] **Step 4: Add the dashboard embedded host** in the same page region used by the other evidence surfaces, ensuring it does not cover Quick Config or the side nav.
- [ ] **Step 5: Add the pop-out host** through `DraggableModal`, with one launcher for `popout`/`both` and no duplicate modal when the embedded view is also visible.
- [ ] **Step 6: Add conflict/layout guards** so the visualizer and Sequence View/Token Topology do not claim the same embedded slot simultaneously; pop-outs remain independently available.
- [ ] **Step 7: Run focused tests** and confirm they pass.
- [ ] **Step 8: Commit** the explicit modified/test paths with `git commit -m "feat: add OAuth visualizer surfaces"`.

### Task 4: Theme, font-size, accessibility, and regression coverage

**Files:**
- Modify: `demo_api_ui/src/components/OAuthVisualizerPanel.jsx`
- Modify: `demo_api_ui/src/components/OAuthVisualizerPanel.css`
- Create: `demo_api_ui/src/components/__tests__/OAuthVisualizerPanel.theme.test.jsx`
- Modify: `demo_api_ui/src/components/__tests__/DraggableModal.test.jsx` only if modal behavior needs a focused regression assertion.

- [ ] **Step 1: Write failing tests** for both themes, `☀️`/`🌙` mode control, font-size minimum/maximum clamping, keyboard operation, and modal close/reopen preservation.
- [ ] **Step 2: Implement shared `useThemeOptional()` integration** and local font-size preference under `ba_oauth_visualizer_font_scale`; apply only layout classes/CSS variables through class names, not themeable inline styles.
- [ ] **Step 3: Add accessible labels, focus order, keyboard activation, and live status text** for running/current/failed steps.
- [ ] **Step 4: Run focused theme tests** and confirm they pass.
- [ ] **Step 5: Run the required UI checks:**
  - `cd demo_api_ui && npm run test:unit`
  - `cd demo_api_ui && npm run build`
  - `npm run topology:verify` if the integration changes topology/configured routes.
- [ ] **Step 6: Run `graphify update .` from the worktree and inspect `git diff --check` plus the focused diff. Verify the touched panel in both themes with computed styles/contrast checks.
- [ ] **Step 7: Commit** `git add` only the intended UI/test paths and `git commit -m "test: cover OAuth visualizer themes and accessibility"`.

### Task 5: Review and integration handoff

**Files:**
- Modify only files identified by review findings.

- [ ] **Step 1: Run `git status --short --branch` and confirm the feature worktree is clean except intended changes.
- [ ] **Step 2: Run the focused UI tests/build again after any review fixes.
- [ ] **Step 3: Use `requesting-code-review` to review the branch against the spec, especially token custody, surface conflicts, modal behavior, and the Quick Config menu.
- [ ] **Step 4: Push the feature branch and report the commit, test/build evidence, and deployment readiness. Merge/deploy only after the branch review and the user’s explicit integration instruction.**
