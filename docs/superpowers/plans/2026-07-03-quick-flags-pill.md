# Quick Flags Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An always-visible header pill showing the live token-validation mode (`🔐 JWKS` / `🔎 Introspect`) that opens a dropdown with 10 curated demo feature-flag switches, honest about env-pinned flags.

**Architecture:** New self-contained `QuickFlagsPill` React component mounted in `TopNav` next to `VerticalSwitcher`; it reuses the proven `GET`/`PATCH /api/admin/feature-flags` patterns from `ThresholdControls`/`FeatureFlagsPage`. One small server change: `serializeFlag` gains `pinned`/`pinnedBy` fields when a flag's controlling env var is set (env-first `getEffective` makes such flags UI-inert — the UI must show a lock, not a dead toggle).

**Tech Stack:** React (demo_api_ui, vitest + @testing-library/react), Express BFF (demo_api_server, jest + supertest).

**Spec:** `docs/superpowers/specs/2026-07-03-quick-flags-pill-design.md`

## Global Constraints

- Component: `demo_api_ui/src/components/QuickFlagsPill.js` + `QuickFlagsPill.css`; CSS class prefix `qfp-`.
- Pill driven by `ff_mcp_gateway_jwks`: value true → `🔐 JWKS`, false → `🔎 Introspect`, not yet loaded → `–`.
- The 10 switches, their groups, and control styles are EXACTLY the `QUICK_FLAGS` constant in Task 2 — no additions, no omissions.
- API endpoints (unchanged shapes): `GET /api/admin/feature-flags` → `{ flags:[{id,value,type,options?,pinned?,pinnedBy?,...}] }`; `PATCH /api/admin/feature-flags` body `{ updates: { [id]: value } }` (booleans as booleans, enums as strings).
- Pinned flags: render disabled with 🔒 and tooltip `Pinned by <ENV_VAR> in docker-compose — change the env to flip`; never send a PATCH for them.
- Non-admin (`user?.role !== 'admin'`) or PATCH 403: controls disabled, hint text `Admin session required`. Pill and current states remain visible (GET is unauthenticated).
- Existing files stay behaviorally unchanged except the two named modifications (`featureFlags.js` serializeFlag, `TopNav.js` mount).
- Work on branch `worktree-quick-flags-pill` in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/quick-flags-pill`. Stage explicitly (`git add <file>`), never `git add -A`; verify `git branch --show-current` before each commit; append the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` to every commit message.
- UI tests run from `demo_api_ui/`: `npx vitest run src/components/__tests__/QuickFlagsPill.test.jsx`. Server tests run from `demo_api_server/`: `npx jest tests/featureFlagsPinned.test.js --forceExit` (if `node_modules` is missing in the worktree, `npm install` first).

---

### Task 1: Server — `pinned`/`pinnedBy` on serialized flags

**Files:**

- Modify: `demo_api_server/routes/featureFlags.js` (serializeFlag at ~line 730; exports at line 827)
- Test (create): `demo_api_server/tests/featureFlagsPinned.test.js`

**Interfaces:**

- Consumes: existing `FLAG_REGISTRY`, `resolveFlag` (unchanged).
- Produces: `serializeFlag(flag)` now returns `pinned: true, pinnedBy: '<ENV_VAR>'` iff the flag id has an entry in the new `PINNED_ENV_ALIASES` map AND that env var is set (non-empty). New export: `module.exports = { router, FLAG_REGISTRY, serializeFlag }`. Task 2's UI consumes `pinned`/`pinnedBy` from GET.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/featureFlagsPinned.test.js`:

