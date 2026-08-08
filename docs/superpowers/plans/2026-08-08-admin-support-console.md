# Admin Support Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the sidelined per-vertical ops console into a customer-support Case Workspace whose identity gate is enforced on the server, not painted on the client.

**Architecture:** `demo_api_ui/src/components/verticalOps/` is renamed to `supportConsole/` and grows in place — it already owns lookup, per-vertical actions and the record drawer. A new `requireCustomerVerified` middleware in the BFF rejects gated write actions unless the session holds a live verification for that specific customer. The UI mirrors that server truth; it never becomes the source of it.

**Tech Stack:** React 19.2 + Vite 8 + Vitest 3.2 (UI, plain JS/JSX — no TypeScript). Node 22 + Express 4.18 + Jest 29.7 + supertest (BFF, CommonJS).

## Scope of this plan

Covers **Phase 0** (cleanup) and **Phase 1** (centre pane with enforced identity gate) from
`docs/superpowers/specs/2026-08-08-admin-support-console-design.md`. Both ship working,
testable software: at the end, `/admin/<vertical>` is a professional support console with a
gate that provably holds.

Phases 2–4 (vertical parity, queue rail + evidence rail + `/admin` repoint, agent persona)
get their own plans once Phase 1's config shape is real. Writing their code now would mean
inventing signatures against interfaces that do not yet exist.

## Deviations from the spec — read before starting

1. **`ADMIN_WRITE` is not a guard.** The spec says vertical write actions are "guarded by
   `ADMIN_WRITE`". They are not. `routes/adminVerticals.js:155` reads
   `const ADMIN_WRITE = [];` — an empty array spread into every route, with a comment
   stating "Vertical Ops are open to any authenticated user." This strengthens the case for
   Task 6 rather than weakening it, but no task should assume a pre-existing gate.

2. **`identityActions` (reset password / unlock / remove passkey) is deferred.** No
   BFF endpoint exists for any of them, and building them means PingOne Management API
   calls against a live environment. That is its own change with its own risk review. The
   config key is still defined in Task 7 so later phases have somewhere to put them, but no
   task in this plan renders the account-and-sign-in card.

## Global Constraints

Every task's requirements implicitly include these. Violating one fails review regardless of green tests.

