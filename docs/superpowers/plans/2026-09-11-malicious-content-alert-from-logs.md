# Malicious Content — Alert-from-logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the LLM Gateway page, surface the Privilege gateway's own guardrail verdict (Alert / Block) for a chat request, read from the gateway's `gateway-events` log — so the Malicious Content threat demonstrates even though the aligned model refuses and the HTTP response is clean.

**Architecture:** The verdicts live only in OpenSearch index `gateway-events` on the SE cluster, reachable off-cluster ONLY through the `opensearch-mcp-server` MCP endpoint, which is behind full OAuth 2.1 (PKCE + DCR; client_credentials is rejected). So the BFF connects as an interactive OAuth client through the mcpgw broker, holds the token in the session, and calls the `SearchIndexTool` MCP tool to read the log. A new `GuardrailLogPanel` on the LLM Gateway page shows the verdicts, filtered to the demo's own calls. Nothing new scores or blocks — this only READS and DISPLAYS the gateway's existing verdicts.

**Tech Stack:** BFF — Node 22, CommonJS, Express 4, `jest`+`supertest`, `@modelcontextprotocol/sdk` (already a dep). UI — React 19.2, Vite, `vitest`+`@testing-library/react`. No new dependencies.

**Spec:** `~/.claude/projects/-Users-cmuir-Development-AI-DEMO2/memory/project-four-threat-guardrail-measurements-2026-09-10.md` (the measured facts) + this header. Live facts captured 2026-09-10/11 against the SE cluster.

## Global Constraints

- **CommonJS only** in `demo_api_server` (`'use strict'` + `require`), Node >= 22. UI is plain JSX (no TS), vitest not jest.
- **Error shape** `{ error }` (add flags alongside, never instead): `res.status(4xx).json({ error: 'code', ... })`.
- **Never leak upstream errors**: wrap axios/fetch failures with `require('../utils/normalizeAxiosError')` before returning/logging — raw errors carry bearer tokens.
- **THEMING**: no inline `color`/`background`/`font-size`; use `--th-*` and `--font-size-*` tokens in a `.css` file. Smallest font token is `--font-size-2xs` (there is no `3xs`).
- **Emoji allowlist only** (`REGRESSION_PLAN.md` §0): the icons this feature uses are `⚠️ ✅ ❌ 🔐 🛡`. No others.
- **Never print/log secrets**: the OAuth token and `client_secret` live in `req.session`, never in a response body or a log line.
- **HTTP from UI** goes through `apiClient` (`demo_api_ui/src/services/apiClient.js`) EXCEPT where a raw `fetch` is required for exact header control (documented per-call).
- **Do not break** `routes/privilegeMcpClient.js` — this feature MIRRORS its OAuth flow in a new self-contained service rather than refactoring it (it is large and protected; duplication of ~40 lines of broker calls is the deliberately lazy, low-risk choice).

## Measured facts the plan depends on (do not re-derive)

- Index: `gateway-events` (SE cluster OpenSearch, 256+ docs). AIGuard docs carry:
  `msg:"AIGuard"`, `Event` (`llm_request_blocked` | `llm_request_alert`), `Category`
  (e.g. `prompt_injection`, `pii`, `malicious_content`), `Direction` (`request`|`response`),
  `VirtualKeyID` (e.g. `sk-orion-...`), `time` (ISO8601), and compliance arrays
  `OWASPIDs`, `MITREATLASIDs`, `NISTAIRMFIDs`, plus `ComplianceMappings[]`.
- MCP server: `opensearch-mcp-server.mcpgw.ai-demo.ping-devops.com`, MCP endpoint `/sse`,
  behind OAuth 2.1. OAuth AS is the gateway itself:
  `authorization_uri=https://mcpgw.ai-demo.ping-devops.com/.well-known/authorize`,
  `token_uri=https://mcpgw.ai-demo.ping-devops.com/.well-known/token`,
  DCR at `POST /register`. **client_credentials is rejected — PKCE authorization_code only.**