```js
'use strict';

// serializeFlag must report pinned/pinnedBy when a flag's controlling env var
// is set — getEffective() is env-first, so such flags are UI-inert and the
// QuickFlagsPill renders them locked instead of showing a dead toggle.

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => undefined),
  setRaw: jest.fn(),
}));
jest.mock('../config/runtimeSettings', () => ({
  get: jest.fn(() => undefined),
  update: jest.fn(),
}));

const { FLAG_REGISTRY, serializeFlag } = require('../routes/featureFlags');

const flagById = (id) => FLAG_REGISTRY.find((f) => f.id === id);

describe('serializeFlag pinned/pinnedBy', () => {
  const ENV_KEYS = [
    'FF_MCP_GATEWAY_PINGGATEWAY',
    'FF_MCP_GATEWAY_JWKS',
    'FF_AUTHORIZE_SIMULATED',
    'FF_HEURISTIC_ENABLED',
    'CIBA_ENABLED',
  ];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('env var set -> pinned true with pinnedBy naming the var', () => {
    process.env.FF_MCP_GATEWAY_PINGGATEWAY = 'true';
    const out = serializeFlag(flagById('ff_mcp_gateway_pinggateway'));
    expect(out.pinned).toBe(true);
    expect(out.pinnedBy).toBe('FF_MCP_GATEWAY_PINGGATEWAY');
  });

  test('env var unset -> pinned/pinnedBy omitted', () => {
    const out = serializeFlag(flagById('ff_mcp_gateway_pinggateway'));
    expect(out).not.toHaveProperty('pinned');
    expect(out).not.toHaveProperty('pinnedBy');
  });

  test('empty-string env var does not pin', () => {
    process.env.FF_MCP_GATEWAY_JWKS = '';
    const out = serializeFlag(flagById('ff_mcp_gateway_jwks'));
    expect(out).not.toHaveProperty('pinned');
  });

  test('flag with no env alias never pins', () => {
    const out = serializeFlag(flagById('ff_agent_results_panel'));
    expect(out).not.toHaveProperty('pinned');
  });

  test('existing serialization fields unchanged', () => {
    const out = serializeFlag(flagById('introspectionProvider'));
    expect(out.id).toBe('introspectionProvider');
    expect(out.type).toBe('enum');
    expect(out.options).toEqual(['pinggateway', 'p1az']);
    expect(out).toHaveProperty('value');
    expect(out).toHaveProperty('defaultValue');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `demo_api_server/`): `npx jest tests/featureFlagsPinned.test.js --forceExit`
Expected: FAIL — `serializeFlag` is not exported (undefined is not a function), or `pinned` undefined.

- [ ] **Step 3: Implement**

In `demo_api_server/routes/featureFlags.js`, directly above `serializeFlag` (~line 730), add:

```js
// Env vars that hard-pin a quick-switch flag: configStore.getEffective() is
// env-FIRST, so while one of these is set (e.g. in docker-compose) the UI
// toggle is inert. serializeFlag surfaces that as pinned/pinnedBy so the UI
// can render a lock instead of a dead toggle. Only flags with an env alias
// in configStore's fallback map belong here.
const PINNED_ENV_ALIASES = {
  ff_mcp_gateway_pinggateway: 'FF_MCP_GATEWAY_PINGGATEWAY',
  ff_mcp_gateway_jwks:        'FF_MCP_GATEWAY_JWKS',
  ff_authorize_simulated:     'FF_AUTHORIZE_SIMULATED',
  ff_heuristic_enabled:       'FF_HEURISTIC_ENABLED',
  ciba_enabled:               'CIBA_ENABLED',
};
```

Then extend the returned object in `serializeFlag` (after the `warnIfEnabled` spread line):

```js
    ...(flag.warnIfEnabled  && { warnIfEnabled:  flag.warnIfEnabled }),
    ...(PINNED_ENV_ALIASES[flag.id] && String(process.env[PINNED_ENV_ALIASES[flag.id]] || '').trim()
      ? { pinned: true, pinnedBy: PINNED_ENV_ALIASES[flag.id] }
      : {}),
```

And change the export line (827) to:

```js
module.exports = { router, FLAG_REGISTRY, serializeFlag };
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `demo_api_server/`): `npx jest tests/featureFlagsPinned.test.js --forceExit`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/tests/featureFlagsPinned.test.js
git commit -m "feat: surface env-pinned feature flags as pinned/pinnedBy in flags API"
```

---

### Task 2: `QuickFlagsPill` component + styles + tests

**Files:**

- Create: `demo_api_ui/src/components/QuickFlagsPill.js`
- Create: `demo_api_ui/src/components/QuickFlagsPill.css`
- Test (create): `demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx`

**Interfaces:**

- Consumes: `GET/PATCH /api/admin/feature-flags` (shapes in Global Constraints), including Task 1's `pinned`/`pinnedBy`.
- Produces: default export `QuickFlagsPill({ user })` — Task 3 mounts it as `<QuickFlagsPill user={user} />`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx`:

