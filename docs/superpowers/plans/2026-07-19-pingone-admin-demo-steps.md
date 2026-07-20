# PingOne Admin Demo Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Post-merge status (2026-07-19):** All 4 tasks shipped and are live-verified for what they cover — the 400 is fixed, the popout renders 4 real steps with a working "0 of 4 done" tracker, and the banking vertical (and all 9 pre-existing verticals) is unaffected. **However**, clicking a step does NOT reach the admin agent yet: live testing found that the demo-step click path (`AIAgent.js`'s `nlResumeAfterAuth` effect → `/api/agent/invoke`) unconditionally calls the customer/banking agent backend regardless of vertical, so it dead-ends in a "log in as a customer" guard card instead of the admin agent's tool-backed reply. This is a **pre-existing routing defect in unchanged code** (`demo_api_ui/src/components/AIAgent.js`, `demo_api_server/services/demoAgentService.js`) — none of this branch's 4 files participate in endpoint selection — and it also affects free-text typed into the admin agent's chat box, not just demo steps. Shipped anyway as the incremental "fix the 400 + render real steps" slice; routing the admin vertical's messages to `POST /api/admin-agent/message` is tracked as a separate follow-up (touches protected agent-routing code, needs its own scoping).

**Goal:** Fix `GET /api/use-cases?vertical=pingone-admin` 400ing, and give the PingOne Admin AI Agent's "Demo steps" button a real 4-step scripted walkthrough.

**Architecture:** A small standalone list of `{id, title, trigger}` entries served by a new branch in the existing `GET /api/use-cases` route (bypassing the 22-use-case banking catalog entirely), consumed by the existing generic `DemoStepsDropdown` component via a vertical-aware id-list switch.

**Tech Stack:** Express (demo_api_server), React + Vite (demo_api_ui), Jest (backend tests), Vitest + Testing Library (frontend tests).

## Global Constraints

