# Digital Worker demo (live run + visible autonomy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/digital-worker` from an editable diagram into the "assistant vs worker" demo page: a governed live worker run (UC38), a visible unattended-run moment (arm → fire → replay → approve), and the contrast framing in page copy, nav, and Learning Hub.

**Architecture:** Zero server changes — every endpoint already exists. The page gains two sections under the existing diagram editor: (A) a governed run that mounts `PersonalAgentStudioPage` exactly the way `WorkloadAgentsPage` does (UC38: wire transfer, step-up MFA, HITL), and (B) a new self-contained `DigitalWorkerRunPanel` driving the existing `/api/autonomous-runs` endpoints, replaying runs into `TokenChainFilmstrip` via `replayUnattendedRun`. Learning surfaces wired through `pageGuides` + `lessonCatalog` + a Learning Hub card.

**Tech Stack:** React JSX (existing CRA app), vitest + @testing-library/react, existing demo components only. No new dependencies.

**Spec:** Session audit 2026-10-20 (conversation). Spec points, all covered below: (1) one-line assistant-vs-worker contrast on the page, (2) a live worker run behind `/digital-worker` (page was diagram-only), (3) a visible autonomy moment (scheduler existed with no UI surface), (4) Learning Hub card + nav relabel ("Digital Worker Diagram" → "Digital Worker").

## Global Constraints

- **No server-side changes.** If a step appears to need one, stop and surface — the endpoints below are final.
- No new npm dependencies; reuse only components already imported by `WorkloadAgentsPage.jsx` / `AutonomousAgentsPage.jsx`.
- The diagram editor's behavior (edit boxes/edges, autosave to browser, Simulate, Reset) is untouched.
- Styling reuses the page's existing `dw-*` classes and app conventions; no new design tokens, no purple.
- `/digital-worker` stays public (matches `/autonomous-agents` and the documented public run routes); all fetches use `credentials: 'include'`.
- Execute in a git worktree off main (the main checkout is shared by concurrent sessions); one commit per task; merge only after CI green.

## Review Focus

1. **Trigger while auto-disarmed/revoked** — `POST /run` returns `{ run: null }`; panel must show the disarmed fallback and return to the arm state, never a spinner. (Task 1 test)
2. **Another viewer disarms mid-session** — `GET /flag` and run calls return 403 `feature_disabled`; panel renders the unarmed state, no crash. (Task 1 test)
3. **Approve/deny on an expired parked run** — route errors; panel refetches the list and shows current state, no stuck button. (Task 1 test)
4. **Guest/kiosk render** — page and both new sections mount and fetch with no signed-in user. (Task 2 test)
5. **Studio mount parity** — `PersonalAgentStudioPage` must receive the same props `WorkloadAgentsPage` passes (`scenario`, `vertical`, `runNonce`) or the run silently no-ops. (Task 2 test)

---

### Task 1: `DigitalWorkerRunPanel` (unattended-run panel)

**Files:**
- Create: `demo_api_ui/src/pages/DigitalWorkerRunPanel.jsx`
- Test: `demo_api_ui/src/pages/__tests__/DigitalWorkerRunPanel.test.jsx`

**Interfaces:**
- Produces: default export `DigitalWorkerRunPanel()` — no props, self-fetching. Owns its heading: "Unattended: the worker starts itself".
- Consumes (exact endpoints, all existing):
  - `GET /api/autonomous-runs/flag` → `{ flag, enabled }`
  - `POST /api/autonomous-runs/flag` body `{ enabled: boolean }` → `{ flag, enabled, armExpiresInMs }`
  - `POST /api/autonomous-runs/run` body `{ job }` → `{ run }` (`run` is `null` when disabled/revoked)
  - `GET /api/autonomous-runs?limit=5` → `{ runs: [...] }`
  - `GET /api/autonomous-runs/:runId` → `{ run }` (full record incl. `tokenEvents`)
  - `POST /api/autonomous-runs/:runId/approve` and `/deny` → `{ run }`