- **Worktree only.** Edit, test and commit inside an isolated git worktree. A hard-block hook denies `Write`/`Edit` in the main checkout. Verify `git branch --show-current` before each commit.
- **Stage explicitly.** `git add <files>`, never `git add -A`. A BFF jest run regenerates 443 data files under `demo_api_server/data/`; `-A` sweeps them in.
- **Emoji allowlist only:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else is plain text, CSS, or semantic HTML. This is REGRESSION_PLAN §0, always on.
- **UI HTTP** goes through `bffAxios` (this directory's existing choice) — never bare `axios`.
- **UI toasts** come from `utils/appToast` (`notifySuccess`, `notifyError`) — never `react-toastify` directly. ESLint `no-restricted-imports` enforces it.
- **UI modals** use `DraggableModal` / `ConfirmModal` — never a hand-rolled overlay or `window.confirm`.
- **UI is plain JS/JSX.** No TypeScript sources in `demo_api_ui`.
- **Server is CommonJS** (`'use strict'` + `require`), error bodies are `{ error }` — extra flags go alongside it, never instead of it.
- **Styling** lives in a co-located `.css` file, not inline `style={{}}` objects.
- **Default vertical for anything that picks one:** Super Sports (`sporting-goods`).

### Commands

```bash
# UI — from demo_api_ui/
npx vitest run src/components/supportConsole/__tests__/<file>   # one file
npm run test:unit                                                # full unit run
npm run build                                                    # the real gate

# BFF — from demo_api_server/
CI=true npx jest src/__tests__/adminVerticals.route.test.js --forceExit
CI=true npm run test:unit                                        # core regression
```

`CI=true` is mandatory for BFF tests — without it supertest suites flake and green proves
nothing. If jest reports `No tests found, exiting with code 1` inside the worktree, invoke
the `verify-ai-demo2` skill; the cause is a missing `node_modules` or a needed
`--testPathIgnorePatterns` override, not a missing test.

---

## File Structure

**Phase 0**

| Action | Path | Responsibility |
|---|---|---|
| Delete | `demo_api_ui/src/components/Admin.jsx`, `Admin.css` | Unrouted since Dashboard.js took `/admin` |
| Delete | `demo_api_ui/src/components/OAuthHealthDashboard.jsx` | Zero importers |
| Delete | `demo_api_ui/src/components/AdminConfigValidationPanel.jsx`, `.css` | Zero importers |
| Modify | `demo_api_ui/src/App.js:1001-1045` | Wrap five vertical-ops routes in `RequireAdminLogin` |
| Modify | `demo_api_ui/src/components/verticalOps/verticalOpsConfig.js` | Replace non-allowlist emoji with text tokens |
| Modify | `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx`, `.css` | Render text tokens as styled chips |

**Phase 1**

| Action | Path | Responsibility |
|---|---|---|
| Rename | `verticalOps/` → `supportConsole/` | Directory move, no behaviour change |
| Rename | `verticalOpsConfig.js` → `supportConsoleConfig.js` | Same, plus new keys |
| Create | `demo_api_server/middleware/requireCustomerVerified.js` | The enforcement point |
| Create | `demo_api_ui/src/components/supportConsole/IdentityGate.jsx`, `.css` | Verification strip; owns nothing but display + initiate |
| Create | `demo_api_ui/src/components/supportConsole/resolvePermission.js` | Pure function: (scopes, permission, verified) → state |
| Create | `demo_api_ui/src/components/supportConsole/CaseNotes.jsx`, `.css` | Notes list + composer |
| Modify | `demo_api_server/routes/adminVerticals.js` | Verification endpoints, gated writes, audit, notes |
| Modify | `demo_api_ui/src/components/supportConsole/SupportConsole.jsx` | Compose the above |

---

## Task 1: Delete the unrouted admin components

Three components have zero importers outside their own files. `Admin.jsx` is the oldest —
`App.js:360` carries the comment "Admin uses Dashboard.js on /admin", which is why it went
dark. Deleting them is the whole task; the proof is that the build still passes.

**Files:**
- Delete: `demo_api_ui/src/components/Admin.jsx`
- Delete: `demo_api_ui/src/components/Admin.css`
- Delete: `demo_api_ui/src/components/OAuthHealthDashboard.jsx`
- Delete: `demo_api_ui/src/components/AdminConfigValidationPanel.jsx`
- Delete: `demo_api_ui/src/components/AdminConfigValidationPanel.css`

**Interfaces:**
- Consumes: nothing
- Produces: nothing — this task only removes

- [ ] **Step 1: Confirm each file has zero importers**

Run from `demo_api_ui/src`:

```bash
for c in Admin OAuthHealthDashboard AdminConfigValidationPanel; do
  echo "--- $c"
  grep -rEl "from ['\"][^'\"]*/${c}['\"]" . --include="*.js" --include="*.jsx"
done
```

Expected: no output under any of the three headers. If a path prints, **stop** — that file
is live and this plan is wrong about it. Report it rather than deleting.

- [ ] **Step 2: Delete the five files**

```bash
git rm demo_api_ui/src/components/Admin.jsx \
       demo_api_ui/src/components/Admin.css \
       demo_api_ui/src/components/OAuthHealthDashboard.jsx \
       demo_api_ui/src/components/AdminConfigValidationPanel.jsx \
       demo_api_ui/src/components/AdminConfigValidationPanel.css
```

- [ ] **Step 3: Verify the build still resolves every import**

Run from `demo_api_ui`: `npm run build`

Expected: PASS. A build failure naming one of the deleted files means Step 1's grep missed
a dynamic import — restore that file and report.

- [ ] **Step 4: Run the unit suite**

Run from `demo_api_ui`: `npm run test:unit`

Expected: PASS, same count as before minus any tests that targeted the deleted components.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/
git commit -m "chore(admin): delete three unrouted admin components

Admin.jsx has been dark since Dashboard.js took /admin (see the comment at
App.js:360). OAuthHealthDashboard.jsx and AdminConfigValidationPanel.jsx have
zero importers. Build and unit suite pass without them."
```

---

## Task 2: Put the vertical-ops routes behind admin login

`/admin`, `/admin/vault` and `/admin/verticals` are wrapped in `RequireAdminLogin`. The five
vertical-ops routes are not (`App.js:1001-1045`) — anyone who knows the URL reaches a
customer-data console. This closes that.

**Files:**
- Modify: `demo_api_ui/src/App.js:1001-1045`
- Test: `demo_api_ui/src/__tests__/App.structure.test.js`

**Interfaces:**
- Consumes: `RequireAdminLogin` from `./routes/RequireAdminLogin` — already imported at `App.js:179`
- Produces: nothing new; five routes change shape

- [ ] **Step 1: Read how the wrapped routes look today**

Open `demo_api_ui/src/App.js` at line 993. The `/admin` route is the pattern to copy:

```jsx
<Route
  path="/admin"
  element={
    <RequireAdminLogin user={user}>
      <Dashboard user={user} onLogout={logout} />
    </RequireAdminLogin>
  }
/>
```

- [ ] **Step 2: Write the failing test**

Add to `demo_api_ui/src/__tests__/App.structure.test.js`:

```jsx
it('every /admin route element is wrapped in RequireAdminLogin', () => {
  const source = readFileSync(
    new URL('../App.js', import.meta.url), 'utf8'
  );
  const adminPaths = [
    '/admin/banking', '/admin/healthcare', '/admin/retail',
    '/admin/sporting-goods', '/admin/workforce',
  ];
  for (const p of adminPaths) {
    // Grab the <Route …> block that declares this path, up to its closing />
    const block = source.slice(source.indexOf(`path="${p}"`));
    const routeEnd = block.indexOf('/>');
    expect(block.slice(0, routeEnd)).toContain('RequireAdminLogin');
  }
});
```

`readFileSync` needs `import { readFileSync } from 'node:fs';` at the top of the file if it
is not already there.

- [ ] **Step 3: Run the test to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/__tests__/App.structure.test.js -t "RequireAdminLogin"`

Expected: FAIL — the first path, `/admin/banking`, has no `RequireAdminLogin` in its block.

- [ ] **Step 4: Wrap all five routes**

Replace each of the five route elements. `/admin/banking` becomes:

```jsx
<Route
  path="/admin/banking"
  element={
    <RequireAdminLogin user={user}>
      <BankingAdminOps user={user} onLogout={logout} />
    </RequireAdminLogin>
  }
/>
```

Apply the identical shape to `/admin/healthcare` (`HealthcareAdminOps`), `/admin/retail`
(`RetailAdminOps`), `/admin/sporting-goods` (`SportingGoodsAdminOps`) and
`/admin/workforce` (`WorkforceAdminOps`). Keep them as direct children of `<Routes>` —
React Router v6 requires it, and `App.structure.test.js` has a "Render smoke" test that
catches the failure mode if you extract them.

- [ ] **Step 5: Run the test to verify it passes**

Run from `demo_api_ui`: `npx vitest run src/__tests__/App.structure.test.js`

Expected: PASS, including the pre-existing render smoke tests.

- [ ] **Step 6: Run the full unit suite and build**

Run from `demo_api_ui`: `npm run test:unit && npm run build`

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/__tests__/App.structure.test.js
git commit -m "fix(admin): require admin login on the five vertical-ops routes

/admin, /admin/vault and /admin/verticals were wrapped in RequireAdminLogin;
the five /admin/<vertical> consoles were not, so anyone with the URL reached a
customer-data view. Adds a structure test so a new admin route cannot land
unwrapped."
```

---

## Task 3: Bring the console inside the emoji allowlist

`verticalOpsConfig.js` carries roughly two dozen emoji (`🏦 🩺 🛍️ 💳 🔁 📅 💊 🧾 📁 ➡️ 📦 ↩️ 🔄 🎧 ⭐ 🎿 🏃 🧑‍💼 💵 🛠️ 🎓 🌴 🏥 🏅`), none of them on the REGRESSION_PLAN §0 allowlist. Replace each with a two-letter text token rendered as a styled chip.

**Files:**
- Modify: `demo_api_ui/src/components/verticalOps/verticalOpsConfig.js`
- Modify: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.jsx`
- Modify: `demo_api_ui/src/components/verticalOps/VerticalOpsConsole.css`
- Test: `demo_api_ui/src/components/verticalOps/__tests__/verticalOpsConfig.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `cfg.icon` and `category.icon` change type from emoji string to a 1–2 character
  uppercase token string. Task 7 and later phases read the same field; no shape change,
  only content.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/verticalOps/__tests__/verticalOpsConfig.test.js`:

```js
import { CONFIGS, VERTICAL_ORDER } from '../verticalOpsConfig';

// REGRESSION_PLAN §0 — the only emoji permitted anywhere in the UI.
const ALLOWED = ['⚠️', '✅', '❌', '🔐', '✕', '✓', '👤', '🔑', '🪟', '📚'];

function hasDisallowedEmoji(value) {
  let s = String(value);
  for (const ok of ALLOWED) s = s.split(ok).join('');
  return /\p{Extended_Pictographic}/u.test(s);
}

it('no vertical config value uses an emoji outside the allowlist', () => {
  const offenders = [];
  for (const id of VERTICAL_ORDER) {
    const cfg = CONFIGS[id];
    if (hasDisallowedEmoji(cfg.icon)) offenders.push(`${id}.icon=${cfg.icon}`);
    const { categories } = cfg.adaptLookup({ user: { id: 'u1', name: 'T' }, data: {} });
    for (const c of categories) {
      if (hasDisallowedEmoji(c.icon)) offenders.push(`${id}.${c.id}.icon=${c.icon}`);
    }
  }
  expect(offenders).toEqual([]);
});

it('every icon token is one or two uppercase letters', () => {
  for (const id of VERTICAL_ORDER) {
    expect(CONFIGS[id].icon).toMatch(/^[A-Z]{1,2}$/);
  }
});
```

Banking's `adaptLookup` returns `customer: null` for an empty `data`, but still returns its
`categories` array, so the loop is safe for all five verticals.

- [ ] **Step 2: Run the test to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/components/verticalOps/__tests__/verticalOpsConfig.test.js`

Expected: FAIL — `offenders` lists `banking.icon=🏦` and every category icon.

- [ ] **Step 3: Replace the vertical icons**

In `verticalOpsConfig.js`, change the five top-level `icon` values:

```js
banking:          icon: 'BK',
healthcare:       icon: 'HC',
retail:           icon: 'RT',
'sporting-goods': icon: 'SG',
workforce:        icon: 'WF',
```

- [ ] **Step 4: Replace the category icons**

Same file, every `category(...)` call and every `sliceDefs` entry. Full replacement set:

```
banking:          accounts 'AC'  transactions 'TX'
healthcare:       appointments 'AP'  medications 'RX'  billing 'BL'
                  records 'RC'  referrals 'RF'
retail:           orders 'OR'  returns 'RN'  subscriptions 'SB'
                  support_tickets 'TK'  rewards 'RW'
sporting-goods:   orders 'OR'  rentals 'RE'  coaching_sessions 'CO'
                  support_tickets 'TK'  loyalty 'LY'
workforce:        expenses 'EX'  tickets 'TK'  trainings 'TR'
                  pto 'PT'  benefits 'BN'
```

- [ ] **Step 5: Style the tokens as chips**

`VerticalOpsConsole.jsx` already renders `{cfg.icon}` inside `<span className="vops__icon">`
and `{c.icon}` inside `<span>` in `.vops__cardhead`. Give the card-head span a class so it
can be styled — change:

```jsx
<div className="vops__cardhead"><span>{c.icon}</span><b>{c.label}</b>
```

to:

```jsx
<div className="vops__cardhead"><span className="vops__cardicon">{c.icon}</span><b>{c.label}</b>
```

Add to `VerticalOpsConsole.css`:

```css
.vops__icon,
.vops__cardicon {
  display: inline-grid;
  place-items: center;
  min-width: 1.75rem;
  height: 1.75rem;
  padding: 0 0.35rem;
  border-radius: 6px;
  background: var(--tint, #f1f5f9);
  color: var(--accent, #334155);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run from `demo_api_ui`: `npx vitest run src/components/verticalOps/__tests__/verticalOpsConfig.test.js`

Expected: PASS, both cases.

- [ ] **Step 7: Run the console tests, unit suite and build**

Run from `demo_api_ui`:

```bash
npx vitest run src/components/verticalOps/
npm run test:unit && npm run build
```

Expected: all PASS. `VerticalOpsConsole.test.jsx` asserts on text like `'Healthcare Ops'`
and `'Appointments'`, not on icons, so it should be unaffected.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/verticalOps/
git commit -m "style(admin): replace console emoji with allowlisted text tokens

verticalOpsConfig carried ~24 emoji outside the REGRESSION_PLAN §0 allowlist.
Each becomes a two-letter token rendered as a CSS chip. Adds a config test so
a new vertical cannot reintroduce one."
```

---

## Task 4: Rename verticalOps to supportConsole

Pure move. Doing it now, on its own, keeps every later diff readable — a rename mixed with
behaviour changes hides both.

**Files:**
- Rename: `demo_api_ui/src/components/verticalOps/` → `demo_api_ui/src/components/supportConsole/`
- Rename: `supportConsole/VerticalOpsConsole.jsx` → `supportConsole/SupportConsole.jsx` (and `.css`)
- Rename: `supportConsole/verticalOpsConfig.js` → `supportConsole/supportConsoleConfig.js`
- Modify: the five wrappers `BankingAdminOps.js`, `HealthcareAdminOps.js`, `RetailAdminOps.js`, `SportingGoodsAdminOps.js`, `WorkforceAdminOps.js`

**Interfaces:**
- Consumes: everything Task 3 left behind
- Produces: `import SupportConsole from './supportConsole/SupportConsole'`, default export
  unchanged — `({ vertical, user, onLogout }) => JSX`. Config module exports `CONFIGS`,
  `VERTICAL_ORDER`, `getVerticalConfig(id)` under the new filename.

- [ ] **Step 1: Move the directory and rename the two files**

```bash
git mv demo_api_ui/src/components/verticalOps demo_api_ui/src/components/supportConsole
git mv demo_api_ui/src/components/supportConsole/VerticalOpsConsole.jsx \
       demo_api_ui/src/components/supportConsole/SupportConsole.jsx
git mv demo_api_ui/src/components/supportConsole/VerticalOpsConsole.css \
       demo_api_ui/src/components/supportConsole/SupportConsole.css
git mv demo_api_ui/src/components/supportConsole/verticalOpsConfig.js \
       demo_api_ui/src/components/supportConsole/supportConsoleConfig.js
git mv demo_api_ui/src/components/supportConsole/__tests__/VerticalOpsConsole.test.jsx \
       demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.test.jsx
git mv demo_api_ui/src/components/supportConsole/__tests__/verticalOpsConfig.test.js \
       demo_api_ui/src/components/supportConsole/__tests__/supportConsoleConfig.test.js
```

- [ ] **Step 2: Rename the component and its imports**

In `SupportConsole.jsx`: rename the function `VerticalOpsConsole` to `SupportConsole`, and
update its two local imports:

```jsx
import { getVerticalConfig } from './supportConsoleConfig';
import './SupportConsole.css';
```

Leave the CSS class prefix `vops__` alone. Renaming classes is a second, unrelated churn and
`SupportConsole.css` plus its tests reference them throughout.

- [ ] **Step 3: Update the five page wrappers**

Each is a one-liner. `BankingAdminOps.js` becomes:

```jsx
import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function BankingAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="banking" user={user} onLogout={onLogout} />;
}
```

Apply the same shape to the other four, changing only the `vertical` prop
(`healthcare`, `retail`, `sporting-goods`, `workforce`).

- [ ] **Step 4: Update test imports**

In `__tests__/SupportConsole.test.jsx`, change the import to
`import SupportConsole from '../SupportConsole';` and every `<VerticalOpsConsole` to
`<SupportConsole`. In `__tests__/supportConsoleConfig.test.js`, change
`from '../verticalOpsConfig'` to `from '../supportConsoleConfig'`. Do the same in
`RecordDrawer.test.jsx` and `OpsAssistantChat.test.jsx` if they reference either name.

- [ ] **Step 5: Verify nothing still points at the old paths**

```bash
grep -rn "verticalOps\|VerticalOpsConsole\|verticalOpsConfig" demo_api_ui/src
```

Expected: no output.

- [ ] **Step 6: Run the tests and build**

Run from `demo_api_ui`: `npm run test:unit && npm run build`

Expected: both PASS with the same test count as after Task 3.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/
git commit -m "refactor(admin): rename verticalOps to supportConsole

Pure move ahead of the Case Workspace work so later diffs read as behaviour
changes rather than renames. CSS class prefix left as vops__ deliberately."
```

---

## Task 5: Server — record a customer verification on the session

Verification is of the **customer**, not the operator. It is stored separately from
`req.session.stepUpVerified` (which records the operator's own MFA, set in `routes/mfa.js`)
because cross-crediting the two would let an operator's own MFA unlock writes against any
customer.

This task only records and reports verification. Task 6 enforces it.

**Files:**
- Modify: `demo_api_server/routes/adminVerticals.js`
- Test: `demo_api_server/src/__tests__/adminVerticals.route.test.js`

**Interfaces:**
- Consumes: `resolveUser(q)` and `isKnownUser(userId)`, already in `adminVerticals.js`
- Produces:
  - `SUPPORT_VERIFY_TTL_MS` — module constant, `15 * 60 * 1000`
  - `markCustomerVerified(req, customerId)` — writes `req.session.supportVerified[customerId] = Date.now() + SUPPORT_VERIFY_TTL_MS`
  - `isCustomerVerified(req, customerId)` — returns boolean
  - Both exported as `module.exports.__verify = { markCustomerVerified, isCustomerVerified, SUPPORT_VERIFY_TTL_MS }` so Task 6's middleware and the tests can reach them
  - `POST /api/admin/<vertical>/verify/initiate` body `{ customerId }` → `{ ok: true, customerId, channel, expiresIn }`
  - `GET  /api/admin/<vertical>/verify/status?customerId=` → `{ customerId, verified, expiresAt }`

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/src/__tests__/adminVerticals.route.test.js`. The existing
`makeApp()` builds a bare express app with no session middleware, so add a second factory
that supplies one — an in-memory object is enough, and it keeps these cases independent of
the session store's real configuration.

```js
// A minimal session shim: one object shared across requests from one agent.
function makeSessionApp() {
  const app = express();
  app.use(express.json());
  const session = {};
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/admin', adminVerticals);
  return app;
}

describe('customer verification', () => {
  it('starts unverified', async () => {
    const a = makeSessionApp();
    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u1');
    expect(r.status).toBe(200);
    expect(r.body.verified).toBe(false);
  });

  it('initiate then status reports verified', async () => {
    const a = makeSessionApp();
    const init = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({ customerId: 'u1' });
    expect(init.status).toBe(200);
    expect(init.body.ok).toBe(true);

    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u1');
    expect(r.body.verified).toBe(true);
    expect(r.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('verifying one customer does not verify another', async () => {
    const a = makeSessionApp();
    await request(a).post('/api/admin/sporting-goods/verify/initiate').send({ customerId: 'u1' });
    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u2');
    expect(r.body.verified).toBe(false);
  });

  it('rejects an unknown customerId with 404', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({ customerId: 'ghost' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });

  it('rejects a missing customerId with 400', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('customerId is required');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js -t "customer verification" --forceExit
```

Expected: FAIL with 404s — the routes do not exist.

- [ ] **Step 3: Implement the store and the two routes**

In `demo_api_server/routes/adminVerticals.js`, insert above `const ADMIN_WRITE = [];`:

```js
// ── Customer verification ─────────────────────────────────────────────────────
// Records that THIS OPERATOR SESSION verified THIS CUSTOMER. Deliberately not
// req.session.stepUpVerified — that field records the operator's own MFA, and
// crediting it here would let an operator's MFA unlock writes against anyone.
// Not consumed single-use: one support call legitimately performs several
// writes, so the TTL is the bound.
const SUPPORT_VERIFY_TTL_MS = 15 * 60 * 1000;

function markCustomerVerified(req, customerId) {
  if (!req.session) return 0;
  if (!req.session.supportVerified) req.session.supportVerified = {};
  const expiresAt = Date.now() + SUPPORT_VERIFY_TTL_MS;
  req.session.supportVerified[String(customerId)] = expiresAt;
  return expiresAt;
}

function verificationExpiry(req, customerId) {
  const at = req.session?.supportVerified?.[String(customerId)];
  return typeof at === 'number' ? at : 0;
}

function isCustomerVerified(req, customerId) {
  return verificationExpiry(req, customerId) > Date.now();
}

// POST /<vertical>/verify/initiate — start a challenge against the customer's
// registered device. The demo completes it synchronously; a deployment wired to
// a real CIBA channel would flip `ok` to false and let the client poll /status.
function verifyInitiate(req, res) {
  const customerId = req.body?.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  if (!isKnownUser(customerId)) return res.status(404).json({ error: 'unknown user' });
  const expiresAt = markCustomerVerified(req, customerId);
  res.json({
    ok: true,
    customerId: String(customerId),
    channel: 'device-otp',
    expiresIn: SUPPORT_VERIFY_TTL_MS,
    expiresAt,
  });
}

// GET /<vertical>/verify/status?customerId=
function verifyStatus(req, res) {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  const expiresAt = verificationExpiry(req, customerId);
  res.json({
    customerId: String(customerId),
    verified: expiresAt > Date.now(),
    expiresAt,
  });
}

for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']) {
  router.post(`/${vertical}/verify/initiate`, verifyInitiate);
  router.get(`/${vertical}/verify/status`, verifyStatus);
}
```

At the bottom of the file, replace `module.exports = router;` with:

```js
module.exports = router;
module.exports.__verify = {
  markCustomerVerified,
  isCustomerVerified,
  verificationExpiry,
  SUPPORT_VERIFY_TTL_MS,
};
```

Assigning a property onto the router function is how this file can expose helpers without
changing what `server.js` mounts.

- [ ] **Step 4: Run the test to verify it passes**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js --forceExit
```

Expected: PASS, all five new cases plus every pre-existing case.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/adminVerticals.js \
        demo_api_server/src/__tests__/adminVerticals.route.test.js
git commit -m "feat(admin): record per-customer verification on the operator session

Adds POST /<vertical>/verify/initiate and GET /<vertical>/verify/status, backed
by req.session.supportVerified keyed by customer id with a 15-minute TTL. Kept
separate from stepUpVerified so an operator's own MFA cannot unlock writes
against an arbitrary customer. Records only — enforcement is the next commit."
```

---

## Task 6: Server — enforce verification on gated writes

The gate. Every vertical write action now requires a live verification for the customer it
targets. Denials are audited.

**Files:**
- Create: `demo_api_server/middleware/requireCustomerVerified.js`
- Modify: `demo_api_server/routes/adminVerticals.js`
- Test: `demo_api_server/src/__tests__/adminVerticals.route.test.js`

**Interfaces:**
- Consumes: `isCustomerVerified(req, customerId)` from Task 5's `__verify` export
- Produces:
  - `requireCustomerVerified` — express middleware, default export of the new module
  - `recordAudit(req, entry)` in `adminVerticals.js`, appending `{ at, operator, action, customerId, outcome }`
  - `GET /api/admin/<vertical>/audit?customerId=` → `{ vertical, data: { entries } }`

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/src/__tests__/adminVerticals.route.test.js`:

```js
describe('verification is enforced on writes', () => {
  async function firstActionableOrder(agentApp) {
    const look = await request(agentApp).get('/api/admin/sporting-goods/lookup?q=demo');
    return actionable(look.body.data.orders, 'status', ['Cancelled', 'Delivered']);
  }

  it('rejects a gated write when the customer is not verified', async () => {
    const a = makeSessionApp();
    const order = await firstActionableOrder(a);
    expect(order).toBeTruthy();

    const r = await request(a)
      .post(`/api/admin/sporting-goods/orders/${order.id}/cancel`)
      .send({ userId: 'u1' });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
    expect(r.body.need_verification).toBe(true);
  });

  it('allows the same write once the customer is verified', async () => {
    const a = makeSessionApp();
    const order = await firstActionableOrder(a);
    expect(order).toBeTruthy();

    await request(a).post('/api/admin/sporting-goods/verify/initiate').send({ customerId: 'u1' });

    const r = await request(a)
      .post(`/api/admin/sporting-goods/orders/${order.id}/cancel`)
      .send({ userId: 'u1' });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('verifying customer A does not unlock writes against customer B', async () => {
    const a = makeSessionApp();
    await request(a).post('/api/admin/sporting-goods/verify/initiate').send({ customerId: 'u1' });

    const r = await request(a)
      .post('/api/admin/sporting-goods/orders/anything/cancel')
      .send({ userId: 'u2' });

    // u2 is not a known demo user, so it must not reach the store either way —
    // the point is that it does not come back 200.
    expect(r.status).not.toBe(200);
  });

  it('the operator own step-up does not satisfy the customer gate', async () => {
    const a = makeSessionApp();
    const order = await firstActionableOrder(a);
    expect(order).toBeTruthy();

    // Simulate routes/mfa.js having credited the OPERATOR's own MFA.
    await request(a).get('/api/admin/sporting-goods/lookup?q=demo'); // materialise session
    const r = await request(a)
      .post(`/api/admin/sporting-goods/orders/${order.id}/cancel`)
      .set('x-test-stepup', '1')
      .send({ userId: 'u1' });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
  });

  it('records both the denial and the success in the audit', async () => {
    const a = makeSessionApp();
    const order = await firstActionableOrder(a);

    await request(a)
      .post(`/api/admin/sporting-goods/orders/${order.id}/cancel`)
      .send({ userId: 'u1' });
    await request(a).post('/api/admin/sporting-goods/verify/initiate').send({ customerId: 'u1' });
    await request(a)
      .post(`/api/admin/sporting-goods/orders/${order.id}/cancel`)
      .send({ userId: 'u1' });

    const r = await request(a).get('/api/admin/sporting-goods/audit?customerId=u1');
    expect(r.status).toBe(200);
    const outcomes = r.body.data.entries.map((e) => e.outcome);
    expect(outcomes).toContain('denied');
    expect(outcomes).toContain('ok');
  });
});
```

The `x-test-stepup` header in the fourth case is a marker only — nothing reads it. Its job
is to make the intent legible: even with operator step-up in play, the customer gate holds.
Add a middleware to `makeSessionApp` that honours it so the case is not vacuous:

```js
app.use((req, _res, next) => {
  if (req.get('x-test-stepup')) req.session.stepUpVerified = Date.now() + 60_000;
  next();
});
```

Place it after the session shim and before the router mount.

- [ ] **Step 2: Run the test to verify it fails**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js -t "verification is enforced" --forceExit
```

Expected: FAIL — the first case gets 200 instead of 403, because nothing is gating yet.

- [ ] **Step 3: Write the middleware**

Create `demo_api_server/middleware/requireCustomerVerified.js`:

```js
'use strict';

/**
 * Rejects a support write unless the operator's session holds a live
 * verification for the customer the write targets.
 *
 * The customer id is read from req.body.userId — the field every write action
 * in routes/adminVerticals.js already requires — falling back to
 * req.params.customerId for the case routes.
 *
 * Deliberately independent of req.session.stepUpVerified: that field records
 * the OPERATOR's own MFA. Honouring it here would let an operator's step-up
 * unlock writes against any customer.
 */
function makeRequireCustomerVerified({ isCustomerVerified, recordAudit }) {
  return function requireCustomerVerified(req, res, next) {
    const customerId = req.body?.userId || req.params?.customerId;
    if (!customerId) return next(); // the route's own 400 handles this

    if (isCustomerVerified(req, customerId)) return next();

    recordAudit(req, {
      action: `${req.method} ${req.originalUrl}`,
      customerId: String(customerId),
      outcome: 'denied',
    });

    return res.status(403).json({
      error: 'customer_not_verified',
      customerId: String(customerId),
      need_verification: true,
    });
  };
}

module.exports = { makeRequireCustomerVerified };
```

It takes its dependencies as arguments rather than requiring `adminVerticals.js` — the
route file will require this module, and a circular require would leave one side holding a
half-built export.

- [ ] **Step 4: Wire the middleware and the audit**

In `adminVerticals.js`, below the verification helpers from Task 5, add the audit store:

```js
// ── Operator audit ────────────────────────────────────────────────────────────
// In-memory, per process, same lifetime as the other demo stores. A denial that
// leaves no trace is worse than no audit at all, so denials are recorded too.
const auditLog = new Map(); // customerId -> entries[]

function recordAudit(req, entry) {
  const key = String(entry.customerId);
  if (!auditLog.has(key)) auditLog.set(key, []);
  auditLog.get(key).push({
    at: new Date().toISOString(),
    operator: req.user?.sub || req.user?.username || 'unknown',
    ...entry,
  });
}

function auditFor(req, res) {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  res.json({
    vertical: req.baseUrl.split('/').pop(),
    data: { entries: auditLog.get(String(customerId)) || [] },
  });
}
```

Then replace `const ADMIN_WRITE = [];` and its comment with:

```js
const { makeRequireCustomerVerified } = require('../middleware/requireCustomerVerified');

// Every vertical write requires a live verification for the targeted customer.
// This array was previously empty — the routes were open to any authenticated
// user. Removing this middleware must turn the "verification is enforced"
// tests red; that is the proof the gate is real and not decorative.
const ADMIN_WRITE = [makeRequireCustomerVerified({ isCustomerVerified, recordAudit })];
```

`ADMIN_WRITE` is already spread into every route including the `GET /lookup` routes. Reads
must stay open — an operator has to see the customer before verifying them. Change the
five lookup registrations to drop the spread:

```js
router.get('/banking/lookup', bankingLookup);
router.get('/healthcare/lookup', lookupAction(healthcare, 'healthcare', { /* unchanged */ }));
router.get('/retail/lookup', lookupAction(retail, 'retail', { /* unchanged */ }));
router.get('/sporting-goods/lookup', lookupAction(sportingGoods, 'sporting-goods', { /* unchanged */ }));
router.get('/workforce/lookup', lookupAction(workforce, 'workforce', { /* unchanged */ }));
```

Leave every `router.post(...)` write registration exactly as it is — they keep
`...ADMIN_WRITE`, which now carries the gate.

Record success in `writeAction`. Replace its final `res.json({ ok: true, item });` with:

```js
    recordAudit(req, {
      action: `${req.method} ${req.originalUrl}`,
      customerId: String(userId),
      outcome: 'ok',
    });
    res.json({ ok: true, item });
```

Register the audit route in the existing vertical loop from Task 5:

```js
for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']) {
  router.post(`/${vertical}/verify/initiate`, verifyInitiate);
  router.get(`/${vertical}/verify/status`, verifyStatus);
  router.get(`/${vertical}/audit`, auditFor);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js --forceExit
```

Expected: PASS. The pre-existing write-action cases (`CASES` in the older `describe`) use
`makeApp()`, which has **no** session shim — so `req.session` is undefined,
`isCustomerVerified` returns false, and they will now 403. Update those cases to use
`makeSessionApp()` and to call `verify/initiate` for `u1` before the write. The
`it.each(CASES)` body gains two lines at the top:

```js
    const app = makeSessionApp();
    await request(app).post(`/api/admin/${vertical}/verify/initiate`).send({ customerId: 'u1' });
```

and every `request(app)` inside that block then refers to the local `app`. Do the same for
`'workforce: deny expense sets Denied status'`, `'returns 404 when the target item id does
not exist'`, and `'rejects an unknown userId with 404'`.

The `'rejects a missing userId with 400'` case needs no verification — the middleware
passes through when there is no customer id to check, and the route's own 400 fires.

- [ ] **Step 6: Prove revert-to-RED**

Temporarily change `ADMIN_WRITE` back to `[]` and re-run:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js -t "verification is enforced" --forceExit
```

Expected: FAIL. If it passes, the gate is not wired into the request path and the task is
not done. Restore `ADMIN_WRITE` and confirm green again before committing.

- [ ] **Step 7: Run the core regression**

Run from `demo_api_server`: `CI=true npm run test:unit`

Expected: PASS. If it flakes on worker contention, re-run with `--maxWorkers=4` before
treating it as a regression.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/middleware/requireCustomerVerified.js \
        demo_api_server/routes/adminVerticals.js \
        demo_api_server/src/__tests__/adminVerticals.route.test.js
git commit -m "feat(admin): enforce customer verification on vertical write actions

ADMIN_WRITE was an empty array — every /api/admin/<vertical> write was open to
any authenticated user. It now carries requireCustomerVerified, which rejects a
write with 403 customer_not_verified unless the session holds a live
verification for that customer. Lookups stay open so an operator can find the
customer before verifying them. Denials and successes are both audited.

Revert-to-RED: emptying ADMIN_WRITE turns the enforcement tests red."
```

---

## Task 7: UI — permission resolution

A pure function plus config. No rendering, so it is fast to test and impossible to get
subtly wrong through a mocked DOM.

**Files:**
- Create: `demo_api_ui/src/components/supportConsole/resolvePermission.js`
- Create: `demo_api_ui/src/components/supportConsole/__tests__/resolvePermission.test.js`
- Modify: `demo_api_ui/src/components/supportConsole/supportConsoleConfig.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `resolvePermission({ permission, scopes, verified })` → one of `'allowed'`, `'verify-first'`, `'approval'`, `'denied'`
  - `PERMISSION_LABEL` — map from state to display string
  - `cfg.permissions` — object keyed by action label, values `{ scope, gate, limit? }`, `gate` in `'none' | 'verified' | 'approval' | 'never'`
  - `cfg.identityActions` — declared as `[]` for all five verticals (populated in a later phase; see Deviations)
  - `cfg.caseSource` — `{ path: '/api/admin/<vertical>/cases' }`

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/supportConsole/__tests__/resolvePermission.test.js`:

```js
import { resolvePermission } from '../resolvePermission';
import { CONFIGS, VERTICAL_ORDER } from '../supportConsoleConfig';

const S = ['orders:read', 'orders:write', 'orders:refund'];

it('missing scope is denied regardless of gate', () => {
  expect(resolvePermission({ permission: { scope: 'pan:read', gate: 'none' }, scopes: S, verified: true }))
    .toBe('denied');
});

it('gate none with the scope present is allowed even unverified', () => {
  expect(resolvePermission({ permission: { scope: 'orders:read', gate: 'none' }, scopes: S, verified: false }))
    .toBe('allowed');
});

it('gate verified is verify-first while unverified and allowed once verified', () => {
  const permission = { scope: 'orders:refund', gate: 'verified' };
  expect(resolvePermission({ permission, scopes: S, verified: false })).toBe('verify-first');
  expect(resolvePermission({ permission, scopes: S, verified: true })).toBe('allowed');
});

it('gate approval stays approval even when verified', () => {
  expect(resolvePermission({ permission: { scope: 'orders:refund', gate: 'approval' }, scopes: S, verified: true }))
    .toBe('approval');
});

it('gate never is denied even with the scope and verification', () => {
  expect(resolvePermission({ permission: { scope: 'orders:refund', gate: 'never' }, scopes: S, verified: true }))
    .toBe('denied');
});

it('an unknown action is denied, never implicitly allowed', () => {
  expect(resolvePermission({ permission: undefined, scopes: S, verified: true })).toBe('denied');
});

it('every declared action has a permission entry', () => {
  const missing = [];
  for (const id of VERTICAL_ORDER) {
    const cfg = CONFIGS[id];
    for (const label of Object.keys(cfg.actions)) {
      if (!cfg.permissions?.[label]) missing.push(`${id}: ${label}`);
    }
  }
  expect(missing).toEqual([]);
});

it('every vertical declares identityActions and caseSource', () => {
  for (const id of VERTICAL_ORDER) {
    expect(Array.isArray(CONFIGS[id].identityActions)).toBe(true);
    expect(CONFIGS[id].caseSource?.path).toMatch(/^\/api\/admin\/.+\/cases$/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/resolvePermission.test.js`

Expected: FAIL — `resolvePermission` does not exist.

- [ ] **Step 3: Write the resolver**

Create `demo_api_ui/src/components/supportConsole/resolvePermission.js`:

```js
// Maps (declared permission, operator's token scopes, customer verification)
// to the single state that drives both the button and the evidence rail.
//
// An action with no permission entry resolves to 'denied'. Treating a missing
// entry as an implicit allow would make forgetting to declare one a silent
// privilege grant.

export const PERMISSION_LABEL = {
  allowed: 'Allowed',
  'verify-first': 'Verify first',
  approval: 'Needs approval',
  denied: 'Denied',
};

export function resolvePermission({ permission, scopes, verified }) {
  if (!permission) return 'denied';
  if (permission.gate === 'never') return 'denied';
  if (!Array.isArray(scopes) || !scopes.includes(permission.scope)) return 'denied';
  if (permission.gate === 'approval') return 'approval';
  if (permission.gate === 'verified' && !verified) return 'verify-first';
  return 'allowed';
}
```

- [ ] **Step 4: Add the three config keys**

In `supportConsoleConfig.js`, add to each of the five vertical entries. Banking:

```js
    identityActions: [],
    caseSource: { path: '/api/admin/banking/cases' },
    permissions: {
      'Seed charge': { scope: 'accounts:write', gate: 'verified' },
      'Delete':      { scope: 'accounts:write', gate: 'verified' },
    },
```

Healthcare:

```js
    identityActions: [],
    caseSource: { path: '/api/admin/healthcare/cases' },
    permissions: {
      'Cancel':   { scope: 'health:write', gate: 'verified' },
      'Pay bill': { scope: 'health:write', gate: 'verified' },
      'Refill':   { scope: 'health:write', gate: 'verified' },
      'Release':  { scope: 'health:records', gate: 'approval' },
    },
```

Retail:

```js
    identityActions: [],
    caseSource: { path: '/api/admin/retail/cases' },
    permissions: {
      'Cancel order': { scope: 'orders:write',  gate: 'verified' },
      'Cancel sub':   { scope: 'orders:write',  gate: 'verified' },
      'Resolve':      { scope: 'support:write', gate: 'none' },
      'Approve':      { scope: 'orders:refund', gate: 'verified', limit: 250 },
    },
```

Sporting goods:

```js
    identityActions: [],
    caseSource: { path: '/api/admin/sporting-goods/cases' },
    permissions: {
      'Cancel order':    { scope: 'orders:write',  gate: 'verified' },
      'Return':          { scope: 'orders:write',  gate: 'verified' },
      'Resolve':         { scope: 'support:write', gate: 'none' },
      'Cancel coaching': { scope: 'orders:write',  gate: 'verified' },
    },
```

Workforce:

```js
    identityActions: [],
    caseSource: { path: '/api/admin/workforce/cases' },
    permissions: {
      'Approve':  { scope: 'expenses:write', gate: 'approval' },
      'Deny':     { scope: 'expenses:write', gate: 'approval' },
      'Resolve':  { scope: 'support:write',  gate: 'none' },
      'Complete': { scope: 'training:write', gate: 'verified' },
    },
```

The keys must match `cfg.actions` exactly — the last test in Step 1 fails on any mismatch.

- [ ] **Step 5: Run the test to verify it passes**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/resolvePermission.test.js`

Expected: PASS, all eight cases.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/supportConsole/
git commit -m "feat(admin): permission resolution for support console actions

resolvePermission maps declared permission, operator scopes and customer
verification to one of allowed / verify-first / approval / denied. A missing
permission entry resolves to denied rather than implicit allow, and a config
test fails if any declared action lacks one."
```

---

## Task 8: UI — identity gate wired to the server

The strip that shows verification state, starts a challenge, and gates the write buttons.
The server already refuses unverified writes; this makes the refusal visible before the
operator clicks.

**Files:**
- Create: `demo_api_ui/src/components/supportConsole/IdentityGate.jsx`
- Create: `demo_api_ui/src/components/supportConsole/IdentityGate.css`
- Create: `demo_api_ui/src/components/supportConsole/__tests__/IdentityGate.test.jsx`
- Modify: `demo_api_ui/src/components/supportConsole/SupportConsole.jsx`
- Modify: `demo_api_ui/src/components/supportConsole/SupportConsole.css`
- Modify: `demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.test.jsx`

**Interfaces:**
- Consumes: `resolvePermission`, `PERMISSION_LABEL` from Task 7; `POST /verify/initiate` and `GET /verify/status` from Task 5
- Produces: `<IdentityGate vertical customer verified onVerified />` — calls `onVerified(expiresAt)` after a successful initiate

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/supportConsole/__tests__/IdentityGate.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../utils/appToast', () => ({
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn(),
}));

import bffAxios from '../../../services/bffAxios';
import IdentityGate from '../IdentityGate';

const CUSTOMER = { id: 'u1', name: 'Marcus Hall' };

it('shows the unverified state and offers to send a code', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'false');
  expect(screen.getByRole('button', { name: /send one-time code/i })).toBeInTheDocument();
});

it('posts initiate for the selected customer and reports back', async () => {
  const expiresAt = Date.now() + 900000;
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });
  const onVerified = vi.fn();

  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified={false} onVerified={onVerified} />);
  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));

  await waitFor(() => expect(onVerified).toHaveBeenCalledWith(expiresAt));
  expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/admin/sporting-goods/verify/initiate',
    { customerId: 'u1' },
  );
});