- Do not modify `config/useCases.js`'s `VERTICALS` array or the 22-use-case catalog — the admin steps are a parallel, separate list.
- Do not add tokenChain/evidence/OWASP/codeRefs metadata to admin steps — out of scope per spec (admin agent has no consent/HITL gate to demo).
- No "advanced" step group for admin — 4 steps is the whole script.
- Emoji allowlist only if any UI copy is touched: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` (this plan adds no new UI copy needing emoji, but flagging per REGRESSION_PLAN §0).
- Worktree is at `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/feat-pingone-admin-demo-steps`, branch `worktree-feat-pingone-admin-demo-steps`. All commands below assume this cwd unless stated otherwise.
- This worktree has no `node_modules` (lockfiles are gitignored repo-wide). Task 1's first step symlinks both service dirs to the main checkout's `node_modules`.
- Jest run from inside `.claude/worktrees/` is excluded by `testPathIgnorePatterns` in `jest.config.js` — always pass `--testPathIgnorePatterns="/node_modules/"` on the CLI to override it.

---

### Task 1: Backend — admin demo-steps data + route branch

**Files:**
- Create: `demo_api_server/config/admin/demoSteps.js`
- Modify: `demo_api_server/routes/useCases.js`
- Test: `demo_api_server/src/__tests__/useCases.route.test.js`

**Interfaces:**
- Produces: `ADMIN_DEMO_STEPS` — a frozen array of 4 objects, each
  `{ id: string, title: string, trigger: { type: 'chip', text: string } }`,
  exported from `demo_api_server/config/admin/demoSteps.js` as a named export.
  This is the exact shape `DemoStepsDropdown` (Task 4) and `handleDemoStepSelect`
  in `AIAgent.js` already read (`uc.id`, `uc.title`, `uc.trigger.type`,
  `uc.trigger.text`) — no other fields are read for a `chip`-type step.

- [ ] **Step 1: Symlink node_modules so tests can run in this worktree**

```bash
ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules demo_api_server/node_modules
```

- [ ] **Step 2: Write the failing test**

Append to `demo_api_server/src/__tests__/useCases.route.test.js`, inside the
existing `describe('GET /api/use-cases', ...)` block (after the
`'rejects an unknown vertical with 400'` test, before `'GET /:id returns...'`):

```js
  test('serves the standalone admin demo-steps list for vertical=pingone-admin', async () => {
    const res = await request(makeApp()).get('/api/use-cases?vertical=pingone-admin');
    expect(res.status).toBe(200);
    expect(res.body.vertical).toBe('pingone-admin');
    expect(res.body.useCases).toHaveLength(4);
    expect(res.body.useCases[0]).toEqual({
      id: 'ADMIN1',
      title: 'List applications',
      trigger: { type: 'chip', text: 'List all PingOne applications in this environment' },
    });
    expect(res.body.useCases.map((u) => u.id)).toEqual(['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4']);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/useCases.route.test.js --testPathIgnorePatterns="/node_modules/" -t "pingone-admin"`
Expected: FAIL — `expected 400 to be 200` (route doesn't know `pingone-admin` yet).

- [ ] **Step 4: Create the admin demo-steps data file**

Create `demo_api_server/config/admin/demoSteps.js`:

```js
'use strict';

/**
 * Minimal scripted walkthrough for the PingOne Admin AI Agent's "Demo
 * steps" button. Deliberately NOT part of the 22-use-case banking
 * trust-ladder catalog in config/useCases.js — the admin agent has no
 * consent/HITL gate or tokenChain evidence narrative to attach, just
 * plain NL prompts against the live PingOne MCP tool set
 * (see services/adminAgentService.js).
 */
const ADMIN_DEMO_STEPS = [
  {
    id: 'ADMIN1',
    title: 'List applications',
    trigger: { type: 'chip', text: 'List all PingOne applications in this environment' },
  },
  {
    id: 'ADMIN2',
    title: 'Look up a user',
    trigger: { type: 'chip', text: 'Look up the user demouser' },
  },
  {
    id: 'ADMIN3',
    title: 'List populations',
    trigger: { type: 'chip', text: 'List populations in this environment' },
  },
  {
    id: 'ADMIN4',
    title: 'Reset a password',
    trigger: { type: 'chip', text: 'Reset the password for demouser' },
  },
];

module.exports = { ADMIN_DEMO_STEPS };
```

- [ ] **Step 5: Wire the route branch**

In `demo_api_server/routes/useCases.js`, add the require after the existing
`config/useCases` require (line 12):

```js
const { listUseCases, resolveUseCase, VERTICALS } = require('../config/useCases');
const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const { authenticateToken } = require('../middleware/auth');
```

Then change the `GET /` handler (currently lines 24-30) to branch before
`pickVertical`:

```js
// GET /api/use-cases  → list
router.get('/', (req, res) => {
  if (req.query.vertical === 'pingone-admin') {
    res.set({ 'Cache-Control': 'private, max-age=60' });
    return res.json({ vertical: 'pingone-admin', useCases: ADMIN_DEMO_STEPS });
  }
  const vertical = pickVertical(req, res);
  if (!vertical) return;
  res.set({ 'Cache-Control': 'private, max-age=60' });
  res.json({ vertical, useCases: listUseCases(vertical) });
});
```

`GET /:id` and `pickVertical` are untouched — `pingone-admin` is still not in
`VERTICALS`, and nothing else routes through it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/useCases.route.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS, all tests in the file (the 5 pre-existing + the 1 new one).

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/config/admin/demoSteps.js demo_api_server/routes/useCases.js demo_api_server/src/__tests__/useCases.route.test.js
git commit -m "feat(pingone-admin): serve standalone demo-steps list for vertical=pingone-admin"
```

---

### Task 2: Frontend — admin step-id list

**Files:**
- Modify: `demo_api_ui/src/config/demoUseCaseSteps.js`
- Test: `demo_api_ui/src/config/__tests__/demoUseCaseSteps.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (this is a static id list mirroring
  the `id`s in `ADMIN_DEMO_STEPS`, same pattern as the existing
  `DEMO_PRIMARY_USE_CASE_IDS` mirroring `USE_CASES` ids).
- Produces: `ADMIN_PRIMARY_USE_CASE_IDS` — `['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4']`,
  named export from `demo_api_ui/src/config/demoUseCaseSteps.js`. Task 3
  imports this exact name.

- [ ] **Step 1: Symlink node_modules so tests can run in this worktree**

```bash
ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules demo_api_ui/node_modules
```

- [ ] **Step 2: Write the failing test**

Add to `demo_api_ui/src/config/__tests__/demoUseCaseSteps.test.js` (add the
import and a new `it` block inside the existing `describe`):

```js
import { DEMO_USE_CASE_IDS, DEMO_USE_CASE_LABEL, ADMIN_PRIMARY_USE_CASE_IDS } from '../demoUseCaseSteps';
```

```js
  it('exports the admin vertical demo-steps id list', () => {
    expect(ADMIN_PRIMARY_USE_CASE_IDS).toEqual(['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4']);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/demoUseCaseSteps.test.js`
Expected: FAIL — `ADMIN_PRIMARY_USE_CASE_IDS is not exported` / `undefined`.

- [ ] **Step 4: Add the export**

In `demo_api_ui/src/config/demoUseCaseSteps.js`, add after the
`DEMO_USE_CASE_IDS` export (after line 34):

```js
/**
 * PingOne Admin vertical's demo-steps ids. Served by a separate backend
 * list (demo_api_server/config/admin/demoSteps.js), not the 22-use-case
 * banking catalog — see docs/superpowers/specs/2026-07-19-pingone-admin-demo-steps-design.md.
 */
export const ADMIN_PRIMARY_USE_CASE_IDS = ['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4'];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/demoUseCaseSteps.test.js`
Expected: 2 tests pass, 1 pre-existing test may still show its own unrelated
failure (the `keeps the presenter Demo script order` test is already stale
against the current `DEMO_USE_CASE_IDS` content — pre-existing, not caused by
this change; do not fix it, out of scope).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/config/demoUseCaseSteps.js demo_api_ui/src/config/__tests__/demoUseCaseSteps.test.js
git commit -m "feat(pingone-admin): add ADMIN_PRIMARY_USE_CASE_IDS demo-steps id list"
```

---

### Task 3: Frontend — vertical-aware id selection in DemoStepsDropdown

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx`
- Test: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`

**Interfaces:**
- Consumes: `ADMIN_PRIMARY_USE_CASE_IDS` from
  `demo_api_ui/src/config/demoUseCaseSteps.js` (Task 2).
- Produces: no new exports — `DemoStepsDropdown`'s existing props
  (`vertical`, `disabled`, `open`, `onOpenChange`, `onSelect`) are unchanged;
  behavior changes only for `vertical === 'pingone-admin'`.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx`.
First, extend the import line (currently line 8):

```js
import { DEMO_USE_CASE_IDS, ADMIN_PRIMARY_USE_CASE_IDS } from '../../config/demoUseCaseSteps';
```

Then add a new top-level `describe` block, after the existing one closes:

```js
describe('DemoStepsDropdown — pingone-admin vertical', () => {
  const ADMIN_CATALOG = ADMIN_PRIMARY_USE_CASE_IDS.map((id) => ({
    id,
    title: `Admin title for ${id}`,
    trigger: { type: 'chip', text: `admin prompt for ${id}` },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: ADMIN_CATALOG } });
  });

  it('lists only the 4 admin steps with no advanced group', async () => {
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    const items = screen.getAllByTestId(/^demo-step-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual(
      ADMIN_PRIMARY_USE_CASE_IDS.map((id) => `demo-step-${id}`),
    );
    expect(screen.queryByTestId('demo-steps-advanced-toggle')).not.toBeInTheDocument();
  });

  it('requests the pingone-admin vertical from the API', async () => {
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/use-cases',
      { params: { vertical: 'pingone-admin' }, _silent: true },
    ));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoStepsDropdown.test.jsx -t "pingone-admin"`
Expected: FAIL on the first new test — with the current fixed
`DEMO_PRIMARY_USE_CASE_IDS`, the component looks up ids like `UC1` in the
admin-only `ADMIN_CATALOG` and finds nothing, so `demo-step-ADMIN1` etc. are
never rendered (`getAllByTestId(/^demo-step-/)` returns `[]`, unequal to the
expected 4 ids).

- [ ] **Step 3: Implement the vertical-aware id selection**

In `demo_api_ui/src/components/DemoStepsDropdown.jsx`, add the import
(alongside the existing `demoUseCaseSteps` import, currently lines 8-11):

```js
import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
} from '../config/demoUseCaseSteps';
```

Then change `loadSteps` (currently lines 46-69) to pick the id lists based on
`vertical`:

```js
  const loadSteps = useCallback(() => {
    setLoading(true);
    setError(null);
    const isAdmin = vertical === 'pingone-admin';
    const primaryIds = isAdmin ? ADMIN_PRIMARY_USE_CASE_IDS : DEMO_PRIMARY_USE_CASE_IDS;
    const advancedIds = isAdmin ? [] : DEMO_ADVANCED_USE_CASE_IDS;
    apiClient
      .get('/api/use-cases', { params: { vertical }, _silent: true })
      .then(({ data }) => {
        const catalog = data.useCases || [];
        const mapIds = (ids, offset) =>
          ids
            .map((id, index) => {
              const uc = catalog.find((u) => u.id === id);
              return uc ? { uc, stepNumber: offset + index + 1 } : null;
            })
            .filter(Boolean);
        setPrimarySteps(mapIds(primaryIds, 0));
        setAdvancedSteps(mapIds(advancedIds, primaryIds.length));
      })
      .catch((err) => {
        setError(err.message || 'Failed to load demo steps');
        setPrimarySteps([]);
        setAdvancedSteps([]);
      })
      .finally(() => setLoading(false));
  }, [vertical]);
```

(`advancedIds` is `[]` for admin, so `mapIds([], ...)` returns `[]`,
`advancedSteps` stays empty, and the existing
`{advancedSteps.length > 0 && (...)}` guard already hides the "More demos"
toggle — no other change needed for that part.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoStepsDropdown.test.jsx`
Expected: PASS, all tests in the file (pre-existing banking-vertical tests
plus the 2 new admin ones).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/DemoStepsDropdown.jsx demo_api_ui/src/components/__tests__/DemoStepsDropdown.test.jsx
git commit -m "feat(pingone-admin): DemoStepsDropdown picks admin step ids for pingone-admin vertical"
```

---

### Task 4: Manual live verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the API directly**

```bash
curl -sk 'https://api.ping.demo:3001/api/use-cases?vertical=pingone-admin' \
  -H 'Cookie: <a real session cookie>' -w '\n%{http_code}\n'
```

Expected: `200`, body `{"vertical":"pingone-admin","useCases":[...4 items...]}`.
(A 401 here just means no session cookie was supplied — that's the existing
auth gate working correctly, not this change. Get a real cookie by logging
in through the browser first, per Task below.)

- [ ] **Step 2: Confirm through the running dev stack**

Open `https://local.ping-devops.com:4000/admin` (per project convention —
sign-in only works on this host), log in, open the PingOne Admin AI Agent,
click "Demo steps". Expected: popout shows 4 steps (no "More demos"
section), progress reads "0 of 4 done". Click each step in turn and confirm
it sends its NL prompt and the agent returns a real tool-backed reply (not
"unknown action" / "I'm not sure how to help with that one").

- [ ] **Step 3: Confirm the pre-existing banking vertical is unaffected**

On the customer-side dashboard, open the agent's "Demo steps" and confirm it
still shows the original 6 primary + 8 advanced trust-ladder steps unchanged.

No commit for this task — verification only.