- Consumes: `replayUnattendedRun` from `../services/tokenChainTrace/replayUnattendedRun`; `TokenChainFilmstrip` (same import paths `AutonomousAgentsPage.jsx` uses). Run-record field names (esp. the parked-status field): mirror the run fixtures in `demo_api_server/src/__tests__/autonomousRevocation.test.js` — verify there before writing the approve/deny branch.

- [ ] **Step 1: Write the failing test**

Vitest + @testing-library, fetch-stub style mirrored from `demo_api_ui/src/pages/__tests__/WorkloadAgentsPage.test.jsx`. Assertions:

- `renders arm switch when flag disabled` — GET `/flag` → `{ flag: 'ff_autonomous_agents', enabled: false }`; expect the arm switch and heading, no run list.
- `arming posts the flag and shows the TTL` — click arm → POST `/flag` `{ enabled: true }` called; shows "auto-disarms in 60 min" derived from `armExpiresInMs` (3600000).
- `enabled panel offers job select and fire button` — shows a select with `fraud-watch` and `balance-sweep` (default `balance-sweep`) and button "Fire without a human turn"; click → POST `/run` `{ job: 'balance-sweep' }`; with response `{ run: { id: 'r1', ...fixture } }` the panel fetches nothing extra and renders replayed steps in `TokenChainFilmstrip`.
- `null run falls back to disarmed` — POST `/run` → `{ run: null }`; expect "worker auto-disarmed" message and the arm switch again.
- `403 renders unarmed state` — GET `/flag` → 403 `{ error: 'feature_disabled' }`; expect arm switch, no crash.
- `parked run shows approve and deny` — run with the parked-status field from the server fixture; Approve click → POST `/:id/approve`; on rejection, the run list is refetched and no button hangs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerRunPanel.test.jsx`
Expected: FAIL — cannot resolve `DigitalWorkerRunPanel`.

- [ ] **Step 3: Implement `DigitalWorkerRunPanel.jsx`**

Layout in order: heading, arm switch + TTL line, job select + "Fire without a human turn" (only when enabled), latest run rendered via `replayUnattendedRun(run)` → `TokenChainFilmstrip`, run list (limit 5, click loads full run via `GET /:runId`), parked approve/deny. All run-list calls happen only when `enabled === true` (everything under the flag gate 403s otherwise).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerRunPanel.test.jsx`
Expected: PASS (all six).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/DigitalWorkerRunPanel.jsx demo_api_ui/src/pages/__tests__/DigitalWorkerRunPanel.test.jsx
git commit -m "feat: unattended-run panel for digital worker page

```

---

### Task 2: Wire `/digital-worker` — contrast copy + live run + panel + nav

**Files:**
- Modify: `demo_api_ui/src/pages/DigitalWorkerPage.jsx` (insert sections inside `.dw-page`, after the canvas `</div>` at line ~284)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx:1368-1372`
- Test: `demo_api_ui/src/pages/__tests__/DigitalWorkerPage.test.jsx` (extend)

**Interfaces:**
- Consumes: `DigitalWorkerRunPanel` (Task 1); `PersonalAgentStudioPage` mounted as `{ scenario, vertical, runNonce }` exactly as `WorkloadAgentsPage.jsx:96-99`; use-case loading mirrored from `WorkloadAgentsPage.jsx:34-50` (`GET /api/verticals/list`, then `GET /api/use-cases/:id?vertical=...`) targeting **uc38**.
- Copy (exact, spec-fixed):
  - Lede under the existing title: "An assistant answers questions. A worker takes action — it holds delegated identity, spends it across tools, and every action is governed."
  - Section A heading: "Governed worker run"; sub-line: "UC38 · wire transfer with step-up MFA and HITL"; button: "Run worker task".
- Nav entry: `label: "Digital Worker"`, `searchAlias` gains ` live run autonomous arm uc38` (keep existing terms).

- [ ] **Step 1: Extend the failing test**