it('shows the verified state without a send button', () => {
  render(<IdentityGate vertical="sporting-goods" customer={CUSTOMER} verified onVerified={() => {}} />);
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true');
  expect(screen.queryByRole('button', { name: /send one-time code/i })).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/IdentityGate.test.jsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `demo_api_ui/src/components/supportConsole/IdentityGate.jsx`:

```jsx
import React, { useCallback, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifyError, notifySuccess } from '../../utils/appToast';
import './IdentityGate.css';

// Shows whether THIS customer has been verified in THIS operator session, and
// starts the challenge. The server refuses unverified writes regardless of what
// this renders — the strip exists so the operator learns that before clicking,
// not so the client decides it.
export default function IdentityGate({ vertical, customer, verified, onVerified }) {
  const [sending, setSending] = useState(false);

  const sendCode = useCallback(async () => {
    if (!customer) return;
    setSending(true);
    try {
      const { data } = await bffAxios.post(
        `/api/admin/${vertical}/verify/initiate`,
        { customerId: customer.id },
      );
      notifySuccess('Customer verified.');
      onVerified(data.expiresAt);
    } catch (err) {
      const status = err?.response?.status;
      notifyError(
        status === 401
          ? 'Session expired — please sign in again.'
          : err?.response?.data?.error || 'Verification failed.',
      );
    } finally {
      setSending(false);
    }
  }, [vertical, customer, onVerified]);

  if (!customer) return null;

  return (
    <div className="idgate" data-testid="identity-gate" data-verified={String(!!verified)}>
      <span className={`idgate__badge idgate__badge--${verified ? 'ok' : 'warn'}`}>
        {verified ? '✅ Identity verified' : '⚠️ Not verified'}
      </span>
      <span className="idgate__text">
        {verified
          ? `${customer.name} confirmed it is them. Writes are enabled for this session.`
          : `Read-only until ${customer.name} confirms it is them. Writes are disabled.`}
      </span>
      {!verified && (
        <button type="button" className="idgate__btn" onClick={sendCode} disabled={sending}>
          {sending ? 'Sending…' : 'Send one-time code'}
        </button>
      )}
    </div>
  );
}
```

Both emoji used (`✅`, `⚠️`) are on the allowlist.

- [ ] **Step 4: Write the stylesheet**

Create `demo_api_ui/src/components/supportConsole/IdentityGate.css`:

```css
.idgate {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  margin: 0 0 1rem;
  border-radius: 10px;
  border: 1px solid #fcd34d;
  background: #fef3c7;
  color: #78350f;
  font-size: 0.875rem;
}
.idgate[data-verified='true'] {
  border-color: #86efac;
  background: #dcfce7;
  color: #14532d;
}
.idgate__badge {
  flex: none;
  font-weight: 700;
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.6);
}
.idgate__text { flex: 1; }
.idgate__btn {
  flex: none;
  padding: 0.35rem 0.8rem;
  border-radius: 8px;
  border: 1px solid currentColor;
  background: #fff;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.idgate__btn[disabled] { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/IdentityGate.test.jsx`

Expected: PASS, all three cases.

- [ ] **Step 6: Write the failing test for console wiring**

Append to `demo_api_ui/src/components/supportConsole/__tests__/SupportConsole.test.jsx`:

```jsx
it('disables gated action buttons until the customer is verified', async () => {
  bffAxios.get.mockResolvedValueOnce({
    data: {
      user: { id: 'u1', name: 'Marcus Hall' },
      data: { orders: [{ id: 'o1', product: 'Trail Runner GTX', amount: 189, status: 'Delivered' }] },
    },
  });
  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up a member/i), { target: { value: 'marcus' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));

  await waitFor(() => expect(screen.getByText('Marcus Hall')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /Cancel order/i })).toBeDisabled();
});

it('enables gated action buttons after verification', async () => {
  const expiresAt = Date.now() + 900000;
  bffAxios.get.mockResolvedValueOnce({
    data: {
      user: { id: 'u1', name: 'Marcus Hall' },
      data: { orders: [{ id: 'o1', product: 'Trail Runner GTX', amount: 189, status: 'Delivered' }] },
    },
  });
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });

  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up a member/i), { target: { value: 'marcus' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Marcus Hall')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Cancel order/i })).toBeEnabled(),
  );
});
```

- [ ] **Step 7: Run it to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/SupportConsole.test.jsx`

Expected: FAIL — the buttons render enabled; there is no gate in the console yet.

- [ ] **Step 8: Wire the gate into the console**

In `SupportConsole.jsx`, add imports:

```jsx
import IdentityGate from './IdentityGate';
import { resolvePermission } from './resolvePermission';
```

Add state beside the existing `result` state:

```jsx
  const [verifiedUntil, setVerifiedUntil] = useState(0);
```

Clear it whenever a new lookup lands — inside `doLookup`, right after
`setResult(cfg.adaptLookup(data))`:

```jsx
      setVerifiedUntil(0);
```

A new customer is a new call; carrying the previous customer's verification forward is the
exact confusion the server-side keying prevents, and the client must not contradict it.

Derive the state each render, below the `cfg` line:

```jsx
  const verified = verifiedUntil > Date.now();
  // Operator scopes are not yet surfaced to this component; until the evidence
  // rail lands (Phase 3) assume the scopes the vertical declares, so the gate
  // under test is verification rather than scope.
  const scopes = Object.values(cfg.permissions).map((p) => p.scope);
```

Render the gate directly above the `vops__grid` section:

```jsx
      {result?.customer && (
        <IdentityGate
          vertical={vertical}
          customer={result.customer}
          verified={verified}
          onVerified={setVerifiedUntil}
        />
      )}
```

Gate the row action buttons. Replace the existing action map:

```jsx
                    {r.actions.map((a) => (<button key={a} onClick={() => runAction(a, r, c.id)}>{a}</button>))}
```

with:

```jsx
                    {r.actions.map((a) => {
                      const state = resolvePermission({
                        permission: cfg.permissions[a], scopes, verified,
                      });
                      return (
                        <button
                          key={a}
                          type="button"
                          data-permission={state}
                          disabled={state !== 'allowed'}
                          title={state === 'allowed' ? a : `${a} — ${PERMISSION_LABEL[state]}`}
                          onClick={() => runAction(a, r, c.id)}
                        >
                          {state === 'allowed' ? a : `🔐 ${a}`}
                        </button>
                      );
                    })}
```

and extend the import to `import { resolvePermission, PERMISSION_LABEL } from './resolvePermission';`.
`🔐` is on the allowlist.

- [ ] **Step 9: Handle the server's 403 in runAction**

In `runAction`'s catch, replace the single `notifyError` line with:

```jsx
    } catch (err) {
      if (err?.response?.data?.error === 'customer_not_verified') {
        setVerifiedUntil(0);
        notifyError('Verify the customer before making changes.');
        return;
      }
      notifyError(err?.response?.data?.error || `${label} failed.`);
    }
```

This is what keeps the client honest: if the server disagrees with the client's idea of
verification, the server wins and the strip flips back.

- [ ] **Step 10: Run the tests to verify they pass**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/`

Expected: PASS — the two new cases plus the pre-existing console tests.

- [ ] **Step 11: Run the full unit suite and build**

Run from `demo_api_ui`: `npm run test:unit && npm run build`

Expected: both PASS.

- [ ] **Step 12: Commit**

```bash
git add demo_api_ui/src/components/supportConsole/
git commit -m "feat(admin): identity gate on the support console

Adds the verification strip and gates every action button through
resolvePermission. A new lookup clears verification, and a server 403
customer_not_verified flips the strip back — the client mirrors the server's
decision rather than making its own."
```

---

## Task 9: Case notes

What the operator wrote down. Needed for the console to read as a support tool rather than
a data browser.

**Files:**
- Modify: `demo_api_server/routes/adminVerticals.js`
- Modify: `demo_api_server/src/__tests__/adminVerticals.route.test.js`
- Create: `demo_api_ui/src/components/supportConsole/CaseNotes.jsx`
- Create: `demo_api_ui/src/components/supportConsole/CaseNotes.css`
- Create: `demo_api_ui/src/components/supportConsole/__tests__/CaseNotes.test.jsx`
- Modify: `demo_api_ui/src/components/supportConsole/SupportConsole.jsx`

**Interfaces:**
- Consumes: `recordAudit` and the session shim from Task 6
- Produces:
  - `GET  /api/admin/<vertical>/cases/:customerId/notes` → `{ vertical, data: { notes } }`, note shape `{ id, at, operator, body }`
  - `POST /api/admin/<vertical>/cases/:customerId/notes` body `{ body }` → `{ ok: true, note }`
  - `<CaseNotes vertical customerId />`

- [ ] **Step 1: Write the failing server test**

Append to `demo_api_server/src/__tests__/adminVerticals.route.test.js`:

```js
describe('case notes', () => {
  it('starts empty, accepts a note, and returns it', async () => {
    const a = makeSessionApp();

    const empty = await request(a).get('/api/admin/sporting-goods/cases/u1/notes');
    expect(empty.status).toBe(200);
    expect(empty.body.data.notes).toEqual([]);

    const post = await request(a)
      .post('/api/admin/sporting-goods/cases/u1/notes')
      .send({ body: 'Verified via OTP. Photos received.' });
    expect(post.status).toBe(200);
    expect(post.body.note.body).toBe('Verified via OTP. Photos received.');
    expect(post.body.note.at).toEqual(expect.any(String));

    const after = await request(a).get('/api/admin/sporting-goods/cases/u1/notes');
    expect(after.body.data.notes).toHaveLength(1);
  });

  it('rejects an empty note body with 400', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/cases/u1/notes')
      .send({ body: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('note body is required');
  });

  it('rejects a note against an unknown customer with 404', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/cases/ghost/notes')
      .send({ body: 'hello' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });
});
```

Notes are not gated on verification — writing down what happened during a call is not a
change to the customer's data, and blocking it would push operators to keep notes elsewhere.

- [ ] **Step 2: Run it to verify it fails**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js -t "case notes" --forceExit
```

Expected: FAIL with 404s.

- [ ] **Step 3: Implement the notes store and routes**

In `adminVerticals.js`, below the audit block from Task 6:

```js
// ── Case notes ────────────────────────────────────────────────────────────────
// In-memory, keyed `<vertical>:<customerId>`. Not gated on verification: a note
// records what happened on the call, it does not change customer data.
const caseNotes = new Map();

function notesKey(vertical, customerId) {
  return `${vertical}:${customerId}`;
}

function listNotes(req, res) {
  const vertical = req.params.vertical;
  const key = notesKey(vertical, req.params.customerId);
  res.json({ vertical, data: { notes: caseNotes.get(key) || [] } });
}

function addNote(req, res) {
  const vertical = req.params.vertical;
  const { customerId } = req.params;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'note body is required' });
  if (!isKnownUser(customerId)) return res.status(404).json({ error: 'unknown user' });

  const key = notesKey(vertical, customerId);
  if (!caseNotes.has(key)) caseNotes.set(key, []);
  const note = {
    id: `${key}:${caseNotes.get(key).length + 1}`,
    at: new Date().toISOString(),
    operator: req.user?.sub || req.user?.username || 'unknown',
    body,
  };
  caseNotes.get(key).push(note);
  res.json({ ok: true, note });
}

