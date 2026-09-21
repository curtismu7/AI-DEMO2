# Agent Trust Navigation and Privilege Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the side navigation, Demo Steps groups, and search vocabulary with the ID4AI maturity journey while making PingOne Privilege a first-class capability.

**Architecture:** Keep the current route topology and live execution handlers. Add shared presentation metadata for maturity groups, Privilege lanes, and search aliases; consume it in Demo Steps and use targeted naming changes in the side-nav catalog. Privilege remains a cross-cutting enforcement capability, alongside—not inside—the five-stage Discover, Register, Authenticate, Authorize, Govern journey.

**Tech Stack:** React, React Router, Vitest, Vite, existing navigation catalog and use-case catalog.

**Spec:** `/Users/cmuir/Downloads/ID4AI - Maturity Model - Architecture 501.pdf`

## Global Constraints

- Preserve all existing routes, route ownership, and live Demo Steps handlers.
- Use the canonical local browser origin; do not add localhost OAuth redirects.
- UI changes require `cd demo_api_ui && npm run build`.
- Preserve the project emoji allowlist.
- Generated use-case/topology artifacts must not be hand-edited.
- Work only in the isolated worktree and stage only intended paths.

### Task 1: Shared journey and Privilege presentation metadata

**Files:**
- Modify: `demo_api_ui/src/config/demoUseCaseSteps.js`
- Test: `demo_api_ui/src/config/__tests__/demoUseCaseSteps.test.js`

- [x] Add a `PRIVILEGE_USE_CASE_IDS` list for existing runnable or linked Privilege lanes: `UC17`, `UC25`, `UC40`, `UC-PAM-SETUP`, `UC-PAM-SCRIPT`, `UC-LEARN11`, and `UC-TOOL3`.
- [x] Add search aliases for JIT, ephemeral credentials, secretless access, approval, session recording, kill switch, Privilege MCP Gateway, and Privilege AI.
- [x] Add tests asserting the Privilege list and representative aliases.
- [x] Run the config test and confirm it fails before the implementation and passes after it.

### Task 2: Demo Steps Privilege group

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx`
- Modify: `demo_api_ui/src/components/AIAgent.css`
- Test: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`

- [x] Add a `Privilege & JIT Access` filter chip beside the maturity groups.
- [x] Load Privilege rows from the same `/api/use-cases` catalog and reuse the existing `handleSelect`/`onSelect` path.
- [x] Display the group with a clear description: temporary access, approvals, privileged MCP, session recording, and revocation.
- [x] Add tests that select the group, reveal the Privilege rows, and run one row through the existing handler.
- [x] Run the focused Demo Steps suite and verify the default All view remains in the original script order.

### Task 3: Side-nav naming and group alignment

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/config/navPagePaths.js` only if labels change there
- Test: existing navigation tests plus targeted side-nav tests if present

- [x] Rename customer-facing groups without changing their IDs or paths: `Demos` → `Agent Trust Journey`, `AI Flows` → `Agent Lifecycle & Flows`, `AI-Gateway` → `Agent Security & Enforcement`, `Monitoring` → `Evidence & Audit`, `Telemetry` → `Runtime Observability`, `Learn & Present` → `Learn & Architecture`.
- [x] Consolidate or relabel overlapping MCP entries as `MCP & Agent Gateways` while preserving each child path.
- [x] Add a first-class `Privilege & JIT Access` group containing existing Privilege demo, MCP gateway, AI gateway, learning, diagram, and preview routes.
- [x] Add agent-type naming where existing routes support it: Employee Agents, Consumer & Partner Agents, Workload Agents, and SaaS-Embedded Agents (preview/future where no live route exists).
- [x] Update auto-expand section IDs/path mappings if labels change, without breaking persisted expansion state.
- [x] Run side-nav tests, `npm run authz:verify`, and `npm run topology:verify` if route/catalog surfaces are affected.

### Task 4: End-to-end verification and documentation

**Files:**
- Modify: `docs/use-cases/ciam-agent-types-demo.md` if operator instructions reference old group names
- Modify: this plan, marking completed steps

- [x] Run the focused UI tests, full relevant UI tests, production build, `git diff --check`, and navigation/topology checks.
- [x] Verify no route strings changed unintentionally.
- [x] Update operator instructions with the new Demo Steps group names and search examples.
- [x] Report the final group names and any intentionally preview-only Privilege or SaaS-Embedded entries.
