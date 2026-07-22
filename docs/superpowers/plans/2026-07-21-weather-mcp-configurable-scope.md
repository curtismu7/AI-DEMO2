# Weather MCP Configurable Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin change, live and without a gateway restart, which US state
(Texas / Michigan / no restriction) the Agent Gateway's weather-mcp showcase route
currently allows — so a presenter can flip the same "weather in Miami" chat query from
denied to allowed in front of an audience.

**Architecture:** One new enum feature flag (`ff_weather_mcp_allowed_state`), persisted via
the existing `configStore` and read live by `tx-weather-scope.groovy` on every request via
the SAME HTTP call that already fetches `ff_weather_mcp_showcase` (extended response, no new
round-trip). A small new React component (`WeatherStateControl`) renders an inline `<select>`
on the weather capability's Capability Tour card, via one new optional prop on the shared,
generic `CapabilityShowcasePage`.

**Tech Stack:** Node/Express (`demo_api_server`), Groovy `ScriptableFilter` (`ping-gateway`),
React (`demo_api_ui`), Jest (backend tests, `CI=true npx jest`), Vitest (frontend tests,
`npm test` in `demo_api_ui`).

## Global Constraints

- Emoji allowlist only in any UI text touched: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`.
  This plan introduces no new emoji.
- `ff_weather_mcp_showcase` (existing master on/off flag) must stay fully independent of the
  new `ff_weather_mcp_allowed_state` flag — the master flag OFF must still 403 every request
  regardless of the selected state.
- `tx-weather-scope.groovy` has no automated test in this repo (no framework reaches Groovy
  directly) — every task touching it is verified live, via real curl calls through the
  running `ping-gateway` container, matching how this file's prior two changes in this repo's
  history were verified.
- Backend tests run with `CI=true npx jest <files> --testPathIgnorePatterns="/node_modules/|\.claude/worktrees/(?!<this-worktree-name>)|/\.kilo/worktrees/|/tests/real/"` from `demo_api_server/` — the bare default ignore pattern excludes ANY path containing `.claude/worktrees/`, which includes worktree checkouts, so it must always be overridden this way when working from a worktree.
- Frontend tests run with `npm test -- <pattern>` from `demo_api_ui/` (vitest).

---

### Task 1: Backend — new flag + extended flag-check endpoint

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (add one entry to `FLAG_REGISTRY`)
- Modify: `demo_api_server/routes/weatherMcpFlag.js` (extend the JSON response)
- Create: `demo_api_server/tests/weatherMcpFlag.test.js`

**Interfaces:**
- Produces: `GET /internal/feature-flags/weather-mcp-showcase` now returns
  `{ enabled: boolean, allowedState: 'texas'|'michigan'|'any' }` (previously just
  `{ enabled }`). Consumed by Task 2's Groovy script.
- Produces: `ff_weather_mcp_allowed_state` as a valid flag id readable via
  `configStore.getEffective('ff_weather_mcp_allowed_state')` and writable via the existing
  `PATCH /api/admin/feature-flags` (`{updates: {ff_weather_mcp_allowed_state: 'michigan'}}`).
  Consumed by Task 4's `WeatherStateControl`.

- [ ] **Step 1: Add the new flag to `FLAG_REGISTRY`**

In `demo_api_server/routes/featureFlags.js`, immediately after the existing
`ff_weather_mcp_showcase` entry, add:

```js
  {
    id:           'ff_weather_mcp_allowed_state',
    name:         'Weather MCP — Allowed State',
    category:     'MCP / Agent',
    description:
      'Which US state the Agent Gateway (PingGateway/IG) currently allows through the ' +
      'weather-mcp showcase route (`/mcp/weather`). `tx-weather-scope.groovy` reads this ' +
      'live on every request via `GET /internal/feature-flags/weather-mcp-showcase`, so ' +
      'changing it here takes effect immediately, with no gateway restart — the SAME query ' +
      '("what\'s the weather in Miami") can flip from denied to allowed live, during a demo.',
    impact:
      'texas (default) = only the 20 largest Texas cities / TX bounding box pass. ' +
      'michigan = only the 20 largest Michigan cities / MI bounding box pass. ' +
      'any = no geographic restriction — every city passes (subject to ff_weather_mcp_showcase ' +
      'still being ON).',
    type:         'enum',
    options:      ['texas', 'michigan', 'any'],
    defaultValue: 'texas',
  },
