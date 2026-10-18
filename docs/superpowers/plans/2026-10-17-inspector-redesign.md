# Inspector Redesign Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MCP, Authorize and Agent Gateway inspectors on one shared layout. Each call gets five tabs: What happened, Request & response, Tokens, API calls and Diagram. Each page also keeps its tools, all on real traffic.

**Architecture:**
- **Shared shell.** `components/inspector/` renders the header, the "Send a call" bar, the Calls list and the Call detail.
- **Per page.** Each page owns only its send form and a pure adapter that turns its backend responses into the shared `InspectorCall` shape. That shape includes the call's steps, tokens, hops, audit record and logs.
- **Diagram tab.** It is the existing `EmbeddedFlowDiagram` (ReactFlow, with draggable boxes, Simulate, Reset and step time), fed by `diagramConfigFromCall(call)`.
- **Routes.** The routes and route components keep their names.
- **Data sources.** Data comes from what the backends already return: MCP `frames` + `tokenEvents`, Authorize `pingoneRequest`/`pingoneResponse`, and the gateway `X-Gw-Audit-Trail` (`filterChain`, `mcpAudit`, `authorize`).
- **Server changes.** These are small:
  - tool scopes on `/tools`
  - the worker token and rule facts on Authorize
  - trail detail in the gateway decision buffer
  - deleting one mock route.

**Tech Stack:** React 19 + react-router + `@xyflow/react` 12 (demo_api_ui, Vitest + Testing Library), Express (demo_api_server, Jest + supertest). No new dependencies.

**Spec:** the v2 mockups in `docs/mockups/inspectors/` (`mcp.html`, `authorize.html`, `agent-gateway.html`; open from disk; commit ce7d7b3e5) plus the Decisions below. They set the copy, tab names, chip tones, layout and data mapping.

## Decisions (user-approved via the v2 mockups)

- **Same layout on all three pages.**
  - Header: eyebrow, h1, lede, a "More tools" link row, a mode chip, and a source select.
  - Then the "Send a call" card.
  - Then two columns: Calls (`minmax(17rem, 22rem)`) and Call detail. Under `60rem` it stacks to one column.
- **Call detail header.**
  - Status/ms/time/source/correlation chips.
  - Actions: `Resend`, `Edit & resend`, and a `Compare with` select.
  - An optional banner.
  - Five tabs: `What happened` (default), `Request & response`, `Tokens`, `API calls`, `Diagram`.
- **What happened** is an ordered list of steps. Each step has a title, a status chip, a tag chip and plain text. A step may also carry a key/value list or, on Authorize, a policy tree. Gateway calls also show the 5W1H audit record and the gateway log lines for that call.
- **Compare** shows the field-level differences (request and response, up to 8 each, then `…and N more`) and the two responses side by side.
- **Diagram** has one box per system and one numbered arrow per hop. Arrow color: ok green, refused red, held or limited amber, not called dashed. It is built with `EmbeddedFlowDiagram`, never a hand-rolled SVG.
- **The mode chip is driven by data.** Hard-coded strings are deleted: "LIVE", "DEMO SIMULATION", "Environment: 01d89b06", "Worker: demo-bff-mcp-client".
- **Raw tokens are shown on purpose (R13, user: "we want raw tokens, this is education").** Claims still come from server-decoded `tokenEvents` or introspection results; the JWT itself rides along as `raw` (event `raw`, MCP `frames...params.agentToken`, gateway `rawInboundToken`) and renders under a "Raw token" disclosure with Copy. This reverses the earlier redaction.
- **Routes are unchanged:** `/pingone-mcp-inspector`, `/pingone-authorize`, `/agent-gateway-inspector`. These components are rewritten in place: `McpInspectorPageClean.jsx`, `PingOneAuthorizeConsoleClean.jsx`, `AgentGatewayInspectorClean.jsx`.
- **Kept or restored on MCP:**
  - every source, now in a select
  - the Custom server profiles and the "+ Add server" form
  - elicitation Confirm/Decline
  - tool description and required scopes
  - an `Input schema` disclosure
  - a `Browse all N tools` list
  - cross-inspector autofill (`InspectorFieldContext`), with the note `Filled from an earlier result`
- **Kept or restored on Authorize:**
  - presets Transaction / MCP tool / Custom with their existing fields, plus User ID
  - a read-only `Policies on this endpoint` list
  - the toggle `Include PingOne's recent decisions`, which uses the existing `/recent-decisions` and `/recording`
  - the policy tree, using the existing `PolicyDecisionTree`
  - the other tabs, as "More tools" links: Bulk decisions, Guided scenarios, Mock rules, Scopes, Snapshot import, Policy decision trace. Each of those tabs gets `← Back to Authorize Inspector`.
- **Kept or restored on Gateway:**
  - a gateway switch and an `Authz Real | Simulated` toggle (the same feature-flag PATCH the Tester uses)
  - a Scenario select: Custom, three expectation presets, the chain, and the `TOOL_ATTACKS` attack library
  - a `Repeat` count, using `/test/burst` when greater than 1
  - the raw gateway log, as a collapsed card
  - "More tools" links: Gateway tester (`/agent-gateway-capabilities`), Gateway config (`/configure?tab=mcp-gateway`)
  - The Tester's config presets (UC18 throttling and the others) stay on the Tester.
- **Removed (fake or dead only):**
  - the hard-coded Headers tab and Status/Transport text
  - output tabs that rendered nothing
  - the uncontrolled policy checkboxes
  - the dead `EvaluatePanel` (~490 lines)
  - the gateway mock `POST /api/agent-gateway/invoke` and its route and hook
  - font −/+ controls, the per-page theme toggles, the resizable dividers, the history reel (Calls replaces it), and the gateway Identify/Authorize/Enforce/Audit block
- **Known gaps for v1. List them in the PR body.**
  - Token cards don't show "check" chips; the checks appear as What happened steps instead.
  - PingOne's recent-decisions summary has no request parameters, so those rows say so.
  - The gateway trail has no upstream-token card and no gateway-side token-exchange hop.
  - Per-hop ms appear only where measured.
  - Times are shown in local time.
- Nav label "P1AZ Inspector" is unchanged. The h1 becomes "Authorize Inspector".

## Global Constraints

- Use the existing theme tokens in `demo_api_ui/src/index.css`: `--th-bg-page`, `--th-bg-card`, `--th-bg-inset`, `--th-text`, `--th-border`, `--th-border-strong`, `--th-bg-hover`, `--th-bg-emphasis`, `--th-text-on-emphasis`, `--th-status-{success,warning,error,info}[-bg|-border|-text]`, `--font-mono`.
- Ping red is `#d20e0f`, the gradient is `linear-gradient(90deg, #d20e0f 55%, #aa0005)`, and dark red text is `#ff5a5b`. Define them as custom props on `.insp`, as `.ijp` does in `IdJagPlaygroundPage.css`.
- Use the class prefix `insp-`. The only new stylesheet is `components/inspector/Inspector.css`.
- Copy is verbatim from the mockups:
  - `Send a call`, `Send` (busy: `Sending…`), `Calls`, `All`, `Problems`
  - `What happened`, `Request & response`, `Tokens`, `API calls`, `Diagram`
  - `Resend`, `Edit & resend`, `Compare with`, `Choose a call…`, `Stop comparing`
  - Tokens note: `Decoded on the server. The raw token strings never reach this page.`; empty state: `This call carried no tokens.`
  - Hidden claims: `{n} claims hidden by policy: {list}`
  - `No calls yet. Send one above, or use the AI agent.`
  - `No failed calls. Switch to All to see every call.`
  - `More tools: `
  - `MCP audit record (5W1H)`, `Gateway log lines for this call`