```jsx
// demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import QuickFlagsPill from '../QuickFlagsPill';

const ADMIN = { role: 'admin', username: 'demo-admin' };

function flag(id, value, extra = {}) {
  return { id, name: id, category: 'x', description: '', impact: '', type: typeof value === 'string' ? 'enum' : 'boolean', defaultValue: value, value, ...extra };
}

function flagsResponse(overrides = {}) {
  const base = {
    ff_mcp_gateway_jwks: flag('ff_mcp_gateway_jwks', true),
    ff_mcp_gateway_pinggateway: flag('ff_mcp_gateway_pinggateway', true),
    introspectionProvider: flag('introspectionProvider', 'pinggateway', { options: ['pinggateway', 'p1az'] }),
    ff_skip_token_exchange: flag('ff_skip_token_exchange', false),
    ff_authorize_simulated: flag('ff_authorize_simulated', false),
    ff_id_token_exchange: flag('ff_id_token_exchange', false),
    ff_token_auth_private_key_jwt: flag('ff_token_auth_private_key_jwt', false),
    ciba_enabled: flag('ciba_enabled', false),
    ff_heuristic_enabled: flag('ff_heuristic_enabled', true),
    ff_agent_results_panel: flag('ff_agent_results_panel', true),
    ...overrides,
  };
  return { flags: Object.values(base), categories: [] };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => flagsResponse() };
    }
    return { ok: true, status: 200, json: async () => ({ updated: true, flags: flagsResponse().flags }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuickFlagsPill', () => {
  it('pill shows JWKS mode from the loaded flag value', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /JWKS/ })).toBeTruthy());
  });

  it('pill shows Introspect when ff_mcp_gateway_jwks is false', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => flagsResponse({ ff_mcp_gateway_jwks: flag('ff_mcp_gateway_jwks', false) }),
    }));
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Introspect/ })).toBeTruthy());
  });

  it('clicking the pill opens the dropdown with the three groups', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => expect(screen.getByText('Token & Gateway')).toBeTruthy());
    expect(screen.getByText('AuthN / AuthZ')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('flipping the validation segmented control PATCHes the boolean', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: /🔎 Introspect/ }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch[1].body)).toEqual({ updates: { ff_mcp_gateway_jwks: false } });
    });
  });

  it('enum segmented control PATCHes the string value', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: 'P1AZ' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH');
      expect(JSON.parse(patch[1].body)).toEqual({ updates: { introspectionProvider: 'p1az' } });
    });
  });

  it('pinned flag renders locked and fires no PATCH', async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return {
          ok: true, status: 200,
          json: async () => flagsResponse({
            ff_mcp_gateway_pinggateway: flag('ff_mcp_gateway_pinggateway', true, { pinned: true, pinnedBy: 'FF_MCP_GATEWAY_PINGGATEWAY' }),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ updated: true, flags: [] }) };
    });
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    const demoGw = screen.getByRole('button', { name: 'Demo GW' });
    expect(demoGw.disabled).toBe(true);
    expect(demoGw.title).toMatch(/FF_MCP_GATEWAY_PINGGATEWAY/);
    fireEvent.click(demoGw);
    expect(fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH')).toBeUndefined();
  });

  it('non-admin user sees disabled controls and the admin hint', async () => {
    render(<QuickFlagsPill user={{ role: 'customer' }} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    expect(screen.getByText('Admin session required')).toBeTruthy();
    expect(screen.getByRole('button', { name: /🔎 Introspect/ }).disabled).toBe(true);
  });

  it('PATCH 403 flips to the non-admin state', async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => flagsResponse() };
      }
      return { ok: false, status: 403, json: async () => ({ error: 'admin required' }) };
    });
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: /🔎 Introspect/ }));
    await waitFor(() => expect(screen.getByText('Admin session required')).toBeTruthy());
  });

  it('GET failure renders the muted pill', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Flags/ })).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `demo_api_ui/`): `npx vitest run src/components/__tests__/QuickFlagsPill.test.jsx`
Expected: FAIL — cannot resolve `../QuickFlagsPill`.

- [ ] **Step 3: Implement the component**

Create `demo_api_ui/src/components/QuickFlagsPill.js`:

```jsx
// QuickFlagsPill — always-visible header pill showing the live token-validation
// mode (🔐 JWKS / 🔎 Introspect) + a dropdown with the curated demo switches.
// Read path is open to everyone (GET /api/admin/feature-flags is unauthenticated);
// writes require an admin session (PATCH 403 downgrades the UI to read-only).
// Env-pinned flags (pinned/pinnedBy from the API) render locked: getEffective()
// is env-first, so their toggles would be silently inert.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './QuickFlagsPill.css';

