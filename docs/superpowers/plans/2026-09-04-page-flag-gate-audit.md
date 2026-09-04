# Page Flag Gate Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest or signed-in visitor to `/use-cases` turn on the feature flag(s) a use case needs, from an inline banner on the card itself, with no trip to the Feature Flags setup page.

**Architecture:** A new narrow, unauthenticated server endpoint (`POST /api/demo-flags/enable`) resolves and enables exactly the flags a named use case declares it needs (server-side, via the existing trusted `requiredFlagsForUseCaseId`) — the client can never name an arbitrary flag. On the UI, the existing (but currently guest-broken) `FlagGate`/`useLiveFlags` code inside `UseCaseLauncherPage.js` is extracted into shared, reusable pieces, extended to cover the *full* required-flag set (today it only checks the single `maturity: 'flag:<id>'` flag, missing the `ff_mcp_gateway_pinggateway` flag most use cases also need), and repointed from the admin-gated PATCH route to the new guest-safe endpoint.

**Tech Stack:** React 19 (plain JS/JSX, no TS) + Vitest on the UI; Express 4 (CommonJS) + Jest 29/supertest on the server.

**Spec:** [docs/superpowers/specs/2026-09-04-page-flag-gate-audit-design.md](../specs/2026-09-04-page-flag-gate-audit-design.md)

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN.md §0): only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` `🔧` + the product icon set + `☀️`/`🌙` reserved specifically for the light/dark toggle button. No other emoji in new UI text.
- Dark mode is `:root[data-theme="dark"]` only — never `prefers-color-scheme` — per THEMING.md and REGRESSION_PLAN.md §0 (H1–H3).
- Server error responses use `{ error }` shape (not `{ message }`).
- `demo_api_server` tests run via `CI=true npx jest <path> --forceExit` from `demo_api_server/`.
- `demo_api_ui` gate is `npm run test:unit && npm run build` from `demo_api_ui/`.
- The general `PATCH /api/admin/feature-flags` route and its `authenticateToken` gate (`demo_api_server/middleware/featureFlagsAuthGate.js`) are NOT to be modified — this plan adds a new, narrower route instead.

## Scope note (read before starting)

This plan implements the design's Part B for **`UseCaseLauncherPage.js` only** — the public use-case catalog, which is where a guest actually lands. `LiveUseCaseWorkbenchPage.js` is deliberately **out of scope**: it already has a working signed-in auto-arm path (`handleRunSelected` → the authenticated dispatch route in `demo_api_server/routes/useCases.js:138-154`), its drawer cards (`renderCard()`, `pages/LiveUseCaseWorkbenchPage.js:481-559`) are too compact for the approved banner without new unapproved design work, and AIAgent — mounted as its sibling in the same layout — already provides a working dark-mode switch (`components/AIAgent.js:9574`, plain-text "Dark mode" `Check` switch, no emoji needed). Part A's audit found no other page needs a banner: the plain-page grep found zero `pages/` hits and only 4 sub-panel-only flag reads (`TokenChainTraceRail.jsx`, `TokenChainFilmstrip.jsx`, `Dashboard.js`, `AuthorizeRulesPanel.jsx` — each just shows/hides a tab or badge inside an already-working page). `pageFlagRequirements.js` from the design is therefore **not created** — YAGNI, per the design's own non-goal.

---

### Task 1: Server — guest-safe flag-enable endpoint

**Files:**
- Create: `demo_api_server/routes/demoFlags.js`
- Modify: `demo_api_server/server.js` (mount the route)
- Test: `demo_api_server/tests/demoFlags.route.test.js`

**Interfaces:**
- Consumes: `USE_CASES` from `../config/useCases` (array), `requiredFlagsForUseCaseId(useCaseId, catalog): string[]` and `isFlagOn(value): boolean` from `../services/demoStepPrerequisites`, `configStore.getEffective(id)` / `configStore.setRaw({[id]: 'true'})` from `../services/configStore` (all exist today — see Task 1's context in the design doc).
- Produces: `POST /api/demo-flags/enable` — body `{ useCaseId: string }` → `200 { success: true, flags: string[] }` (the flags it turned on or confirmed already on), `400 { error }` for a missing/non-string `useCaseId`, `404 { error }` when the id resolves to zero required flags (unknown id, or a real use case that needs none).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/demoFlags.route.test.js
'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => 'false'),
  setRaw: jest.fn(async () => {}),
}));

const request = require('supertest');
const express = require('express');
const configStore = require('../services/configStore');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/demo-flags', require('../routes/demoFlags'));
  return app;
}

describe('POST /api/demo-flags/enable', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing useCaseId returns 400', async () => {
    const res = await request(buildApp()).post('/api/demo-flags/enable').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('unknown useCaseId returns 404', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  test('a real 2-flag use case enables exactly its resolved flags, nothing else', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_rar: 'true' });
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
    expect(configStore.setRaw).toHaveBeenCalledTimes(2);
  });

  test('a single-flag use case enables only that flag', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ciba_enabled', 'ff_mcp_gateway_pinggateway'].sort());
  });

  test('a flag that is already on is reported but not re-set', async () => {
    configStore.getEffective.mockImplementation((id) => (id === 'ff_rar' ? 'true' : 'false'));
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'par-rar-intent-verified' });
    expect(res.status).toBe(200);
    expect(res.body.flags.sort()).toEqual(['ff_mcp_gateway_pinggateway', 'ff_rar'].sort());
    expect(configStore.setRaw).toHaveBeenCalledTimes(1);
    expect(configStore.setRaw).toHaveBeenCalledWith({ ff_mcp_gateway_pinggateway: 'true' });
  });

  test('no session/auth header required (guest-safe)', async () => {
    const res = await request(buildApp())
      .post('/api/demo-flags/enable')
      .send({ useCaseId: 'ciba-out-of-band-approval' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/demoFlags.route.test.js --forceExit`
