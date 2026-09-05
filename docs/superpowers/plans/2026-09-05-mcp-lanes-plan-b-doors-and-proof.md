# MCP Lanes Plan B — Door discovery, the banking Agentic App, and the LM Studio proof

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding an Agentic App in the Privilege console makes it appear as a selectable door after one click — no code change, no env var, no redeploy — and every LM Studio entry is proven to work in the GUI.

**Architecture:** Three surfaces, no new services. The BFF already reads the Privilege console inventory (`consoleInventory()`, `privilegeMcpClient.js:1811`) and already exposes it as `GET /console/inventory`; this plan wires that inventory into the `/state` preset list that builds the Door picker, and persists it through `configStore` so the doors outlive the operator's console cookie. The banking Agentic App (W3) is then registered in the console and must appear with no code change — that registration *is* the test that discovery works. LM Studio (W4) is regenerated from the live door table and proven by hand.

**Tech Stack:** Node >= 22 CommonJS (BFF), Express 4.18, Jest 29.7 + supertest (BFF tests), React 19.2 + Vitest 3.2 (UI), LM Studio (manual GUI proof).

**Spec:** [`docs/superpowers/specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md`](../specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md) — workstreams **W8**, **W3**, **W4**.

**Scope note:** Plan B of three. Plan A (merged, PR #2794) covered W1/W2/W7. Plan C covers W6/W5. Plan B's ordering follows spec §6: **W8 lands before W3**, because once the door list comes from the inventory, registering banking makes it appear with no further code change — which is the proof W8 works.

## Global Constraints

- **Do not change the Privilege transport.** The agent-based deployment with OAuth retained works and is out of scope (spec §9).
- **Do not change any frozen LLM setting** (resident tiers, `LLAMACPP_MAX_TOKENS`, `REASON_LOOP_TIMEOUT_MS`, `reasoning_effort`).
- `demo_api_server` is **CommonJS** (`'use strict'` + `require`), not ESM.
- BFF error responses use `{ error }`, never `{ message }`.
- UI: **Vitest, not jest.** Modals are `DraggableModal`. `PrivilegeMcpClientPage.jsx` uses its own `api()` helper (line 78) for `/api/privilege-mcp/*` — it already checks `r.ok` and throws an Error carrying `data.error`. **Use it. Do not hand-roll a `fetch`** — that is how Plan A's Task 6 draft turned a 401 into an empty list that looked like success.
- **Emoji allowlist only** (`REGRESSION_PLAN.md` §0). Allowed here: `⚠️` `✅` `❌`.
- **Theming:** no colour, background, or `font-size` in inline `style={{ }}`. Use `--th-*` tokens. **Grep `demo_api_ui/src/index.css` for a token's definition before using it** — Plan A found five invented names (`--th-warn-bg`, `--th-warn-border`, `--th-surface`, `--th-surface-2`, `--th-danger`) that do not exist. Confirmed-real tokens for this plan: `--th-bg-card`, `--th-bg-hover`, `--th-border`, `--th-text`, `--th-text-muted`, `--th-status-error`, `--th-status-warning-bg`, `--th-status-warning-border`, `--th-status-warning-text`, `--font-size-xs`, `--font-size-2xs`.
- **Worktree required.** Stage explicitly with `git add <files>` — never `git add -A` (jest regenerates hundreds of artifacts). Verify `git branch --show-current` before each commit.
- BFF test command: `CI=true npx jest <paths> --forceExit` run from `demo_api_server/`. `CI=true` is mandatory.
- **Console credentials are operator-pasted and short-lived.** The console API takes a browser `auth_token` cookie valid roughly 60 minutes, not a service credential. Re-discovery is an operator action; **serving a door must never require the token.** That is why Task 2 exists.
- **Never print a secret's value.** The console token is a credential: log its presence, never its content.

---

### Task 1: Serve the console inventory as door presets

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js` (the `presets` array in `GET /state`, lines 1316-1387)
- Test: `demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js` (create)

**Interfaces:**
- Consumes: `consoleInventory(session)` → `{ applications: Array<{name, mcpUrl, frontEndName, backends, entryPath, status}>, policies: Array<{name, spec}>, envId }` (already exists, `privilegeMcpClient.js:1811`).
- Produces, consumed by Tasks 2-3:
  - `discoveredPresets(apps)` → `Array<{ label, mode, url, app, status, discovered: true }>` — two presets per app (`privilege` and `facade` mode).
  - `/state` response gains `doorSource: 'inventory' | 'constants'`.

**Design note:** the hardcoded constants stay as the fallback. An operator who has never connected the console, or whose token expired with nothing persisted, must still get a working Door picker — discovery is an upgrade, never a prerequisite. `discovered: true` is what lets the UI tell the two apart.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js`:

```js
'use strict';

// The Door picker was built from three hardcoded app names, so a new Agentic
// App needed a code change and a redeploy. It is now built from the console
// inventory, with the constants kept as the fallback for an operator who has
// never connected the console.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
  get: jest.fn(() => ''),
  setConfig: jest.fn(async () => {}),
}));

const express = require('express');
const request = require('supertest');
const session = require('express-session');

const router = require('../../routes/privilegeMcpClient');
const { __test } = router;

function app() {
  return express()
    .use(session({ secret: 't', resave: false, saveUninitialized: true }))
    .use('/api/privilege-mcp', router);
}

describe('discoveredPresets', () => {
  it('offers each app in both privilege and facade mode', () => {
    const rows = __test.discoveredPresets([
      { name: 'brave', mcpUrl: 'https://gw.test/brave/mcp', status: 'Running' },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mode).sort()).toEqual(['facade', 'privilege']);
    // Every discovered row is marked, so the UI can say where a door came from.
    expect(rows.every((r) => r.discovered === true)).toBe(true);
    expect(rows.every((r) => r.app === 'brave')).toBe(true);
  });

  it('routes the facade row through the multiApp door path', () => {
    const rows = __test
      .discoveredPresets([{ name: 'brave', mcpUrl: 'https://gw.test/brave/mcp', status: '' }])
      .sort((a, b) => a.mode.localeCompare(b.mode));

    expect(rows[0].url).toMatch(/\/mcp-facade\/privilege-gateway\/brave\/mcp$/);
  });

  // An app with no usable name cannot be turned into a URL, and a row with an
  // empty url would render as a selectable door that goes nowhere.
  it('skips an app with no name', () => {
    expect(__test.discoveredPresets([{ name: '', mcpUrl: null }])).toEqual([]);
    expect(__test.discoveredPresets([{}])).toEqual([]);
  });

  it('carries the app status through for the UI to show', () => {
    const [row] = __test.discoveredPresets([{ name: 'brave', status: 'Degraded' }]);
    expect(row.status).toBe('Degraded');
  });
});

describe('GET /state doorSource', () => {
  it('reports constants when no inventory has been discovered', async () => {
    const res = await request(app()).get('/api/privilege-mcp/state');

    expect(res.status).toBe(200);
    expect(res.body.doorSource).toBe('constants');
    // The fallback must still be a usable picker, not an empty one.
    expect(res.body.presets.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.doorDiscovery.test.js --forceExit
```

Expected: FAIL — `__test.discoveredPresets is not a function`.

- [ ] **Step 3: Add the builder and export it for test**

In `demo_api_server/routes/privilegeMcpClient.js`, add above the `GET /state` handler:

```js
// Two presets per discovered app: straight at the AI Gateway, and through the
// façade's multiApp door. The façade door is already `multiApp`
// (mcpFacade.js DOORS['privilege-gateway']), so only the list of app names is
// new — the route shape needs no change.
function discoveredPresets(apps) {
  const facadeBase = `${PUBLIC_APP_ORIGIN()}/mcp-facade/privilege-gateway`;
  return (Array.isArray(apps) ? apps : []).flatMap((a) => {
    const name = a && typeof a.name === 'string' ? a.name.trim() : '';
    // A row with no url renders as a door that goes nowhere. Skip it.
    if (!name) return [];
    const direct = a.mcpUrl || `${PRIVILEGE_GATEWAY_HOST}/${name}/mcp`;
    return [
      { label: `Privilege — ${name}`, mode: 'privilege', url: direct, app: name, status: a.status || '', discovered: true },
      { label: `Façade — ${name}`, mode: 'facade', url: `${facadeBase}/${name}/mcp`, app: name, status: a.status || '', discovered: true },
    ];
  });
}
```

At the bottom of the file, beside the existing exports, add the test hook:

```js
module.exports.__test = { ...(module.exports.__test || {}), discoveredPresets };
```

In the `GET /state` handler, the `presets` array literal ends with `.filter((p) => p.url);`. Immediately after that line and before `res.json({`, insert:

```js
  // Discovered doors win over the constants of the same app name: the console
  // inventory is authoritative (spec §2.3 — the probe is not). When nothing has
  // been discovered the constants stand alone, so a picker always works.
  const discovered = discoveredPresets(session.discoveredApps || []);
  const discoveredKeys = new Set(discovered.map((d) => `${d.mode}:${d.url}`));
  const mergedPresets = [
    ...presets.filter((p) => !discoveredKeys.has(`${p.mode}:${p.url}`)),
    ...discovered,
  ];
  const doorSource = discovered.length ? 'inventory' : 'constants';
```

Then in the `res.json({ ... })` body, change the `presets,` line to:

```js
    presets: mergedPresets,
    doorSource,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.doorDiscovery.test.js --forceExit
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the neighbouring suite — `/state` is read by every page test**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient --forceExit
```

Expected: PASS. If an existing test asserts an exact preset count, change it to assert that the presets it cares about are present rather than re-pinning a total — a count assertion breaks every time a door is added, which is the thing this plan makes routine.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js
git commit -m "feat(privilege-mcp): build door presets from the console inventory"
```

---

### Task 2: Persist the discovered apps so doors outlive the console token

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js` (`POST /console/connect` line 1842, `GET /console/inventory` line 1866, and the session builder)
- Test: `demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js` (extend)

**Interfaces:**
- Consumes: `configStore.setConfig(data)` and `configStore.get(key)` (`services/configStore.js:1442`, `:1417`). `setConfig` is **async** — await it.
- Produces: config key `PRIVILEGE_DISCOVERED_APPS`, a JSON array of `{ name, mcpUrl, status }`, read at session start into `session.discoveredApps`, which Task 1 consumes.

**Design note — the load-bearing constraint.** The console credential is an operator-pasted browser cookie valid roughly 60 minutes. If the door list lived only in the session, every door would vanish an hour after discovery and the demo would silently be back to hardcoded constants. Persistence is what makes "refresh" an occasional operator action rather than a prerequisite for serving traffic.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js`:

```js
const configStore = require('../../services/configStore');

describe('discovered apps persistence', () => {
  beforeEach(() => {
    configStore.setConfig.mockClear();
    configStore.get.mockReturnValue('');
  });

  it('persists the discovered apps, keeping only the fields a door needs', async () => {
    await __test.rememberDiscoveredApps([
      { name: 'brave', mcpUrl: 'https://gw.test/brave/mcp', status: 'Running', backends: ['x'], frontEndName: 'y' },
    ]);

    expect(configStore.setConfig).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(configStore.setConfig.mock.calls[0][0].PRIVILEGE_DISCOVERED_APPS);
    expect(saved).toEqual([{ name: 'brave', mcpUrl: 'https://gw.test/brave/mcp', status: 'Running' }]);
  });

  it('reads them back', () => {
    configStore.get.mockReturnValue(JSON.stringify([{ name: 'brave', mcpUrl: 'u', status: '' }]));
    expect(__test.loadDiscoveredApps()).toEqual([{ name: 'brave', mcpUrl: 'u', status: '' }]);
  });

  // Corrupt persisted state must not take the page down — it degrades to the
  // constants, which is exactly the pre-discovery behaviour.
  it('falls back to an empty list when the stored value is not JSON', () => {
    configStore.get.mockReturnValue('{not json');
    expect(__test.loadDiscoveredApps()).toEqual([]);
  });

  it('falls back to an empty list when the stored value is not an array', () => {
    configStore.get.mockReturnValue('{"name":"brave"}');
    expect(__test.loadDiscoveredApps()).toEqual([]);
  });

  // Persisting nothing would silently erase every door the operator had.
  it('refuses to persist an empty discovery result', async () => {
    await __test.rememberDiscoveredApps([]);
    expect(configStore.setConfig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.doorDiscovery.test.js --forceExit
```

Expected: FAIL — `__test.rememberDiscoveredApps is not a function`.

- [ ] **Step 3: Implement persistence**

In `demo_api_server/routes/privilegeMcpClient.js`, beside `discoveredPresets`:

```js
const DISCOVERED_APPS_KEY = 'PRIVILEGE_DISCOVERED_APPS';

// Only what a door needs. The inventory also returns backends, frontEndName and
// entryPath; persisting those would age badly and none of them build a URL.
async function rememberDiscoveredApps(apps) {
  const slim = (Array.isArray(apps) ? apps : [])
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({ name: a.name.trim(), mcpUrl: a.mcpUrl || null, status: a.status || '' }));
  // An empty result would erase every door the operator already had. A failed
  // or empty discovery is not a reason to forget a working door list.
  if (!slim.length) return [];
  await configStore.setConfig({ [DISCOVERED_APPS_KEY]: JSON.stringify(slim) });
  return slim;
}

function loadDiscoveredApps() {
  const raw = configStore.get(DISCOVERED_APPS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // A corrupt or reshaped value degrades to the constants rather than
    // throwing on every page load.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

Extend the test hook at the bottom of the file:

```js
module.exports.__test = { ...(module.exports.__test || {}), discoveredPresets, rememberDiscoveredApps, loadDiscoveredApps };
```

In `getClientSession`, seed the field so Task 1's `session.discoveredApps` is populated on a fresh session:

```js
    if (!Array.isArray(session.discoveredApps)) session.discoveredApps = loadDiscoveredApps();
```

In **both** `POST /console/connect` and `GET /console/inventory`, after the inventory call returns and before responding, persist and seed. Use the variable name the surrounding code already uses for the inventory result:

```js
    session.discoveredApps = await rememberDiscoveredApps(inv.applications);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.doorDiscovery.test.js --forceExit
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the suite**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient --forceExit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/privilegeMcpClient.js demo_api_server/tests/routes/privilegeMcpClient.doorDiscovery.test.js
git commit -m "feat(privilege-mcp): persist discovered doors so they outlive the console token"
```

---

### Task 3: "Refresh from Privilege" control on the page

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`
- Test: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.doorRefresh.test.jsx` (create)

**Interfaces:**
- Consumes: `GET /console/inventory` → `{ applications, policies, envId }`; `state.doorSource` from Task 1.
- Produces: nothing other tasks depend on.

**Design note:** the control reports **how many apps and policies came back**. A silent refresh is indistinguishable from a broken one — the same failure Plan A closed in three other places.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.doorRefresh.test.jsx`:

```jsx
// Adding an Agentic App in the console must make it a selectable door after one
// click. A refresh that reports nothing is indistinguishable from one that
// failed, so the count and the failure are both asserted here.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

function stateBody(doorSource) {
  return JSON.stringify({
    config: { mcpUrl: "https://gw.test/opensearch22/mcp", clientId: "", scopes: "" },
    gatewayMode: "privilege",
    gatewayConfigs: {},
    oauth: { authenticated: true },
    mainAppAuthenticated: true,
    tools: [],
    presets: [],
    doorSource,
    gatewaySession: { ready: true },
  });
}

function mockFetch(inventory, doorSource = "constants") {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/api/privilege-mcp/state")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => stateBody(doorSource) });
    }
    if (u.endsWith("/api/privilege-mcp/console/inventory")) return Promise.resolve(inventory());
    return new Promise(() => {});
  });
}

beforeEach(() => {
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

describe("refresh from Privilege", () => {
  it("reports how many apps and policies came back", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          applications: [
            { name: "brave", status: "Running" },
            { name: "banking", status: "Running" },
          ],
          policies: [{ name: "p1", spec: {} }],
          envId: "e1",
        }),
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /refresh from privilege/i }));

    expect(await screen.findByText(/2 apps/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 polic/i)).toBeInTheDocument();
  });

  // The console token is a ~60 minute browser cookie. It expiring is the most
  // common failure here, and it must say so rather than appearing to succeed.
  it("surfaces a failed refresh instead of appearing to succeed", async () => {
    mockFetch(() => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Console token expired. Paste a new auth_token." }),
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /refresh from privilege/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/token expired/i);
  });

  // Zero apps is a real outcome, not silence: a console with no Agentic Apps,
  // or a namespace filter that matched nothing.
  // Spec W8.4: a lapsed policy is the most common cause of a 403 that looks
  // like misconfiguration, and the inventory already returns both halves.
  // "mentions" is a HEURISTIC over the raw policy Spec text — it is never a
  // claim that a policy GRANTS anything (see consoleInventory's own comment).
  it("flags an app that no policy mentions", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          applications: [
            { name: "brave", status: "Running" },
            { name: "banking", status: "Running" },
          ],
          policies: [{ name: "p1", spec: { rules: "allow brave tools/list" } }],
          envId: "e1",
        }),
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /refresh from privilege/i }));

    const unmentioned = await screen.findByTestId("doors-unmentioned");
    expect(unmentioned).toHaveTextContent(/banking/);
    expect(unmentioned).not.toHaveTextContent(/brave/);
  });

  it("says none were found rather than reporting a bare zero", async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ applications: [], policies: [], envId: "e1" }),
    }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /refresh from privilege/i }));

    expect(await screen.findByText(/no agentic apps/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.doorRefresh.test.jsx
```

Expected: FAIL — no "Refresh from Privilege" button.

Use `npm run test:unit`, **not** `npx vitest`. In a worktree `npx` can fetch a different vitest and report zero tests as green.

- [ ] **Step 3: Implement the control**

First find the function the page already uses to re-read `/state` — grep for `setGatewayMode(` and reuse it rather than adding a second loader:

```bash
cd demo_api_ui && grep -n "setGatewayMode(" src/pages/PrivilegeMcpClientPage.jsx | head -3
```

Add state beside the other page state:

```jsx
  const [doorRefresh, setDoorRefresh] = useState(null);
  const [doorRefreshError, setDoorRefreshError] = useState('');
  const [doorRefreshBusy, setDoorRefreshBusy] = useState(false);
```

Add the handler beside `runPreflight`, replacing `reloadState` with the name found above:

```jsx
  // Discovery is an operator action by construction: the console API takes a
  // pasted browser cookie, not a service credential. Serving a door never needs
  // it — the BFF persists the result (PRIVILEGE_DISCOVERED_APPS).
  const refreshDoors = useCallback(async () => {
    setDoorRefreshBusy(true);
    setDoorRefreshError('');
    setDoorRefresh(null);
    try {
      const data = await api('/console/inventory');
      const apps = Array.isArray(data.applications) ? data.applications : [];
      const policies = Array.isArray(data.policies) ? data.policies : [];
      // The pacpolicy Spec schema is undocumented, so the BFF ships each policy's
      // raw Spec and the match is on text. That makes this a HEURISTIC: an app no
      // policy mentions is worth flagging, but a mention is not proof of a grant.
      const policyText = JSON.stringify(policies).toLowerCase();
      setDoorRefresh({
        apps: apps.length,
        policies: policies.length,
        unmentioned: apps
          .map((a) => (a && typeof a.name === 'string' ? a.name : ''))
          .filter((n) => n && !policyText.includes(n.toLowerCase())),
      });
      await reloadState();
    } catch (err) {
      setDoorRefreshError(err.message || 'Refresh failed');
    } finally {
      setDoorRefreshBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Render it beside the preflight panel:

```jsx
      <div className="cur-doorsync">
        <button
          type="button"
          className="cur-doorsync__run"
          onClick={refreshDoors}
          disabled={doorRefreshBusy}
        >
          {doorRefreshBusy ? 'Refreshing…' : 'Refresh from Privilege'}
        </button>
        {doorRefreshError && (
          <span className="cur-doorsync__error" role="alert">{doorRefreshError}</span>
        )}
        {doorRefresh && doorRefresh.apps === 0 && (
          <span className="cur-doorsync__note">
            No Agentic Apps came back. Check the environment and the pasted console token.
          </span>
        )}
        {doorRefresh && doorRefresh.apps > 0 && (
          <span className="cur-doorsync__note">
            {doorRefresh.apps} apps, {doorRefresh.policies} policies
          </span>
        )}
        {doorRefresh && doorRefresh.unmentioned?.length > 0 && (
          <span className="cur-doorsync__warn" data-testid="doors-unmentioned">
            ⚠️ No policy mentions: {doorRefresh.unmentioned.join(', ')} — a new app
            starts with no policy, and the absence presents as a 403.
          </span>
        )}
      </div>
```

- [ ] **Step 4: Style it**

Append to `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`:

```css
/* Door discovery — real tokens, verified against src/index.css. */
.cur-doorsync {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
}

.cur-doorsync__run {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-bg-card);
  color: var(--th-text);
  cursor: pointer;
}

.cur-doorsync__run:hover:not(:disabled) {
  background: var(--th-bg-hover);
}

.cur-doorsync__run:disabled {
  cursor: progress;
  opacity: 0.7;
}

.cur-doorsync__note {
  color: var(--th-text-muted);
  font-size: var(--font-size-2xs);
}

.cur-doorsync__error {
  color: var(--th-status-error);
  font-size: var(--font-size-2xs);
}

.cur-doorsync__warn {
  flex: 1 0 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--th-status-warning-border);
  border-radius: 4px;
  background: var(--th-status-warning-bg);
  color: var(--th-status-warning-text);
  font-size: var(--font-size-2xs);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage.doorRefresh.test.jsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole page suite and the build gate**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage && npm run build
```

Expected: PASS across all spec files, build exit 0. A green test run is not the gate; the build is.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx demo_api_ui/src/pages/PrivilegeMcpClientPage.css demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.doorRefresh.test.jsx
git commit -m "feat(privilege-mcp): Refresh from Privilege rebuilds the door list"
```

---

### Task 4: Prove a discovered door survives the console token — USER-SIDE, needs a live token

**Files:** none. This is the acceptance test for Tasks 1-3.

- [ ] **Step 1: Pin the stack generation**

```bash
gen="$(npm run -s stack:generation)"
```

- [ ] **Step 2: Connect and refresh**

On `/privilege-mcp-client`, paste a current console `auth_token` and click
**Refresh from Privilege**. Record the reported app and policy counts, and the
door count in the picker.

- [ ] **Step 3: Restart the BFF and reload without reconnecting**

```bash
docker restart ai-demo-api-server
```

Reload the page. Do **not** paste a token. The discovered doors must still be
listed — that is the whole point of Task 2's persistence.

- [ ] **Step 4: Check the run was not void**

```bash
npm run -s stack:generation -- --check "$gen"
```

A non-zero result means another session recreated the stack mid-run: the run is
void, not a defect.

- [ ] **Step 5: Record it**

Paste the door count at each of the three points (before refresh, after refresh,
after restart) into the PR.

---

### Task 5: Register banking as an Agentic App — USER-SIDE GATE

**This task cannot be executed by an agent.** It is console work in the
Privilege admin UI, and it is the live test that door discovery works.

- [ ] **Step 1: Create the app — the one trap that matters**

Use **Add Application → MCP Server** specifically. An app created any other way
gets no working `FrontEndName` and fails with `Domain not found` **forever** —
it cannot be repaired after the fact, only deleted and recreated.

- [ ] **Step 2: Register the banking MCP backend with a `/sse` suffix**

The backend URL must end in `/sse`. Without it the gateway will not route.

- [ ] **Step 3: Author a policy for it**

A new app starts with **no** policy, and the absence presents as a **403**, not
as a "no policy" message. A 403 on a brand-new app almost always means this step
was skipped rather than that the policy denies.

- [ ] **Step 4: The actual test of Plan B (spec §7 criterion 7)**

Click **Refresh from Privilege**. The banking app must appear as a selectable
door — in both Privilege and Façade mode — with **no code change, no env var,
and no redeploy**.

If it does not appear, that is a Task 1-3 defect, not a console problem. Check
`GET /console/inventory` directly before touching the console again.

- [ ] **Step 5: Only if the separate `agentless` door is wanted**

Set `MCP_FACADE_AGENTLESS_URL`, `MCP_FACADE_AGENTLESS_AS` and
`PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING` to the new app in
`demo_api_server/.env`, then restart the BFF.

This is the *old* mechanism, kept because the `agentless` door is its own door
rather than a `privilege-gateway` app. If Tasks 1-3 work, the banking door
appears without any of it.

- [ ] **Step 6: Prove the three lanes now agree (spec §7 criterion 6)**

Call the same banking tool through Direct, Privilege and Façade and confirm all
three return the same real data. Paste all three results.

---

### Task 6: Reconcile the LM Studio config and pin it against drift

**Files:**
- Modify: `lmstudio/mcp.json`
- Modify: `lmstudio/README.md`
- Test: `demo_api_server/tests/routes/mcpFacade.lmstudioConfig.test.js` (create)

**Interfaces:**
- Consumes: `require('../../routes/mcpFacade').__test.DOORS` — already exported.
- Produces: nothing.

**The drift, measured 2026-09-05 rather than assumed.** `lmstudio/mcp.json` names six servers and every door it references does exist in `DOORS` — but the **targets are mixed**: `MCP Direct-Banking` and `MCP Agentless-Banking` point at SE hosts, `MCP Privilege-OpenSearch` and `MCP PingOne-Admin` at `localhost:3002`, `MCP Direct-OpenSearch` at `localhost:9900`. One file cannot serve both targets, so an operator following it gets a config that half-works. That is the §2.4 staleness.

PR #2804 deleted the `agent` and `agent-cmuir` doors. `mcp.json` happens not to name them, but nothing was checking — which is why step 1 exists.

- [ ] **Step 1: Write the failing test — the drift guard is the durable part**

Create `demo_api_server/tests/routes/mcpFacade.lmstudioConfig.test.js`:

```js
'use strict';

// lmstudio/mcp.json is hand-maintained and drifted undetectably (spec §2.4);
// PR #2804 deleted two doors with nothing checking whether this file still
// named them. This pins the file to the real door table.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { __test } = require('../../routes/mcpFacade');

const CONFIG = path.join(__dirname, '..', '..', '..', 'lmstudio', 'mcp.json');
const entries = Object.entries(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).mcpServers);

// /mcp-facade/<door>/mcp and /mcp-facade/<door>/<app>/mcp
const FACADE_PATH = /\/mcp-facade\/([^/]+)(?:\/([^/]+))?\/mcp$/;

describe('lmstudio/mcp.json', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s names a door that exists', (label, entry) => {
    const m = FACADE_PATH.exec(entry.url);
    if (!m) return; // a direct (non-façade) URL has no door to check
    expect(Object.keys(__test.DOORS)).toContain(m[1]);
  });

  // The thing that actually broke: a file mixing local and SE hosts, so an
  // operator following it got a config where half the entries went elsewhere.
  it('points every entry at one target, not a mix', () => {
    const hosts = [...new Set(entries.map(([, e]) => new URL(e.url).host))];
    const local = hosts.filter((h) => h.startsWith('localhost') || h.startsWith('127.'));
    const mixed = local.length > 0 && local.length < hosts.length;
    // Assert on a message, not a bare boolean — a failure has to name the hosts
    // or the next person re-derives which entry is the odd one out.
    expect(mixed ? `mixed targets: ${hosts.join(', ')}` : 'single target').toBe('single target');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.lmstudioConfig.test.js --forceExit
```

Expected: FAIL on the mixed-hosts case, with the host list in the message.

- [ ] **Step 3: Regenerate `lmstudio/mcp.json` for one target**

Ship **SE** as the default — a fresh clone has no local stack, and the SE host works from anywhere. Replace `lmstudio/mcp.json` with:

```json
{
  "mcpServers": {
    "MCP Direct-Banking": {
      "url": "https://cmuir-mcp.ping-devops.com/mcp"
    },
    "MCP Agentless-Banking": {
      "url": "https://ai-demo.ping-devops.com/mcp-facade/agentless/mcp"
    },
    "MCP AgentGateway-Banking": {
      "url": "https://ai-demo.ping-devops.com/mcp-facade/agent-gateway/mcp"
    },
    "MCP Privilege-OpenSearch": {
      "url": "https://ai-demo.ping-devops.com/mcp-facade/privilege-gateway/opensearch22/mcp"
    },
    "MCP Privilege-Brave": {
      "url": "https://ai-demo.ping-devops.com/mcp-facade/privilege-gateway/brave/mcp"
    },
    "MCP PingOne-Admin": {
      "url": "https://ai-demo.ping-devops.com/mcp-facade/pingone-admin/mcp"
    }
  }
}
```

`MCP Direct-OpenSearch` at `localhost:9900` is dropped: it is a local-only port with no SE equivalent, and it is the entry that made the file mixed. The local variants go in the README, where they cannot break the file.

- [ ] **Step 4: Rewrite `lmstudio/README.md` for the current door set**

The README must carry, at minimum:

1. **A door table** — one row per entry in `mcp.json`, saying what each proves: Direct = no Privilege in the path; Agentless/AgentGateway = through the façade; Privilege-* = the AI Gateway's own registered apps.
2. **The local-target variants**, since `mcp.json` now ships SE. Locally the façade is `http://localhost:3002` — **plain HTTP, not HTTPS**. LM Studio will not complete the OAuth dance against a certificate it does not trust, so the mkcert HTTPS origin does not work here.
3. **A note that the door list is no longer authoritative here**: it can be regenerated from the page's **Refresh from Privilege** control (Task 3). This file is a starting point, and the console inventory is the source of truth.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade.lmstudioConfig.test.js --forceExit
```

Expected: PASS.

- [ ] **Step 6: Run the whole façade suite — the test imports the door table**

```bash
cd demo_api_server && CI=true npx jest tests/routes/mcpFacade --forceExit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lmstudio/mcp.json lmstudio/README.md demo_api_server/tests/routes/mcpFacade.lmstudioConfig.test.js
git commit -m "fix(lmstudio): one target per config, and pin it against door drift"
```

---

### Task 7: Prove every LM Studio entry in the GUI — USER-SIDE GATE

**This task cannot be executed by an agent.** It is spec §7 criterion 3 and the
gate for the whole matrix in §3. A passing unit test proves the file names real
doors; it cannot prove LM Studio completes an OAuth dance.

- [ ] **Step 1: Clean install**

Remove any existing LM Studio MCP config and paste `lmstudio/mcp.json` fresh. A
config that only works because of leftover state is not proven.

- [ ] **Step 2: For every entry, all four of these**

Per entry — not per door type, per **entry**:

1. The OAuth dance completes.
2. `tools/list` populates.
3. One real `tools/call` returns **real data**, not an empty success.
4. The reel image renders.

- [ ] **Step 3: Record it**

A table, one row per entry, four columns. Paste it into the PR.

If an entry fails, record **which of the four** it failed at — they fail for
different reasons (1 = broker/AS config, 2 = door routing or policy, 3 = the
upstream MCP server, 4 = the reel).

---

## Final verification

- [ ] **Server tests**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient tests/routes/mcpFacade --forceExit
```

- [ ] **UI tests and the build gate**

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PrivilegeMcpClientPage && npm run build
```

- [ ] **Preflight still green on both targets**

```bash
npm run demo:preflight -- --target se
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run demo:preflight -- --target local
```

The gateway-session row should now report real state rather than a missing
`gatewaySession` key — Plan A merged in `602194b41`.

- [ ] **The claim this plan exists to make (spec §7 criterion 7)**

Adding an Agentic App in the console makes it a selectable door after one
"Refresh from Privilege" click, with no code change, no env var and no redeploy
— **and the door survives the console token expiring**. Both halves need
pasting: the door list after refresh (Task 5 step 4), and the door list after a
BFF restart with no reconnect (Task 4 step 3).

- [ ] **Spec §7 criterion 6**

The banking tools are reachable identically through Direct, Privilege and Façade
(Task 5 step 6), with all three results pasted.