- MCP tool: **`SearchIndexTool`**, args model `SearchIndexArgs`:
  `index: str`, `query_dsl: <OpenSearch DSL object>`, `format: "json"|"csv"` (default json),
  `size: int` (default 10, max 100). (Server: `opensearch_mcp_server_py` 0.10.0.)
  Example DSL for the demo:
  ```json
  { "query": { "bool": { "must": [ { "match": { "msg": "AIGuard" } } ] } },
    "sort": [ { "time": { "order": "desc" } } ] }
  ```

## File Structure

- `demo_api_server/services/gatewayEventsService.js` (create) — the OAuth + MCP + query + normalize core. One responsibility: turn a session (with or without a stored opensearch-mcp token) into normalized guardrail verdicts, driving DCR/PKCE/token/refresh and the `SearchIndexTool` call.
- `demo_api_server/routes/guardrailLog.js` (create) — thin Express router: `/connect`, `/callback`, `GET /` (query). Mounted under `/api/privilege-mcp/guardrail-log`.
- `demo_api_server/server.js` (modify) — mount the router.
- `demo_api_server/tests/services/gatewayEventsService.test.js` (create) — normalize + DSL builder units (no network).
- `demo_api_server/tests/routes/guardrailLog.test.js` (create) — route behavior with the service mocked.
- `demo_api_ui/src/components/GuardrailLogPanel.jsx` (create) — Connect button + verdict list + category filter.
- `demo_api_ui/src/components/GuardrailLogPanel.css` (create) — themeable styles.
- `demo_api_ui/src/components/__tests__/GuardrailLogPanel.test.jsx` (create) — render + states (disconnected/connected/empty).
- `demo_api_ui/src/pages/LlmGatewayPage.jsx` (modify) — render `<GuardrailLogPanel />` and, after a Malicious Content send returns a clean 200, point the SE at the panel.

---

### Task 1: SPIKE — validate the opensearch-mcp-server OAuth + SearchIndexTool flow end-to-end

**Why a spike:** every later task's OAuth code depends on the exact register/authorize/token request shapes this broker wants, which have not been executed off-cluster yet. This task PRODUCES those captured shapes; Tasks 3–4 copy them verbatim. No production code is written here.

**Files:**
- Create (scratch, not committed): `scratchpad/spike-guardrail-oauth.md` — the captured request/response for each step.

**Interfaces:**
- Produces (consumed by Tasks 3–4): the exact JSON bodies + headers for (a) `POST /register` (DCR), (b) the `/authorize` query params incl. `code_challenge`/`resource`/`scope`, (c) `POST /token` (authorization_code) and (d) refresh, and (e) the `tools/call` request for `SearchIndexTool` over the `/sse` transport, plus one real normalized verdict row.

- [ ] **Step 1: Fetch the AS metadata and DCR-register a client**

Run (from repo root, stack up):
```bash
curl -s https://mcpgw.ai-demo.ping-devops.com/.well-known/oauth-authorization-server \
  -H 'Authorization: Bearer x' | tee /tmp/as.json   # may 401; capture authorization/token endpoints from the /register flow instead
curl -s -X POST https://mcpgw.ai-demo.ping-devops.com/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"guardrail-log-demo","redirect_uris":["https://api.ping.demo:3001/api/privilege-mcp/guardrail-log/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"client_secret_post"}' | tee /tmp/dcr.json
```
Expected: a JSON body with `client_id` (and maybe `client_secret`). Record it.

- [ ] **Step 2: Drive the PKCE authorize leg in a browser and capture the code**

Use the Playwright MCP browser: build the authorize URL with a generated `code_verifier`/`code_challenge` (S256), `client_id` from Step 1, `redirect_uri` = the callback above, `response_type=code`, and — if the resource-metadata demanded it — `resource=https://opensearch-mcp-server.mcpgw.ai-demo.ping-devops.com`. Sign in as the demo user; capture the `code` from the redirect to the callback URL. Record the full authorize query string that worked.

