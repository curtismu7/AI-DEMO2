# Inspector Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MCP, Authorize and Agent Gateway inspectors on one shared, simple layout that shows only requests, responses, tokens and API calls, using real traffic everywhere.

**Architecture:** One shared shell (`components/inspector/`) renders a header, a "Send a call" bar, a Calls list and a Call detail with three tabs. Each page owns only two things: its send form and a pure adapter that turns its backend response into the shared `InspectorCall` shape. The three routes and route components keep their names, so nav, tests and redirects keep working. Data comes from what the backends already return (MCP `frames` + `tokenEvents`, Authorize `pingoneRequest`/`pingoneResponse`, the gateway's `X-Gw-Audit-Trail`). The server changes are small: the worker token on Authorize, trail detail in the gateway decision buffer, and deleting one mock route.

**Tech Stack:** React 18 + react-router (demo_api_ui, Vitest + Testing Library), Express (demo_api_server, Jest + supertest). No new dependencies.

**Spec:** the three mockups in `docs/mockups/inspectors/` (`mcp.html`, `authorize.html`, `agent-gateway.html`; open them from disk) plus the Decisions section below. The mockups are the visual spec. Copy, tab names, chip tones and layout come from them.

## Decisions (already made, do not re-open)

- **Same layout on all three pages.** Header (eyebrow, h1, lede, mode chip, source select), a "Send a call" card, then two columns: Calls (left, `minmax(17rem, 22rem)`) and Call detail (right). One column under `60rem`.
- **Call detail = 3 tabs:** "Request & response" (two panes side by side), "Tokens" (one card per token), "API calls" (one expandable row per hop).
- **The mode chip is driven by data**, never hard-coded. Hard-coded strings go: "LIVE", "DEMO SIMULATION", "Environment: 01d89b06", "Worker: demo-bff-mcp-client".
- **Tokens come only from server-decoded `tokenEvents`** (`buildTokenEvent` output: sanitized claims + hidden-claim names). The page never receives or renders a raw token string.
- **The routes stay the same:** `/pingone-mcp-inspector`, `/pingone-authorize`, `/agent-gateway-inspector`. The components keep their filenames and are rewritten in place: `McpInspectorPageClean.jsx`, `PingOneAuthorizeConsoleClean.jsx`, `AgentGatewayInspectorClean.jsx`.
- **No ReactFlow diagram on these pages.** The API calls list is the flow.
- Removed from **MCP**:
  - output tabs Schema, Timing and Headers (Headers was hard-coded)
  - the hard-coded Status "200 OK" and Transport
  - font −/+ controls and the theme toggle
  - the resizable dividers and the history reel
  - the left tool tree. The tool picker moves into the Send bar as a grouped `<select>`.
- Removed from **Authorize**:
  - the six-tab bar. The other tabs become header links and get a back link.
  - the "Available Policies" checklist (uncontrolled, it did nothing)
  - the fake header tabs and status bar
  - output tabs that rendered nothing
  - dead `EvaluatePanel` (~490 lines) and its tests
  - the dark toggle
- Removed from **Gateway**:
  - the mock `POST /api/agent-gateway/invoke` path, including its route and hook
  - the Identify/Authorize/Enforce/Audit education block
  - Tool Chain mode and Diff/Performance tabs
  - the decisions table, which moves into Calls
  - the raw gateway log stays, as a collapsed `<details>` card below.
- **Mock vs v1 gaps** (accepted for v1, list them in the PR body):
  - Authorize "AI agent" decision rows are not shown; the AG-UI decision shape is unverified.
  - The Authorize worker-token "cached/skipped" hop is not shown.
  - The Gateway "Upstream token" card and the gateway's own token-exchange hop are not shown; the audit trail doesn't carry them.
  - Per-hop ms are only shown where measured.
  - Times are shown in local time, not UTC.
- Nav label "P1AZ Inspector" is unchanged. The page h1 becomes "Authorize Inspector".

## Global Constraints

- Use the existing theme tokens from `demo_api_ui/src/index.css` (`--th-bg-page`, `--th-bg-card`, `--th-bg-inset`, `--th-text`, `--th-border`, `--th-border-strong`, `--th-bg-hover`, `--th-bg-emphasis`, `--th-text-on-emphasis`, `--th-status-{success,warning,error}-{bg,border,text}`, `--font-mono`).
- Ping red is `#d20e0f`, the gradient is `linear-gradient(90deg, #d20e0f 55%, #aa0005)`, and dark-mode red text is `#ff5a5b`. Define them as local custom props on `.insp`, the same way `.ijp` does in `IdJagPlaygroundPage.css`.
- Use the class prefix `insp-` throughout. The only new stylesheet is `components/inspector/Inspector.css`.
- Copy is verbatim from the mockups:
  - Section and tabs: `Send a call`, `Send` (busy: `Sending…`), `Calls`, `All`, `Problems`, `Request & response`, `Tokens`, `API calls`.
  - Tokens tab: `Decoded on the server. The raw token strings never reach this page.` and `This call carried no tokens.`
  - Hidden claims: `{n} claims hidden by policy: {comma list}`.
  - Empty states: `No calls yet. Send one above, or use the AI agent.` and `No failed calls. Switch to All to see every call.`
- Hop direction strings are exact, using `→` (U+2192): `Browser → BFF`, `AI agent → BFF`, `BFF → PingOne`, `BFF → MCP server`, `BFF → PingOne Authorize`, `BFF → Gateway`, `AI agent → Gateway`, `Gateway → PingOne`, `Gateway → PingOne Authorize`, `Gateway → MCP server`.
- JSON panes reuse `components/shared/FormJsonToggle.jsx`, `JsonHighlight.jsx` (`deep` + `copyable`) and `JsonFormView.jsx`. Default view is JSON. Don't write a new JSON viewer or copy button.
- Work in this worktree (`.worktrees/inspector-redesign`, branch `docs/inspector-redesign`; rename to `feat/inspector-redesign` before the first code commit). The main checkout is shared with other sessions. Commit after every task.
- UI tests run with `cd demo_api_ui && npx vitest run <path>`. Server tests run with `cd demo_api_server && npx jest <path>`. The server jest network guard blocks sockets; supertest against an in-process app is fine.
- CI: run one CI run at a time (Playwright gets SIGKILLed under load).

## Review Focus

1. **A call with no tokens or frames** (MCP `_localFallback`, the PingOne MCP source, a custom server, or an Authorize call without a cached worker token). Tokens shows `This call carried no tokens.`, API calls still shows the first hop, and nothing throws. Tests: Task 3 (`local fallback`) and Task 2 (`no tokens`).
2. **Error responses.** These are MCP 502 `mcp_invoke_failed` with `frames`, Authorize 502 `pingone_evaluation_failed`, and gateway `ok:false` / 429. The row turns red (or amber for 429), a banner shows the message, and the Response pane shows the error body. Tests: Task 3 (`403 error`), Task 6 (`502`), Task 8 (`rate limited`).
3. **An elicitation is pending mid-call.** The newest MCP row shows `Waiting for you`, and the banner keeps `data-testid="elicitation-card"`, the text `elicitation/create`, and the `Confirm`/`Decline` buttons. Test: the existing `McpInspectorPageClean.elicitation.test.jsx` must still pass unchanged (Task 4).
4. **Large or embedded JSON** (MCP `content[0].text` holding JSON, an 18-tool `tools/list`, long tool names). The JSON view deep-parses, the panes scroll inside `max-height: 26rem`, names wrap at `_`, and the page never scrolls sideways. Test: Task 2 (`long title wraps`) asserts the `<wbr>`; Task 9 checks the browser at 400px.
5. **A gateway trail whose detail field is over 32 KB.** The buffer stores `{ truncated: true, bytes }` for that field and never throws. A non-admin still sees only their own `sub`. Tests: Task 7.

---

### Task 1: Shared call model and token helpers

**Files:**
- Create: `demo_api_ui/src/components/inspector/inspectorCalls.js`
- Test: `demo_api_ui/src/components/inspector/__tests__/inspectorCalls.test.js`

**Interfaces:**
- Produces these JSDoc typedefs, used by every later task:
  - `Chip = { tone: 'ok'|'warn'|'err'|'idle', label: string }`
  - `Payload = { label: string, where?: string, body: any }`
  - `TokenView = { label, role, alg: string|null, status: Chip, claims: object, hidden: string[], header: object|null, diff?: Record<string,string> }`
  - `Hop = { dir, call, what, status: Chip, ms: number|null, request: any, response: any }`
  - `InspectorCall = { id: string, at: number /* ms epoch */, kind, title, src: 'you'|'agent', ms: number|null, status: Chip, chips: Chip[], banner: null | { tone, title, text, testId?, actions?: {label, onClick}[] }, corr: string|null, request: Payload, response: Payload, tokens: TokenView[], hops: Hop[] }`
- Produces these exports:
  - `ok(label)`, `warn(label)`, `err(label)`, `idle(label)`, each returning a `Chip`
  - `diffClaims(before, after) → Record<string,string>`
  - `tokenStatusChip(status) → Chip`
  - `tokensFromEvents(events) → TokenView[]`
  - `isProblem(call) → boolean`

- [ ] **Step 1: Write the failing tests**

```js
import { diffClaims, tokensFromEvents, tokenStatusChip, isProblem } from '../inspectorCalls';

const USER = { id: 'user-token', label: 'User access token', status: 'active', alg: 'RS256',
  claims: { sub: 'u1', aud: ['ai-demo-bff'], scope: 'openid accounts:read read' }, hiddenClaims: ['email'],
  explanation: 'Your sign-in token. It never leaves the BFF.', jwtFullDecode: { header: { alg: 'RS256' } } };
const EXCH = { id: 'exchanged-token', label: 'MCP access token (delegated) → MCP server', status: 'exchanged', alg: 'RS256',
  claims: { sub: 'u1', aud: ['https://api.example/mcp'], scope: 'accounts:read read', act: { sub: 'ai-agent' } }, hiddenClaims: [] };

test('diffClaims marks aud changed, scope narrowed, act added', () => {
  expect(diffClaims(USER.claims, EXCH.claims)).toEqual({ aud: 'changed', scope: 'narrowed', act: 'added' });
});
test('diffClaims ignores equal claims and array order', () => {
  expect(diffClaims({ sub: 'u', aud: ['a', 'b'] }, { sub: 'u', aud: ['b', 'a'] })).toEqual({});
});
test('a scope that gains a value is changed, not narrowed', () => {
  expect(diffClaims({ scope: 'read' }, { scope: 'read write' })).toEqual({ scope: 'changed' });
});
test('tokenStatusChip maps server statuses', () => {
  expect(tokenStatusChip('active')).toEqual({ tone: 'ok', label: 'Valid' });
  expect(tokenStatusChip('exchanged')).toEqual({ tone: 'ok', label: 'Exchanged' });
  expect(tokenStatusChip('warning')).toEqual({ tone: 'warn', label: 'Warning' });
  expect(tokenStatusChip('failed')).toEqual({ tone: 'err', label: 'Failed' });
  expect(tokenStatusChip('waiting')).toEqual({ tone: 'idle', label: 'waiting' });
});
test('tokensFromEvents keeps events with claims and diffs the exchanged token', () => {
  const t = tokensFromEvents([{ id: 'rar-authorization', status: 'active', claims: null }, USER, EXCH]);
  expect(t.map((x) => x.label)).toEqual(['User access token', 'MCP access token (delegated) → MCP server']);
  expect(t[0]).toMatchObject({ role: 'Your sign-in token', alg: 'RS256', hidden: ['email'], header: { alg: 'RS256' } });
  expect(t[0].diff).toBeUndefined();
  expect(t[1].diff).toEqual({ aud: 'changed', scope: 'narrowed', act: 'added' });
});
test('tokensFromEvents tolerates missing or empty input', () => {
  expect(tokensFromEvents(undefined)).toEqual([]);
  expect(tokensFromEvents([{ id: 'x', claims: {} }])).toEqual([]);
});
test('isProblem is true for anything not ok', () => {
  expect(isProblem({ status: { tone: 'ok' } })).toBe(false);
  expect(isProblem({ status: { tone: 'warn' } })).toBe(true);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/inspectorCalls.test.js`
Expected: FAIL, because `../inspectorCalls` doesn't exist yet.

- [ ] **Step 3: Implement `inspectorCalls.js`**

- `role` is the explanation text before its first `'. '`.
- `header` is `jwtFullDecode?.header ?? null`.
- The diff is applied only to the `exchanged-token` event, against the `user-token` event, when both are present.
- Scope compare: split on whitespace. `narrowed` when the after-set is a proper subset of the before-set; otherwise `changed` when the sets differ.
- Array compare ignores order.
- A key present only in `after` is `added`. A key present only in `before` is `removed`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same command. Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/inspector/
git commit -m "feat(inspector): shared call model + token helpers"
```

---

### Task 2: Shared layout, call detail and styles

**Files:**
- Create: `demo_api_ui/src/components/inspector/InspectorLayout.jsx` (header, send card, calls list, filter, footer slot)
- Create: `demo_api_ui/src/components/inspector/CallDetail.jsx` (detail header chips, banner, tabs, panes, token cards, hop rows)
- Create: `demo_api_ui/src/components/inspector/Inspector.css`
- Test: `demo_api_ui/src/components/inspector/__tests__/InspectorLayout.test.jsx`

**Interfaces:**
- Consumes: `InspectorCall`, `isProblem` (Task 1).
- Produces `export default function InspectorLayout(props)`. Its props:
  - text: `eyebrow, title, lede`
  - `related?: { label: string, to: string }[]` and `relatedPrefix?: string`. The links render as router `<Link>`s after the prefix, joined with ` · `. Authorize passes `Also in PingOne Authorize: ` as the prefix.
  - `mode: Chip`
  - `source: { label, value, options: {value,label}[], onChange(value), disabled? }`
  - `send: ReactNode | null`. When `null`, the send card is not rendered.
  - `calls: InspectorCall[]`, `callsNote: string`, `selectedId: string|null`, `onSelect(id)`
  - `footer?: ReactNode`
- Produces `export default function CallDetail({ call })`. Tab state lives inside the component and persists across selection.

- [ ] **Step 1: Write the failing tests.** Build two fixture calls in the test file:
  - `c1`: ok `200 OK`, title `get_my_accounts`, 1 token with `diff: { scope: 'narrowed' }`, 2 hops (`Browser → BFF`, `BFF → PingOne`).
  - `c2`: err `403`, title `get_sensitive_account_details`, `banner: { tone: 'err', title: 'Refused', text: 't', testId: 'elicitation-card', actions: [{ label: 'Confirm', onClick: vi.fn() }] }`, no tokens, 1 hop.

  The tests:
  - `renders header, mode chip and call count`: heading `MCP Inspector`, text `Live`, and the Calls heading contains `2`.
  - `selecting a row calls onSelect`: click the button whose name contains `get_sensitive` → `onSelect('c2')`.
  - `Problems filter hides ok calls`: click `Problems` → `get_my_accounts` is gone from the list.
  - `Tokens tab shows the server-decoded note and diff chip`: the note text plus `narrowed`.
  - `no tokens`: rerender with `selectedId='c2'` on the Tokens tab → `This call carried no tokens.`
  - `API calls tab lists hops with a count`: the tab name matches `/API calls\s*2/`, and `BFF → PingOne` is visible.
  - `banner keeps its test id and runs actions`: `getByTestId('elicitation-card')`, then clicking `Confirm` calls the mock.
  - `empty calls`: `calls=[]` → `No calls yet. Send one above, or use the AI agent.`
  - `long title wraps`: the row title for `get_sensitive_account_details` contains `<wbr>`. Check with `container.querySelector('.insp-call-title').innerHTML`.
  - `related links route`: `related=[{label:'Bulk decisions', to:'/pingone-authorize?tab=bulk'}]` → link `href` equals that path.

  Wrap renders in `<MemoryRouter>`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/InspectorLayout.test.jsx`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement the layout, the detail and the CSS to the mockup.**
  - Calls rows are buttons with `aria-current` on the selected row.
  - Tabs use `role="tablist"`/`tab`/`tabpanel` with `aria-selected`.
  - Each pane is `FormJsonToggle` (`defaultView="json"`, `jsonView={<JsonHighlight value={body} deep copyable />}`) with `<JsonFormView value={body} />` as its child. Read `FormJsonToggle.jsx` for the exact prop contract before wiring.
  - Token cards show claims in the order `sub, aud, scope, act, client_id, iat, exp`, when present. `iat`/`exp` also show the local time. A diff chip uses the warn tone. A `<details>` labeled `All claims (JSON)` holds the full claims.
  - Hops are an `<ol>` of `<details>`. The last hop whose tone isn't `idle` is open by default.
  - Titles insert `<wbr>` after each `_`: split on `_` and join with `_` plus `<wbr />` in JSX. No `dangerouslySetInnerHTML`.
  - Times use `toLocaleTimeString()`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same command. Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/inspector/
git commit -m "feat(inspector): shared layout, call detail, styles"
```

---

### Task 3: Capture full MCP call detail, and the MCP adapters

**Files:**
- Modify: `demo_api_ui/src/services/mcpCallStore.js:33` (new 6th param)
- Modify: `demo_api_ui/src/hooks/useInspectorSource.js:343,354` (pass detail)
- Modify: `demo_api_ui/src/services/demoAgentService.js:677` (pass detail, after the token events are merged)
- Create: `demo_api_ui/src/components/inspector/mcpCalls.js`
- Test: `demo_api_ui/src/components/inspector/__tests__/mcpCalls.test.js`, and `demo_api_ui/src/services/__tests__/mcpCallStore.test.js` (add a case; create the file if it doesn't exist)

**Interfaces:**
- Produces `appendMcpCall(tool, status, duration, result, errorMsg = null, detail = null)`.
  - Shape: `detail = { src: 'you'|'agent', params?: object, frames?: object, tokenEvents?: object[], response?: object }`.
  - It is stored as `entry.detail`. Existing callers are unchanged.
- Produces `mcpCallFromStore(entry) → InspectorCall` and `apiCallFromTracker(call) → InspectorCall`.
- Consumes `ok/err/warn/idle`, `tokensFromEvents` (Task 1).
- `frames` keys from the server (`mcpWebSocketClient.js:393-608`) are `initializeRequest`, `initializeResponse`, `initializedNotification`, `request`, `response`, `notifications[]`.

- [ ] **Step 1: Write the failing tests**
  - Store: `appendMcpCall('t', 200, 5, {}, null, { src: 'you' })` → `getCalls()[0].detail` equals `{ src: 'you' }`.
  - `mcpCallFromStore` cases:
    - **Inspector success** (`detail.src='you'`, with `frames.initializeRequest/Response`, `frames.request/response`, and `tokenEvents=[USER, EXCH]` from Task 1's fixture):
      - `kind 'tools/call'`, `request.label 'JSON-RPC request'`, `response.label 'JSON-RPC response'`
      - `status {tone:'ok',label:'200 OK'}`, `tokens.length 2`
      - `hops.map(h=>h.dir)` equals `['Browser → BFF','BFF → PingOne','BFF → MCP server','BFF → MCP server']`
      - `hops[0].call 'POST /api/mcp/inspector/invoke'`
      - the exchange hop request is `{ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: ['https://api.example/mcp'], scope: 'accounts:read read' }`
      - the exchange hop `ms` is `null`.
    - **Agent entry without detail:** `src 'agent'`, `request.label 'Tool arguments'`, `hops.length 1`, `hops[0].dir 'AI agent → BFF'`, `hops[0].call 'POST /api/mcp/tool'`, `tokens []`.
    - **403 error** (`status 403`, `errorMsg 'insufficient_scope'`): `status.tone 'err'`, `status.label '403'`, and `banner.text` contains `insufficient_scope`.
    - **Local fallback** (`detail.response._localFallback === true`): `chips` contains `{tone:'idle',label:'Local handler, no MCP server'}`.
  - `apiCallFromTracker`, from `{ id:'a1', timestamp:'2026-10-17T10:00:00Z', method:'GET', url:'/api/accounts', request:{body:null}, response:{status:200, body:{ok:true}}, duration:12 }`:
    - `title 'GET /api/accounts'`, `status.label '200'`, `ms 12`, `tokens []`
    - `hops.length 1`, `hops[0].dir 'Browser → BFF'`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/mcpCalls.test.js src/services/__tests__/mcpCallStore.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `useInspectorSource.handleExecute`:
    - success: pass `{ src: 'you', params: <the args sent>, frames: data.frames, tokenEvents: data.tokenEvents, response: data }`
    - error: pass the same keys read from `e.response?.data`.
  - `demoAgentService`: move the `appendMcpCall` at :677 below the `allTokenEvents` merge and pass `{ src: 'agent', params: <tool args>, tokenEvents: allTokenEvents }`.
  - Adapter `id` is `` `mcp-${entry.id}` `` and `at` is `Date.parse(entry.timestamp)`.
  - When there is no `frames.request`, `request` is `{ label: 'Tool arguments', body: params ?? {} }` and `response` is `{ label: 'Result', body: result ?? { error: errorMsg } }`.

- [ ] **Step 4: Run the tests and confirm they pass.** Also run `npx vitest run src/hooks/__tests__/useInspectorSource.test.js` and expect PASS.

- [ ] **Step 5: Commit** with the message `feat(inspector): capture MCP frames/tokens per call + MCP adapters`.

---

### Task 4: Rebuild the MCP Inspector on the shared layout

**Files:**
- Modify (rewrite): `demo_api_ui/src/components/McpInspectorPageClean.jsx`
- Modify: `demo_api_ui/src/hooks/useInspectorSource.js`. Remove `outputTab`, `setOutputTab`, `outputValue`, `outputContent` (lines ~412-451) and add `toolsSource` (the tools response `_source`).
- Delete: the `McpInspectorPage.clean.css` import from this page. Delete the file only if `grep -rn "McpInspectorPage.clean.css" demo_api_ui/src` finds no other importer after Task 6.
- Test (update): `src/components/__tests__/mcpInspectorCleanGrouping.test.jsx`, `McpInspectorPageClean.elicitation.test.jsx` (must pass **unchanged**), `McpInspectorPageClean.addServer.test.jsx` (must pass **unchanged**), `src/hooks/__tests__/useInspectorSource.test.js`
- Test (create): `src/components/__tests__/McpInspectorPageClean.calls.test.jsx`

**Interfaces:**
- Consumes `InspectorLayout` (Task 2), `mcpCallFromStore`, `apiCallFromTracker` (Task 3), and `useInspectorSource(sourceKey)`.
- `useInspectorSource(sourceKey)` keeps `tools, selectedTool, paramValues, schemaProps, requiredParams, busy, banner, servers, profiles, selectedProfileId, mode, config, mcpHistory, pendingElicitation, answerElicitation(action, content), handleExecute, loadProfiles, setSelectedTool, setParamValues, setSelectedProfileId` and gains `toolsSource`.

Page wiring:
- **Header:**
  - eyebrow `PingOne MCP · Inspector`, h1 `MCP Inspector`, lede copied from `mcp.html`.
  - Source select, labeled `Server`, uses the existing SOURCES keys in this order: `banking` `AI Demo MCP`, `pingone` `PingOne MCP`, `gateway` `Gateway showcase`, `custom` `Custom server`, `protocol` `Raw JSON-RPC`, `api` `All API calls`.
  - Changing the source updates `?source=` with `setSearchParams`. The initial value still comes from `?source=`.
- **Mode chip:**
  - `banner` set → `err('Unavailable')`
  - `toolsSource === 'local_catalog'` → `warn('Local fallback')`
  - otherwise `ok('Live')`
- **Send bar (hidden for `api`):**
  - Tool `<select>` with one `<optgroup label={server}>` per `config.groupBy` group. For `protocol` it is a method select.
  - One input per schema prop, labeled `key *` when the param is required.
  - Button `Send` (`Sending…` while busy) → `handleExecute`.
  - For `custom`, keep the profile select and the full "+ Add server" form with its current copy and placeholders.
- **Calls:**
  - `api` source: `/api/api-calls?limit=100` items mapped with `apiCallFromTracker`.
  - All other sources: `mcpHistory.map(mcpCallFromStore)`.
  - Select the newest call after each Send.
  - `callsNote` is `Includes calls the AI agent made in this browser tab.`
- **Elicitation:** when `pendingElicitation` is set, prepend a call with:
  - `status warn('Waiting for you')`
  - `banner { tone:'warn', testId:'elicitation-card', title:'The MCP server is asking you to confirm (elicitation/create)', text: pendingElicitation.message, actions: Confirm → answerElicitation('accept', { confirm: true }), Decline → answerElicitation('decline') }`
  - Select it.

- [ ] **Step 1: Write and update the failing tests.**
  - New `calls` test: seed `mcpCallStore` with one agent entry for `get_my_accounts`, render the page (mock `useInspectorSource` the same way the elicitation test does), and assert the row text `AI agent`.
  - Grouping test: replace the divider and `--inspector-col-*` assertions with `getByRole('group', { name: 'Weather MCP' })` (the optgroup) and `getByRole('option', { name: 'Gateway showcase' })`.
  - Hook test: drop the `outputValue`/`outputTab` assertions and add `toolsSource` equal to `'mcp_server'` from a mocked tools response.

- [ ] **Step 2: Run and confirm the new and updated tests fail**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/McpInspectorPageClean src/components/__tests__/mcpInspectorCleanGrouping.test.jsx src/hooks/__tests__/useInspectorSource.test.js`

- [ ] **Step 3: Rewrite the page as described above.** Remove `useDividerDrag` and its localStorage keys (`mcp-inspector-col-left/right`).

- [ ] **Step 4: Run the same command and confirm everything passes,** including the unchanged elicitation and addServer tests. Then run the route tests that reference this page: `npx vitest run src/components/__tests__/PageGuide.test.jsx src/__tests__/App.structure.test.js`.

- [ ] **Step 5: Commit** with the message `feat(mcp-inspector): rebuild on shared inspector layout`.

---

### Task 5: Authorize evaluate-endpoint returns the worker token and rule facts

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` (add `peekWorkerToken`, export it)
- Modify: `demo_api_server/routes/authorize.js:767-806` (`/evaluate-endpoint` response)
- Test: `demo_api_server/tests/routes/authorizeEvaluateEndpointInspector.test.js`

**Interfaces:**
- Produces `peekWorkerToken() → string|null`. It returns `_workerTokenCache.token` when the credKey matches and the token hasn't expired. It never makes a network call.
- The `/evaluate-endpoint` 200 body gains `policyEvalMs`, `ruleName`, `ruleCode` (from `result`, `null` when absent) and `tokenEvents`.
  - `tokenEvents` is `[buildTokenEvent('worker-token', 'Worker token (client credentials)', 'active', decodeJwtClaims(token), 'The BFF used this token to call PingOne Authorize.')]` when `peekWorkerToken()` returns a token, else `[]`.
  - `buildTokenEvent` and `decodeJwtClaims` are imported from `services/agentMcpTokenService`. `decodeJwtClaims` returns `{ header, claims }`.

- [ ] **Step 1: Write the failing test.** Mock `../../services/pingOneAuthorizeService` so that:
  - `evaluateDecisionEndpoint` resolves `{ decision:'DENY', policyEvalMs:41, ruleName:'Step-up above $10,000', ruleCode:'step-up', raw:{}, _debug:{ request:{method:'POST',url:'u',body:{parameters:{Amount:12500}}}, response:{decision:'DENY'} } }`
  - `peekWorkerToken` returns a JWT you build in the test from header `{alg:'RS256'}` and payload `{client_id:'demo-bff-mcp-client', aud:['https://api.pingone.com']}`, using an unsigned base64url join.

  Mount the router with a stub `authenticateToken`. Copy the setup from `tests/routes/agentGatewayDecisionsAccess.test.js`. Assertions:
  - `body.policyEvalMs === 41` and `body.ruleName === 'Step-up above $10,000'`
  - `body.tokenEvents[0].id === 'worker-token'` and `body.tokenEvents[0].claims.aud` is `['https://api.pingone.com']`
  - **`JSON.stringify(body)` does not contain the raw token string** (security)
  - when `peekWorkerToken` returns `null`, `body.tokenEvents` is `[]`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd demo_api_server && npx jest tests/routes/authorizeEvaluateEndpointInspector.test.js`
Expected: FAIL (`peekWorkerToken is not a function` or missing fields).

- [ ] **Step 3: Implement both changes.**

- [ ] **Step 4: Run the test and confirm it passes.** Then run `npx jest tests/routes/authorize src/__tests__/authorize` and expect no new failures compared with `main`.

- [ ] **Step 5: Commit** with the message `feat(authorize): evaluate-endpoint returns worker token event + rule facts`.

---

### Task 6: Rebuild the Authorize Inspector, and scale back the page

**Files:**
- Create: `demo_api_ui/src/components/inspector/authorizeCalls.js`
- Modify: `demo_api_ui/src/hooks/usePingOneAuthorizeConsole.js:161` (richer `onEvaluated`, also called on error)
- Modify (rewrite): `demo_api_ui/src/components/PingOneAuthorizeConsoleClean.jsx`
- Delete: `demo_api_ui/src/components/PingOneAuthorizeConsoleClean.css`
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx`:
  - drop the tab bar (L1014-1019) and the dark toggle
  - delete `EvaluatePanel` (L302 to ~790) and its helpers, which are only used by it (`TAB_HELP`, `DecisionRow`, `PolicyNode`, `authorizeRequestPayload`, `authorizeResponsePayload`). Check `PacEditorLaunch` with grep; delete it if it has no other importer.
  - delete `PingOneAuthorizePage.css` (`p1az-evaluate-shell` only)
- Test: `demo_api_ui/src/components/inspector/__tests__/authorizeCalls.test.js`; update `src/components/__tests__/PingOneAuthorizePage.test.jsx`

**Interfaces:**
- `onEvaluated` payload becomes:
  - on success: `{ preset, decision, engine, stepUpRequired, decisionId, result: res.data, parameters, elapsedMs }`
  - on error: `{ preset, error: message, parameters, elapsedMs }`
- Produces `authorizeCallFromResult({ result, error, parameters, preset, elapsedMs, at }) → InspectorCall`. It consumes Task 1 helpers and the Task 5 response fields.

Mapping rules:
- **Status:**
  - `error` → `err('Error')`
  - `DENY` → `err('DENY')`
  - `PERMIT` with `consentRequired || hitlRequired` → `warn('PERMIT · needs approval')`
  - `PERMIT` → `ok('PERMIT')`
- **Chips:** `idle('Rule: ' + ruleName)` when present; `idle('Policy eval ' + policyEvalMs + ' ms')` when present.
- **Banner:**
  - `DENY` with `stepUpRequired`: `{ tone:'err', title:'Denied until the user steps up', text:'PingOne Authorize wants a stronger sign-in. Statement: ' + statements[0].name }`
  - other `DENY`: `{ tone:'err', title:'Denied by PingOne Authorize', text: statement names joined with ', ' or 'No statements returned.' }`
  - `PERMIT` needing approval: `{ tone:'warn', title:'Permitted, with a condition', text:"The app must get the user's approval before the tool runs." }`
  - error: `{ tone:'err', title:'PingOne Authorize call failed', text: error }`
- **Request / response:**
  - `request` is `{ label:'Decision request', where:'POST ' + pingoneRequest.url, body: pingoneRequest.body }`
  - `response` is `{ label:'PingOne Authorize response', where:'PingOne Authorize → BFF', body: pingoneResponse }`
- **Tokens:** `tokensFromEvents(result.tokenEvents)`.
- **Hops:**
  - `Browser → BFF` / `POST /api/authorize/evaluate-endpoint`, with `ms: elapsedMs`
  - `BFF → PingOne Authorize` / `POST /decisionEndpoints/{id}`, with `ms: null`
- **Title:**
  - Transaction preset: `` `${parameters.TransactionType} $${Number(parameters.Amount).toLocaleString('en-US')}` ``
  - MCP preset: `parameters.ToolName`
  - otherwise `Custom decision`
- **Kind:** `` `Decision · ${preset}` ``.

Page wiring:
- **Header:** eyebrow `PingOne Authorize · Inspector`, h1 `Authorize Inspector`, lede from `authorize.html`.
- **Mode chip:** `ok('Live')` when the `/api/authorize/pingone-live-policy` response has `simulatedMode` false; otherwise `warn('Simulated')`.
- **Source:** labeled `Endpoint`. Options are the endpoints from that response; picking one drives `endpointId`.
- **Related links:** `Bulk decisions`→`?tab=bulk`, `Guided scenarios`→`?tab=guided`, `Mock rules`→`?tab=mockRules`, `Scopes`→`?tab=scopes`, `Snapshot import`→`?tab=snapshot`, with `relatedPrefix 'Also in PingOne Authorize: '`.
- **Non-console tabs:** render a `← Back to Authorize Inspector` link to `/pingone-authorize` above their existing content.
- **Send:** preset segmented control `Transaction | MCP tool | Custom`, then that preset's existing fields from the hook, then `Send` → `run()`.
- **Calls:** page state, prepending `authorizeCallFromResult(payload)` on every `onEvaluated`. `callsNote` is `Decisions you sent from this page.`
- **Signed-out and loading:** keep the existing `SignInPrompt` and spinner branches.

- [ ] **Step 1: Write the failing tests.**
  - Adapter cases: PERMIT, DENY + stepUp (the banner title and text contain the statement name), PERMIT + `hitlRequired` (warn), 502 error, and Transaction title `TRANSFER $12,500`.
  - Page test: replace the `Available Policies` assertion with heading `Authorize Inspector` and a `Transaction` button. Delete the `EvaluatePanel` / `filterPolicyTree` / `policyNodeMatches` tests (L5, L102-165) together with the code they test. Keep the `?tab=` render tests and add `Back to Authorize Inspector` for `?tab=bulk`.

- [ ] **Step 2: Run and confirm the tests fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/authorizeCalls.test.js src/components/__tests__/PingOneAuthorizePage.test.jsx`

- [ ] **Step 3: Implement** the adapter, the hook payload, the console rewrite and the page scale-back.

- [ ] **Step 4: Run the same command and confirm it passes.** Then run `npx vitest run src/__tests__/signInInterruptVsPrompt.test.js src/pages/__tests__/ControlPlanePage.test.jsx src/__tests__/App.structure.test.js` and expect PASS.

- [ ] **Step 5: Commit** with the message `feat(authorize-inspector): shared layout, real request/response/token, drop dead EvaluatePanel`.

---

### Task 7: Gateway decision buffer keeps trail detail, with a size cap

**Files:**
- Modify: `demo_api_server/services/agentGatewayDecisions.js:28-66`
- Test: `demo_api_server/tests/routes/gatewayDecisionIngest.test.js` (add cases)

**Interfaces:**
- Each entry gains these fields: `parameters`, `rawResponse` (from `trail.authorize`), `filterChain`, `mcpAudit` (from `trail`), and `introspectionActive: trail.introspection?.active ?? null`.
- Each detail field is kept as-is when `JSON.stringify(value).length <= DETAIL_MAX` (`32 * 1024`). Otherwise it is stored as `{ truncated: true, bytes: <length> }`. Missing fields are stored as `null`.
- `recent()` and the non-admin `sub` filter are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `record({ authorize:{ decision:'DENY', parameters:{ToolName:'t'}, rawResponse:{decision:'DENY'} }, filterChain:[{filter:'P1AZDecision',result:'blocked'}] })` → `recent(1)[0]` has `parameters.ToolName === 't'`, `rawResponse.decision === 'DENY'` and `filterChain.length === 1`.
  - `rawResponse: { blob: 'x'.repeat(40000) }` → `recent(1)[0].rawResponse` matches `{ truncated: true }`, `bytes` is greater than 32768, and nothing throws.
  - The existing access test `agentGatewayDecisionsAccess.test.js` still passes unchanged.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_server && npx jest tests/routes/gatewayDecisionIngest.test.js tests/routes/agentGatewayDecisionsAccess.test.js`

- [ ] **Step 3: Implement** (`const DETAIL_MAX = 32 * 1024;` and one `capped(value)` helper).

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit** with the message `feat(gateway): keep P1AZ parameters/response + filter chain per recorded decision`.

---

### Task 8: Rebuild the Agent Gateway Inspector on real traffic

**Files:**
- Create: `demo_api_ui/src/components/inspector/gatewayCalls.js`
- Modify (rewrite): `demo_api_ui/src/components/AgentGatewayInspectorClean.jsx`
- Modify: `demo_api_ui/src/components/AgentGatewayLogPanel.jsx`:
  - remove the "Recent decisions" table, `CapabilityCallout` and `decisionBadgeClass`
  - wrap the remaining log controls and `<pre>` in `<details className="insp-card insp-log">` with summary `Gateway log` · `Last {n} lines. Tokens are redacted.`
  - keep the filter placeholder and the stale-response guard
- Delete:
  - `demo_api_ui/src/components/AgentGatewayInspectorClean.css`
  - `demo_api_ui/src/hooks/useAgentGatewayInspector.js`
  - `demo_api_server/routes/agentGatewayInspector.js` and its mount at `demo_api_server/server.js:1565`
  - First run `grep -rn "agent-gateway/invoke\|agent-gateway/capabilities\|useAgentGatewayInspector\|agentGatewayInspector" demo_api_ui/src demo_api_server --include=*.js --include=*.jsx`. It must show only these files and their tests.
- Delete test: `src/components/__tests__/AgentGatewayLogPanel.badge.test.js` (its function is removed; the tone mapping is covered by the adapter tests)
- Test: `demo_api_ui/src/components/inspector/__tests__/gatewayCalls.test.js`; rewrite `src/components/__tests__/AgentGatewayInspectorClean.test.jsx`; keep `AgentGatewayLogPanel.staleResponse.test.jsx` passing.

**Interfaces:**
- Produces `gatewayCallFromTest(res, { tool, args, gatewayUrl, at }) → InspectorCall`, where `res` is the `POST /api/mcp-gateway/test` body (`{ ok, durationMs, result, gwAuditTrail, tokenEvents }` or `{ ok:false, error, httpStatus, gatewayErrorCode, message, retryAfterMs, rateLimited }`).
- Produces `gatewayCallFromRecord(rec) → InspectorCall` for Task 7 entries.
- Produces `dedupeGatewayCalls(testCalls, recordCalls) → InspectorCall[]`. It drops a record call when a test call has the same `title` and decision and is within 5000 ms of it. Mark it with `// ponytail: heuristic dedupe; switch to correlationId once the ingest records it`.
- Status mapping:
  - `rateLimited` → `warn('429 Rate limited')`
  - `DENY` → `err('DENY')`
  - PERMIT where `isPause(...)` from `services/tokenChainTrace/pauseObligation` is true → `warn('PAUSE · approval')`
  - `PERMIT` → `ok('PERMIT')`
  - other `ok:false` → `err(String(httpStatus || 'Error'))`
  - Chip `idle('Stopped at: ' + denyingFilter)` when set.
- Tokens:
  - from tests: `tokensFromEvents(res.tokenEvents)` plus a card `{ label:'Token as the gateway saw it', role:'Introspected by the gateway (RFC 7662)', alg:null, status: introspection.active ? ok('Active') : err('Inactive'), claims: introspection without email, hidden: email ? ['email'] : [], header:null }`
  - from records: only that introspection card, built from `{ sub, aud, scope, iss, client_id: clientId, act: actor ? { sub: actor } : undefined }`.
- Hops, in order:
  1. `BFF → Gateway` (tests) or `AI agent → Gateway` (records) / `POST /mcp tools/call`
  2. `Gateway → PingOne` / `Token introspection`, with status from the `filterChain` `TokenIntrospection` result (`passed`→ok, `blocked`→err, `skipped`→`idle('not called')`)
  3. `Gateway → PingOne Authorize` / `POST ` + `authorize.url`, with request `{ parameters }`, response `rawResponse`, and status chip = the decision
  4. `Gateway → MCP server` / `` `tools/call ${tool}` ``: `ok('forwarded')` when not stopped, else `idle('not called')` with `what: 'Stopped at ' + denyingFilter`.
  - A 429 has only hop 1 plus hop 2 as `idle('not called')` with `what 'Rate limit hit before any checks ran'`.

Page wiring:
- **Header:** eyebrow `PingOne Agent Gateway · Inspector`, h1 `Agent Gateway Inspector`, lede from `agent-gateway.html`.
- **Source:** labeled `Gateway`, `disabled`, with one option from `GET /api/mcp-gateway/active`'s `name`.
- **Mode chip:** `active.simulated` → `warn('Simulated authz')`, else `ok('Live')`.
- **Send:** tool `<select>` from `GET /api/mcp/inspector/tools`, `Arguments (JSON)` input (`Invalid JSON` inline error, Send disabled), `Send` → `POST /api/mcp-gateway/test { tool, args }`. Then prepend the result and refetch records.
- **Calls:** `dedupeGatewayCalls(testCalls, records.map(gatewayCallFromRecord))`, where records come from `GET /api/admin/agent-gateway/decisions?limit=50`. Fetch on mount, after each Send, and every 5 s while `document.visibilityState === 'visible'`; clear the interval on unmount. `callsNote` is `Includes every call the gateway reported, from you and from agents.`
- **Route:** `McpGatewayConfigRoute` in `routes/PublicRoutes.js` stays as-is, so the `App.structure.test.js` assertions (LogPanel inside `mgc-root`) keep passing unchanged.

- [ ] **Step 1: Write the failing tests.**
  - Adapter cases:
    - PERMIT test call: 4 hops, hop 4 `forwarded`; tokens include `Token as the gateway saw it`, and its claims have no `email`.
    - DENY record: status `DENY`, hop 4 `not called`, chip `Stopped at: P1AZDecision`.
    - PAUSE via obligation.
    - 429: 2 hops, the second `not called`.
    - dedupe: drops the record within 5 s and keeps it at 6 s.
  - Page test: mock `bffAxios`:
    - `/api/mcp-gateway/active` → `{ name:'PingOne Agent Gateway', simulated:false, url:'https://gw/mcp' }`
    - decisions → one DENY record
    - tools → `[{name:'get_my_accounts'}]`

    Assert:
    - the row `DENY`
    - mode `Live`
    - Tokens tab → `Token as the gateway saw it`
    - API calls tab → `Gateway → PingOne Authorize` and `not called`
    - no request to `/api/agent-gateway/invoke` (assert on the mock's calls).

- [ ] **Step 2: Run and confirm the tests fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/gatewayCalls.test.js src/components/__tests__/AgentGatewayInspectorClean.test.jsx src/components/__tests__/AgentGatewayLogPanel.staleResponse.test.jsx`

- [ ] **Step 3: Implement** the adapter, the page rewrite, the LogPanel trim and the deletions.

- [ ] **Step 4: Run the same command and confirm it passes.** Then run `npx vitest run src/__tests__/App.structure.test.js src/components/__tests__/AgentGatewayTester.test.jsx`, plus `cd ../demo_api_server && npx jest tests/routes/gatewayDecisionIngest.test.js`, and expect PASS.

- [ ] **Step 5: Commit** with the message `feat(gateway-inspector): real gateway traffic on shared layout; remove mock invoke route`.

---

### Task 9: Copy sweep, full suites, live check

**Files:**
- Modify only what the grep finds, in:
  - `demo_api_ui/src/config/pageGuides.js`, `pageGuidesMore.js`, `demoStepGuides.js`, `demoUseCaseSteps.js`
  - `demo_api_ui/src/learning/lessonCatalog.js`
  - `demo_api_ui/src/components/AIAgent.js` (`:10976`, `:11594` link into the dead `?subtab=tester`)
  - `demo_api_ui/src/utils/buildTraceSteps.js:608`

- [ ] **Step 1: Find stale copy.** Run:

  ```bash
  grep -rnE "Execute Call|Execute Policies|Execute Tool|Available Policies|Live / Simulated Console|Tool Invocation|Gateway & Filters|DEMO SIMULATION|Recent decisions|subtab=tester|History reel|Output tab" demo_api_ui/src --include=*.js --include=*.jsx --include=*.ts --include=*.tsx | grep -v __tests__
  ```

  Rewrite each hit to the new labels (`Send`, `Calls`, `Request & response`, `Tokens`, `API calls`). Point `?subtab=tester` links at `/agent-gateway-inspector`.

- [ ] **Step 2: Learning Hub sync.** The diagram/demo/Learning Hub trio is kept in sync. Open each Hub card and lesson that links to the three routes (the grep in Step 1 plus `grep -rn "pingone-mcp-inspector\|/pingone-authorize\b\|agent-gateway-inspector" demo_api_ui/src/config demo_api_ui/src/learning`). Confirm their descriptions match the new pages, and fix the text where they don't.

- [ ] **Step 3: Full suites.**
  - Run `cd demo_api_ui && npm test` and `cd demo_api_server && npm test`.
  - Expect no failures beyond the ones already on `main`. Record the before/after failure lists in the PR body.

- [ ] **Step 4: Live check** in the local stack (OrbStack; follow the repo's run instructions; skip the Welcome wizard first in a fresh browser). Signed in as the demo admin:
  1. On each page, send one call. The new row appears and is selected.
  2. On each page, open all three tabs. Tokens show claims and no `eyJ` string appears anywhere in the DOM (`document.body.innerText.includes('eyJ')` is false).
  3. Ask the AI agent "what accounts do I have?". The MCP page shows an `AI agent` row, and the gateway page shows the gateway's record.
  4. At a 400px viewport, the page doesn't scroll sideways.
  5. Screenshot each page in light and dark mode for the PR.

- [ ] **Step 5: Commit, push, open the PR.** The PR body lists the "Mock vs v1 gaps" from Decisions and the test before/after. Hand the user the exact `gh pr merge` command; don't run it.