```

- [ ] **Step 2: Extend `weatherMcpFlag.js`'s response**

Replace the handler body in `demo_api_server/routes/weatherMcpFlag.js`:

```js
router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  const presented = req.headers['x-internal-gateway-secret'];
  const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : null;
  if (
    !presentedBuf ||
    presentedBuf.length !== INTERNAL_SECRET_BUF.length ||
    !crypto.timingSafeEqual(presentedBuf, INTERNAL_SECRET_BUF)
  ) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  const rawState = configStore.getEffective('ff_weather_mcp_allowed_state');
  const allowedState = ['texas', 'michigan', 'any'].includes(rawState) ? rawState : 'texas';

  return res.json({ enabled, allowedState });
});
```

Also update the file's top-of-file doc comment (`Status codes:` block) to mention the new
`allowedState` field, mirroring the existing `enabled` field's documentation style.

- [ ] **Step 3: Write the test file**

Create `demo_api_server/tests/weatherMcpFlag.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');

describe('GET /internal/feature-flags/weather-mcp-showcase', () => {
  const SECRET = 'test-secret';
  let app;
  let configStore;

  function makeApp() {
    jest.resetModules();
    process.env.BFF_INTERNAL_SECRET = SECRET;
    configStore = require('../services/configStore');
    const router = require('../routes/weatherMcpFlag');
    const a = express();
    a.use('/internal', router);
    return a;
  }

  beforeEach(() => {
    app = makeApp();
  });

  afterEach(() => {
    delete process.env.BFF_INTERNAL_SECRET;
  });

  test('403 without the internal secret header', async () => {
    const res = await request(app).get('/internal/feature-flags/weather-mcp-showcase');
    expect(res.status).toBe(403);
  });

  test('defaults to enabled=true, allowedState=texas when unset', async () => {
    jest.spyOn(configStore, 'getEffective').mockReturnValue(undefined);
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, allowedState: 'texas' });
  });

  test('reflects a stored allowedState value', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'michigan';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('michigan');
  });

  test('falls back to texas for an unrecognized stored value', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'not-a-real-state';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('texas');
  });

  test('enabled reflects a stored false value independently of allowedState', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_showcase') return false;
      if (key === 'ff_weather_mcp_allowed_state') return 'michigan';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body).toEqual({ enabled: false, allowedState: 'michigan' });
  });
});
```

- [ ] **Step 4: Run the test**

From `demo_api_server/`:
```
CI=true npx jest tests/weatherMcpFlag.test.js --testPathIgnorePatterns="/node_modules/|\.claude/worktrees/(?!weather-mcp-chat-integration)|/\.kilo/worktrees/|/tests/real/"
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/routes/weatherMcpFlag.js demo_api_server/tests/weatherMcpFlag.test.js
git commit -m "feat(weather-mcp): add ff_weather_mcp_allowed_state flag + extend flag-check response"
```

---

### Task 2: Gateway — configurable STATES map in `tx-weather-scope.groovy`

**Files:**
- Modify: `ping-gateway/scripts/groovy/tx-weather-scope.groovy`

**Interfaces:**
- Consumes: Task 1's extended `GET /internal/feature-flags/weather-mcp-showcase` response
  shape (`{enabled, allowedState}`).

- [ ] **Step 1: Replace the file's full content**

Replace the entire contents of `ping-gateway/scripts/groovy/tx-weather-scope.groovy` with:

```groovy
// ping-gateway/scripts/groovy/tx-weather-scope.groovy
//
// Agent Gateway (IG) demo policy: the weather-mcp passthrough is scoped to
// ONE configurable US state at a time (default: Texas), or left wide open
// ("any"). Runs after McpValidationFilter has buffered the body. A
// tools/call whose location argument cannot be verified against the
// currently-selected state is denied here, not by the upstream weather-mcp
// server. The selected state is admin-configurable live, via
// ff_weather_mcp_allowed_state — see demo_api_server/routes/featureFlags.js.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_WEATHER_FLAG_URL') ?: ''