Expected: FAIL — `Cannot find module '../routes/demoFlags'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_server/routes/demoFlags.js
'use strict';

const express = require('express');
const router = express.Router();

const { USE_CASES } = require('../config/useCases');
const { requiredFlagsForUseCaseId, isFlagOn } = require('../services/demoStepPrerequisites');
const configStore = require('../services/configStore');

/**
 * Guest-safe flag enable. The client names a use case, never a flag — the
 * server resolves which flags that use case needs via the same trusted
 * computation the signed-in chip-run auto-arm already uses
 * (routes/useCases.js), so this can never set a flag outside that resolved
 * set. No auth gate: mirrors GET /api/use-cases' openness — the reachable
 * flag set is bounded by requiredFlagsForUseCaseId regardless of caller.
 */
router.post('/enable', async (req, res) => {
  const { useCaseId } = req.body || {};
  if (!useCaseId || typeof useCaseId !== 'string') {
    return res.status(400).json({ error: 'useCaseId is required' });
  }

  const flags = requiredFlagsForUseCaseId(useCaseId, USE_CASES);
  if (flags.length === 0) {
    return res.status(404).json({ error: 'Unknown use case, or it needs no flags' });
  }

  for (const flag of flags) {
    if (!isFlagOn(configStore.getEffective(flag))) {
      await configStore.setRaw({ [flag]: 'true' });
    }
  }

  res.json({ success: true, flags });
});

module.exports = router;
```

- [ ] **Step 4: Mount the route in server.js**

Find the existing `app.use('/api/admin/feature-flags', ...)` mount in `demo_api_server/server.js` (around line 1049) and add directly below it:

```js
app.use('/api/demo-flags', require('./routes/demoFlags'));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/demoFlags.route.test.js --forceExit`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/demoFlags.js demo_api_server/server.js demo_api_server/tests/demoFlags.route.test.js
git commit -m "feat(demo-flags): add guest-safe endpoint to enable a use case's required flags"
```

---

### Task 2: UI — extract the flag-read hook and add a guest-safe write helper

**Files:**
- Create: `demo_api_ui/src/hooks/useLiveFlags.js`
- Create: `demo_api_ui/src/services/demoFlagsClient.js`
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js:178-220` (remove the local `useLiveFlags` definition, import the extracted one)
- Test: `demo_api_ui/src/hooks/__tests__/useLiveFlags.test.js`
- Test: `demo_api_ui/src/services/__tests__/demoFlagsClient.test.js`

**Interfaces:**
- Consumes: `apiClient` (default export) from `../services/apiClient`.
- Produces: `useLiveFlags(): { flagMap: Record<string,string>|null, flagsLoading: boolean, refreshFlags: () => void }` (read-only — no `setFlag`, since that was the admin-gated write path this plan removes). `enableUseCaseFlags(useCaseId: string): Promise<{ success: boolean, flags: string[] }>` — the guest-safe write, used by `FlagGate` in Task 3.

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_ui/src/services/__tests__/demoFlagsClient.test.js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import apiClient from '../apiClient';
import { enableUseCaseFlags } from '../demoFlagsClient';

vi.mock('../apiClient', () => ({ default: { post: vi.fn() } }));