- Hop `dir` strings are exact, with `→` (U+2192):
  - `Browser → BFF`, `AI agent → BFF`, `BFF → PingOne`, `BFF → MCP server`, `BFF → PingOne Authorize`
  - `BFF → Gateway`, `AI agent → Gateway`, `Gateway → PingOne`, `Gateway → PingOne Authorize`, `Gateway → MCP server`
- JSON panes reuse `components/shared/FormJsonToggle.jsx`, `JsonHighlight.jsx` (`deep` + `copyable`) and `JsonFormView.jsx`, with JSON as the default view. Don't write a new JSON viewer or copy button.
- Diagram rule: movable boxes, Simulate, Reset and step time. `EmbeddedFlowDiagram` meets all four. Every diagram gets a rule test.
- Work in `.worktrees/inspector-redesign` on branch `feat/inspector-redesign`. The main checkout is shared with other sessions. Commit after every task.
- UI tests run with `cd demo_api_ui && npx vitest run <paths>`. Server tests run with `cd demo_api_server && npx jest <paths>`. The server jest network guard blocks sockets; in-process supertest is fine.
- CI: run one CI run at a time.

## Review Focus

1. **A call with no tokens or frames** (MCP `_localFallback`, PingOne MCP or custom server, Authorize without a cached worker token, a PingOne recent-decision row). Tokens shows the empty state. What happened, API calls and Diagram still render with whatever hops exist (at least 1), and nothing throws. Tests: Task 3 `local fallback`, Task 6 `recent decision row`, Task 2 `no tokens` and `single-hop diagram`.
2. **Error responses.** These are MCP 502 `mcp_invoke_failed` with `frames`, Authorize 502, and gateway `ok:false` / 429. The row is red (amber for 429), a banner shows the message, and the What happened last step carries the error. Tests: Task 3 `403`, Task 6 `502`, Task 8 `rate limited`.
3. **Elicitation pending.** The newest MCP row shows `Waiting for you`, with banner `data-testid="elicitation-card"`, the text `elicitation/create`, and the buttons `Confirm`/`Decline`. `McpInspectorPageClean.elicitation.test.jsx` passes unchanged (Task 4).
4. **Large or embedded JSON and long names.** Panes scroll inside `max-height: 26rem`, names wrap at `_` (`<wbr />`), and the page never scrolls sideways at 400px. Tests: Task 2 `long title wraps`; Task 9 live check at 400px.
5. **A gateway trail detail over 32 KB.** The stored value is `{ truncated: true, bytes }`, and nothing throws. A non-admin still sees only their own `sub`. Tests: Task 7.

---

### Task 1: Shared call model, token and step helpers, diagram config

**Files:**
- Create: `demo_api_ui/src/components/inspector/inspectorCalls.js`
- Test: `demo_api_ui/src/components/inspector/__tests__/inspectorCalls.test.js`

**Interfaces (produced; every later task uses these exact names):**

- JSDoc typedefs:
  - `Chip = { tone: 'ok'|'warn'|'err'|'idle', label: string }`
  - `Payload = { label: string, where?: string, body: any }`
  - `TokenView = { label, role, alg: string|null, rfc: string|null, status: Chip, claims: object, hidden: string[], header: object|null, diff?: Record<string,string> }`
  - `Hop = { dir, call, what, status: Chip, ms: number|null, request: any, response: any }`
  - `Step = { status: Chip, title: string, text: string, tag?: string, kv?: [string,string][], policyTree?: { policies: any[], result: object } }`
  - `InspectorCall`:
    ```
    { id, at /* ms epoch */, kind, title, src: 'you'|'agent'|'log', ms: number|null, status: Chip, chips: Chip[],
      banner: null | { tone, title, text, testId?, actions?: {label, onClick}[] }, corr: string|null,
      request: Payload, response: Payload, tokens: TokenView[], hops: Hop[], steps: Step[],
      audit?: Record<'Who'|'What'|'When'|'Where'|'Why'|'How', [string,string][]>, logs?: string[], input?: object }
    ```
- `ok(label)`, `warn(label)`, `err(label)`, `idle(label)`, each returning a `Chip`
- `SRC_LABEL = { you: 'You', agent: 'AI agent', log: 'PingOne log' }`
- `diffClaims(before, after) → Record<string,string>`
- `tokenStatusChip(status) → Chip`
- `tokensFromEvents(events) → TokenView[]`
- `stepsFromTokenEvents(events) → Step[]`
- `isProblem(call) → boolean`
- `diffPaths(a, b) → { path: string, a: string|undefined, b: string|undefined }[]`
- `diagramConfigFromCall(call, nodeSubs = {}) → { GROUPS, NODES, EDGES, STEPS }`, matching the contract in `components/StaticFlowDiagram.jsx:1-30`

- [ ] **Step 1: Write the failing tests.** Use these fixtures:

```js
const USER = { id: 'user-token', label: 'User access token', status: 'active', alg: 'RS256', rfc: 'RFC 9068',
  claims: { sub: 'u1', aud: ['ai-demo-bff'], scope: 'openid accounts:read read' }, hiddenClaims: ['email'],
  explanation: 'Your sign-in token. It never leaves the BFF.', jwtFullDecode: { header: { alg: 'RS256' } } };
const EXCH = { id: 'exchanged-token', label: 'MCP access token (delegated) → MCP server', status: 'exchanged', alg: 'RS256',
  rfc: 'RFC 8693 · RFC 8707', claims: { sub: 'u1', aud: ['https://api.example/mcp'], scope: 'accounts:read read', act: { sub: 'ai-agent' } },
  hiddenClaims: [], explanation: 'PingOne issued the MCP access token.' };
const DPOP = { id: 'dpop-binding', label: 'DPoP — Sender-constrained token (cnf.jkt)', status: 'active', claims: null, explanation: 'Bound to the key.' };
```

Tests and their assertions:
- `diffClaims(USER.claims, EXCH.claims)` → `{ aud: 'changed', scope: 'narrowed', act: 'added' }`
- `diffClaims({ aud: ['a','b'] }, { aud: ['b','a'] })` → `{}`
- `diffClaims({ scope: 'read' }, { scope: 'read write' })` → `{ scope: 'changed' }`
- `tokenStatusChip` cases:
  - `'active'` → `{tone:'ok',label:'Valid'}`
  - `'exchanged'` → `{tone:'ok',label:'Exchanged'}`
  - `'warning'` → warn `Warning`
  - `'failed'` → err `Failed`
  - `'skipped'` → `{tone:'idle',label:'skipped'}`
- `tokensFromEvents([DPOP, USER, EXCH])`:
  - has 2 entries
  - `[0].role` is the full explanation `'Your sign-in token. It never leaves the BFF.'`
  - `[0].rfc` is `'RFC 9068'` and `[0].hidden` is `['email']`
  - `[1].diff` is `{ aud:'changed', scope:'narrowed', act:'added' }`
- `tokensFromEvents(undefined)` → `[]`
- `stepsFromTokenEvents([DPOP, USER, EXCH])`:
  - has 3 steps, in order
  - `[0]` is `{ title: 'DPoP — Sender-constrained token (cnf.jkt)', status: {tone:'ok',label:'Valid'}, text: 'Bound to the key.' }`
  - `[2].tag` is `'RFC 8693 · RFC 8707'`
