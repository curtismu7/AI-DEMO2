# Academy Learning Hub and Live Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI Security Academy discoverable from the Learning Hub, validate the merged experience in the local stack, and connect remaining demo scenarios only to safe, scenario-relevant evidence observations.

**Architecture:** Keep the existing Academy route and lesson catalog as the shared source of demo links. Add a themed Learning Hub entry section that links to the guided journey and standalone launcher. Extend the existing read-only lesson observation service with explicit scenario evidence actions; when no safe direct observation exists, retain the launcher link and show a bounded limitation instead of claiming a live result.

**Tech Stack:** React 19, Vite 8, Vitest, Playwright, Express read-only GET endpoints, existing `apiClient`, CSS theme tokens, local Docker stack.

**Spec:** User request: execute the Learning Hub entry, local validation, and remaining scenario evidence wiring in that order.

## Global Constraints

- Work only in the isolated `codex/academy-next` worktree and stage explicit paths.
- Do not change OAuth, sessions, browser token custody, authorization enforcement, agent placement, or protected BFF boundaries.
- Preserve the project emoji allowlist and use `--th-*` theme tokens for new Learning Hub styles.
- Evidence checks remain read-only snapshots; never invent a completed lesson action or expose credential material.
- After UI changes, run focused Vitest tests, `npm run test:unit`, and `npm run build`.
- Validate the live UI on `https://local.ping-devops.com:4000` only after pinning stack generation before and after the browser drive.

### Task 1: Add the Academy entry to Learning Hub

**Files:**
- Modify: `demo_api_ui/src/components/LearningHub.tsx`
- Modify: `demo_api_ui/src/components/LearningHub.css`
- Test: `demo_api_ui/src/components/__tests__/LearningHub.trainingPath.test.tsx`

**Interfaces:**
- Consumes: existing `/academy/journey` and `/academy/demos` routes.
- Produces: visible “AI Security Academy” entry with guided and standalone links, rendered when the Learning Hub search is empty.

- [x] **Step 1: Write the failing test**

Add assertions that the Learning Hub renders the Academy entry, links to `/academy/journey` and `/academy/demos`, and preserves both light/dark theme labels.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/LearningHub.trainingPath.test.tsx`

Expected: FAIL because the new Academy entry is not present.

- [x] **Step 3: Implement the minimal themed entry**

Add a semantic section in `LearningHub.tsx` with two React Router links and add only the corresponding tokenized rules in `LearningHub.css`. Keep it outside filtered topic cards so search behavior remains unchanged.

- [x] **Step 4: Run the focused test and verify it passes**

Run the same focused Vitest command. Expected: PASS.

- [x] **Step 5: Commit Task 1**

```bash
git add demo_api_ui/src/components/LearningHub.tsx demo_api_ui/src/components/LearningHub.css demo_api_ui/src/components/__tests__/LearningHub.trainingPath.test.tsx
git commit -m "feat(learning): add Academy entrypoint to Learning Hub"
```

### Task 2: Start and validate the merged local experience

**Files:**
- No product source changes unless validation exposes a real defect.
- Test artifact: `/private/tmp/academy-next-live-check.py` (temporary, untracked).

**Interfaces:**
- Consumes: merged main checkout served through the canonical local origin.
- Produces: browser evidence that the Learning Hub entry, side-nav search, guided journey, and standalone launcher render and link correctly.

- [x] **Step 1: Check the serving owner and stack generation**

Run: `npm run serve:worktree status` and `gen="$(npm run -s stack:generation)"`. If the stack is stopped, start the local Docker stack from the main checkout using the repository’s supported runner, then capture a fresh generation.

- [x] **Step 2: Run a Playwright reconnaissance check**

Navigate to `https://local.ping-devops.com:4000/learning`, wait for the app shell to settle, inspect the rendered DOM, and confirm the Academy links and Learning Hub search field. Then inspect the side nav and search for `standalone demos`.

- [x] **Step 3: Exercise the routes**

Open `/academy/journey` and `/academy/demos`, confirm their headings and navigation links, and record console/page errors. Do not run mutating demo actions during this pass.