- [ ] **Step 3: Exchange the code for a token**

```bash
curl -s -X POST https://mcpgw.ai-demo.ping-devops.com/.well-known/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code&code=<CODE>&redirect_uri=<CB>&client_id=<CID>&client_secret=<CSECRET>&code_verifier=<VERIFIER>' | tee /tmp/tok.json
```
Expected: `access_token` (+ maybe `refresh_token`). Record the exact param set that worked.

- [ ] **Step 4: Call SearchIndexTool over /sse and capture a verdict**

Using `@modelcontextprotocol/sdk` `Client` + `StreamableHTTP`/`SSEClientTransport` against `https://opensearch-mcp-server.mcpgw.ai-demo.ping-devops.com/sse` with `Authorization: Bearer <access_token>`: `initialize` → `tools/list` (confirm `SearchIndexTool` present) → `tools/call` `SearchIndexTool` with `{ index: "gateway-events", query_dsl: { query: { bool: { must: [ { match: { msg: "AIGuard" } } ] } }, sort: [ { time: { order: "desc" } } ] }, size: 5 }`. Record one raw hit's `_source`.

- [ ] **Step 5: Write the captured shapes to `scratchpad/spike-guardrail-oauth.md`**

Record verbatim: DCR request/response, working authorize query, token request/response keys, the transport class that connected (`SSEClientTransport` vs `StreamableHTTPClientTransport`), and one normalized verdict `{ time, category, event, direction, virtualKeyId, owasp, mitre, nist }`. No commit (scratch only).

---

### Task 2: `gatewayEventsService` — normalize + DSL builder (pure, no network)

**Files:**
- Create: `demo_api_server/services/gatewayEventsService.js`
- Test: `demo_api_server/tests/services/gatewayEventsService.test.js`

**Interfaces:**
- Produces: `buildAiGuardDsl({ category, virtualKeyId })` → OpenSearch DSL object; `normalizeVerdict(hit)` → `{ time, category, event, direction, virtualKeyId, owasp, mitre, nist }`. Both consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { buildAiGuardDsl, normalizeVerdict } = require('../../services/gatewayEventsService');