- `isProblem({status:{tone:'warn'}})` → `true`
- `diffPaths({a:{b:1,c:2}}, {a:{b:1,c:3},d:true})` → `[{path:'a.c',a:'2',b:'3'},{path:'d',a:undefined,b:'true'}]`. Values are JSON strings. A string holding JSON is parsed first, the way `JsonHighlight.deepParse` does it.
- `diagramConfigFromCall` with hops `Browser → BFF` (ok), `BFF → PingOne` (ok), `BFF → MCP server` (err):
  - `NODES.map(n=>n.id)` → `['Browser','BFF','PingOne','MCP server']`
  - groups → `['client','bff','pingone','mcp']`
  - `x` → `[0,300,600,600]`
  - `EDGES[2]` → `['BFF','MCP server','3. <call>', { color: 'var(--th-status-error)' }]`
  - an idle hop's edge opts → `{ dashed: true }`
  - `STEPS.length` is 3, and `STEPS[1].edges` is `[1]`
  - `nodeSubs['BFF']` lands on `sub`

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/inspectorCalls.test.js`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement.**
  - **Tokens:** `tokensFromEvents` keeps events whose `claims` has at least one key. `role` is the full `explanation`. `header` is `jwtFullDecode?.header ?? null`. The diff is set only on the `exchanged-token` event, against `user-token`.
  - **Scope compare:** split on whitespace. `narrowed` means a proper subset; any other difference is `changed`. Array compare ignores order. A key only in `after` is `added`; a key only in `before` is `removed`.
  - **`stepsFromTokenEvents`:** maps every event in order to a step: `title` = `label`, `status` = `tokenStatusChip(status)`, `text` = `explanation ?? ''`, `tag` = `rfc`.
  - **Diagram layout:**
    - Nodes are the unique hop endpoints in order of first appearance.
    - Level is the BFS distance from the first node along hop direction. Unreached nodes are level 1.
    - `x = level * 300`. Within a level, `y = index * 130`, offset by `(maxLevelSize - levelSize) * 65` so each level is centered.
    - Group comes from the name: `/Browser|AI agent/`→client, `BFF`→bff, `PingOne Authorize`→authorize, `PingOne`→pingone, `Gateway`→gateway, else mcp.
    - `GROUPS`:
      - `client` → `{label:'Caller', bg:'var(--th-status-info)'}`
      - `bff` → `{label:'BFF', bg:'var(--th-bg-emphasis)'}`
      - `pingone` → `{label:'PingOne', bg:'var(--th-status-warning)'}`
      - `authorize` → `{label:'PingOne Authorize', bg:'#7c3aed'}`
      - `gateway` → `{label:'Agent Gateway', bg:'#d20e0f'}`
      - `mcp` → `{label:'MCP server', bg:'var(--th-status-success)'}`
    - Edge label is `` `${i + 1}. ${hop.call}` ``.
    - Edge opts by tone: ok → `{color:'var(--th-status-success)'}`, err → `{color:'var(--th-status-error)'}`, warn → `{color:'var(--th-status-warning)'}`, idle → `{dashed:true}`.
    - `STEPS[i]` is `{ key: 'h'+i, edges: [i], title: hop.dir + ': ' + hop.call, what: hop.what }`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same command. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/inspector/
git commit -m "feat(inspector): shared call model, token/step helpers, per-call diagram config"
```

---

### Task 2: Shared layout and call detail (5 tabs, compare, actions, diagram)

**Files:**
- Create: `demo_api_ui/src/components/inspector/InspectorLayout.jsx` (header, related links, send card, calls list + filter, footer slot)
- Create: `demo_api_ui/src/components/inspector/CallDetail.jsx` (header chips + actions + compare select, banner, five tabs)
- Create: `demo_api_ui/src/components/inspector/Inspector.css`
- Test: `demo_api_ui/src/components/inspector/__tests__/InspectorLayout.test.jsx`

**Interfaces:**
- Consumes everything from Task 1, `components/EmbeddedFlowDiagram.jsx` (`{ config, title, lede, ariaLabel, testId }`), `components/PolicyDecisionTree.jsx` (`{ policies, result }`), and `components/shared/FormJsonToggle|JsonHighlight|JsonFormView`.
- Produces `InspectorLayout` (default export). Its props:
  - `eyebrow, title, lede`
  - `related: { label, to }[]`, rendered as router `<Link>`s after `More tools: ` and joined with ` · `
  - `mode: Chip`
  - `source: { label, value, options: {value,label}[], onChange(value), disabled? }`
  - `heroExtra?: ReactNode`
  - `send: ReactNode|null`
  - `calls: InspectorCall[]`, `callsNote: string`, `callsToggle?: ReactNode`
  - `selectedId`, `onSelect(id)`
  - `onResend(call)`, `onEdit(call)`
  - `nodeSubs?: Record<string,string[]>`
  - `footer?: ReactNode`
- Produces `CallDetail` (default export), with props `{ call, calls, nodeSubs, onResend, onEdit }`. Tab state and compare state live inside it. Changing `call.id` resets compare to none and keeps the current tab.

- [ ] **Step 1: Write the failing tests.** Add `window.ResizeObserver ||= class { observe(){} unobserve(){} disconnect(){} }` at the top, the way `ArchitectureOverviewPage.rule.test.jsx` does. Build two fixtures:
  - `c1`:
    - ok `200 OK`, title `get_my_accounts`
    - 1 token with `diff:{scope:'narrowed'}`
    - 2 hops (`Browser → BFF`, `BFF → PingOne`)
    - 2 steps, the second with `kv: [['aud','x']]`
    - `audit: { Who: [['userSub','u1']] }` and `logs: ['line one']`
  - `c2`:
    - err `403`, title `get_sensitive_account_details`
    - banner `{tone:'err',title:'Refused',text:'t',testId:'elicitation-card',actions:[{label:'Confirm',onClick:vi.fn()}]}`
    - no tokens, 1 hop, 1 step

  Wrap the render in `<MemoryRouter>`. Tests:
  - `renders header, mode chip and call count`
  - `selecting a row calls onSelect('c2')`
  - `Problems filter hides ok calls`
  - `What happened is the default tab and lists steps`: the step titles show, plus `MCP audit record (5W1H)` and `Gateway log lines for this call`.
  - `Tokens tab shows the server-decoded note and diff chip`, and on `c2` shows `This call carried no tokens.`
  - `API calls tab lists hops with a count`: the tab name matches `/API calls\s*2/`.
  - `Diagram tab follows the diagram rule`:
    - `container.querySelectorAll('.react-flow__node-sfd')` has length 3 and each has class `draggable`
    - `getByRole('button', { name: /Simulate/ })` and `getByRole('button', { name: /Reset/ })` exist
    - `container.querySelector('.dc-steptime-select')` exists. Read the exact step-time class in `components/diagram/DiagramControls.jsx` first and use that.
  - `single-hop diagram renders`, for `c2`.
  - `Compare shows differences`: select `c2` in `Compare with` → text matches `/fields? differ/`, and a `Stop comparing` button exists.
  - `Resend and Edit call the page callbacks`.
  - `banner keeps its test id and runs actions`.
  - `empty calls` → `No calls yet. Send one above, or use the AI agent.`
  - `long title wraps`: `.insp-call-title` innerHTML contains `<wbr>`.
  - `related links route`: the link `href` equals `/pingone-authorize?tab=bulk`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/InspectorLayout.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement to the mockup.**
  - Calls rows are buttons with `aria-current`. Tabs use `role=tablist/tab/tabpanel`.
  - Each pane is `FormJsonToggle` (`defaultView="json"`, `jsonView={<JsonHighlight value={body} deep copyable />}`) with `<JsonFormView value={body} />` as its child. Read `FormJsonToggle.jsx` for its exact props.
  - Token cards:
    - claims in the order `sub, aud, scope, act, client_id, iat, exp`
    - `iat`/`exp` also show the local time
    - diff chip in the warn tone
    - an `rfc` tag chip
    - a `<details>` labeled `All claims (JSON)`
  - What happened:
    - an `<ol>` of steps with a numbered gradient badge, the title, a status chip and a tag chip
    - the text, then `kv` as a `<dl>`
    - `policyTree` renders `<PolicyDecisionTree policies={…} result={…} />`
    - then the audit grid (6 boxes) and the logs `<pre>`
  - Compare uses `diffPaths`. It lists up to 8 paths for the request and 8 for the response as `path: <del>other</del> → <ins>this</ins>`, then shows both responses' panes.
  - Diagram: `<EmbeddedFlowDiagram config={diagramConfigFromCall(call, nodeSubs)} title="Diagram" lede="One arrow per API call, in order. Drag any box; Simulate walks the arrows." testId="insp-diagram" />`. Memoize the config on `call.id`.
  - Titles insert `<wbr />` after each `_`; don't use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run the tests and confirm they pass.**