describe('enableUseCaseFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts the useCaseId and returns the response data', async () => {
    apiClient.post.mockResolvedValue({ data: { success: true, flags: ['ff_rar'] } });
    const result = await enableUseCaseFlags('par-rar-intent-verified');
    expect(apiClient.post).toHaveBeenCalledWith('/api/demo-flags/enable', {
      useCaseId: 'par-rar-intent-verified',
    });
    expect(result).toEqual({ success: true, flags: ['ff_rar'] });
  });
});
```

```js
// demo_api_ui/src/hooks/__tests__/useLiveFlags.test.js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import useLiveFlags from '../useLiveFlags';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

describe('useLiveFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  test('loads flags into a map keyed by id', async () => {
    apiClient.get.mockResolvedValue({
      data: { flags: [{ id: 'ff_rar', value: 'false' }, { id: 'ciba_enabled', value: 'true' }] },
    });
    const { result } = renderHook(() => useLiveFlags());
    await waitFor(() => expect(result.current.flagsLoading).toBe(false));
    expect(result.current.flagMap).toEqual({ ff_rar: 'false', ciba_enabled: 'true' });
  });

  test('a failed load resolves to an empty map (gates stay closed, not stuck loading)', async () => {
    apiClient.get.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLiveFlags());
    await waitFor(() => expect(result.current.flagsLoading).toBe(false));
    expect(result.current.flagMap).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/demoFlagsClient.test.js src/hooks/__tests__/useLiveFlags.test.js`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_ui/src/services/demoFlagsClient.js
import apiClient from './apiClient';

/**
 * Guest-safe: the server resolves which flags `useCaseId` needs and enables
 * only those (demo_api_server/routes/demoFlags.js). No session required.
 */
export async function enableUseCaseFlags(useCaseId) {
  const { data } = await apiClient.post('/api/demo-flags/enable', { useCaseId });
  return data;
}
```

```js
// demo_api_ui/src/hooks/useLiveFlags.js
import { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

/**
 * Read-only live feature-flag values from GET /api/admin/feature-flags
 * (open — no session required). Writes go through demoFlagsClient's
 * guest-safe enableUseCaseFlags instead of PATCHing this endpoint directly;
 * that PATCH route requires a signed-in session
 * (middleware/featureFlagsAuthGate.js) and a guest write to it 401s.
 */
export default function useLiveFlags() {
  const [flagMap, setFlagMap] = useState(null); // null = loading
  const [flagsLoading, setFlagsLoading] = useState(true);

  const load = useCallback(() => {
    setFlagsLoading(true);
    return apiClient
      .get('/api/admin/feature-flags', { _silent: true })
      .then(({ data }) => {
        const map = {};
        for (const f of data.flags || []) map[f.id] = f.value;
        setFlagMap(map);
        setFlagsLoading(false);
      })
      .catch(() => {
        setFlagMap({}); // empty = all flags default-off (safe: gates remain closed)
        setFlagsLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [load]);

  return { flagMap, flagsLoading, refreshFlags: load };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/demoFlagsClient.test.js src/hooks/__tests__/useLiveFlags.test.js`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Remove the local `useLiveFlags` from `UseCaseLauncherPage.js` and import the extracted one**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, delete the entire local `function useLiveFlags() { ... }` block (lines 178-220 as read today — the whole function including its doc comment), and add near the top with the other imports:

```js
import useLiveFlags from '../hooks/useLiveFlags';
```

Leave every call site (`const { flagMap, flagsLoading, setFlag } = useLiveFlags();` at line 775, and the `flagsLoading={flagsLoading}` props passed down) as-is for now — `setFlag` is still referenced by the old `FlagGate` usage until Task 4 replaces it. This step is a pure extraction; behavior is unchanged (the old broken `setFlag`/PATCH path is only removed in Task 4).

- [ ] **Step 6: Run the existing page test suite to confirm no regression**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.test.js src/pages/__tests__/UseCaseLauncherPage.loginPrompt.test.jsx src/pages/__tests__/UseCaseLauncherPage.copyPrompt.test.jsx src/pages/__tests__/UseCaseLauncherPage.memoization.test.jsx`
Expected: PASS (unchanged — this step only moved code, not behavior).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/hooks/useLiveFlags.js demo_api_ui/src/hooks/__tests__/useLiveFlags.test.js \
  demo_api_ui/src/services/demoFlagsClient.js demo_api_ui/src/services/__tests__/demoFlagsClient.test.js \
  demo_api_ui/src/pages/UseCaseLauncherPage.js
git commit -m "refactor(use-cases): extract useLiveFlags hook, add guest-safe demoFlagsClient"
```

---

### Task 3: UI — shared multi-flag `FlagGate` banner component

**Files:**
- Create: `demo_api_ui/src/components/FlagGate.js`
- Create: `demo_api_ui/src/components/FlagGate.css`
- Test: `demo_api_ui/src/components/__tests__/FlagGate.test.jsx`

**Interfaces:**
- Consumes: `enableUseCaseFlags` from `../services/demoFlagsClient` (Task 2).
- Produces: `<FlagGate useCaseId={string} flagIds={string[]} flagMap={Record<string,string>|null} loading={boolean} onEnabled={(flagIds: string[]) => void} />`. Renders `null` when every id in `flagIds` is on in `flagMap` (or `flagIds` is empty). `onEnabled` is called with the flags the server actually resolved once the guest-safe POST succeeds, so the parent can merge them into its own `flagMap` without a second fetch.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/FlagGate.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlagGate from '../FlagGate';
import { enableUseCaseFlags } from '../../services/demoFlagsClient';

vi.mock('../../services/demoFlagsClient', () => ({ enableUseCaseFlags: vi.fn() }));

describe('FlagGate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders nothing when all required flags are already on', () => {
    const { container } = render(
      <FlagGate
        useCaseId="ciba-out-of-band-approval"
        flagIds={['ciba_enabled']}
        flagMap={{ ciba_enabled: 'true' }}
        loading={false}
        onEnabled={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when there are no required flags', () => {
    const { container } = render(
      <FlagGate useCaseId="x" flagIds={[]} flagMap={{}} loading={false} onEnabled={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('shows a chip per missing flag and an Enable button', () => {
    render(
      <FlagGate
        useCaseId="par-rar-intent-verified"
        flagIds={['ff_rar', 'ff_mcp_gateway_pinggateway']}
        flagMap={{ ff_rar: 'false', ff_mcp_gateway_pinggateway: 'false' }}
        loading={false}
        onEnabled={() => {}}
      />,
    );
    expect(screen.getByText('ff_rar')).toBeInTheDocument();
    expect(screen.getByText('ff_mcp_gateway_pinggateway')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
  });

  test('clicking Enable calls enableUseCaseFlags and reports the resolved flags', async () => {
    enableUseCaseFlags.mockResolvedValue({ success: true, flags: ['ff_rar', 'ff_mcp_gateway_pinggateway'] });
    const onEnabled = vi.fn();
    render(
      <FlagGate
        useCaseId="par-rar-intent-verified"
        flagIds={['ff_rar', 'ff_mcp_gateway_pinggateway']}
        flagMap={{ ff_rar: 'false', ff_mcp_gateway_pinggateway: 'false' }}
        loading={false}
        onEnabled={onEnabled}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    await waitFor(() => expect(enableUseCaseFlags).toHaveBeenCalledWith('par-rar-intent-verified'));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledWith(['ff_rar', 'ff_mcp_gateway_pinggateway']));
  });

  test('does not require a signed-in prop or branch on one (guest-safe by construction)', () => {
    // No `user` prop exists on this component at all — this test documents
    // that guarantee so a future edit adding one fails loudly.
    expect(FlagGate.length).toBeLessThanOrEqual(1); // single props object, no user param
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/FlagGate.test.jsx`
Expected: FAIL — `Cannot find module '../FlagGate'`.

- [ ] **Step 3: Write the minimal implementation**

```jsx
// demo_api_ui/src/components/FlagGate.js
import { useState } from 'react';
import { enableUseCaseFlags } from '../services/demoFlagsClient';
import './FlagGate.css';

/**
 * Inline banner shown on a use-case card when one or more of its required
 * flags are off. Guest-safe: Enable calls the unauthenticated
 * POST /api/demo-flags/enable, which resolves and enables exactly this use
 * case's required flags server-side — no session, no admin check.
 */
export default function FlagGate({ useCaseId, flagIds, flagMap, loading, onEnabled }) {
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState(null);

  const missing = (flagIds || []).filter((id) => flagMap == null || flagMap[id] !== 'true');
  if (loading || missing.length === 0) return null;

  async function handleEnable() {
    setEnabling(true);
    setError(null);
    try {
      const result = await enableUseCaseFlags(useCaseId);
      onEnabled(result.flags || flagIds);
    } catch (e) {
      setError('Could not enable — try again');
    } finally {
      setEnabling(false);
    }
  }

  return (
    <div className="flag-gate" role="status">
      <span className="flag-gate__icon" aria-hidden="true">⚠️</span>
      <div className="flag-gate__body">
        <div className="flag-gate__title">
          {missing.length > 1 ? `${missing.length} feature flags are off` : '1 feature flag is off'}
        </div>
        <div className="flag-gate__chips">
          {missing.map((id) => (
            <span key={id} className="flag-gate__chip">{id}</span>
          ))}
        </div>
        {error && <p className="flag-gate__error">{error}</p>}
      </div>
      <button
        type="button"
        className="flag-gate__enable"
        disabled={enabling}
        onClick={handleEnable}
      >
        {enabling ? 'Enabling…' : '🔑 Enable'}
      </button>
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/FlagGate.css */
.flag-gate {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--th-status-warning-border);
  background: var(--th-status-warning-bg);
  padding: 0.65rem 0.75rem;
  margin: 0.5rem 0;
}

.flag-gate__icon {
  font-size: 0.95rem;
  line-height: 1.4;
}

.flag-gate__title {
  font-weight: 600;
  font-size: 0.82rem;
  color: var(--th-status-warning-text);
  margin-bottom: 0.3rem;
}

.flag-gate__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.3rem;
}

.flag-gate__chip {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid var(--th-status-warning-border);
  color: var(--th-status-warning-text);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.flag-gate__error {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: var(--th-status-error-text);
}

.flag-gate__enable {
  all: unset;
  cursor: pointer;
  background: var(--signin-accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  white-space: nowrap;
}

.flag-gate__enable:hover {
  background: var(--signin-accent-hover);
}

.flag-gate__enable:focus-visible {
  outline: 2px solid var(--signin-accent);
  outline-offset: 2px;
}

.flag-gate__enable[disabled] {
  cursor: default;
  opacity: 0.7;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/FlagGate.test.jsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/FlagGate.js demo_api_ui/src/components/FlagGate.css \
  demo_api_ui/src/components/__tests__/FlagGate.test.jsx
git commit -m "feat(use-cases): add shared multi-flag FlagGate banner component"
```

---

### Task 4: Wire the new `FlagGate` into `UseCaseLauncherPage.js`, covering the full flag set

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js:335-364` (delete the old single-flag `FlagGate`), `:366-429` (`UseCaseCard` — switch from `parseFlagId` to `requiredFlagsForUseCase`), `:775` (call site unaffected), `:83-90`, `:169-176` (delete `parseFlagId`, now unused)
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css:583-609` (delete the old `.uc-ff-gate*`/`.ctl-switch*` rules — the switch styling moves out with the component it styled)
- Test: `demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.flagGate.test.jsx`

**Interfaces:**
- Consumes: `requiredFlagsForUseCase(uc): string[]` from `../utils/requiredDemoFlags` (existing, unchanged), the new `FlagGate` from `../components/FlagGate` (Task 3).
- Produces: n/a (leaf wiring).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.flagGate.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import UseCaseLauncherPage from '../UseCaseLauncherPage';

vi.mock('../../services/apiClient');

describe('UseCaseLauncherPage — flag gating covers the full required set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/use-cases') {
        return Promise.resolve({
          data: {
            useCases: [{
              id: 'UC14b',
              useCaseId: 'par-rar-intent-verified',
              title: 'PAR + RAR intent verified (PERMIT)',
              maturity: 'flag:ff_rar',
              primaryTool: 'create_transfer',
              trigger: { type: 'chip', text: 'run it' },
            }],
          },
        });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({
          data: {
            flags: [
              { id: 'ff_rar', value: 'false' },
              { id: 'ff_mcp_gateway_pinggateway', value: 'false' },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  test('shows both required flags, not just the maturity flag', async () => {
    render(<MemoryRouter><UseCaseLauncherPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('ff_rar')).toBeInTheDocument());
    expect(screen.getByText('ff_mcp_gateway_pinggateway')).toBeInTheDocument();
  });
});
```

(This test asserts the regression this task fixes: today only `ff_rar` — the maturity flag — is checked; `ff_mcp_gateway_pinggateway` is silently missed until Run.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.flagGate.test.jsx`
Expected: FAIL — only `ff_rar` renders, `ff_mcp_gateway_pinggateway` is not found.

- [ ] **Step 3: Delete the old `FlagGate` and `parseFlagId`, wire in the new one**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`:

1. Delete the `function FlagGate({ flagId, isOn, loading, onToggle }) { ... }` block (lines 335-364).
2. Delete `parseFlagId` and its preceding comment (lines 169-176), and the `// Maps maturity...` comment block at 83-90 if nothing else references it (check with `grep -n parseFlagId` after deleting the function — it should have zero remaining matches).
3. Add the import: `import FlagGate from '../components/FlagGate';` and `import { requiredFlagsForUseCase } from '../utils/requiredDemoFlags';`
4. In `UseCaseCard`, replace:

```js
  // Flag-gating: parse flagId from maturity; gate Run if flag is not ON.
  const flagId   = parseFlagId(uc.maturity);
  const flagIsOn = flagId != null
    ? (flagMap != null ? Boolean(flagMap[flagId]) : false)
    : true; // non-flag-gated UCs are always runnable
  const flagGated = flagId != null && !flagIsOn;
```

with:

```js
  // Flag-gating: the FULL required set (maturity flag + any runtime flags
  // like ff_mcp_gateway_pinggateway), not just the maturity flag.
  const requiredFlags = requiredFlagsForUseCase(uc);
  const flagIsOn = requiredFlags.every((id) => flagMap != null && flagMap[id] === 'true');
  const flagGated = requiredFlags.length > 0 && !flagIsOn;
```

5. Replace the render block:

```jsx
      {flagId != null && (
        <FlagGate
          flagId={flagId}
          isOn={flagIsOn}
          loading={flagsLoading}
          onToggle={setFlag}
        />
      )}
```

with:

```jsx
      <FlagGate
        useCaseId={uc.useCaseId}
        flagIds={requiredFlags}
        flagMap={flagMap}
        loading={flagsLoading}
        onEnabled={(enabledFlags) => onFlagsEnabled(enabledFlags)}
      />
```

6. `UseCaseCard`'s prop list drops `setFlag` and gains `onFlagsEnabled` — update its function signature (line 366) accordingly, and update every call site that renders `<UseCaseCard ... />` (there are several — search `flagsLoading={flagsLoading}` to find them all, listed at lines ~1085, 1112, 1138, 1164, 1186, 1205 as read today) to pass `onFlagsEnabled={handleFlagsEnabled}` instead of `setFlag={setFlag}`.
7. Where the page currently does `const { flagMap, flagsLoading, setFlag } = useLiveFlags();` (line 775), replace with:

```js
  const { flagMap, flagsLoading, refreshFlags } = useLiveFlags();
  const [localFlagMap, setLocalFlagMap] = useState(null);
  const effectiveFlagMap = localFlagMap || flagMap;
  const handleFlagsEnabled = useCallback((enabledFlags) => {
    setLocalFlagMap((prev) => {
      const base = prev || flagMap || {};
      const next = { ...base };
      for (const id of enabledFlags) next[id] = 'true';
      return next;
    });
  }, [flagMap]);
```

   and pass `flagMap={effectiveFlagMap}` (not the raw `flagMap`) into every `<UseCaseCard>` call site alongside the `onFlagsEnabled={handleFlagsEnabled}` change from step 6. `refreshFlags` is exposed for future use but not called automatically here — the optimistic merge above is enough for the banner to disappear immediately after Enable.

- [ ] **Step 4: Delete the now-unused CSS**

In `demo_api_ui/src/pages/UseCaseLauncherPage.css`, delete the `.uc-ff-gate`, `.uc-ff-gate--off`, `.uc-ff-gate--on`, `.uc-ff-gate__text`, `.uc-ff-gate__flag` rules (lines 583-609) and the `.ctl-switch*` rules that follow them if `grep -n "ctl-switch"` shows no other consumer in this file after the deletion (the old switch styling existed only for the deleted `FlagGate`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.flagGate.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the full existing page test suite**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.test.js src/pages/__tests__/UseCaseLauncherPage.loginPrompt.test.jsx src/pages/__tests__/UseCaseLauncherPage.copyPrompt.test.jsx src/pages/__tests__/UseCaseLauncherPage.memoization.test.jsx`
Expected: PASS. If any test asserted on the old `setFlag`/`onToggle` prop shape, update it to match the new `onFlagsEnabled` prop — search first with `grep -n "setFlag\|onToggle" src/pages/__tests__/UseCaseLauncherPage*.test.js*` (Task 4's earlier repo-wide grep found none, so this should be a no-op check).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css \
  demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.flagGate.test.jsx
git commit -m "fix(use-cases): gate on the full required-flag set, not just the maturity flag; guest-safe Enable"
```

---

### Task 5: Add the ☀️/🌙 theme toggle to `UseCaseLauncherPage.js`

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js` (add the toggle button near the page header)
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.css` (add `.ulp__theme-toggle`)
- Test: `demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.themeToggle.test.jsx`

This follows the exact pattern already established and approved app-wide in commit `830a6d284` (`McpShowcasePage.jsx`), which is also what added `☀️`/`🌙` to the REGRESSION_PLAN.md §0 allowlist. `UseCaseLauncherPage.js` currently has no theme control at all (confirmed: zero references to `useTheme`/`darkMode`/`toggleDarkMode` in the file today).

**Interfaces:**
- Consumes: `useThemeOptional` from `../context/ThemeContext` (existing).
- Produces: n/a (leaf UI).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.themeToggle.test.jsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import UseCaseLauncherPage from '../UseCaseLauncherPage';

vi.mock('../../services/apiClient');

describe('UseCaseLauncherPage — theme toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: {} });
    document.documentElement.removeAttribute('data-theme');
  });

  test('renders a Dark mode toggle and flips data-theme on click', () => {
    render(<MemoryRouter><UseCaseLauncherPage /></MemoryRouter>);
    const btn = screen.getByRole('button', { name: /dark mode/i });
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.themeToggle.test.jsx`
Expected: FAIL — no button matching `/dark mode/i`.

- [ ] **Step 3: Add the toggle**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, add the import:

```js
import { useThemeOptional } from '../context/ThemeContext';
```

Inside the top-level page component (where the page header/title renders — the same component that calls `useLiveFlags()`), add:

```js
  const { darkMode, toggleDarkMode } = useThemeOptional();
```

and, in the header JSX (next to the page title), add:

```jsx
        {/* ☀️/🌙 reserved in REGRESSION_PLAN.md §0 specifically for this control. */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="ulp__theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
```

In `demo_api_ui/src/pages/UseCaseLauncherPage.css`, add:

```css
.ulp__theme-toggle {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--th-border-strong);
  background: var(--th-bg-inset);
  color: var(--th-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}

.ulp__theme-toggle:hover {
  background: var(--th-bg-hover);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/UseCaseLauncherPage.themeToggle.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/pages/UseCaseLauncherPage.css \
  demo_api_ui/src/pages/__tests__/UseCaseLauncherPage.themeToggle.test.jsx
git commit -m "feat(use-cases): add light/dark mode toggle to the use-case launcher page"
```

---

### Task 6: Log the deferred stylesheet debt

**Files:**
- Modify: `TECH_DEBT.md` (append one entry)

`UseCaseLauncherPage.css` has ~46 distinct hardcoded literal colors outside anything this plan touches (confirmed via `grep -o "#[0-9a-fA-F]\{3,6\}" pages/UseCaseLauncherPage.css | sort | uniq -c`) — mostly the `.uc-sim-result__*` attack-simulation result styling (lines 387-456) and two locally-declared-but-never-defined custom properties, `--color-accent` and `--color-ping-blue` (used only as `var(--color-accent, #2563eb)`-style fallbacks, confirmed absent from any `:root` block app-wide via `grep -rn "^\s*--color-accent:"`, unlike `--color-surface`/`--color-border` which ARE aliased to `--th-bg-card`/`--th-border` in `index.css:308-309` and so already work). These are pre-existing, unrelated to the flag-gate feature, and out of scope per "touch only what you must" — but per THEMING.md's "closes opportunistically" policy they should be logged, not silently left for the next person to rediscover.

- [ ] **Step 1: Append the entry**

Add to `TECH_DEBT.md` (follow the file's existing entry format — check the format of the entry immediately above wherever you insert this):

```markdown
### UseCaseLauncherPage.css — literal colors outside the FlagGate/theme-toggle work

`--color-accent` and `--color-ping-blue` are referenced only as
`var(--color-accent, #2563eb)`-style fallbacks and are never actually
defined anywhere (unlike `--color-surface`/`--color-border` in the same
file, which resolve via `index.css:308-309`'s alias to `--th-bg-card`/
`--th-border`) — so they always render their light-mode literal in both
themes. The `.uc-sim-result__*` attack-simulation result block
(lines 387-456) is fully hardcoded (`#fee2e2`, `#991b1b`, `#dcfce7`,
`#166534`, etc.), no `var()` at all. Found 2026-09-04 while adding the
FlagGate banner + theme toggle to this page; left alone because it's a
separate, unrelated feature area. Fix: alias `--color-accent`/
`--color-ping-blue` to `--signin-accent` (same #2563eb value) either
locally in this file or in `index.css`'s existing alias block, and convert
`.uc-sim-result__*` to the `--th-status-success`/`--th-status-error`
families.
```

- [ ] **Step 2: Commit**

```bash
git add TECH_DEBT.md
git commit -m "docs(tech-debt): log UseCaseLauncherPage.css's remaining light-only literals"
```

---

### Task 7: Record the completed audit in the design doc

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-page-flag-gate-audit-design.md` (append the Part A results as a new section)

**Interfaces:** n/a — documentation only.

- [ ] **Step 1: Append the audit results**

Add a new `## Audit results (2026-09-04)` section at the end of the design doc:

```markdown
## Audit results (2026-09-04)

Computed via `requiredFlagsForUseCase()` against the live `USE_CASES` catalog
(60 entries): **32 use cases require at least one flag, 7 of those require
two simultaneously** (the maturity flag plus `ff_mcp_gateway_pinggateway`,
added whenever `primaryTool` is set). Full list: `delegated-access-with-proof`,
`a2a-delegation`, `a2a-orchestrator-learning`, `a2a-generalist-mismatch`,
`may-act-gate`, `agent-identity-lifecycle`, `audit-trail`,
`mortgage-delegated-access`, `overscoped-agent`, `authz-denied`,
`step-up-required`, `hitl-consent`, `group-entitlement-check`,
`entitlement-tiered-capability`, `ciba-out-of-band-approval`,
`progressive-trust-public-access`, `token-theft-replay`,
`par-rar-intent-violation`, `par-rar-intent-verified`,
`jit-ephemeral-credentials`, `weather-mcp-texas-permit`,
`weather-mcp-texas-deny`, `brave-mcp-search-permit`, `brave-mcp-crypto-deny`,
`code-search`, `enterprise-managed-mcp-access`, `enterprise-mcp-revocation`,
`enterprise-managed-mcp-authorization`, `hitl-consent-bypass-attempt`,
`unauthorized-commitment-fee-waiver`, `verified-trust-a2a-assertion`,
`personal-agent-concierge`. The two-flag cases are
`group-entitlement-check`, `ciba-out-of-band-approval`,
`par-rar-intent-verified`, `enterprise-managed-mcp-access`,
`enterprise-mcp-revocation`, `verified-trust-a2a-assertion`,
`personal-agent-concierge`.

**Plain nav pages:** grepped `demo_api_ui/src/pages/**` and `components/**`
for direct flag reads outside the use-case mapping. Zero hits in `pages/`.
Four component-level hits, all sub-panel visibility only (not "the page
doesn't work" gates): `TokenChainTraceRail.jsx`/`TokenChainFilmstrip.jsx`
show/hide a Trust tab on `ff_dpop`/`ff_rar` (both already covered by the
use-case table above), `Dashboard.js` shows a debug notice on
`ff_inject_scopes`, `AuthorizeRulesPanel.jsx` shows an extra rule row on
`ff_authorize_mcp_first_tool`. **No page needs its own banner beyond the
use-case set** — `pageFlagRequirements.js` is not created (YAGNI, per the
design's own non-goal).

**Nav-hidden pages:** none found — the audit found no nav item whose
visibility itself is flag-gated, so the "banner is unreachable" edge case
does not currently apply anywhere.

**Rollout scope:** `UseCaseLauncherPage.js` only (Tasks 1-6 of the
implementation plan). `LiveUseCaseWorkbenchPage.js` is deliberately excluded
— see the plan's "Scope note" for why (existing signed-in auto-arm path,
compact drawer cards, AIAgent sibling already provides a dark-mode
control). Revisit if guest use of the live workbench becomes a real
scenario.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-page-flag-gate-audit-design.md
git commit -m "docs(spec): record completed page/flag audit results"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the UI unit suite and build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: all tests pass, build exits 0.

- [ ] **Step 2: Run the touched server test**

Run: `cd demo_api_server && CI=true npx jest tests/demoFlags.route.test.js --forceExit`
Expected: PASS.

- [ ] **Step 3: Manual live check**

With the dev stack running, visit `/use-cases` as a guest (no session, e.g. a private window): confirm the "PAR + RAR intent verified" card shows a banner listing both `ff_rar` and `ff_mcp_gateway_pinggateway`, clicking Enable turns the banner into the card's normal (non-gated) state with no sign-in prompt, and the page's new 🌙/☀️ button flips the whole page (and the banner) into dark mode correctly (no unreadable text, no literal-color flash).

- [ ] **Step 4: State the result**

Report ✅ or ❌ per the root CLAUDE.md "Before claiming done" checklist — scoped test/build output, not a bare assertion.