// The curated lineup. Adding switch #11 = one new entry here.
// control: 'segmented' renders all modes as A/B buttons; 'toggle' renders an
// on/off switch. For segmented booleans, modes map labels onto true/false.
const QUICK_FLAGS = [
  { id: 'ff_mcp_gateway_jwks',          group: 'Token & Gateway', control: 'segmented', label: 'Token Validation',                modes: [{ value: true, label: '🔐 JWKS' }, { value: false, label: '🔎 Introspect' }] },
  { id: 'ff_mcp_gateway_pinggateway',   group: 'Token & Gateway', control: 'segmented', label: 'Agent Gateway',                   modes: [{ value: true, label: 'PingOne GW' }, { value: false, label: 'Demo GW' }] },
  { id: 'introspectionProvider',        group: 'Token & Gateway', control: 'segmented', label: 'Introspection Provider',          modes: [{ value: 'pinggateway', label: 'PingGateway' }, { value: 'p1az', label: 'P1AZ' }] },
  { id: 'ff_skip_token_exchange',       group: 'Token & Gateway', control: 'toggle',    label: 'Skip Token Exchange' },
  { id: 'ff_authorize_simulated',       group: 'AuthN / AuthZ',   control: 'segmented', label: 'Authorize Engine',                modes: [{ value: false, label: 'Real P1AZ' }, { value: true, label: 'Simulated' }] },
  { id: 'ff_id_token_exchange',         group: 'AuthN / AuthZ',   control: 'toggle',    label: 'ID Token Exchange Mode' },
  { id: 'ff_token_auth_private_key_jwt', group: 'AuthN / AuthZ',  control: 'toggle',    label: 'Client Auth — Private Key JWT' },
  { id: 'ciba_enabled',                 group: 'AuthN / AuthZ',   control: 'toggle',    label: 'CIBA — Out-of-Band Approval' },
  { id: 'ff_heuristic_enabled',         group: 'Agent',           control: 'toggle',    label: 'LLM Chips — Heuristic Fast-Path' },
  { id: 'ff_agent_results_panel',       group: 'Agent',           control: 'toggle',    label: 'Floating Results Panel' },
];
const GROUPS = ['Token & Gateway', 'AuthN / AuthZ', 'Agent'];
const PILL_FLAG = 'ff_mcp_gateway_jwks';