router.get('/:vertical/cases/:customerId/notes', listNotes);
router.post('/:vertical/cases/:customerId/notes', addNote);
```

Register these **after** the five per-vertical loops. `/:vertical/...` is a wildcard, and an
earlier registration would shadow the explicit routes above it.

- [ ] **Step 4: Run it to verify it passes**

Run from `demo_api_server`:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js --forceExit
```

Expected: PASS, the whole file.

- [ ] **Step 5: Write the failing UI test**

Create `demo_api_ui/src/components/supportConsole/__tests__/CaseNotes.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../utils/appToast', () => ({
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn(),
}));

import bffAxios from '../../../services/bffAxios';
import CaseNotes from '../CaseNotes';

it('loads and lists existing notes', async () => {
  bffAxios.get.mockResolvedValueOnce({
    data: { data: { notes: [{ id: 'n1', at: '2026-08-08T10:44:00.000Z', operator: 'dana', body: 'Photos received.' }] } },
  });
  render(<CaseNotes vertical="sporting-goods" customerId="u1" />);
  await waitFor(() => expect(screen.getByText('Photos received.')).toBeInTheDocument());
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/sporting-goods/cases/u1/notes');
});

it('posts a new note and shows it', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: { data: { notes: [] } } });
  bffAxios.post.mockResolvedValueOnce({
    data: { ok: true, note: { id: 'n1', at: '2026-08-08T10:45:00.000Z', operator: 'dana', body: 'Refund issued.' } },
  });

  render(<CaseNotes vertical="sporting-goods" customerId="u1" />);
  await waitFor(() => expect(screen.getByPlaceholderText(/Add a note/i)).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText(/Add a note/i), { target: { value: 'Refund issued.' } });
  fireEvent.click(screen.getByRole('button', { name: /save note/i }));

  await waitFor(() => expect(screen.getByText('Refund issued.')).toBeInTheDocument());
  expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/admin/sporting-goods/cases/u1/notes',
    { body: 'Refund issued.' },
  );
});
```