// Named-state scope data. Each state: an approximate, generous bounding box
// and its ~20 largest cities (case-insensitive, trimmed, no substring
// containment — see the city_name branch below).
def STATES = [
    texas: [
        latMin: 25.8, latMax: 36.5, lonMin: -106.6, lonMax: -93.5,
        abbrevs: ['tx', 'texas'] as Set,
        cities: [
            'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
            'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
            'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
            'brownsville', 'killeen', 'mcallen',
        ] as Set,
    ],
    michigan: [
        latMin: 41.7, latMax: 48.3, lonMin: -90.5, lonMax: -82.1,
        abbrevs: ['mi', 'michigan'] as Set,
        cities: [
            'detroit', 'grand rapids', 'warren', 'sterling heights', 'ann arbor',
            'lansing', 'dearborn', 'livonia', 'westland', 'troy',
            'farmington hills', 'kalamazoo', 'wyoming', 'southfield', 'rochester hills',
            'taylor', 'pontiac', 'novi', 'st. clair shores', 'royal oak',
        ] as Set,
    ],
]
def STATE_LABELS = [texas: 'Texas', michigan: 'Michigan']

// Live flag check against the BFF: ff_weather_mcp_showcase (on/off) and
// ff_weather_mcp_allowed_state (texas | michigan | any). Fails OPEN on
// `enabled` (a demo toggle, not a security control) but defaults
// `allowedState` to the NARROWEST state ('texas') on any error or
// unrecognized value — an outage or a version-skewed value must never
// accidentally widen the policy. The city/bbox scope check below remains
// fail-closed regardless of this call's outcome.
def weatherFlags = {
    def result = [enabled: true, allowedState: 'texas']
    if (!flagUrl) return result
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxWeatherScope] flag check HTTP ' + code + ' — failing open (enabled), defaulting to texas')
            return result
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        result.enabled = parsed.enabled != false
        if (STATES.containsKey(parsed.allowedState)) {
            result.allowedState = parsed.allowedState
        }
        return result
    } catch (Exception e) {
        logger.warn('[TxWeatherScope] flag check failed: ' + e.message + ' — failing open (enabled), defaulting to texas')
        return result
    }
}

def toNum = { v ->
    if (v instanceof Number) return v.doubleValue()
    if (v instanceof String) {
        try { return Double.parseDouble(v.trim()) } catch (Exception ignored) { return null }
    }
    return null
}

def denied = { Object id, String message ->
    def resp = new Response(Status.FORBIDDEN)
    resp.headers.put('Content-Type', 'application/json')
    resp.entity.setString(JsonOutput.toJson([
        jsonrpc: '2.0',
        id: id,
        error: [code: -32000, message: message],
    ]))
    return Promises.newResultPromise(resp)
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    body = null
}

def id = (body instanceof Map && body.containsKey('id')) ? body.id : null

def flags = weatherFlags()
if (!flags.enabled) {
    return denied(id, 'Agent Gateway: weather capability disabled (ff_weather_mcp_showcase is off)')
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def params = body.params
def args = (params instanceof Map) ? params.arguments : null
if (!(args instanceof Map)) {
    return next.handle(context, request)
}

// Wide open — no restriction at all, every location argument shape passes.
if (flags.allowedState == 'any') {
    return next.handle(context, request)
}

def state = STATES[flags.allowedState]
def stateLabel = STATE_LABELS[flags.allowedState]

if (args.containsKey('latitude') || args.containsKey('longitude')) {
    def latVal = toNum(args.latitude)
    def lonVal = toNum(args.longitude)
    if (latVal == null || lonVal == null || !Double.isFinite(latVal) || !Double.isFinite(lonVal)) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — invalid or incomplete coordinates")
    }
    if (latVal < state.latMin || latVal > state.latMax || lonVal < state.lonMin || lonVal > state.lonMax) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — coordinates outside ${stateLabel}")
    }
    return next.handle(context, request)
}