export default function QuickFlagsPill({ user }) {
  const [flagsById, setFlagsById] = useState(null); // null = not loaded
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [adminDenied, setAdminDenied] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const isAdmin = user?.role === 'admin' && !adminDenied;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      if (!res.ok) { setLoadFailed(true); return; }
      const data = await res.json();
      const byId = {};
      for (const f of data.flags || []) byId[f.id] = f;
      setFlagsById(byId);
      setLoadFailed(false);
    } catch (_) {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch on open so states stay honest across sessions/tabs.
  useEffect(() => { if (open) load(); }, [open, load]);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = useCallback(async (id, value) => {
    if (!flagsById) return;
    const prev = flagsById[id];
    if (!prev || prev.pinned) return;
    setSavingId(id);
    setError(null);
    // Optimistic update + rollback (FeatureFlagsPage pattern).
    setFlagsById((cur) => ({ ...cur, [id]: { ...cur[id], value } }));
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [id]: value } }),
      });
      if (res.status === 403) {
        setAdminDenied(true);
        setFlagsById((cur) => ({ ...cur, [id]: prev }));
        return;
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const data = await res.json();
      if (Array.isArray(data.flags) && data.flags.length) {
        setFlagsById((cur) => {
          const next = { ...cur };
          for (const f of data.flags) next[f.id] = f;
          return next;
        });
      }
    } catch (e) {
      setFlagsById((cur) => ({ ...cur, [id]: prev }));
      setError(e.message || 'save failed');
    } finally {
      setSavingId(null);
    }
  }, [flagsById]);

  const pillFlag = flagsById?.[PILL_FLAG];
  const pillLabel = !flagsById
    ? (loadFailed ? '⚑ Flags –' : '…')
    : pillFlag?.value
      ? '🔐 JWKS'
      : '🔎 Introspect';

  const pillTitle = 'Quick feature flags — token validation mode and demo switches';

  const rect = open ? btnRef.current?.getBoundingClientRect() : null;

  const renderControl = (def) => {
    const f = flagsById?.[def.id];
    if (!f) return <span className="qfp-missing">unavailable</span>;
    const locked = !!f.pinned;
    const disabled = locked || !isAdmin || savingId === def.id;
    const lockTitle = locked
      ? `Pinned by ${f.pinnedBy} in docker-compose — change the env to flip`
      : undefined;
    if (def.control === 'segmented') {
      return (
        <span className="qfp-segmented" role="group" aria-label={def.label}>
          {def.modes.map((m) => (
            <button
              key={String(m.value)}
              type="button"
              className={`qfp-seg-btn${f.value === m.value ? ' qfp-seg-btn--active' : ''}`}
              disabled={disabled}
              title={lockTitle}
              onClick={() => { if (f.value !== m.value) save(def.id, m.value); }}
            >
              {m.label}
            </button>
          ))}
          {locked && <span className="qfp-lock" aria-label="pinned" title={lockTitle}>🔒</span>}
        </span>
      );
    }
    return (
      <span className="qfp-toggle-wrap">
        <button
          type="button"
          className={`qfp-toggle${f.value ? ' qfp-toggle--on' : ''}`}
          role="switch"
          aria-checked={!!f.value}
          aria-label={def.label}
          disabled={disabled}
          title={lockTitle}
          onClick={() => save(def.id, !f.value)}
        >
          <span className="qfp-toggle-knob" />
        </button>
        {locked && <span className="qfp-lock" aria-label="pinned" title={lockTitle}>🔒</span>}
      </span>
    );
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`qfp-pill${open ? ' qfp-pill--open' : ''}${loadFailed ? ' qfp-pill--muted' : ''}`}
        title={pillTitle}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {pillLabel}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="qfp-dropdown"
          style={rect ? { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) } : undefined}
          role="menu"
          aria-label="Quick feature flags"
        >
          {!isAdmin && <div className="qfp-hint">Admin session required</div>}
          {error && <div className="qfp-error">{error}</div>}
          {loadFailed && (
            <button type="button" className="qfp-retry" onClick={load}>Reload flags</button>
          )}
          {GROUPS.map((g) => (
            <div key={g} className="qfp-group">
              <div className="qfp-group-title">{g}</div>
              {QUICK_FLAGS.filter((d) => d.group === g).map((d) => (
                <div key={d.id} className="qfp-row">
                  <span className="qfp-row-label" title={flagsById?.[d.id]?.description || d.label}>{d.label}</span>
                  {renderControl(d)}
                </div>
              ))}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
```

Create `demo_api_ui/src/components/QuickFlagsPill.css`:

```css
/* QuickFlagsPill — header pill + portal dropdown (prefix: qfp-) */

.qfp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.qfp-pill:hover,
.qfp-pill--open { background: rgba(255, 255, 255, 0.18); }
.qfp-pill--muted { opacity: 0.55; }

.qfp-dropdown {
  position: fixed;
  z-index: 10050;
  min-width: 320px;
  max-width: 380px;
  max-height: 70vh;
  overflow-y: auto;
  background: #fff;
  color: #1a2233;
  border: 1px solid #d5dbe7;
  border-radius: 10px;
  box-shadow: 0 10px 32px rgba(16, 24, 40, 0.18);
  padding: 10px 12px;
  font-size: 13px;
}

.qfp-hint,
.qfp-error {
  padding: 4px 8px;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}
.qfp-hint { background: #fef6e7; color: #8a6116; }
.qfp-error { background: #fdecec; color: #a12622; }

.qfp-retry {
  margin-bottom: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #d5dbe7;
  background: #f6f8fc;
  cursor: pointer;
}

.qfp-group { padding: 6px 0; border-top: 1px solid #eef1f7; }
.qfp-group:first-of-type { border-top: none; }
.qfp-group-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #66708a;
  margin-bottom: 4px;
}

.qfp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
}
.qfp-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qfp-missing { color: #98a1b8; font-size: 12px; }

.qfp-segmented { display: inline-flex; align-items: center; gap: 0; }
.qfp-seg-btn {
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid #cdd5e4;
  background: #f6f8fc;
  color: #3c4763;
  cursor: pointer;
}
.qfp-seg-btn:first-child { border-radius: 6px 0 0 6px; }
.qfp-seg-btn:last-of-type { border-radius: 0 6px 6px 0; border-left: none; }
.qfp-seg-btn--active { background: #1b62d6; border-color: #1b62d6; color: #fff; }
.qfp-seg-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.qfp-toggle-wrap { display: inline-flex; align-items: center; gap: 6px; }
.qfp-toggle {
  width: 34px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid #cdd5e4;
  background: #dfe5f0;
  position: relative;
  cursor: pointer;
  padding: 0;
}
.qfp-toggle--on { background: #1b62d6; border-color: #1b62d6; }
.qfp-toggle:disabled { opacity: 0.55; cursor: not-allowed; }
.qfp-toggle-knob {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s ease;
}
.qfp-toggle--on .qfp-toggle-knob { left: 16px; }

.qfp-lock { font-size: 12px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `demo_api_ui/`): `npx vitest run src/components/__tests__/QuickFlagsPill.test.jsx`
Expected: 9/9 PASS, output pristine.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/QuickFlagsPill.js demo_api_ui/src/components/QuickFlagsPill.css demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx
git commit -m "feat: QuickFlagsPill component — validation-mode pill + curated flag dropdown"
```

---

### Task 3: Mount in TopNav + suite regression

**Files:**

- Modify: `demo_api_ui/src/components/TopNav.js` (right after `<VerticalSwitcher variant="nav" />`, ~line 104)

**Interfaces:**

- Consumes: Task 2's `QuickFlagsPill({ user })`; TopNav's existing `user` prop.
- Produces: the pill on every page that renders TopNav (guests included — the pill is read-only until an admin session exists).

- [ ] **Step 1: Add the mount**

In `demo_api_ui/src/components/TopNav.js`, add the import next to the other component imports:

```js
import QuickFlagsPill from './QuickFlagsPill';
```

and render it immediately after the `VerticalSwitcher` line:

```jsx
        <VerticalSwitcher variant="nav" />

        {/* Quick Flags — live validation-mode pill + curated demo switches.
            Visible to everyone (read-only without an admin session). */}
        <QuickFlagsPill user={user} />
```

- [ ] **Step 2: Run the component suite + neighboring UI tests**

Run (from `demo_api_ui/`): `npx vitest run src/components/__tests__/QuickFlagsPill.test.jsx src/components/__tests__/SimpleStepperBar.test.jsx`
Expected: all PASS (SimpleStepperBar is the canary that shared test setup didn't break).

- [ ] **Step 3: Build check**

Run (from `demo_api_ui/`): `npx vite build 2>&1 | tail -5` (or `npm run build` if that's the script)
Expected: build completes without errors referencing QuickFlagsPill/TopNav.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TopNav.js
git commit -m "feat: mount QuickFlagsPill in TopNav next to the vertical switcher"
```

---

### Post-merge manual check (not a task — record in PR body)

Flip Token Validation in the pill on the live stack → the next MCP tool call's response carries `X-Token-Validation-Mode: jwks` (or loses it in Introspect mode) with no restarts; env-pinned Gateway switch shows 🔒 with the `FF_MCP_GATEWAY_PINGGATEWAY` tooltip.
