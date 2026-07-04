# PingGateway Vault API-Key — Phase 2 (Invest App + Auth Evidence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Deliver a working, API-key-authenticated **Invest** app (a new `/invest` route on `demo_data_service`, a `show_investment` tool on the api-key disposition) whose result **shows how it was authenticated** — the masked service key + the `GET /invest` call — in the UI and the Token Chain. All via the existing Node-gateway api-key dispatch; **no live IG, no shared-stack recreate** (that is Phase 3).

**Architecture:** `show_investment` joins the existing api-key disposition (the same path that serves `show_mortgage`). The gateway drops the bearer, calls `demo_data_service /invest` with `X-API-Key`, and returns an MCP result whose `_meta` now carries `apiCall` alongside `apiKeyMaskedLast4`. `VerticalFeaturePage` renders both. The value chain is identical to mortgage, so every piece is reused unchanged when Phase 3 moves the injector to IG.

**Tech Stack:** Node/Express (`demo_data_service`, Jest+supertest), TypeScript (Node `mcp-gateway`, Jest+ts-jest), React (`demo_api_ui`, Vitest), Docker Compose.

## Global Constraints

- Work in the worktree `feat/pinggateway-vault-apikey` (`.claude/worktrees/pg-vault-apikey`). Never edit the main checkout. Stage files explicitly; verify `git branch --show-current` before each commit. `node_modules` already exists in the sub-projects in this worktree.
- The invest service key name is `DEMO_INVEST_SERVICE_KEY` (already a Phase-1 vault entry); its value `demo-invest-key-0000` (last4 `0000`). The backend route segment is `invest`.
- Mirror the existing `show_mortgage` / mortgage patterns exactly — invest is a sibling in every map, never a special case.
- `demo_data_service` is `demo_mortgage_service/server.js`; it validates `X-API-Key` (SHA-256 + `timingSafeEqual`) and auto-registers `GET /<route>` for each entry in its `VERTICALS` map.
- Node gateway Jest: `cd demo_mcp_gateway && npx jest <pattern>`. Backend Jest: `cd demo_mortgage_service && npx jest <pattern>` (or the repo's runner if that service has no jest — see Task 1). UI Vitest: `cd demo_api_ui && npx vitest run <pattern>`.
- Do NOT modify IG (`ping-gateway/`) or recreate any container in Phase 2.

---

### Task 1: `demo_data_service` — add the `invest` vertical (`GET /invest`)

**Files:**
- Modify: `demo_mortgage_service/server.js` (the `VERTICALS` map, ~lines 78–92)
- Test: `demo_mortgage_service/` — add `tests/invest-route.test.js` (create `tests/` if absent)

**Interfaces:**
- Produces: `GET /invest` (behind `requireApiKey`) → 200 with a portfolio record; 401 without a valid `X-API-Key`. The record's top-level field is `invest`.

- [ ] **Step 1: Write the failing test**

Create `demo_mortgage_service/tests/invest-route.test.js`:

```js
const request = require('supertest');
process.env.MORTGAGE_SERVICE_API_KEY = 'demo-mortgage-key-0000';
const app = require('../server');

describe('GET /invest', () => {
  test('401 without X-API-Key', async () => {
    const res = await request(app).get('/invest');
    expect(res.status).toBe(401);
  });
  test('200 with valid X-API-Key returns a portfolio record', async () => {
    const res = await request(app).get('/invest').set('X-API-Key', 'demo-mortgage-key-0000');
    expect(res.status).toBe(200);
    expect(res.body.invest).toBeTruthy();
    expect(res.body.invest.portfolioId).toBe('INV-8842');
    expect(res.body.authMechanism).toBe('X-API-Key (shared secret)');
  });
});
```

- [ ] **Step 2: Run it → RED**

Run: `cd demo_mortgage_service && npx jest tests/invest-route.test.js`
Expected: FAIL — `/invest` returns 404 (`not_found`), so the 200 test fails. (If `supertest`/`jest` are absent in this service, install dev-only: `npm i -D jest supertest` — gitignored — and add `"test":"jest"` to its package.json if missing; note it in your report.)

- [ ] **Step 3: Add the `invest` vertical**

In `demo_mortgage_service/server.js`, inside the `VERTICALS` object (sibling to `mortgage`/`retail`/`expense`), add:

```js
  invest: {
    noun: 'portfolio',
    record: {
      invest: {
        portfolioId: 'INV-8842',
        holder: 'Jordan A. Rivera',
        totalValue: 184320.55,
        cashSweep: 12580.10,
        ytdReturnPct: 11.4,
        riskProfile: 'Growth',
        holdings: [
          { symbol: 'VTI', name: 'Vanguard Total Market ETF', quantity: 220, marketValue: 62480.00 },
          { symbol: 'UST-10Y', name: 'US Treasury Note', quantity: null, marketValue: 60010.35 },
          { symbol: 'AAPL', name: 'Apple Inc.', quantity: 90, marketValue: 19260.00 },
          { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', quantity: 340, marketValue: 29990.10 },
        ],
      },
    },
  },
```

- [ ] **Step 4: Run it → GREEN**

Run: `cd demo_mortgage_service && npx jest tests/invest-route.test.js`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add demo_mortgage_service/server.js demo_mortgage_service/tests/invest-route.test.js
[ -f demo_mortgage_service/package.json ] && git add demo_mortgage_service/package.json
git commit -m "feat(data-service): add /invest portfolio route"
```

---

### Task 2: Node gateway — register `show_investment` on the api-key disposition

**Files:**
- Modify: `demo_mcp_gateway/src/router.ts` (`APIKEY_TOOLS` ~51-60, `APIKEY_BACKEND_ROUTES` ~104-114)
- Modify: `demo_mcp_gateway/src/apiKeyDispatch.ts` (`TOOL_DISPLAY_NAMES` ~52-61)
- Modify: `demo_mcp_gateway/src/auth/toolScopes.ts` (the tool→scopes map — read it and add the `show_investment` sibling)
- Test: `demo_mcp_gateway/tests/investDispatch.test.ts` (new; mirror `tests/mortgageDispatch.test.ts`)

**Interfaces:**
- Consumes: `routeTool`, `backendHttpUrl` from `../src/router`; `getScopesForGatewayTool` from `../src/auth/toolScopes`.
- Produces: `routeTool('show_investment') === 'apikey'`; `backendHttpUrl('apikey','show_investment',config)` ends with `/invest`; `getScopesForGatewayTool('show_investment')` includes `invest:read`.

- [ ] **Step 1: Write the failing test**

Create `demo_mcp_gateway/tests/investDispatch.test.ts`:

```ts
import { routeTool, backendHttpUrl } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const cfg: any = { mortgageServiceBaseUrl: 'http://mortgage-service:8082' };

describe('show_investment api-key disposition', () => {
  test('routes to the apikey disposition', () => {
    expect(routeTool('show_investment')).toBe('apikey');
  });
  test('backend URL targets the /invest route', () => {
    expect(backendHttpUrl('apikey', 'show_investment', cfg)).toBe('http://mortgage-service:8082/invest');
  });
  test('requires invest:read scope', () => {
    expect(getScopesForGatewayTool('show_investment')).toContain('invest:read');
  });
});
```

- [ ] **Step 2: Run it → RED**

Run: `cd demo_mcp_gateway && npx jest tests/investDispatch.test.ts`
Expected: FAIL — `routeTool` returns `'olb'` and `backendHttpUrl` returns `''` for the unknown tool.

- [ ] **Step 3: Register the tool in the three maps**

In `demo_mcp_gateway/src/router.ts`, add to `APIKEY_TOOLS` (sibling line):

```ts
  'show_investment',     // banking — investment portfolio (api-key demo, Phase 2)
```

and to `APIKEY_BACKEND_ROUTES`:

```ts
  show_investment:     'invest',
```

In `demo_mcp_gateway/src/apiKeyDispatch.ts`, add to `TOOL_DISPLAY_NAMES`:

```ts
  show_investment:     'Investment Portfolio',
```

In `demo_mcp_gateway/src/auth/toolScopes.ts`: read the file, find the `show_mortgage` entry in the tool→scopes map, and add the parallel `show_investment` entry with scope `invest:read` (mirror the mortgage entry's shape exactly — e.g. `show_investment: ['invest:read']`).

- [ ] **Step 4: Run it → GREEN**

Run: `cd demo_mcp_gateway && npx jest tests/investDispatch.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add demo_mcp_gateway/src/router.ts demo_mcp_gateway/src/apiKeyDispatch.ts demo_mcp_gateway/src/auth/toolScopes.ts demo_mcp_gateway/tests/investDispatch.test.ts
git commit -m "feat(gateway): register show_investment on the api-key disposition"
```

---

### Task 3: `apiKeyDispatch` — add `_meta.apiCall` + correct masked last4

**Files:**
- Modify: `demo_mcp_gateway/src/apiKeyDispatch.ts` (the success-return `_meta`, ~153-199; and the last4 source)
- Modify: `demo_mcp_gateway/src/index.ts` (~745-772) and `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (~718-720) — pass the correct key's last4
- Test: extend `demo_mcp_gateway/tests/investDispatch.test.ts`

**Interfaces:**
- Produces: the api-key MCP result `_meta` gains `apiCall: 'GET /<routeSegment>'`; `apiKeyMaskedLast4` reflects the actually-injected key (`config.mortgageServiceApiKey`), not the marker key.

- [ ] **Step 1: Write the failing test (extend the invest test file)**

Append to `demo_mcp_gateway/tests/investDispatch.test.ts`:

```ts
import { buildApiKeyToolResult } from '../src/apiKeyDispatch';
import nock from 'nock';

describe('show_investment _meta', () => {
  afterEach(() => nock.cleanAll());
  test('result _meta carries apiCall and the injected key last4', async () => {
    nock('http://mortgage-service:8082').get('/invest').reply(200, { invest: { portfolioId: 'INV-8842' } });
    const conf: any = { mortgageServiceBaseUrl: 'http://mortgage-service:8082', mortgageServiceApiKey: 'demo-invest-key-9999' };
    const out: any = await buildApiKeyToolResult('show_investment', 'user-sub', undefined, conf);
    expect(out.ok).toBe(true);
    expect(out.result._meta.apiCall).toBe('GET /invest');
    expect(out.result._meta.apiKeyMaskedLast4).toBe('9999');
  });
});
```

(If `nock` is not already a dev dep of `demo_mcp_gateway`, install it dev-only: `npm i -D nock` — gitignored. Check `package.json` first; several tests may already stub axios differently — if the repo uses a different HTTP-mock, mirror that instead and adjust the test.)

- [ ] **Step 2: Run it → RED**

Run: `cd demo_mcp_gateway && npx jest tests/investDispatch.test.ts -t "_meta"`
Expected: FAIL — `_meta.apiCall` is undefined; `apiKeyMaskedLast4` is `XXXX` (the 3rd arg is undefined and the last4 isn't derived from the injected key).

- [ ] **Step 3: Implement**

In `demo_mcp_gateway/src/apiKeyDispatch.ts`:
- Derive the last4 from the injected key when the caller didn't pass one. Change the `last4` line (~98) to:

```ts
  const injected = config.mortgageServiceApiKey || '';
  const last4 = apiKeyMaskedLast4 || (injected.length >= 4 ? injected.slice(-4) : 'XXXX');
```

- In the success-return `_meta` object (~157-165), add the `apiCall` field next to `apiKeyMaskedLast4`:

```ts
        apiKeyMaskedLast4: last4,
        apiCall: `GET /${meta.routeSegment}`,
```

- [ ] **Step 4: Run it → GREEN**

Run: `cd demo_mcp_gateway && npx jest tests/investDispatch.test.ts`
Expected: PASS (all invest tests, including `_meta`).

- [ ] **Step 5: Confirm no regression in the mortgage dispatch test**

Run: `cd demo_mcp_gateway && npx jest tests/mortgageDispatch.test.ts`
Expected: PASS (the last4 change is additive; if a mortgage test asserted the old `XXXX`/marker last4, update that assertion to the injected key's last4 and note it in your report).

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add demo_mcp_gateway/src/apiKeyDispatch.ts demo_mcp_gateway/src/index.ts demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/tests/investDispatch.test.ts
git commit -m "feat(gateway): add _meta.apiCall + inject-key last4 to api-key result"
```

---

### Task 4: Docker — point the gateway at the in-cluster data service

**Files:**
- Modify: `docker-compose.yml` (`mcp-gateway` `environment:` block, ~315-324)

**Interfaces:**
- Produces: `mcp-gateway` resolves `config.mortgageServiceBaseUrl` to `http://mortgage-service:8082` (reachable in-container) instead of the `localhost:8082` default, so the api-key dispatch's backend GET actually succeeds in Docker.

- [ ] **Step 1: Add the env var**

In `docker-compose.yml`, in the `mcp-gateway` `environment:` block, add:

```yaml
      MORTGAGE_SERVICE_URL: "http://mortgage-service:8082"   # api-key dispatch backend (mortgage + invest routes)
```

- [ ] **Step 2: Validate compose parses**

Run: `cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey && docker compose -f docker-compose.yml config >/dev/null 2>&1 && echo OK` (create a temp empty gitignored `demo_api_server/.env` only if the required-env_file check demands it, then delete it). Expected: `OK`, and the rendered `mcp-gateway` env includes `MORTGAGE_SERVICE_URL`. Do NOT run `up`/recreate.

- [ ] **Step 3: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add docker-compose.yml
git commit -m "fix(gateway): set MORTGAGE_SERVICE_URL so the api-key path reaches the backend in Docker"
```

---

### Task 5: UI — render the auth-evidence line + wire an invest entry point

**Files:**
- Modify: `demo_api_ui/src/components/VerticalFeaturePage.jsx` (the Credential-swap card, ~86-100)
- Modify: `demo_api_ui/src/components/AIAgent.js` (`vertical_feature_demo`, the `featurePayload` build ~2521-2530 — thread `apiCall` through)
- Create: a NEW `investment` vertical — `demo_api_server/config/verticals/investment/manifest.json` with `featurePage.mcpTool: "show_investment"` (each vertical has exactly one feature tool; banking is already `show_mortgage`, so invest must be its own vertical). Mirror the smallest existing manifest (e.g. `government` / `university`, ~209 lines) and adapt id/theme/terminology/scopes(`invest:read`)/demoUsers/featurePage. Register it wherever verticals are enumerated — this is a DISCOVERY step: read `demo_api_server/services/verticalManifest/resolver.js` and `demo_api_server/services/lmdb/verticalStore.lmdb.js` to learn whether verticals load from the filesystem automatically or must be seeded into the store; do whatever an existing vertical does. If registration turns out to require broad changes (nav, scope-topology, seeding scripts) beyond adding the manifest + one registration point, STOP and report DONE_WITH_CONCERNS describing what's needed, rather than sprawling.
- Test: `demo_api_ui/src/components/__tests__/VerticalFeaturePage.test.jsx` (create if absent; assert the apiCall line renders)

**Interfaces:**
- Consumes: `raw.apiCall` (new) + `raw.apiKeyMaskedLast4` on the `featurePayload`.
- Produces: the Credential-swap card shows an "API call" row (e.g. `GET /invest`) beneath the masked key.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/VerticalFeaturePage.test.jsx` (render with a stub `featurePayload` in router state; mirror any existing component test's harness — read a sibling test first for the render/`MemoryRouter` setup):

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerticalFeaturePage from '../VerticalFeaturePage';

function renderWith(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/feature', state }]}>
      <VerticalFeaturePage />
    </MemoryRouter>
  );
}

test('shows the API call row in the credential-swap card', () => {
  renderWith({ featurePayload: { apiKeyMaskedLast4: '0000', apiCall: 'GET /invest', backend: { authMechanism: 'X-API-Key (shared secret)' } } });
  expect(screen.getByText(/GET \/invest/)).toBeInTheDocument();
  expect(screen.getByText(/0000/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it → RED**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/VerticalFeaturePage.test.jsx`
Expected: FAIL — the `GET /invest` text is not rendered (no apiCall row yet). (If the harness/import differs, align to a sibling component test — read one first.)

- [ ] **Step 3: Render the apiCall row + thread the data**

In `demo_api_ui/src/components/VerticalFeaturePage.jsx`, in the credential-swap card (right after the "Service API key" `<span>`/`<code>` block, ~line 96), add:

```jsx
          <div className="vfp-swap-row">
            <span className="vfp-swap-label">API call:</span>
            <code className="vfp-swap-value">{raw.apiCall || '—'}</code>
          </div>
```

In `demo_api_ui/src/components/AIAgent.js`, where `featurePayload` is built (~2521-2530), add `apiCall: featureMeta.apiCall` alongside `apiKeyMaskedLast4: featureMeta.apiKeyMaskedLast4` (and mirror in the mortgage twin ~2458-2475 for consistency).

For the invest entry point — create the NEW `investment` vertical (see the Files block): copy the smallest existing manifest (`government` or `university`) to `demo_api_server/config/verticals/investment/manifest.json`, set `id: "investment"`, a distinct `theme` (accent/name/logo — its own brand, e.g. a wealth/portfolio identity), `terminology`, `scopes` including `invest:read`, `demoUsers`, and `featurePage.mcpTool: "show_investment"` (+ `pageTitle`/`sectionTitle` for the invest app). Then register it the same way existing verticals are: read `verticalManifest/resolver.js` + `lmdb/verticalStore.lmdb.js` first and follow that mechanism (filesystem auto-load vs store seed). The `VerticalFeaturePage` will then theme + render this vertical automatically (it reads `useVertical().pageManifest.featurePage`), so no per-vertical UI code is needed — that's the whole point of A. Document exactly how you registered it. If registration needs changes well beyond "add manifest + one registration point" (nav wiring, scope-topology entries, a seed script), report DONE_WITH_CONCERNS with the list instead of sprawling — I'll scope that separately.

- [ ] **Step 4: Run it → GREEN**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/VerticalFeaturePage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add demo_api_ui/src/components/VerticalFeaturePage.jsx demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/__tests__/VerticalFeaturePage.test.jsx demo_api_server/config/verticals/banking/manifest.json
git commit -m "feat(ui): show API-call row in credential-swap card + wire invest feature entry"
```

---

### Task 6: Token Chain — surface the API call / masked key on the gateway step

**Files:**
- Modify: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` (the `api` step ~171-175, and/or the `gateway` step ~145-160)
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`

**Interfaces:**
- Consumes: an `evt-swap`/`evt-backend` token event (already emitted by `apiKeyDispatch`) or the `mcpResult._meta.apiCall` in the trace.
- Produces: the api/gateway step's `detail` shows the masked key + `apiCall` when the api-key path ran; the empty-trace step ids/count are unchanged (enrich an existing step — do NOT add a new step in Phase 2, to keep the 11-step contract).

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`:

```js
test('api step surfaces the api-key call + masked key when the swap ran', () => {
  const trace = { ...EMPTY_TRACE,
    tokenEvents: [
      { id: 'evt-swap', tokenType: 'api_key', maskedValue: '...0000', status: 'ok' },
      { id: 'evt-backend', tokenType: 'api_key', status: 'ok' },
    ],
    mcpResult: { _meta: { credentialPath: 'api_key', apiKeyMaskedLast4: '0000', apiCall: 'GET /invest' } },
  };
  const step = buildTraceSteps(trace).find((s) => s.id === 'api');
  expect(step.status).toBe('done');
  const flat = JSON.stringify(step.detail);
  expect(flat).toContain('GET /invest');
  expect(flat).toContain('0000');
});
```

- [ ] **Step 2: Run it → RED**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js -t "api-key call"`
Expected: FAIL — the `api` step detail doesn't include the apiCall/masked key.

- [ ] **Step 3: Enrich the `api` step**

In `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`, in the `api` step block (~171-175), when the api-key path ran (`mcpResult?._meta?.credentialPath === 'api_key'` or an `evt-backend`/`evt-swap` event is present), add to that step's `detail.kv` an entry for the API call and the masked key, e.g.:

```js
  const apiMeta = (mcpResult && mcpResult._meta) || {};
  const apiKeyCall = apiMeta.credentialPath === 'api_key';
  // ...within the api step's detail:
  kv: [
    apiKeyCall && apiMeta.apiCall ? ['api call', apiMeta.apiCall] : null,
    apiKeyCall && apiMeta.apiKeyMaskedLast4 ? ['service key', `••••${apiMeta.apiKeyMaskedLast4}`] : null,
    // ...existing kv entries...
  ].filter(Boolean),
```

(Read the existing `api` step to merge this into its real `detail` shape without dropping current fields.)

- [ ] **Step 4: Run it → GREEN + no regression**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
Expected: PASS, including the existing empty-trace 11-step assertion (unchanged — no new step added).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pg-vault-apikey
git add demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js
git commit -m "feat(trace): surface api-key call + masked key on the resource-server step"
```

---

## Self-Review

- **Spec coverage (Rev-2 Phase 2 list):** /invest route → T1; show_investment registration → T2; `_meta.apiCall` + last4 → T3; Docker base-URL fix → T4; UI apiCall row + entry point → T5; trace surfacing → T6. Covered.
- **Placeholder scan:** all steps carry literal code. The two "read the sibling first" instructions (toolScopes entry in T2, the vertical-manifest wiring in T5, the component test harness in T5) are mirror-an-existing-pattern directives with the exact sibling named — not deferred work; the implementer copies a known-good neighbor.
- **Type/name consistency:** `show_investment` / route segment `invest` / `DEMO_INVEST_SERVICE_KEY` / `_meta.apiCall` / `apiKeyMaskedLast4` are identical across backend, gateway, UI, and trace tasks. `mortgageServiceBaseUrl`/`mortgageServiceApiKey` are the real config field names from `config.ts`.
- **No live IG / no recreate:** every task is unit-tested; the only Docker touch (T4) is a `config`-validated env add. IG and the running stack are untouched — that is Phase 3.
- **Risk:** T5 (UI entry point) has the most discovery — the exact manifest wiring depends on the `banking` manifest's current `featurePage`; the task bounds it to "smallest change to reach the invest feature page" and requires the implementer to document what they wired.