- [x] **Step 4: Recheck stack generation**

Run `npm run -s stack:generation -- --check "$gen"`. A non-zero result invalidates the browser findings and requires repeating the drive.

- [x] **Step 5: Run the Learning Hub contrast audit**

Use the repository’s existing contrast-audit workflow against the Learning Hub in both light and dark themes. Confirm H1 ink/ground, readable CTA text, and no font below the 10px token floor.

### Task 3: Wire remaining scenarios to direct or bounded evidence

**Files:**
- Modify: `demo_api_ui/src/pages/StandaloneDemoLauncherPage.jsx`
- Modify: `demo_api_ui/src/services/lessonExecutionService.js`
- Modify: `demo_api_ui/src/components/learning/DemoCard.jsx`
- Test: `demo_api_ui/src/__tests__/StandaloneDemoLauncherPage.test.jsx`
- Test: `demo_api_ui/src/__tests__/lessonExecutionService.test.js`

**Interfaces:**
- Consumes: existing safe GET contracts such as `/api/authorize/pingone-live-policy`, `/api/token-chain`, `/api/agent/identity/status`, `/api/privilege-mcp-simple/status`, and `/api/davinci-login/session-status`.
- Produces: explicit `evidenceAction` scenario metadata, normalized observation results, and disabled evidence controls for scenarios whose live action would require a mutating or unavailable endpoint.

- [x] **Step 1: Write failing mapping and normalization tests**

Add cases for direct evidence mappings: Authorize denial uses recent decision evidence, CIBA uses approval activity evidence, agent revocation uses lifecycle status evidence, Privilege MCP uses relay readiness evidence, DaVinci uses session-status evidence, and audit evidence uses the existing cumulative trace contract. Assert that every mapping is either supported by a normalizer or deliberately disabled with an explanatory detail.

- [x] **Step 2: Run focused tests and verify the new expectations fail**

Run: `cd demo_api_ui && npx vitest run src/__tests__/StandaloneDemoLauncherPage.test.jsx src/__tests__/lessonExecutionService.test.js src/__tests__/LessonShell.test.jsx src/__tests__/GuidedJourneyPage.test.jsx`

Expected: FAIL because the new scenario actions and endpoint normalizers do not exist.

- [x] **Step 3: Implement the smallest read-only observation adapters**

Extend `OBSERVATION_ENDPOINTS` and `OBSERVATION_NORMALIZERS`, keeping `runLesson` action validation strict. Add counts/status fields that describe exactly what was observed. Do not add POST calls, mutate tenant state, or label readiness as proof of a completed scenario action.

- [x] **Step 4: Implement scenario availability and UI copy**

Set `evidenceAction` only for mappings backed by direct observations. Keep unsupported threat-defense or product-path actions disabled with a clear “Launch demo” path. Use “Check live evidence” and “read-only snapshot” language consistently.

- [x] **Step 5: Run focused tests and verify they pass**

Run the focused command from Step 2. Expected: PASS with no unrelated endpoint calls.

- [x] **Step 6: Run the full UI verification**

Run: `cd demo_api_ui && npm run test:unit && npm run build`

Then run from the repository root: `npm run authz:verify`, `npm run topology:verify`, `npm run hygiene:check`, `git diff --check`, and `graphify update .`.

- [x] **Step 7: Commit Task 3 and prepare review**

```bash
git add demo_api_ui/src/pages/StandaloneDemoLauncherPage.jsx demo_api_ui/src/services/lessonExecutionService.js demo_api_ui/src/components/learning/DemoCard.jsx demo_api_ui/src/components/learning/LessonShell.jsx demo_api_ui/src/pages/GuidedJourneyPage.jsx demo_api_ui/src/routes/AcademyRoutes.jsx demo_api_ui/src/__tests__/StandaloneDemoLauncherPage.test.jsx demo_api_ui/src/__tests__/lessonExecutionService.test.js demo_api_ui/src/__tests__/LessonShell.test.jsx demo_api_ui/src/__tests__/GuidedJourneyPage.test.jsx
git commit -m "feat(academy): connect remaining scenario evidence"
```
