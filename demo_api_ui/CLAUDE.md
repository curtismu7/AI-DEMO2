# demo_api_ui — React UI

Inherits the root [CLAUDE.md](../CLAUDE.md) and `REGRESSION_PLAN.md` §0–§1.
Everything below is additive and UI-only.

## Stack

- React 19.2 · Vite 8 (`vite.config.js`) · plain JS/JSX — **no TypeScript sources**
- Vitest 3.2 for unit (jsdom, `globals: true`, setup `src/setupTests.js`) — **not jest**
- Playwright 1.59 for E2E · Biome 2.5 + ESLint 8 + Prettier 3 · Node >= 22

## Layout

```text
src/
├── pages/        route-level screens
├── components/   shared UI (DraggableModal, ConfirmModal, …)
├── services/     network + client state (apiClient, *Store)
├── hooks/ context/ utils/
├── vertical/     per-vertical config (banking, healthcare, retail, …)
└── styles/ theme/
tests/e2e/        Playwright specs — excluded from vitest
```

## Verify before claiming done

```bash
npm run test:unit    # vitest run
npm run build        # vite build — the gate; a green test run is not enough
```

E2E needs a running stack **on `local.ping-devops.com:4000`** (see root "Watch out").

## Ad-hoc probes against the live stack

Driving the real app to check something? Use `tests/e2e/helpers/uiProbe.js` with
`realLogin.js` — do not hand-roll a wait.

```js
await loginAsCustomer(page);          // realLogin.js owns sign-in (nav button is 0x0 headless)
const seen = await settle(page);      // THROWS if the page never renders — never returns a 0
await requireVertical(page, 'sporting-goods');  // THROWS if the session resolved elsewhere
```

**Never `networkidle`** — the app holds SSE open, so it does not fire. Both helpers
throw rather than returning falsy, because a falsy return is what gets written up
as a finding: a probe that sampled too early once produced "renders nothing" for a
page that renders 1381 characters, and a retail phrase submitted into a banking
session was nearly reported as a broken feature.

Pair it with `npm run -s stack:generation` before/after, or another session
recreating the stack mid-run will look like an application bug.

## Modals — always DraggableModal

- ❌ hand-rolled overlay `<div>`, raw `<dialog>`, `window.confirm()`
- ✅ `<DraggableModal>` for panels, `<ConfirmModal>` for yes/no

ESLint warns on `window.confirm`. This is a standing rule — don't ask.

## Toasts — never import `toast` directly

- ❌ `import { toast } from 'react-toastify'`
- ✅ `import { notifyError, notifySuccess } from '../utils/appToast'`

ESLint `no-restricted-imports` enforces it. Only `utils/appToast.js`,
`utils/dashboardToast.js`, `components/ErrorToast.js` may import `toast`.

## HTTP — go through apiClient

- ❌ `axios.get('/api/accounts')` inside a component
- ✅ `import apiClient from '../services/apiClient'`

`apiClient` owns baseURL resolution, `withCredentials`, traffic capture for the
inspector, and the session-expired toast. 73 modules import it; 22 legacy files
still call `axios` directly — do not add a 23rd.

## Feature flags

A use-case chip that needs a flag must be listed in the UI mirror
`src/utils/requiredDemoFlags.js` — the only pre-Run arming path. Dropping an entry
there silently breaks the chip at demo time; unit tests force every `ff_*` ON
and will not catch it.