- [ ] **Step 5: Commit** with the message `feat(inspector): shared layout + call detail with What happened, compare and ReactFlow diagram tab`.

---

### Task 3: MCP data. Tool scopes on the server, full call capture, MCP adapters

**Files:**
- Modify: `demo_api_server/routes/mcpInspector.js`. On both `GET /tools` response paths (live MCP ~L600-624 and the local-catalog fallback), add `requiredScopes: MCP_TOOL_SCOPES[t.name] || null` to each tool.
- Test: `demo_api_server/src/__tests__/mcp-inspector.test.js` (add a case)
- Modify: `demo_api_ui/src/services/mcpCallStore.js:33`: `appendMcpCall(tool, status, duration, result, errorMsg = null, detail = null)`, stored as `entry.detail`
- Modify: `demo_api_ui/src/hooks/useInspectorSource.js:343,354`, to pass `detail`
- Modify: `demo_api_ui/src/services/demoAgentService.js:677`. Move the append below the `allTokenEvents` merge and pass `detail`.
- Create: `demo_api_ui/src/components/inspector/mcpCalls.js`
- Test: `demo_api_ui/src/components/inspector/__tests__/mcpCalls.test.js`, and `demo_api_ui/src/services/__tests__/mcpCallStore.test.js` (create it if it doesn't exist)

**Interfaces:**
- The `detail` shape is `{ src: 'you'|'agent', params?: object, frames?: object, tokenEvents?: object[], response?: object, question?: string }`.
- The server frames keys are `initializeRequest`, `initializeResponse`, `request`, `response`, `notifications[]`. The invoke response's `inspector` is `{ tool, durationMs, phases, tokenExchangeApplied, requiredScopesHint }`.
- Produces `mcpCallFromStore(entry) → InspectorCall` and `apiCallFromTracker(call) → InspectorCall`.

- [ ] **Step 1: Write the failing tests.**
  - **Server:** with the MCP call mocked the way the existing file does it, `GET /api/mcp/inspector/tools` → the tool `get_my_accounts` has `requiredScopes` equal to `['accounts:read']`.
  - **Store:** `appendMcpCall('t',200,5,{},null,{src:'you'})` → `getCalls()[0].detail` equals `{src:'you'}`.
  - **`mcpCallFromStore`, inspector success.** Input: `detail.src='you'`; `frames` with `initializeRequest/Response` and `request/response`; `tokenEvents=[USER, EXCH]`; `response.inspector.requiredScopesHint=['accounts:read']`. Assertions:
    - `request.label` is `'JSON-RPC request'`
    - `status` is `{tone:'ok',label:'200 OK'}`
    - `hops.map(h=>h.dir)` is `['Browser → BFF','BFF → PingOne','BFF → MCP server','BFF → MCP server']`
    - the exchange hop request is `{grant_type:'urn:ietf:params:oauth:grant-type:token-exchange', audience:['https://api.example/mcp'], scope:'accounts:read read'}`, with `ms` `null`
    - the step titles include `'Compared the tool\'s required scopes with the token'`, with status `ok('has them')`
    - the last step title is `'Ran the tool'`
    - `input` is `{ tool, params }`
    - `chips` include `idle('Token exchange applied')`
  - **Agent entry without detail:**
    - `src` is `'agent'`, `request.label` is `'Tool arguments'`
    - `hops` has length 1, with `dir` `'AI agent → BFF'` and `call` `'POST /api/mcp/tool'`
    - `tokens` is `[]`, and `steps.length` is at least 1
  - **403** (`errorMsg 'insufficient_scope'`, with `requiredScopesHint` `['read','sensitive:read']` and the exchanged scope `accounts:read read`):
    - status err `'403'`, and `banner.text` contains `insufficient_scope`
    - the scope step is `err('missing sensitive:read')`
  - **Local fallback** (`detail.response._localFallback`): the chips include `idle('Local handler, no MCP server')`.
  - **`apiCallFromTracker`:** `title` is `'GET /api/accounts'`, `hops.length` is 1, `steps.length` is 1.

- [ ] **Step 2: Run the tests and confirm they fail.** Server: `cd demo_api_server && npx jest src/__tests__/mcp-inspector.test.js`. UI: `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/mcpCalls.test.js src/services/__tests__/mcpCallStore.test.js`.

- [ ] **Step 3: Implement.**
  - **Detail payloads:**
    - Inspector success: `{ src:'you', params, frames:data.frames, tokenEvents:data.tokenEvents, response:data }`
    - Inspector error: the same keys from `e.response?.data`
    - Agent: `{ src:'agent', params:<tool args>, tokenEvents:allTokenEvents, question:<user message if in scope> }`
  - **Steps, in order:**
    1. `You sent the call` / `The AI agent picked a tool`
    2. `stepsFromTokenEvents(tokenEvents)`
    3. the scope comparison, when `requiredScopesHint` and an exchanged token exist: `ok('has them')` or `err('missing ' + list)`
    4. `Opened the MCP session` (when `frames.initializeResponse` exists: `serverInfo` and `protocolVersion` in the text)
    5. `Ran the tool`: ok, err with the JSON-RPC error code and message, or warn `waiting` on elicitation
  - **Without frames:** `request` is `{label:'Tool arguments', body: params ?? {}}` and `response` is `{label:'Result', body: result ?? {error: errorMsg}}`.

- [ ] **Step 4: Run both test commands and confirm they pass.** Also run `npx vitest run src/hooks/__tests__/useInspectorSource.test.js`.

- [ ] **Step 5: Commit** with the message `feat(inspector): tool scopes on /tools, full MCP call capture, MCP adapters`.

---

### Task 4: Rebuild the MCP Inspector

**Files:**
- Modify (rewrite): `demo_api_ui/src/components/McpInspectorPageClean.jsx`
- Modify: `demo_api_ui/src/hooks/useInspectorSource.js`. Remove `outputTab`, `setOutputTab`, `outputValue`, `outputContent` (~L412-451). Add `toolsSource` (the tools response `_source`).
- Tests (update): `src/components/__tests__/mcpInspectorCleanGrouping.test.jsx`, `src/hooks/__tests__/useInspectorSource.test.js`
- Tests that must pass **unchanged**: `McpInspectorPageClean.elicitation.test.jsx`, `McpInspectorPageClean.addServer.test.jsx`
- Test (create): `src/components/__tests__/McpInspectorPageClean.calls.test.jsx`
- Delete `McpInspectorPage.clean.css` only when `grep -rn "McpInspectorPage.clean.css" demo_api_ui/src` finds no importer after Task 6.

**Wiring:**
- **Header:** eyebrow `PingOne MCP · Inspector`, h1 `MCP Inspector`, lede from `mcp.html`.
- **Related links:** `MCP traffic log`→`/monitoring/mcp-traffic`, `Token chain`→`/monitoring/token-chain`, `Agent flow`→`/monitoring/agent-flow`.
- **Source select:** labeled `Server`. Options: `banking` AI Demo MCP, `pingone` PingOne MCP, `gateway` Gateway showcase, `custom` Custom server, `protocol` Raw JSON-RPC, `api` All API calls. It reads and writes `?source=` with `setSearchParams`.
- **Mode chip:** `banner` → `err('Unavailable')`; else `toolsSource==='local_catalog'` → `warn('Local fallback')`; else `ok('Live')`. When `banner` is set, show its existing `Sign in` / `Retry` actions in the send card.
- **Send card** (hidden for `api`):
  - Tool `<select>` with one `<optgroup>` per `config.groupBy` group. For `protocol` it is a method select.
  - A tool info line: the description plus `idle('needs ' + scope)` chips from `requiredScopes`.
  - A `<details>` labeled `Input schema` (JsonHighlight of `inputSchema`).
  - A `<details>` labeled `` `Browse all ${tools.length} tools` `` (name, description, scope chips).
  - Param inputs (`key *` when required). An autofilled param shows `<small>Filled from an earlier result</small>` (existing `getMatchingFields` logic).
  - `Send` → `handleExecute`.
  - For `custom`, keep the profile select and the whole "+ Add server" form with its copy unchanged.
  - For gateway showcase, show per-server status chips (`N tools` or the error) under the select.
- **Calls:**
  - `api` → `/api/api-calls?limit=100` mapped with `apiCallFromTracker`
  - otherwise `mcpHistory.map(mcpCallFromStore)`
  - Select the newest call after each Send.
  - `callsNote` is `Includes calls the AI agent made in this browser tab.`
- **Elicitation:** prepend a call with `status warn('Waiting for you')` and banner `{tone:'warn', testId:'elicitation-card', title:'The MCP server is asking you to confirm (elicitation/create)', text: pendingElicitation.message, actions: Confirm → answerElicitation('accept',{confirm:true}), Decline → answerElicitation('decline')}`.
- **Resend and Edit:**
  - `onResend(call)` → set the tool and params from `call.input`, then `handleExecute`.
  - `onEdit(call)` → set them only, then scroll the send card into view.
- **`nodeSubs`:**
  - `Browser`: `['This page','holds only a session cookie']`
  - `AI agent`: `['Asks the BFF to run tools','for you']`
  - `BFF`: `['Holds your tokens','exchanges them per call']`
  - `PingOne`: `['Issues the MCP token','(RFC 8693 exchange)']`
  - `MCP server`: `['Runs the tool']`
- Remove `useDividerDrag` and its storage keys.

- [ ] **Step 1: Write and update the tests.**
  - New calls test: seed `mcpCallStore` with one agent entry and render with `useInspectorSource` mocked, the way the elicitation test does. Assertions:
    - the row shows `AI agent`
    - the `What happened` tab shows `The AI agent picked a tool`
    - the tool info shows `needs accounts:read`
  - Grouping test: replace the divider and `--inspector-col-*` assertions with `getByRole('group', { name: 'Weather MCP' })` and `getByRole('option', { name: 'Gateway showcase' })`.
  - Hook test: drop the `outputValue`/`outputTab` assertions; add `toolsSource === 'mcp_server'`.
- [ ] **Step 2: Run them and confirm they fail.**
  `cd demo_api_ui && npx vitest run src/components/__tests__/McpInspectorPageClean src/components/__tests__/mcpInspectorCleanGrouping.test.jsx src/hooks/__tests__/useInspectorSource.test.js`
- [ ] **Step 3: Rewrite the page.**
- [ ] **Step 4: Run the same command, plus `npx vitest run src/components/__tests__/PageGuide.test.jsx src/__tests__/App.structure.test.js`. Everything passes.**
- [ ] **Step 5: Commit** with the message `feat(mcp-inspector): rebuild on shared inspector layout`.

---

### Task 5: Authorize evaluate-endpoint returns the worker token and rule facts

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js`. Add and export `peekWorkerToken() → string|null`: the cached token when the credKey matches and it hasn't expired. Never a network call.
- Modify: `demo_api_server/routes/authorize.js:767-806`. The 200 body adds:
  - `policyEvalMs`, `ruleName`, `ruleCode` (from `result`, or `null`)
  - `workerTokenCached: boolean` (whether `peekWorkerToken()` was non-null *before* the evaluate)
  - `tokenEvents: token ? [buildTokenEvent('worker-token', 'Worker token (client credentials)', 'active', decodeJwtClaims(token), 'The BFF used this token to call PingOne Authorize. It identifies the BFF, not you.', { rfc: 'RFC 6749 §4.4' })] : []`
  - `buildTokenEvent` and `decodeJwtClaims` come from `services/agentMcpTokenService`; `decodeJwtClaims` returns `{header, claims}`.
- Test: `demo_api_server/tests/routes/authorizeEvaluateEndpointInspector.test.js`

- [ ] **Step 1: Write the failing test.**
  - Mock the service: `evaluateDecisionEndpoint` resolves `{decision:'DENY', policyEvalMs:41, ruleName:'Step-up above $10,000', ruleCode:'step-up', raw:{}, _debug:{request:{method:'POST',url:'u',body:{parameters:{Amount:12500}}}, response:{decision:'DENY'}}}`.
  - `peekWorkerToken` returns an unsigned JWT built in the test, with payload `{client_id:'demo-bff-mcp-client', aud:['https://api.pingone.com']}`.
  - Mount the router with a stub `authenticateToken`, copying the setup in `tests/routes/agentGatewayDecisionsAccess.test.js`.

  Assertions:
  - `policyEvalMs` is 41 and `ruleName` matches
  - `workerTokenCached` is `true`
  - `tokenEvents[0].id` is `'worker-token'`, with `claims.aud` `['https://api.pingone.com']`
  - **`JSON.stringify(body)` does not contain the token string**
  - when `peekWorkerToken` returns `null`, `tokenEvents` is `[]` and `workerTokenCached` is `false`.
- [ ] **Step 2: Run it and confirm it fails.** `cd demo_api_server && npx jest tests/routes/authorizeEvaluateEndpointInspector.test.js`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and confirm it passes.** Then run `npx jest tests/routes/authorize src/__tests__/authorize` and expect no new failures compared with `main`.
- [ ] **Step 5: Commit** with the message `feat(authorize): evaluate-endpoint returns worker token event + rule facts`.

---

### Task 6: Rebuild the Authorize Inspector and scale back the page

**Files:**
- Create: `demo_api_ui/src/components/inspector/authorizeCalls.js`
- Modify: `demo_api_ui/src/hooks/usePingOneAuthorizeConsole.js:161`. `onEvaluated` gains `result: res.data, parameters, elapsedMs`, and it is also called on error with `{ preset, error: message, parameters, elapsedMs }`.
- Modify (rewrite): `demo_api_ui/src/components/PingOneAuthorizeConsoleClean.jsx`; delete `PingOneAuthorizeConsoleClean.css`
- Modify: `demo_api_ui/src/components/PingOneAuthorizePage.jsx`:
  - drop the tab bar (L1014-1019) and the dark toggle
  - delete `EvaluatePanel` (L302-~790) and the helpers only it uses (`TAB_HELP`, `DecisionRow`, `PolicyNode`, `authorizeRequestPayload`, `authorizeResponsePayload`); also `PacEditorLaunch` if grep finds no other importer
  - delete `PingOneAuthorizePage.css`
  - non-console tabs render `← Back to Authorize Inspector`
- Test: `demo_api_ui/src/components/inspector/__tests__/authorizeCalls.test.js`; update `src/components/__tests__/PingOneAuthorizePage.test.jsx`

**Interfaces:**
- Produces `authorizeCallFromResult({ result, error, parameters, preset, elapsedMs, at, policies }) → InspectorCall` and `authorizeCallFromRecent(d) → InspectorCall`.
- PingOne recent-decision items carry the verdict at `d.decisionResponse?.decision ?? d.decision`, the statements at `d.decisionResponse?.statements`, the time at `d.requestedAt ?? d.createdAt ?? d.timestamp`, and the id at `d.id`. They have **no request parameters**.

Mapping rules for `authorizeCallFromResult`:
- **Status:**
  - `error` → `err('Error')`
  - `DENY` → `err('DENY')`
  - `PERMIT` with `consentRequired || hitlRequired` → `warn('PERMIT · needs approval')`
  - `PERMIT` → `ok('PERMIT')`
- **Chips:** `idle('Rule: '+ruleName)` and `idle('Policy eval '+policyEvalMs+' ms')`, each when present.
- **Banners:**
  - DENY + stepUp: `{tone:'err', title:'Denied until the user steps up', text:'PingOne Authorize wants a stronger sign-in. Statement: '+statements[0].name}`
  - other DENY: `{tone:'err', title:'Denied by PingOne Authorize', text: statement names joined with ', ' or 'No statements returned.'}`
  - PERMIT needing approval: `{tone:'warn', title:'Permitted, with a condition', text:"The app must get the user's approval before the tool runs."}`
  - error: `{tone:'err', title:'PingOne Authorize call failed', text:error}`
- **Request / response:** `request` is `{label:'Decision request', where:'POST '+pingoneRequest.url, body:pingoneRequest.body}`. `response` is `{label:'PingOne Authorize response', where:'PingOne Authorize → BFF', body:pingoneResponse}`.
- **Tokens:** `tokensFromEvents(result.tokenEvents)`.
- **Hops:**
  1. `Browser → BFF` / `POST /api/authorize/evaluate-endpoint`, with `ms` `elapsedMs`
  2. `BFF → PingOne` / `POST /as/token`: when `workerTokenCached`, `idle('skipped')` with what `'Worker token: cached, so no call was made'`; otherwise `ok('200')`
  3. `BFF → PingOne Authorize` / `POST /decisionEndpoints/{id}`
- **Steps:**
  1. `Built the decision request`, with the parameters as `kv`
  2. `Got a worker token`, cached or fetched
  3. `Called the decision endpoint`
  4. `Evaluated the policies`, with `policyTree: { policies, result }` and the text "Matched rules are worked out from the returned statements; PingOne does not return a per-rule trace."
  5. `Returned statements` or `No statements`
  6. `What the app does next`: step-up → prompt for MFA and resend; approval → CIBA approval and resend with `HitlApproved = true`; PERMIT → goes ahead; DENY → stops
- **Title:** for Transaction, `` `${TransactionType} $${Number(Amount).toLocaleString('en-US')}` ``; for MCP, `ToolName`; otherwise `Custom decision`. `kind` is `` `Decision · ${preset}` ``. `input` is `{ preset, parameters }`.

Mapping for `authorizeCallFromRecent`: `src` `'log'`; request `{label:'Decision request', body:{ note: "PingOne's recent-decisions summary doesn't include the request parameters." }}`; response is the item; tokens `[]`; one hop `BFF → PingOne Authorize`; steps are `Recorded by PingOne` plus the statements.

**Page wiring:**
- **Header:** eyebrow `PingOne Authorize · Inspector`, h1 `Authorize Inspector`, lede from `authorize.html`.
- **Mode chip:** from `/api/authorize/pingone-live-policy` `simulatedMode`: false → `ok('Live')`, else `warn('Simulated')`.
- **Source:** labeled `Endpoint`, listing those endpoints.
- **Related links:** `?tab=bulk|guided|mockRules|scopes|snapshot` and `/policy-decision-trace`.
- **Send:**
  - preset segmented `Transaction | MCP tool | Custom`, then that preset's existing hook fields plus User ID, then `Send` → `run()`
  - a `<details>` `Policies on this endpoint · N policies, M rules`, read-only, built from `policiesState`
- **Calls:**
  - page state, prepending `authorizeCallFromResult` on each `onEvaluated`
  - when `callsToggle` `Include PingOne's recent decisions` is on: merge `authorizeCallFromRecent` items, deduped by decision id. Turning it on calls the existing `POST /recording` when the endpoint isn't recording.
  - `callsNote` is `Your decisions from this page, plus PingOne's recent-decisions log (the AI agent's decisions show up there).`
- **Resend and Edit:** `onResend` → `runParameters(call.input.parameters)`. `onEdit` → set the preset and the hook setters from `call.input`.
- **`nodeSubs`:**
  - `Browser`: `['This page']`
  - `BFF`: `['Builds the parameters','and calls PingOne']`
  - `PingOne`: `['Issues the worker token']`
  - `PingOne Authorize`: `['Runs the policy tree','returns decision + statements']`
- Keep the `SignInPrompt` and loading branches.

- [ ] **Step 1: Write the failing tests.**
  - Adapter cases:
    - PERMIT
    - DENY + stepUp (banner and statement name)
    - PERMIT + hitl (warn)
    - 502 error
    - Transaction title `TRANSFER $12,500`
    - cached worker token → hop 2 `skipped`
    - recent decision row → `src 'log'` and the request note.
  - Page test: replace the `Available Policies` assertion with heading `Authorize Inspector` and button `Transaction`. Delete the `EvaluatePanel`/`filterPolicyTree`/`policyNodeMatches` tests (L5, L102-165). Keep the `?tab=` render tests and assert `Back to Authorize Inspector` on `?tab=bulk`.
- [ ] **Step 2: Run them and confirm they fail.** `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/authorizeCalls.test.js src/components/__tests__/PingOneAuthorizePage.test.jsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass,** plus `npx vitest run src/__tests__/signInInterruptVsPrompt.test.js src/pages/__tests__/ControlPlanePage.test.jsx src/components/__tests__/PolicyDecisionTracePage.test.jsx src/__tests__/App.structure.test.js`.
- [ ] **Step 5: Commit** with the message `feat(authorize-inspector): shared layout, policy tree + recent decisions, drop dead EvaluatePanel`.

---

### Task 7: Gateway decision buffer keeps trail detail, with a size cap

**Files:**
- Modify: `demo_api_server/services/agentGatewayDecisions.js:28-66`
- Test: `demo_api_server/tests/routes/gatewayDecisionIngest.test.js` (add cases)

**Interfaces:**
- Each entry gains these fields:
  - `parameters` and `rawResponse` (from `trail.authorize`)
  - `filterChain` and `mcpAudit` (from `trail`)
  - `introspectionActive: trail.introspection?.active ?? null`
- Each detail field is kept when `JSON.stringify(v).length <= DETAIL_MAX` (`32 * 1024`). Otherwise it becomes `{ truncated: true, bytes }`. A missing field is `null`.
- `recent()` and the non-admin `sub` filter are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `record({authorize:{decision:'DENY',parameters:{ToolName:'t'},rawResponse:{decision:'DENY'}}, filterChain:[{filter:'P1AZDecision',result:'blocked'}], mcpAudit:{who:{userSub:'u'}}})`. Then `recent(1)[0]` has:
    - `parameters.ToolName` `'t'`
    - `rawResponse.decision` `'DENY'`
    - `filterChain` of length 1
    - `mcpAudit.who.userSub` `'u'`
  - With `rawResponse: { blob: 'x'.repeat(40000) }`: `recent(1)[0].rawResponse` matches `{ truncated: true }`, `bytes` is greater than 32768, and nothing throws.
  - `agentGatewayDecisionsAccess.test.js` passes unchanged.
- [ ] **Step 2: Run them and confirm they fail.** `cd demo_api_server && npx jest tests/routes/gatewayDecisionIngest.test.js tests/routes/agentGatewayDecisionsAccess.test.js`
- [ ] **Step 3: Implement** (`DETAIL_MAX` plus one `capped(v)` helper).
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit** with the message `feat(gateway): keep P1AZ request/response, filter chain and 5W1H per recorded decision`.

---

### Task 8: Rebuild the Agent Gateway Inspector on real traffic

**Files:**
- Create: `demo_api_ui/src/components/inspector/gatewayCalls.js`
- Modify (rewrite): `demo_api_ui/src/components/AgentGatewayInspectorClean.jsx`
- Modify: `demo_api_ui/src/components/AgentGatewayLogPanel.jsx`:
  - remove the "Recent decisions" table, `CapabilityCallout` and `decisionBadgeClass`
  - wrap the log controls and `<pre>` in `<details className="insp-card insp-log">` with summary `Gateway log` · `Last {n} lines. Tokens are redacted.`
  - keep the filter placeholder and the stale-response guard
- Delete:
  - `AgentGatewayInspectorClean.css`
  - `hooks/useAgentGatewayInspector.js`
  - `demo_api_server/routes/agentGatewayInspector.js` and its mount at `demo_api_server/server.js:1565`
  - First grep `agent-gateway/invoke|agent-gateway/capabilities|useAgentGatewayInspector|agentGatewayInspector` across both apps. It must show only these files and their tests.
- Delete test: `src/components/__tests__/AgentGatewayLogPanel.badge.test.js`
- Tests: `demo_api_ui/src/components/inspector/__tests__/gatewayCalls.test.js`; rewrite `src/components/__tests__/AgentGatewayInspectorClean.test.jsx`; keep `AgentGatewayLogPanel.staleResponse.test.jsx` and `AgentGatewayTester*.test.jsx` passing.

**Interfaces:**
- Produces:
  - `gatewayCallFromTest(res, { tool, args, gatewayUrl, at }) → InspectorCall`, where `res` is the `POST /api/mcp-gateway/test` body
  - `gatewayCallsFromBurst(res, { tool, args, at }) → InspectorCall[]`, one per `results[]` item. These carry only hop 1 and a `Rate limit` step.
  - `gatewayCallFromRecord(rec) → InspectorCall`, for Task 7 entries
  - `dedupeGatewayCalls(testCalls, recordCalls) → InspectorCall[]`: drops a record call when a test call has the same `title` and decision and is within 5000 ms. Mark it with `// ponytail: heuristic dedupe; switch to correlationId once the ingest records it`.
  - `logLinesFor(call, lines) → string[]`: the lines whose ISO timestamp falls in `[at - 2000, at + (ms ?? 0) + 2000]` and that contain `call.title`
- **Status:**
  - `rateLimited` → `warn('429 Rate limited')`
  - DENY → `err('DENY')`
  - PERMIT where `isPause(...)` (`services/tokenChainTrace/pauseObligation`) is true → `warn('PAUSE · approval')`
  - PERMIT → `ok('PERMIT')`
  - other `ok:false` → `err(String(httpStatus || 'Error'))`
  - Chips: `idle('Stopped at: ' + denyingFilter)` and `idle('Backend: ' + authorize.backend)`.
- **Steps:** one per `filterChain` entry, in order, plus `Upstream MCP server`. Tag is `Gateway filter`. Status: `passed`→ok, `forwarded`→ok, `blocked`→err, held obligation→warn, `skipped`→idle. Text per filter:
  - `McpValidationFilter`: "The request is a valid MCP JSON-RPC call."
  - `McpAuditFilter`: "Written to the MCP audit log. The 5W1H record is below."
  - `McpProtectionFilter`: "Rate limit and size checks."
  - `TokenIntrospection`: "Token is active. sub …, client …, scope …"
  - `P1AZDecision`: "PingOne Authorize said {decision}" plus the statement names, plus the resolver attributes when `authorize.resolver` is set
  - Upstream: "Forwarded. The MCP server answered." or "Never reached: stopped at {denyingFilter}."
- **Audit:** `mcpAudit` → `Who` (userSub, agentSub, clientId, actDepth), `What` (mcpMethod, tool, transactionType, transactionAmount), `When` (ISO of `when`), `Where` (resourceId, vertical), `Why` (`how.reason` or the statement names), `How` (decision, backend, result). Skip null values.
- **Tokens:**
  - from test calls: `tokensFromEvents(res.tokenEvents)`, plus `{ label:'Token as the gateway saw it', role:'What introspection returned to the gateway. This is what the policy saw.', alg:null, rfc:'RFC 7662', status: introspection.active ? ok('Active') : err('Inactive'), claims: introspection minus email, hidden: email ? ['email'] : [], header:null }`
  - from records: only that card, built from `{ sub, aud, scope, iss, client_id: clientId, act: actor ? {sub: actor} : undefined }`
- **Hops:**
  1. `BFF → Gateway` (tests) or `AI agent → Gateway` (records) / `POST /mcp tools/call`
  2. `Gateway → PingOne` / `POST /as/introspect`
  3. `Gateway → PingOne Authorize` / `POST /decisionEndpoints/{id}`, with request `{parameters}` and response `rawResponse`
  4. `Gateway → MCP server` / `` `POST /mcp tools/call ${tool}` ``, as `ok('forwarded')` or `idle('not called')` with what `'Stopped at ' + denyingFilter`
  - A 429 has hop 1 plus hop 2 as `idle('not called')`, with what `'Rate limit hit before any checks ran'`.
- `input` is `{ tool, args }`.

**Page wiring:**
- **Header:** eyebrow `PingOne Agent Gateway · Inspector`, h1 `Agent Gateway Inspector`, lede from `agent-gateway.html`.
- **Related links:** `Gateway tester`→`/agent-gateway-capabilities`, `Gateway config`→`/configure?tab=mcp-gateway`.
- **Source:** labeled `Gateway`, `PingOne Agent Gateway | Demo MCP Gateway (Node)`, selected from `GET /api/mcp-gateway/active` `usePingGateway`. Changing it does `PATCH /api/admin/feature-flags { updates: { ff_mcp_gateway_pinggateway: bool } }` and refetches active.
- **`heroExtra`:** `Authz` segmented `Real | Simulated` → the same PATCH with `ff_authorize_real`. On an error (non-admin), show the formatted message in the send hint.
- **Mode chip:** `active.simulated` → `warn('Simulated authz')`, else `ok('Live')`.
- **Send:**
  - `Scenario` select:
    - `Custom`
    - `Read accounts (expect PERMIT)` (get_my_accounts `{}`)
    - `Sensitive read (expect DENY)` (get_sensitive_account_details `{account_id}`)
    - `Withdrawal (expect approval)` (create_withdrawal `{account_id, amount: 500}`)
    - `Run chain: accounts → balance → sensitive` (three sequential `/test`)
    - one option per `TOOL_ATTACKS` entry, labeled `Attack library: {label}` (its `tool` and `args`)
  - Picking a scenario fills `Tool` and `Arguments (JSON)`.
  - `Tool` select from `GET /api/mcp/inspector/tools`.
  - `Arguments (JSON)`: invalid JSON shows `Invalid JSON` and disables Send.
  - `Repeat` number 1–20. When greater than 1, call `POST /api/mcp-gateway/test/burst { tool, args, count }`.
  - `Send` → `POST /api/mcp-gateway/test { tool, args }`, then prepend and refetch records.
- **Calls:** `dedupeGatewayCalls(testCalls, records.map(gatewayCallFromRecord))`, with records from `GET /api/admin/agent-gateway/decisions?limit=50`. Fetch on mount, after Send, and every 5 s while `document.visibilityState === 'visible'`; clear it on unmount. `callsNote` is `Includes every call the gateway reported, from you and from agents.`
- **Logs:** when the selected call changes, `GET /api/admin/agent-gateway/logs?tail=200&filter=<tool>` and set `call.logs = logLinesFor(call, lines)`. On failure, leave `logs` empty.
- **`nodeSubs`:**
  - `AI agent`: `['Calls the gateway','with a delegated token']`
  - `BFF`: `['Calls the gateway','for this page']`
  - `Gateway`: `['PingOne Agent Gateway','filters every MCP call']`
  - `PingOne`: `['Introspects the token','(RFC 7662)']`
  - `PingOne Authorize`: `['Decides per tool call']`
  - `MCP server`: `['Runs the tool']`
- **Route:** `McpGatewayConfigRoute` stays unchanged (the `App.structure.test.js` assertions hold).

- [ ] **Step 1: Write the failing tests.**
  - Adapter cases:
    - PERMIT test call: 4 hops, hop 4 `forwarded`; the tokens include `Token as the gateway saw it`, with no `email` in its claims; 6 steps from a 5-entry `filterChain` plus upstream; `audit.Who` contains `userSub`.
    - DENY record: status `DENY`, hop 4 `not called`, chip `Stopped at: P1AZDecision`.
    - PAUSE.
    - 429: 2 hops, the second `not called`.
    - burst: 3 results → 3 calls.
    - dedupe: drop at 4 s, keep at 6 s.
    - `logLinesFor` keeps lines inside the window and drops one 10 s out.
  - Page test: mock the API client:
    - `/active` → `{name:'PingOne Agent Gateway', usePingGateway:true, simulated:false, url:'https://gw/mcp'}`
    - decisions → one DENY record
    - tools → `[{name:'get_my_accounts'}]`
    - logs → `{lines:[]}`

    Assert:
    - the row `DENY` and mode `Live`
    - What happened shows `P1AZDecision`
    - Tokens shows `Token as the gateway saw it`
    - API calls shows `Gateway → PingOne Authorize` and `not called`
    - the Scenario select has an option starting `Attack library:`
    - no request to `/api/agent-gateway/invoke`
- [ ] **Step 2: Run them and confirm they fail.** `cd demo_api_ui && npx vitest run src/components/inspector/__tests__/gatewayCalls.test.js src/components/__tests__/AgentGatewayInspectorClean.test.jsx src/components/__tests__/AgentGatewayLogPanel.staleResponse.test.jsx`
- [ ] **Step 3: Implement** the adapters, the page, the LogPanel trim and the deletions.
- [ ] **Step 4: Run them and confirm they pass,** plus `npx vitest run src/__tests__/App.structure.test.js src/components/__tests__/AgentGatewayTester.test.jsx` and `cd ../demo_api_server && npx jest tests/routes/gatewayDecisionIngest.test.js`.
- [ ] **Step 5: Commit** with the message `feat(gateway-inspector): real gateway traffic, filter chain + 5W1H, scenarios; remove mock invoke route`.

---

### Task 9: Copy sweep, Learning Hub sync, full suites, live check

**Files:**
- Modify only what the grep finds, in:
  - `demo_api_ui/src/config/pageGuides.js`, `pageGuidesMore.js`, `demoStepGuides.js`, `demoUseCaseSteps.js`
  - `demo_api_ui/src/learning/lessonCatalog.js`
  - `demo_api_ui/src/components/AIAgent.js` (`:10976`, `:11594` → dead `?subtab=tester`)
  - `demo_api_ui/src/utils/buildTraceSteps.js:608`

- [ ] **Step 1: Find stale copy.** Run:

  ```bash
  grep -rnE "Execute Call|Execute Policies|Execute Tool|Available Policies|Live / Simulated Console|Tool Invocation|Gateway & Filters|DEMO SIMULATION|Recent decisions|subtab=tester|History reel|Output tab" demo_api_ui/src | grep -v __tests__
  ```

  Rewrite each hit to the new labels. Point `?subtab=tester` at `/agent-gateway-inspector`.

- [ ] **Step 2: Learning Hub sync.** Find every Hub card, lesson and guide that links to the three routes:

  ```bash
  grep -rn "pingone-mcp-inspector\|/pingone-authorize\b\|agent-gateway-inspector" demo_api_ui/src/config demo_api_ui/src/learning
  ```

  Make each one's description match the new pages.

- [ ] **Step 3: Full suites.**
  - Run `cd demo_api_ui && npm test` and `cd demo_api_server && npm test`.
  - Expect no failures beyond those already on `main`. Record the before/after lists for the PR body.

- [ ] **Step 4: Live check** in the local stack (OrbStack; skip the Welcome wizard in a fresh browser). Signed in as the demo admin:
  1. On each page, send one call. The row appears and is selected.
  2. Open all five tabs. The Diagram's Simulate walks the arrows, a box drags, and Reset restores the layout.
  3. `document.body.innerText.includes('eyJ')` is false on every tab.
  4. Ask the AI agent "what accounts do I have?". The MCP page shows an `AI agent` row, and the gateway page shows the gateway's record.
  5. Compare two calls.
  6. At 400px, nothing scrolls sideways.
  7. Screenshot each page in light and dark mode.

- [ ] **Step 5: Commit, push, open the PR.** The body lists the "Known gaps" from Decisions and the test before/after. Hand the user the exact `gh pr merge` command; don't run it.