- [ ] **Step 6: Run it to verify it fails**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/CaseNotes.test.jsx`

Expected: FAIL — module not found.

- [ ] **Step 7: Write the component**

Create `demo_api_ui/src/components/supportConsole/CaseNotes.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifyError } from '../../utils/appToast';
import './CaseNotes.css';

export default function CaseNotes({ vertical, customerId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const path = `/api/admin/${vertical}/cases/${customerId}/notes`;

  useEffect(() => {
    let live = true;
    bffAxios
      .get(path)
      .then(({ data }) => { if (live) setNotes(data?.data?.notes || []); })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [path]);

  const save = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const { data } = await bffAxios.post(path, { body });
      setNotes((prev) => [...prev, data.note]);
      setDraft('');
    } catch (err) {
      notifyError(err?.response?.data?.error || 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }, [draft, path]);

  return (
    <section className="cnotes" aria-labelledby="cnotes-heading" data-testid="case-notes">
      <h3 id="cnotes-heading" className="cnotes__title">Case notes</h3>
      <ul className="cnotes__list">
        {notes.map((n) => (
          <li key={n.id} className="cnotes__item">
            <div className="cnotes__meta">
              {new Date(n.at).toLocaleString()} · {n.operator}
            </div>
            <div className="cnotes__body">{n.body}</div>
          </li>
        ))}
        {notes.length === 0 && <li className="cnotes__empty">No notes yet.</li>}
      </ul>
      <div className="cnotes__compose">
        <input
          aria-label="Add a note"
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" onClick={save} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Write the stylesheet**

Create `demo_api_ui/src/components/supportConsole/CaseNotes.css`:

```css
.cnotes {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  padding: 0.9rem 1rem;
}
.cnotes__title { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 650; }
.cnotes__list { list-style: none; margin: 0 0 0.75rem; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.cnotes__meta { font-size: 0.75rem; color: #64748b; font-weight: 600; }
.cnotes__body { font-size: 0.875rem; color: #334155; }
.cnotes__empty { font-size: 0.85rem; color: #94a3b8; }
.cnotes__compose { display: flex; gap: 0.5rem; }
.cnotes__compose input {
  flex: 1;
  padding: 0.45rem 0.65rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font: inherit;
}
.cnotes__compose button {
  padding: 0.45rem 0.9rem;
  border: 1px solid #0f172a;
  border-radius: 8px;
  background: #0f172a;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.cnotes__compose button[disabled] { opacity: 0.45; cursor: not-allowed; }
```

- [ ] **Step 9: Run the UI test to verify it passes**

Run from `demo_api_ui`: `npx vitest run src/components/supportConsole/__tests__/CaseNotes.test.jsx`

Expected: PASS, both cases.

- [ ] **Step 10: Mount it in the console**

In `SupportConsole.jsx`, add `import CaseNotes from './CaseNotes';` and render it below the
`vops__grid` section, before the token-chain `<details>`:

```jsx
      {result?.customer?.id && (
        <CaseNotes vertical={vertical} customerId={result.customer.id} />
      )}
```

Banking's `adaptLookup` can return a customer with no `id` (a bare account-number lookup),
which is why the guard checks `customer.id` rather than `customer`.

- [ ] **Step 11: Run everything**

Run from `demo_api_ui`: `npm run test:unit && npm run build`
Run from `demo_api_server`: `CI=true npm run test:unit`

Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add demo_api_server/routes/adminVerticals.js \
        demo_api_server/src/__tests__/adminVerticals.route.test.js \
        demo_api_ui/src/components/supportConsole/
git commit -m "feat(admin): case notes on the support console

GET/POST /api/admin/<vertical>/cases/:customerId/notes with an in-memory store,
plus the CaseNotes component. Notes are not gated on verification — recording
what happened on a call does not change customer data, and gating it would push
operators to keep notes somewhere the demo cannot show."
```

---

## Task 10: Phase gate — verify the whole thing holds

No new code. This is the checkpoint that decides whether Phase 1 is real.

**Files:** none

- [ ] **Step 1: Full UI gate**

Run from `demo_api_ui`:

```bash
npm run test:unit && npm run build
```

Expected: both PASS. Paste the result lines.

- [ ] **Step 2: Full BFF suite**

Run from `demo_api_server`:

```bash
CI=true npm test -- --forceExit
```

Expected: PASS. On a worker-contention flake, re-run with `--maxWorkers=4` before
treating it as a regression.

- [ ] **Step 3: Cross-service check**

Run from the repository root: `npm run topology:verify`

Expected: PASS.

- [ ] **Step 4: Re-prove revert-to-RED**

Temporarily set `ADMIN_WRITE = []` in `routes/adminVerticals.js` and run:

```bash
CI=true npx jest src/__tests__/adminVerticals.route.test.js -t "verification is enforced" --forceExit
```

Expected: FAIL. Restore and confirm green. A gate that cannot be broken by removing it was
never wired in.

- [ ] **Step 5: Emoji audit on everything touched**

```bash
grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' \
  demo_api_ui/src/components/supportConsole/ | \
  grep -vP '⚠️|✅|❌|🔐|✕|✓|👤|🔑|🪟|📚'
```

Expected: no output.

- [ ] **Step 6: Confirm the diff is scoped**

```bash
git branch --show-current
git diff --stat main...HEAD
```

Expected: the branch is the worktree branch, and every changed path is one this plan named.
Nothing under `demo_api_server/data/` — a BFF jest run regenerates 443 files there, and any
of them appearing means an accidental `git add -A`.

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-08-admin-support-console-design.md`:

**Covered:** Phase 0 in full (Tasks 1–3). Phase 1's rename (4), server verification store
(5), enforcement plus audit (6), permission model (7), identity gate (8), case notes (9),
and the gate (10). The spec's testing items 1–3, 8–11 map to Tasks 6–8; item 12 (queue
projection) belongs to Phase 3 and is not in this plan.

**Deliberately deferred, with reason recorded in "Deviations":** `identityActions`
rendering (no BFF endpoints exist; needs PingOne Management API work against a live
environment). Phases 2–4 get their own plans.

**Spec correction found while planning:** the spec described vertical writes as "guarded by
`ADMIN_WRITE`". They were not — `ADMIN_WRITE` was `[]`. Recorded in "Deviations" and fixed
by Task 6.

**One spec detail changed by evidence:** the spec put the operator-audit *display* in
Phase 3 but did not say when recording starts. Recording starts in Task 6, because a gate
whose denials are not recorded cannot be audited after the fact.

**Type consistency:** `resolvePermission({ permission, scopes, verified })` and its four
return values are used identically in Tasks 7 and 8. `markCustomerVerified` /
`isCustomerVerified` / `SUPPORT_VERIFY_TTL_MS` are named identically in Tasks 5, 6 and the
middleware. `recordAudit(req, { action, customerId, outcome })` has one shape across Tasks
6 and 9. The note shape `{ id, at, operator, body }` matches between the server route and
the UI component.