def city = args.city_name
if (city instanceof String) {
    // Split on the FIRST comma: "Corpus Christi, TX" -> cityPart="corpus christi",
    // statePart="tx". Exact match on both parts — no substring containment — so
    // "Plano, IL" (statePart="il") or "Houston Street, New York, NY" (statePart=
    // "new york, ny") are correctly denied instead of matching on a contained
    // city name. A bare name with NO qualifier ("Austin") falls back to an exact
    // allowlist match on the whole trimmed string.
    def normalized = city.toLowerCase().trim()
    def commaIdx = normalized.indexOf(',')
    def isInState
    if (commaIdx >= 0) {
        def statePart = normalized.substring(commaIdx + 1).trim()
        isInState = state.abbrevs.contains(statePart)
    } else {
        isInState = state.cities.contains(normalized)
    }
    if (!isInState) {
        return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — city not recognized as ${stateLabel}")
    }
    return next.handle(context, request)
}

if (args.containsKey('location_name')) {
    return denied(id, "Agent Gateway: weather scope restricted to ${stateLabel} (demo policy) — saved locations cannot be verified")
}

// No location argument at all (e.g. check_service_status) — nothing to scope.
return next.handle(context, request)
```

- [ ] **Step 2: Verify live — default (texas)**

Recreate `ping-gateway` from the worktree so the change is live (`docker compose up -d
--force-recreate --no-deps ping-gateway`), then mint a fresh bearer token (client_credentials
+ RFC 8693 exchange against the Token Exchanger app — same recipe used earlier in this
project's session history, `audience=https://api.ping.demo:3036/mcp`,
`scope=gateway:mcp:invoke`) and confirm:
- `city_name: "Austin"` → `200`, reaches the real backend.
- `city_name: "Detroit"` → `403`, "restricted to Texas".
- `city_name: "Miami"` → `403`, "restricted to Texas".

- [ ] **Step 3: Verify live — set to michigan**

```bash
curl -sk -X PATCH https://api.ping.demo:3001/api/admin/feature-flags \
  -H "Content-Type: application/json" -b <admin-session-cookie> \
  -d '{"updates":{"ff_weather_mcp_allowed_state":"michigan"}}'
```
(Or via the browser, once Task 4 ships — for this task, direct API/curl is enough.) Then
re-run the same three city calls: Detroit → `200`, Austin → `403` ("restricted to Michigan"),
Miami → `403`.

- [ ] **Step 4: Verify live — set to any**

Same PATCH with `"any"`. Re-run all three cities — all three → `200`, reaching the real
backend. Also confirm a `location_name` argument now passes (previously always denied).

- [ ] **Step 5: Verify `ff_weather_mcp_showcase` independence**

With `ff_weather_mcp_allowed_state` still `"any"`, PATCH `ff_weather_mcp_showcase` to
`false`. Confirm Austin now → `403` ("weather capability disabled"), proving the master flag
still wins regardless of the selected state. Reset both flags back to defaults
(`ff_weather_mcp_showcase: true`, `ff_weather_mcp_allowed_state: "texas"`) when done.

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/scripts/groovy/tx-weather-scope.groovy
git commit -m "feat(weather-mcp): STATES map in tx-weather-scope.groovy, driven by ff_weather_mcp_allowed_state"
```

---

### Task 3: Frontend — generic `renderCardExtra` prop on `CapabilityShowcasePage`

**Files:**
- Modify: `demo_api_ui/src/components/CapabilityShowcasePage.jsx`
- Modify: `demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx`

**Interfaces:**
- Produces: `CapabilityShowcasePage` accepts an optional prop
  `renderCardExtra?: (cap: {id, group, title, oneLiner, evidence}) => ReactNode`, called
  once per rendered card, appended after the evidence `<code>` element. `undefined` behaves
  exactly as before (no extra content, existing consumers unaffected).

- [ ] **Step 1: Add the failing test**

Append to `demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx`:

```jsx
it('calls renderCardExtra per card and renders its result, when provided', () => {
  render(
    <CapabilityShowcasePage
      title="Test Product"
      intro="Test intro copy."
      ledger={LEDGER}
      groups={GROUPS}
      renderCardExtra={(cap) => cap.id === 'cap-2' ? <span data-testid="extra-cap-2">Extra</span> : null}
    />
  );
  expect(screen.getByTestId('extra-cap-2')).toBeInTheDocument();
  expect(screen.queryByTestId('extra-cap-1')).not.toBeInTheDocument();
});

