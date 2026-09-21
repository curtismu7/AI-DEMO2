# Academy Personal-Agent Client Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect LibreChat and LM Studio to the existing Personal Agent Academy experience, with grouped client cards, security chips, and side-nav entries.

**Architecture:** Add one immutable client catalog consumed by a focused Personal Agent client panel and by navigation metadata. Reuse `/personal-agent` for the client overview, open LibreChat externally, and route LM Studio to the existing MCP/Privilege setup surface with a `client=lm-studio` context. No new backend or external-client runtime is introduced.

**Tech Stack:** React, React Router, Vitest, Testing Library, existing CSS custom properties and AdminSideNav catalogs.

**Spec:** `docs/superpowers/specs/2026-09-21-academy-personal-agent-clients-design.md`

## Global Constraints

- Use the canonical browser origin and existing routes; do not add localhost OAuth redirects.
- Keep browser tokens in the BFF; this slice adds no token-handling code.
- Preserve the existing Personal Agent route and the LibreChat external URL behavior.
- Use only the repository emoji allowlist; prefer text labels for new UI.
- After UI edits run focused Vitest tests and `npm run build`.
- Run `graphify update .` after code edits.

### Task 1: Define the personal-agent client catalog

**Files:**
- Create: `demo_api_ui/src/config/personalAgentClients.js`
- Create: `demo_api_ui/src/config/__tests__/personalAgentClients.test.js`

**Interfaces:**
- Produces `PERSONAL_AGENT_CLIENTS`, an immutable array with `id`, `label`, `runtime`, `kind`, `description`, `chips`, and either `externalUrl` or `setupPath`.

- [ ] Write a failing test asserting the two client records and their distinct launch modes.
- [ ] Run `cd demo_api_ui && npm run test:unit -- --run src/config/__tests__/personalAgentClients.test.js`; confirm it fails because the catalog does not exist.
- [ ] Add the two records and freeze their nested arrays.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit: `git add demo_api_ui/src/config/personalAgentClients.js demo_api_ui/src/config/__tests__/personalAgentClients.test.js && git commit -m "feat: catalog personal agent clients"`

### Task 2: Add grouped client cards and security chips

**Files:**
- Create: `demo_api_ui/src/components/learning/PersonalAgentClientCards.jsx`
- Create: `demo_api_ui/src/components/learning/PersonalAgentClientCards.css`
- Create: `demo_api_ui/src/components/learning/__tests__/PersonalAgentClientCards.test.jsx`
- Modify: `demo_api_ui/src/pages/PersonalAgentStudioPage.jsx`

**Interfaces:**
- `PersonalAgentClientCards` accepts optional `onLaunch` and renders a `Personal agent clients` region with one card per catalog entry.
- External launch uses `window.open(externalUrl, "_blank", "noopener,noreferrer")`.
- Setup launch uses a React Router `Link` to the catalog `setupPath`.

- [ ] Write tests for headings, runtime labels, security chips, LibreChat external launch, and LM Studio setup link.
- [ ] Run the focused test and confirm it fails because the component is missing.
- [ ] Implement the cards with grouped sections for `Browser personal agent` and `Mac personal agent`.
- [ ] Add themeable CSS using existing `--th-*`/application tokens; avoid inline color, background, and font-size styles.
- [ ] Render the panel in Personal Agent Studio below the header and above the agent interaction surface.
- [ ] Run focused component and existing Personal Agent tests; confirm green.
- [ ] Commit: `git add demo_api_ui/src/components/learning demo_api_ui/src/pages/PersonalAgentStudioPage.jsx && git commit -m "feat: show personal agent client choices"`

### Task 3: Wire side-nav groups and Demo Config catalogs

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/config/navPagePaths.js`
- Modify: `demo_api_ui/src/components/DemoConfigPage.js`
- Modify: `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx`

**Interfaces:**
- `LibreChat (browser)` remains an external action to `http://localhost:3080`.
- `LM Studio (Mac)` links to `/privilege-mcp-client?client=lm-studio`.

- [ ] Add failing navigation assertions for both labels, search aliases, action/link targets, and catalog presence.
- [ ] Run the focused nav tests and confirm they fail.
- [ ] Update the Learn & Present group and matching catalogs/action-path maps.
- [ ] Run nav/config tests and confirm green.
- [ ] Commit: `git add demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/config/navStructureCatalog.js demo_api_ui/src/config/navPagePaths.js demo_api_ui/src/components/DemoConfigPage.js demo_api_ui/src/components/__tests__/adminSideNav.test.jsx && git commit -m "feat: add personal agent clients to navigation"`

### Task 4: Verify, graph, and hand off

**Files:**
- Modify only generated graph output through `graphify update .`.

- [ ] Run `cd demo_api_ui && npm run test:unit`.
- [ ] Run `cd demo_api_ui && npm run build`.
- [ ] Run `npm run authz:verify` if navigation route metadata affects auth checks.
- [ ] Run `graphify update .` and inspect the result.
- [ ] Run `git diff --check` and verify only intended files are changed.
- [ ] Report the exact route and external launch behavior; do not claim native LM Studio launch from a browser.