In `DigitalWorkerPage.test.jsx` (renders with **no user prop** — Review Focus 4):
- page renders the lede and the "Governed worker run" heading;
- clicking "Run worker task" performs the two use-case fetches (mocked, uc38 + its vertical) and renders `PersonalAgentStudioPage` with truthy `scenario` and `vertical` props and a `runNonce` that increments on a second click (Review Focus 5);
- `DigitalWorkerRunPanel` is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerPage.test.jsx`
Expected: FAIL — no lede / no run section.

- [ ] **Step 3: Implement**

Add the lede `<p>`, section A (button → mirror WorkloadAgentsPage's scenario loading and studio mount, `runNonce` incremented per click), section B `<DigitalWorkerRunPanel />`; update the nav entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerPage.test.jsx`
Expected: PASS (existing diagram tests still green — editor untouched).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/DigitalWorkerPage.jsx demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/pages/__tests__/DigitalWorkerPage.test.jsx
git commit -m "feat: live worker run + unattended panel on /digital-worker

```

---

### Task 3: Learning surfaces (PageGuide, lesson, Hub card)

**Files:**
- Modify: `demo_api_ui/src/config/pageGuides.js`
- Modify: `demo_api_ui/src/learning/lessonCatalog.js`
- Modify: `demo_api_ui/src/components/LearningHub.tsx`
- Test: `demo_api_ui/src/pages/__tests__/DigitalWorkerPage.test.jsx` (extend — config files are plain data, so assert them there)

**Interfaces:**
- `PAGE_GUIDES["/digital-worker"] = { title: "Digital worker", lessons: ["digital-worker-live"] }`
- Lesson entry mirrors the field set of the `agent-landscape` entry (`lessonCatalog.js:154-172`), pinned values: `id: "digital-worker-live"`, `title: "Digital worker vs digital assistant"`, `standaloneRoute: "/digital-worker"`, `category: "AI concepts"`, `run: { action: "ai-architecture", exposesRawBearerToken: false, result: REDACTED_RESULT }`, `talkingPoints: ["An assistant answers; a worker acts — and spends delegated identity", "Unattended runs need a dead-man switch, revocation, and audit", "Same governance rails as attended runs: tokens, consent, HITL"]`. Other fields (audience, maturityStages, fallback) copied from the `agent-landscape` exemplar.
- Hub card: add item `{ label: "Digital Worker: live run" }` to the `LEARNING_CATEGORIES` category that already contains the Workload Agents item, plus the action-map entry `"Digital Worker: live run": () => navigate("/digital-worker")` in that category's map (`LearningHub.tsx` ~lines 637-700).

- [ ] **Step 1: Extend the failing test**

In `DigitalWorkerPage.test.jsx`, import `{ PAGE_GUIDES }` from `../../config/pageGuides` and `{ lessonCatalog }` from `../../learning/lessonCatalog`; assert `PAGE_GUIDES["/digital-worker"].lessons` contains `"digital-worker-live"` and a lesson with that id exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerPage.test.jsx`
Expected: FAIL — entries absent.

- [ ] **Step 3: Implement the three file edits per Interfaces**

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/pageGuides.js demo_api_ui/src/learning/lessonCatalog.js demo_api_ui/src/components/LearningHub.tsx demo_api_ui/src/pages/__tests__/DigitalWorkerPage.test.jsx
git commit -m "feat: learning surfaces for digital worker demo

```

---

### Task 4: Verification + PR

- [ ] **Step 1: Full touched-suite run**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DigitalWorkerPage.test.jsx src/pages/__tests__/DigitalWorkerRunPanel.test.jsx`
Expected: PASS.

- [ ] **Step 2: Manual smoke (serve-worktree)**

`scripts/serve-worktree.sh here`, then in the browser on `/digital-worker`: three sections render; diagram editing + Simulate still work; "Run worker task" runs UC38 through MFA/HITL; arm → fire → filmstrip replays the run; disarm returns the panel to the arm state; no console errors.

- [ ] **Step 3: Push, open PR, merge after CI green**

PR description ends with the Claude Code attribution line. Merge only after CI is green.