it('renders normally with no renderCardExtra prop (existing consumers unaffected)', () => {
  render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
  expect(screen.getByTestId('cap-card-cap-1')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify the first new case fails**

From `demo_api_ui/`: `npm test -- CapabilityShowcasePage`
Expected: FAIL on `getByTestId('extra-cap-2')` — not found (prop doesn't exist yet).

- [ ] **Step 3: Implement**

In `demo_api_ui/src/components/CapabilityShowcasePage.jsx`:

```diff
- export default function CapabilityShowcasePage({ title, intro, ledger, groups }) {
+ export default function CapabilityShowcasePage({ title, intro, ledger, groups, renderCardExtra }) {
```

```diff
                  <code className="cap-card__evidence">{cap.evidence.code}</code>
+                 {renderCardExtra?.(cap)}
                </article>
```

Also update the JSDoc block above the component to document the new optional prop, matching
the existing `@param` style for the other props.

- [ ] **Step 4: Run the test to verify it passes**

`npm test -- CapabilityShowcasePage` — expected: all PASS (including the pre-existing 4
tests, unaffected).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CapabilityShowcasePage.jsx demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx
git commit -m "feat(capability-tour): optional renderCardExtra prop for per-card inline controls"
```

---

### Task 4: Frontend — `WeatherStateControl` + wire into the Capability Tour

**Files:**
- Create: `demo_api_ui/src/components/WeatherStateControl.jsx`
- Create: `demo_api_ui/src/components/__tests__/WeatherStateControl.test.jsx`
- Modify: `demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx`

**Interfaces:**
- Consumes: Task 1's `GET /api/admin/feature-flags` (reads `ff_weather_mcp_allowed_state`'s
  current `value` from the returned `flags` array) and `PATCH /api/admin/feature-flags`
  (`{updates: {ff_weather_mcp_allowed_state: <value>}}`).
- Consumes: Task 3's `renderCardExtra` prop.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/WeatherStateControl.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeatherStateControl from '../WeatherStateControl';

function mockFetchSequence(getBody, patchBody) {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => getBody });
    }
    return Promise.resolve({ ok: true, json: async () => patchBody });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads and displays the current allowed state', async () => {
  mockFetchSequence({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));
});

test('PATCHes on change and reflects the confirmed value', async () => {
  mockFetchSequence(
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] },
    { flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'michigan' }] },
  );
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'michigan' } });

  await waitFor(() => {
    const patchCall = global.fetch.mock.calls.find((c) => c[1] && c[1].method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(patchCall[1].body)).toEqual({ updates: { ff_weather_mcp_allowed_state: 'michigan' } });
  });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('michigan'));
});

test('shows an error and reverts the select on a failed PATCH', async () => {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || opts.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({ flags: [{ id: 'ff_weather_mcp_allowed_state', value: 'texas' }] }) });
    }
    return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'server_error' }) });
  });
  render(<WeatherStateControl />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('texas'));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'any' } });

  await waitFor(() => expect(screen.getByText(/error/i)).toBeInTheDocument());
  expect(screen.getByRole('combobox')).toHaveValue('texas');
});
```

- [ ] **Step 2: Run to verify it fails**

`npm test -- WeatherStateControl` — expected: FAIL, module not found (component doesn't
exist yet).

- [ ] **Step 3: Implement the component**

Create `demo_api_ui/src/components/WeatherStateControl.jsx`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';

const FLAG_ID = 'ff_weather_mcp_allowed_state';
const OPTIONS = [
  { value: 'texas', label: 'Texas' },
  { value: 'michigan', label: 'Michigan' },
  { value: 'any', label: 'Any (no restriction)' },
];

/**
 * Inline admin control for the weather-mcp showcase capability card: which US
 * state the Agent Gateway currently allows through /mcp/weather. Reads and
 * writes ff_weather_mcp_allowed_state via the existing feature-flags API —
 * self-contained, no shared state with the rest of the Capability Tour page.
 */
export default function WeatherStateControl() {
  const [value, setValue] = useState('texas');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const flag = (data.flags || []).find((f) => f.id === FLAG_ID);
      if (flag && flag.value) setValue(flag.value);
    } catch (_) {
      // silent — control just keeps its default
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (e) => {
    const next = e.target.value;
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [FLAG_ID]: next } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const confirmed = (data.flags || []).find((f) => f.id === FLAG_ID);
      if (confirmed) setValue(confirmed.value);
    } catch (err) {
      setValue(prev);
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="weather-state-control">
      <label className="weather-state-control__label">
        Allowed state
        <select value={value} onChange={handleChange} disabled={saving}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {error && <span className="weather-state-control__error">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

`npm test -- WeatherStateControl` — expected: 3 passed.

- [ ] **Step 5: Wire into `AgentGatewayCapabilitiesPage.jsx`**

```diff
  import React from 'react';
  import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
+ import WeatherStateControl from '../components/WeatherStateControl';
  import {
    AGENT_GATEWAY_CAPABILITIES,
    AGENT_GATEWAY_GROUPS,
  } from '../config/capabilityLedgers/agentGatewayCapabilities';
  ...
      <CapabilityShowcasePage
        title="Agent Gateway"
        intro={INTRO}
        ledger={AGENT_GATEWAY_CAPABILITIES}
        groups={AGENT_GATEWAY_GROUPS}
+       renderCardExtra={(cap) => cap.id === 'weather-tx-scope' ? <WeatherStateControl /> : null}
      />
```

- [ ] **Step 6: Live check**

Rebuild/serve `demo_api_ui` from this worktree, open `/agent-gateway-capabilities` as an
admin, confirm the "Scope a third-party MCP server" card now shows the dropdown, defaulted
to "Texas". Change it to "Michigan", reload the page, confirm it still shows "Michigan"
(proves the PATCH persisted via `configStore`, not just local component state).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/WeatherStateControl.jsx demo_api_ui/src/components/__tests__/WeatherStateControl.test.jsx demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx
git commit -m "feat(weather-mcp): inline Allowed State control on the Capability Tour card"
```

---

### Task 5: Documentation touch-ups

**Files:**
- Modify: `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`
- Modify: `demo_api_server/config/useCases.js`
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Update the capability ledger entry**

In `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`, the
`weather-tx-scope` entry's `oneLiner` and `evidence.code`:

```diff
    id: 'weather-tx-scope',
    group: 'validate-audit',
    title: 'Scope a third-party MCP server',
    oneLiner: 'Fronts a third-party weather MCP server and denies any tool call outside ' +
-     'Texas, entirely at the gateway — the demo policy the backend never sees. ' +
-     'Live-toggleable via ff_weather_mcp_showcase.',
+     'the currently-allowed US state (Texas by default — configurable live, right on this ' +
+     'card), entirely at the gateway — the demo policy the backend never sees. ' +
+     'Live-toggleable via ff_weather_mcp_showcase / ff_weather_mcp_allowed_state.',
-   evidence: { code: 'PingGateway only — no Node mcp-gateway equivalent: ping-gateway/scripts/groovy/tx-weather-scope.groovy:1-140 · ping-gateway/config/routes/00-mcp-weather.json · demo_api_server/routes/weatherMcpFlag.js' },
+   evidence: { code: 'PingGateway only — no Node mcp-gateway equivalent: ping-gateway/scripts/groovy/tx-weather-scope.groovy · ping-gateway/config/routes/00-mcp-weather.json · demo_api_server/routes/weatherMcpFlag.js · demo_api_server/routes/featureFlags.js' },
```

- [ ] **Step 2: Update UC30/UC31 copy in `useCases.js`**

Reword the fixed "Texas" assertions in UC30/UC31's `buyerStory`, `pingOneSolution`, and
`whatLong` fields to describe the gateway's *currently-configured* state rather than a fixed
policy.

UC30:

```diff
-   buyerStory: "A third-party tool the agent calls must be constrained to the business's actual footprint — even though the tool itself has no idea what that footprint is.",
-   pingOneSolution: 'The Agent Gateway fronts a third-party weather MCP server and enforces a Texas-only demo policy entirely at the edge — the backend never sees the restriction.',
+   buyerStory: "A third-party tool the agent calls must be constrained to the business's actual footprint — even though the tool itself has no idea what that footprint is. That footprint should be something the business can change, not a hardcoded assumption.",
+   pingOneSolution: 'The Agent Gateway fronts a third-party weather MCP server and enforces a live, admin-configurable state-scope policy (Texas by default) entirely at the edge — the backend never sees the restriction.',
    ...
-   whatLong: 'The agent calls a real, unmodified third-party weather MCP server through the Agent Gateway. A Texas city is in scope for this demo policy, so the gateway forwards the call and the backend responds normally — the third-party server itself has no concept of the restriction.',
+   whatLong: 'The agent calls a real, unmodified third-party weather MCP server through the Agent Gateway. A city in the gateway\'s currently-configured state (Texas by default) is in scope for this demo policy, so the gateway forwards the call and the backend responds normally — the third-party server itself has no concept of the restriction.',
```

UC31:

```diff
-   pingOneSolution: 'The Agent Gateway denies the call before it reaches the third-party weather MCP server — the demo policy the backend never sees.',
+   pingOneSolution: 'The Agent Gateway denies the call before it reaches the third-party weather MCP server, based on the currently-configured state scope (Texas by default) — the demo policy the backend never sees.',
    ...
-   whatLong: 'The agent asks for weather in a city outside the demo policy\'s Texas scope. The gateway denies the call before it is ever forwarded to the third-party weather MCP server — the backend never runs, and never sees the request.',
+   whatLong: 'The agent asks for weather in a city outside the demo policy\'s currently-configured state scope (Texas by default). The gateway denies the call before it is ever forwarded to the third-party weather MCP server — the backend never runs, and never sees the request.',
```

- [ ] **Step 3: Add the REGRESSION_PLAN.md entry**

Add a new `§4` entry (top of the reverse-chronological log, same format as the existing
weather-mcp entries): files changed, what changed (admin-configurable state instead of a
hardcoded Texas-only policy), why (make the gateway's enforcement provable live during a
demo), do-not-break note (`ff_weather_mcp_showcase` stays independent — master flag OFF
still 403s regardless of `allowedState`), and the verify steps from Task 2 Steps 2-5.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js demo_api_server/config/useCases.js REGRESSION_PLAN.md
git commit -m "docs(weather-mcp): update capability/use-case copy + REGRESSION_PLAN for configurable scope"
```

---

## Final Verification

- [ ] Full backend suite green: `CI=true npx jest --testPathIgnorePatterns="/node_modules/|\.claude/worktrees/(?!weather-mcp-chat-integration)|/\.kilo/worktrees/|/tests/real/" --maxWorkers=2` from `demo_api_server/`.
- [ ] Full frontend suite green: `npm test` from `demo_api_ui/`.
- [ ] Live end-to-end walkthrough (mirrors Task 2's manual checks, now through the real UI
      control from Task 4): open the Capability Tour, confirm default is Texas, run the UC30
      chip in chat (Austin → passes), switch the dropdown to Michigan, run the SAME UC30
      chip again (Austin now denied), run a Detroit query (passes), switch to Any, confirm
      Miami now passes.