describe('gatewayEventsService pure helpers', () => {
  it('buildAiGuardDsl always filters to AIGuard docs, newest first', () => {
    const dsl = buildAiGuardDsl({});
    expect(dsl.query.bool.must).toContainEqual({ match: { msg: 'AIGuard' } });
    expect(dsl.sort).toEqual([{ time: { order: 'desc' } }]);
  });
  it('buildAiGuardDsl adds category + virtualKeyId filters when given', () => {
    const dsl = buildAiGuardDsl({ category: 'malicious_content', virtualKeyId: 'sk-orion-1' });
    expect(dsl.query.bool.must).toContainEqual({ match: { Category: 'malicious_content' } });
    expect(dsl.query.bool.must).toContainEqual({ match: { VirtualKeyID: 'sk-orion-1' } });
  });
  it('normalizeVerdict maps the AIGuard _source to the UI shape', () => {
    const hit = { _source: { time: '2026-09-10T23:36:19Z', Category: 'prompt_injection',
      Event: 'llm_request_blocked', Direction: 'request', VirtualKeyID: 'sk-orion-1',
      OWASPIDs: ['LLM01'], MITREATLASIDs: ['AML.T0051'], NISTAIRMFIDs: ['MAP-2.3'] } };
    expect(normalizeVerdict(hit)).toEqual({ time: '2026-09-10T23:36:19Z', category: 'prompt_injection',
      event: 'llm_request_blocked', direction: 'request', virtualKeyId: 'sk-orion-1',
      owasp: ['LLM01'], mitre: ['AML.T0051'], nist: ['MAP-2.3'] });
  });
  it('normalizeVerdict tolerates missing compliance arrays', () => {
    expect(normalizeVerdict({ _source: { time: 't', Category: 'c', Event: 'e' } }))
      .toMatchObject({ owasp: [], mitre: [], nist: [] });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/gatewayEventsService.test.js --forceExit`
Expected: FAIL — "Cannot find module '../../services/gatewayEventsService'".

- [ ] **Step 3: Implement the pure helpers**

```javascript
'use strict';
function buildAiGuardDsl({ category, virtualKeyId } = {}) {
  const must = [{ match: { msg: 'AIGuard' } }];
  if (category) must.push({ match: { Category: category } });
  if (virtualKeyId) must.push({ match: { VirtualKeyID: virtualKeyId } });
  return { query: { bool: { must } }, sort: [{ time: { order: 'desc' } }] };
}
function normalizeVerdict(hit) {
  const s = (hit && hit._source) || {};
  return {
    time: s.time || null, category: s.Category || null, event: s.Event || null,
    direction: s.Direction || null, virtualKeyId: s.VirtualKeyID || null,
    owasp: s.OWASPIDs || [], mitre: s.MITREATLASIDs || [], nist: s.NISTAIRMFIDs || [],
  };
}
module.exports = { buildAiGuardDsl, normalizeVerdict };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/gatewayEventsService.test.js --forceExit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/gatewayEventsService.js demo_api_server/tests/services/gatewayEventsService.test.js
git commit -m "feat(bff): gateway-events DSL builder + verdict normalizer"
```

---

### Task 3: `gatewayEventsService` — OAuth + MCP call (append to the service)

**Files:**
- Modify: `demo_api_server/services/gatewayEventsService.js`
- Test: `demo_api_server/tests/services/gatewayEventsService.test.js` (add a block)

**Interfaces:**
- Consumes: `buildAiGuardDsl`, `normalizeVerdict` (Task 2); the Task 1 captured OAuth shapes; `@modelcontextprotocol/sdk`.
- Produces: `getAuthorizeUrl(session)` → `{ url, state }` (starts DCR+PKCE, stashes verifier/client in `session.guardrailOauth`); `completeAuthorize(session, code)` → stores token in `session.guardrailOauth`; `searchGuardrailVerdicts(session, { category, size })` → `{ connected: true, verdicts: [...] }` or throws `NotConnectedError`. All secrets stay in `session.guardrailOauth`, never returned.

- [ ] **Step 1: Write the failing test (mock the SDK client + fetch; assert wiring, not the network)**

```javascript
const svc = require('../../services/gatewayEventsService');
describe('searchGuardrailVerdicts', () => {
  it('throws NotConnectedError when the session has no token', async () => {
    await expect(svc.searchGuardrailVerdicts({}, {})).rejects.toThrow(svc.NotConnectedError);
  });
  it('calls SearchIndexTool with the AIGuard DSL and normalizes hits', async () => {
    const callTool = jest.fn().mockResolvedValue({ content: [{ type: 'text',
      text: JSON.stringify({ hits: { hits: [{ _source: { time: 't', Category: 'malicious_content', Event: 'llm_request_alert' } }] } }) }] });
    jest.spyOn(svc, '_mcpClientFor').mockResolvedValue({ callTool, close: jest.fn() });
    const out = await svc.searchGuardrailVerdicts(
      { guardrailOauth: { accessToken: 'x', expiresAt: Date.now() + 60000 } },
      { category: 'malicious_content', size: 5 });
    expect(callTool).toHaveBeenCalledWith({ name: 'SearchIndexTool',
      arguments: { index: 'gateway-events',
        query_dsl: svc.buildAiGuardDsl({ category: 'malicious_content' }), format: 'json', size: 5 } });
    expect(out.verdicts[0]).toMatchObject({ category: 'malicious_content', event: 'llm_request_alert' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/gatewayEventsService.test.js --forceExit`
Expected: FAIL — `searchGuardrailVerdicts`/`NotConnectedError`/`_mcpClientFor` undefined.

- [ ] **Step 3: Implement OAuth + MCP (copy the exact shapes captured in Task 1)**

Implement, using the Task-1-captured request shapes verbatim:
- `class NotConnectedError extends Error {}`.
- `getAuthorizeUrl(session)`: DCR `POST /register` (fetch), generate PKCE `code_verifier` + S256 `code_challenge` (`crypto`), build the authorize URL with the query params Task 1 proved (incl. `resource` if required), stash `{ clientId, clientSecret, verifier, state }` in `session.guardrailOauth`. Return `{ url, state }`.
- `completeAuthorize(session, code)`: `POST /.well-known/token` (authorization_code + verifier + client creds), store `{ accessToken, refreshToken, expiresAt }` in `session.guardrailOauth`. Wrap failures with `normalizeAxiosError`.
- `_mcpClientFor(session)`: refresh the token if `expiresAt` is near; return a connected `@modelcontextprotocol/sdk` `Client` over the transport Task 1 proved, with `Authorization: Bearer`. (Separate function so tests stub it.)
- `searchGuardrailVerdicts(session, { category, size = 20 })`: throw `NotConnectedError` if no valid token; else `_mcpClientFor` → `callTool SearchIndexTool` with `buildAiGuardDsl` → parse the text content JSON → `hits.hits.map(normalizeVerdict)`; `close()` in `finally`.
- Export all new names alongside Task 2's.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/gatewayEventsService.test.js --forceExit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/gatewayEventsService.js demo_api_server/tests/services/gatewayEventsService.test.js
git commit -m "feat(bff): OAuth PKCE + SearchIndexTool read path for gateway-events"
```

---

### Task 4: `guardrailLog` router + mount

**Files:**
- Create: `demo_api_server/routes/guardrailLog.js`
- Modify: `demo_api_server/server.js` (mount under `/api/privilege-mcp/guardrail-log`, after the other `privilege-mcp` mounts, with `authenticateToken`)
- Test: `demo_api_server/tests/routes/guardrailLog.test.js`

**Interfaces:**
- Consumes: `gatewayEventsService` (Task 3).
- Produces: `GET /api/privilege-mcp/guardrail-log?category=&size=` → `200 { connected: true, verdicts: [...] }` or `401 { error: 'not_connected', connectUrl }`; `GET /connect` → `302` to the authorize URL; `GET /callback?code=&state=` → `302` back to `/llm-gateway?guardrail=connected`.

- [ ] **Step 1: Write the failing test (service mocked)**

```javascript
const request = require('supertest');
jest.mock('../../services/gatewayEventsService');
const svc = require('../../services/gatewayEventsService');
const app = require('../helpers/testApp')(['guardrailLog']); // existing test-app helper pattern
describe('guardrail-log route', () => {
  it('returns verdicts when connected', async () => {
    svc.searchGuardrailVerdicts.mockResolvedValue({ connected: true, verdicts: [{ category: 'malicious_content' }] });
    const r = await request(app).get('/api/privilege-mcp/guardrail-log?category=malicious_content');
    expect(r.status).toBe(200);
    expect(r.body.verdicts[0].category).toBe('malicious_content');
  });
  it('returns 401 + connectUrl when not connected', async () => {
    svc.NotConnectedError = class extends Error {};
    svc.searchGuardrailVerdicts.mockRejectedValue(new svc.NotConnectedError());
    const r = await request(app).get('/api/privilege-mcp/guardrail-log');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: 'not_connected' });
    expect(r.body.connectUrl).toContain('/api/privilege-mcp/guardrail-log/connect');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/guardrailLog.test.js --forceExit`
Expected: FAIL — route/module missing. (If `helpers/testApp` differs, mirror an existing `tests/routes/*.test.js` bootstrap.)

- [ ] **Step 3: Implement the router + mount**

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const svc = require('../services/gatewayEventsService');
router.get('/', async (req, res) => {
  try {
    const { category, size } = req.query;
    const out = await svc.searchGuardrailVerdicts(req.session, { category, size: size ? Number(size) : undefined });
    res.json(out);
  } catch (e) {
    if (e instanceof svc.NotConnectedError) {
      return res.status(401).json({ error: 'not_connected', connectUrl: '/api/privilege-mcp/guardrail-log/connect' });
    }
    res.status(502).json({ error: 'guardrail_log_unavailable', message: e.message });
  }
});
router.get('/connect', async (req, res) => {
  const { url } = await svc.getAuthorizeUrl(req.session);
  res.redirect(url);
});
router.get('/callback', async (req, res) => {
  await svc.completeAuthorize(req.session, req.query.code);
  res.redirect('/llm-gateway?guardrail=connected');
});
module.exports = router;
```
Mount in `server.js`: `app.use('/api/privilege-mcp/guardrail-log', authenticateToken, require('./routes/guardrailLog'));`

- [ ] **Step 4: Run tests, verify pass**

Run: `cd demo_api_server && CI=true npx jest tests/routes/guardrailLog.test.js --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/guardrailLog.js demo_api_server/server.js demo_api_server/tests/routes/guardrailLog.test.js
git commit -m "feat(bff): /api/privilege-mcp/guardrail-log route"
```

---

### Task 5: `GuardrailLogPanel` UI component

**Files:**
- Create: `demo_api_ui/src/components/GuardrailLogPanel.jsx`, `GuardrailLogPanel.css`
- Test: `demo_api_ui/src/components/__tests__/GuardrailLogPanel.test.jsx`

**Interfaces:**
- Consumes: `apiClient.get('/api/privilege-mcp/guardrail-log', { params })`. On 401 `{ connectUrl }`, render a "🔐 Connect gateway log" link to `connectUrl`. On 200, render the verdict list.
- Produces: `<GuardrailLogPanel defaultCategory="malicious_content" />`.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GuardrailLogPanel from '../GuardrailLogPanel';
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
import apiClient from '../../services/apiClient';
describe('GuardrailLogPanel', () => {
  it('shows a Connect link when the BFF says not connected (401)', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 401, data: { error: 'not_connected', connectUrl: '/api/privilege-mcp/guardrail-log/connect' } } });
    render(<GuardrailLogPanel />);
    fireEvent.click(screen.getByRole('button', { name: /load|refresh/i }));
    const link = await screen.findByRole('link', { name: /connect gateway log/i });
    expect(link).toHaveAttribute('href', '/api/privilege-mcp/guardrail-log/connect');
  });
  it('lists verdicts with category + event when connected', async () => {
    apiClient.get.mockResolvedValue({ data: { connected: true, verdicts: [
      { time: 't', category: 'malicious_content', event: 'llm_request_alert', owasp: ['LLM01'], mitre: [], nist: [] } ] } });
    render(<GuardrailLogPanel />);
    fireEvent.click(screen.getByRole('button', { name: /load|refresh/i }));
    expect(await screen.findByText(/malicious_content/)).toBeInTheDocument();
    expect(screen.getByText(/llm_request_alert/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd demo_api_ui && node_modules/.bin/vitest run src/components/__tests__/GuardrailLogPanel.test.jsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component + CSS**

Build `GuardrailLogPanel.jsx`: state `{ verdicts, connectUrl, busy, err }`; a "Load / Refresh" button → `apiClient.get('/api/privilege-mcp/guardrail-log', { params: { category } })`; on `catch` with `response.status===401` set `connectUrl`; render either a `🔐 Connect gateway log` `<a href={connectUrl}>` or a list of verdict rows (time, `category`, `event` with ✅/⚠️ by `event`, and OWASP/MITRE/NIST chips). Use `.css` classes with `--th-*`/`--font-size-*` tokens only (mirror `InterAgentAbuseTester.css`). Header uses `🛡`.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd demo_api_ui && node_modules/.bin/vitest run src/components/__tests__/GuardrailLogPanel.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/GuardrailLogPanel.jsx demo_api_ui/src/components/GuardrailLogPanel.css demo_api_ui/src/components/__tests__/GuardrailLogPanel.test.jsx
git commit -m "feat(ui): GuardrailLogPanel — shows gateway Alert/Block verdicts from the log"
```

---

### Task 6: Wire the panel into LlmGatewayPage + the Malicious Content follow-through

**Files:**
- Modify: `demo_api_ui/src/pages/LlmGatewayPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx` (add one assertion)

**Interfaces:**
- Consumes: `<GuardrailLogPanel defaultCategory="malicious_content" />`.

- [ ] **Step 1: Write the failing test**

```jsx
// In the existing LlmGatewayPage.test.jsx, add:
it('renders the guardrail log panel', () => {
  render(<LlmGatewayPage />);
  expect(screen.getByText(/guardrail log|gateway guardrail/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd demo_api_ui && node_modules/.bin/vitest run src/pages/__tests__/LlmGatewayPage.test.jsx`
Expected: FAIL — panel text not present.

- [ ] **Step 3: Render the panel**

Import and render `<GuardrailLogPanel defaultCategory="malicious_content" />` in `LlmGatewayPage.jsx`, below the last-decision area. When the Malicious Content attack is the selected/last-fired one and the response was a clean 200 (no gateway block), show a one-line note (allowlist emoji `⚠️`) pointing the SE to the panel: "Model refused; check the guardrail log for the gateway's own verdict." Keep copy out of inline styles.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd demo_api_ui && node_modules/.bin/vitest run src/pages/__tests__/LlmGatewayPage.test.jsx && npm run build`
Expected: PASS + build EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/LlmGatewayPage.jsx demo_api_ui/src/pages/__tests__/LlmGatewayPage.test.jsx
git commit -m "feat(ui): surface the guardrail log on the LLM Gateway page for Malicious Content"
```

---

### Task 7: Live verification + PR

- [ ] **Step 1:** With the stack up and on `local.ping-devops.com:4000`, sign in, open the LLM Gateway page, click Connect gateway log, complete OAuth, and confirm verdicts render. Fire the Malicious Content chat attack; confirm the clean-200 note points to the panel and the panel shows the gateway's verdict for a recent call. Pin `npm run -s stack:generation` before/after.
- [ ] **Step 2:** Full scoped checks: `cd demo_api_server && CI=true npx jest tests/services/gatewayEventsService.test.js tests/routes/guardrailLog.test.js --forceExit`; `cd demo_api_ui && npm run test:unit && npm run build`.
- [ ] **Step 3:** Open the PR (base main), body: what/why, the measured facts, and the honest note that this READS the gateway's existing verdicts (nothing new scores). State ✅ with the result lines.

## Self-Review

- **Spec coverage:** Malicious Content demonstrable → Tasks 5–6 (panel + LlmGatewayPage). Read path (OAuth+MCP) → Tasks 1,3. Data/DSL → Task 2. Route → Task 4. Works-everywhere (interactive OAuth, no client_credentials) → Task 3's PKCE. ✅
- **Placeholder scan:** the only deferred detail is the exact OAuth request shapes, which Task 1 (spike) produces before Tasks 3–4 consume them — a validated capture, not a guess.
- **Type consistency:** `buildAiGuardDsl`/`normalizeVerdict`/`searchGuardrailVerdicts`/`NotConnectedError`/`getAuthorizeUrl`/`completeAuthorize`/`_mcpClientFor` are used identically across Tasks 2–5; route paths and the `{ error, connectUrl }` shape match between Task 4 and Task 5.

## Risks / open questions

- **Interactive OAuth per SE.** There is no client_credentials, so each SE must click Connect once per session. Acceptable for a demo; documented in the panel copy.
- **Transport.** The ingress advertises `/sse`; the container runs streamable-http on :9900. Task 1 determines which SDK transport actually connects through the OAuth-wrapped ingress; Task 3 uses that one.
- **VirtualKeyID scoping.** To show *this demo's* verdict rather than any tenant traffic, Task 3 may pass the demo's `sk-orion-...` key id; if it isn't known client-side, drop the filter and rely on recency + category. Decide during Task 1 from the real data.
