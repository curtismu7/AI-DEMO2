# PingOne Admin Vertical — Live Hosted MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every subagent prompt MUST instruct the agent to check for and invoke applicable skills (notably `verify-ai-demo2` for running jest in this worktree and `regression-guard` before UI edits).

**Goal:** Replace the pingone-admin vertical's mock OAS executor with live calls to the hosted PingOne MCP server, with live tool discovery and a labeled mock fallback.

**Architecture:** The vertical plugin (`demo_api_server/config/verticals/pingone-admin/`) swaps its two tools for `list_pingone_tools` (live `tools/list`) and `call_pingone_tool` (direct `tools/call`) via the existing `mcpPingOneHttpAdapter` (worker client_credentials auth, process-lifetime tool cache). Chip heuristics map deterministically to real hosted tool names. Transport/auth failures fall back to the existing mock payloads, always labeled via a `source` field rendered in the UI.

**Tech Stack:** Node/CommonJS (BFF), Jest, Zod-validated vertical manifests, generated MCP tool catalog (`scripts/gen-vertical-tools.js`), React UI (Vite).

**Spec:** `docs/superpowers/specs/2026-07-11-pingone-admin-live-mcp-design.md`

## Global Constraints

- Work ONLY in worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp` on branch `feat/pingone-admin-live-mcp`. All paths below are relative to the worktree root.
- Do NOT modify: `demo_api_server/services/mcpPingOneHttpAdapter.js`, `demo_api_server/services/oasDiscovery.js`, `demo_api_server/config/oas/pingone-fragment.json`, `demo_api_server/services/mcpToolPipeline.js`, anything in `demo_api_ui/src/components/BankingChips.jsx`, or any other vertical.
- Do NOT change any `scopes` values — both new tools keep `scopes: ['read']` exactly as the old tools had (AI-DEMO2 rule: no OAuth/permission scope changes).
- Never hand-edit `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` — regenerate with `cd demo_api_server && npm run verticals:gen`.
- Source label strings, verbatim: `live — hosted PingOne MCP` and `` mock — PingOne MCP unavailable: <reason> ``.
- Emoji rule (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓` allowed in code/UI text; the em dash `—` in the source labels is punctuation and is fine.
- Stage files explicitly (`git add <file>`), never `git add -A`. Verify `git branch --show-current` prints `feat/pingone-admin-live-mcp` before each commit.
- Jest from this worktree (per `verify-ai-demo2` skill): the repo jest config ignores `.claude/worktrees/` paths, so ALWAYS pass `--testPathIgnorePatterns="/node_modules/"` on the CLI. A fresh worktree has no `node_modules` — run `npm install` in the service dir first (or symlink from the main checkout at `/Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules`).

---

### Task 1: Rewrite the vertical executor (`tools.js`)

**Files:**
- Modify: `demo_api_server/config/verticals/pingone-admin/tools.js` (full rewrite)
- Test: `demo_api_server/tests/oas/pingone-admin.test.js` (full rewrite)

**Interfaces:**
- Consumes: `mcpPingOneHttpAdapter.listTools(): Promise<Array<{name, description, inputSchema}>>` and `.callTool(name, args): Promise<{content:[{type:'text',text}]}>` (throws `Error` with `err.code` of `'pingone_mcp_http_error'` or `'pingone_mcp_rpc_error'`); `oasDiscovery.getMockResponse(name, params)` for the five core names.
- Produces: `tools` array with tool defs named `list_pingone_tools` and `call_pingone_tool` (plus unchanged `api_key_demo`/`dual_token_demo`); `execute(name, params, ctx)` returning `{ result, render }` with render keys `list_pingone_tools` / `call_pingone_tool`. Task 2's heuristics and Task 3's manifest reference exactly these names.

- [ ] **Step 1: Install deps in the worktree (one-time setup)**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp/demo_api_server
[ -d node_modules ] || ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_server/node_modules node_modules
node -e "require('jest/package.json'); console.log('jest OK')"
```

Expected: `jest OK`. If the symlink target doesn't exist, run `npm install` instead.

- [ ] **Step 2: Write the failing test — replace `demo_api_server/tests/oas/pingone-admin.test.js` with:**

```js
'use strict';

jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const plugin = require('../../config/verticals/pingone-admin/index');

const mcpJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const httpErr = (msg) => Object.assign(new Error(msg), { code: 'pingone_mcp_http_error' });

beforeEach(() => jest.clearAllMocks());

test('plugin exports required interface', () => {
  expect(typeof plugin.getManifest).toBe('function');
  expect(typeof plugin.getTools).toBe('function');
  expect(typeof plugin.getHeuristics).toBe('function');
  expect(typeof plugin.getSystemPrompt).toBe('function');
  expect(typeof plugin.executeTool).toBe('function');
  expect(typeof plugin.getAuthz).toBe('function');
});

test('getTools returns list_pingone_tools and call_pingone_tool with read scope', () => {
  const tools = plugin.getTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain('list_pingone_tools');
  expect(names).toContain('call_pingone_tool');
  expect(names).not.toContain('discover_oas_operations');
  expect(names).not.toContain('call_pingone_operation');
  tools.forEach((t) => expect(t.scopes).toEqual(['read']));
});

test('list_pingone_tools returns live tool list with source: live', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'listUsers', description: 'List users in the environment' },
    { name: 'createGroup', description: 'Create a group' },
  ]);
  const { result, render } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(render).toBe('list_pingone_tools');
  expect(result.tools).toEqual([
    { name: 'listUsers', description: 'List users in the environment' },
    { name: 'createGroup', description: 'Create a group' },
  ]);
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('list_pingone_tools filter matches name or description', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'listUsers', description: 'List users' },
    { name: 'getEnvironment', description: 'Environment details' },
  ]);
  const { result } = await plugin.executeTool('list_pingone_tools', { filter: 'user' }, {});
  expect(result.tools).toHaveLength(1);
  expect(result.tools[0].name).toBe('listUsers');
});

test('list_pingone_tools falls back to labeled core list on adapter failure', async () => {
  adapter.listTools.mockRejectedValue(httpErr('PingOne MCP HTTP 401'));
  const { result, render } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(render).toBe('list_pingone_tools');
  expect(result.tools.map((t) => t.name)).toEqual(
    ['listUsers', 'getUser', 'createUser', 'listApplications', 'getEnvironment']
  );
  expect(result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 401');
});

test('call_pingone_tool listUsers parses MCP envelope and summarizes live data', async () => {
  adapter.callTool.mockResolvedValue(mcpJson({ _embedded: { users: [{ id: 'u1' }, { id: 'u2' }] } }));
  const { result, render } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(render).toBe('call_pingone_tool');
  expect(adapter.callTool).toHaveBeenCalledWith('listUsers', {});
  expect(result.tool).toBe('listUsers');
  expect(result.responseSummary).toBe('2 users found');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool tolerates non-JSON text content', async () => {
  adapter.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'plain status message' }] });
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'getEnvironment' }, {});
  expect(result.responseSummary).toContain('plain status message');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool falls back to labeled mock for known tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('connect ECONNREFUSED'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(result.responseSummary).toBe('3 users found'); // oasDiscovery mock has 3 users
  expect(result.source).toBe('mock — PingOne MCP unavailable: connect ECONNREFUSED');
});

test('call_pingone_tool returns labeled unavailable for unknown tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('PingOne MCP HTTP 503'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listGroups' }, {});
  expect(result.responseSummary).toMatch(/unavailable/i);
  expect(result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 503');
});

test('call_pingone_tool renders a JSON-RPC (validation) error as a live response', async () => {
  const rpcErr = Object.assign(new Error('INVALID_DATA: username required'), { code: 'pingone_mcp_rpc_error' });
  adapter.callTool.mockRejectedValue(rpcErr);
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'createUser', arguments: { username: 'x' } }, {});
  expect(result.responseSummary).toContain('INVALID_DATA');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool createUser fills defaults and resolves default population when required', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'createUser', description: '', inputSchema: { type: 'object', required: ['username', 'populationId'] } },
  ]);
  adapter.callTool.mockImplementation((name) => {
    if (name === 'listPopulations') {
      return Promise.resolve(mcpJson({ _embedded: { populations: [{ id: 'pop-1', default: true }] } }));
    }
    return Promise.resolve(mcpJson({ id: 'u-9', username: 'demo.user.123456' }));
  });
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'createUser' }, {});
  const createCall = adapter.callTool.mock.calls.find(([n]) => n === 'createUser');
  expect(createCall[1].username).toMatch(/^demo\.user\.\d+$/);
  expect(createCall[1].email).toMatch(/^demo\.user\.\d+@example\.com$/);
  expect(createCall[1].populationId).toBe('pop-1');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool without name returns error', async () => {
  const { result } = await plugin.executeTool('call_pingone_tool', {}, {});
  expect(result.error).toMatch(/name/i);
});

test('unknown vertical tool name returns error', async () => {
  const { result } = await plugin.executeTool('unknown_tool', {}, {});
  expect(result.error).toBeDefined();
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp/demo_api_server
npx jest tests/oas/pingone-admin.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: FAIL (old tool names still exported; `list_pingone_tools` unknown).

- [ ] **Step 4: Replace `demo_api_server/config/verticals/pingone-admin/tools.js` with:**

```js
'use strict';
const adapter = require('../../../services/mcpPingOneHttpAdapter');
const { getMockResponse } = require('../../../services/oasDiscovery');

// Hosted-MCP tool names that have offline mock payloads in oasDiscovery.
// The labeled mock fallback only has data for these five.
const CORE_TOOLS = ['listUsers', 'getUser', 'createUser', 'listApplications', 'getEnvironment'];

const LIVE_SOURCE = 'live — hosted PingOne MCP';
const mockSource = (reason) => `mock — PingOne MCP unavailable: ${reason}`;

const tools = [
  {
    name: 'list_pingone_tools',
    description: 'List the tools exposed by the hosted PingOne MCP server. The visible set is gated by the worker app\'s admin roles in PingOne.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional: filter by tool name or description fragment (e.g. "user")' },
      },
    },
    scopes: ['read'],
    authz: {},
  },
  {
    name: 'call_pingone_tool',
    description: 'Call a hosted PingOne MCP tool by name (e.g. listUsers, createUser, listApplications, getEnvironment) with camelCase arguments.',
    inputSchema: {
      type: 'object',
      properties: {
        name:      { type: 'string', description: 'Hosted MCP tool name (see list_pingone_tools)' },
        arguments: { type: 'object', description: 'Tool arguments as key-value pairs' },
      },
      required: ['name'],
    },
    scopes: ['read'],
    authz: {},
  },
  { name: 'api_key_demo',    description: 'Demo API-key path.',             inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
];

// MCP tools/call results arrive as { content: [{ type:'text', text }] } where
// text is usually JSON; tolerate plain objects and non-JSON text.
function parseMcpResult(raw) {
  if (raw && Array.isArray(raw.content)) {
    const text = raw.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('');
    try { return JSON.parse(text); } catch (_) { return text; }
  }
  return raw;
}

function summaryForResponse(tool, data) {
  if (typeof data === 'string') return data.slice(0, 200);
  try {
    switch (tool) {
      case 'listUsers':
        if (Array.isArray(data?._embedded?.users)) return `${data._embedded.users.length} users found`;
        break;
      case 'listApplications':
        if (Array.isArray(data?._embedded?.applications)) return `${data._embedded.applications.length} applications found`;
        break;
      case 'createUser':
        if (data?.username) return `User ${data.username} created (id: ${data.id})`;
        break;
      case 'getUser':
        if (data?.username) return `User: ${data.username}${data.email ? ` (${data.email})` : ''}`;
        break;
      case 'getEnvironment':
        if (data?.name) return `${data.name} — ${data.type}, region ${data.region}`;
        break;
    }
    return JSON.stringify(data).slice(0, 200);
  } catch (_) {
    return String(data).slice(0, 200);
  }
}

let _defaultPopulationId = null;
async function resolveDefaultPopulationId() {
  if (_defaultPopulationId) return _defaultPopulationId;
  const data = parseMcpResult(await adapter.callTool('listPopulations', {}));
  const pops = data?._embedded?.populations || [];
  const def = pops.find((p) => p.default) || pops[0];
  if (def) _defaultPopulationId = def.id;
  return _defaultPopulationId;
}

// Fill demo-safe defaults for a real createUser write. populationId is only
// resolved when the live inputSchema marks it required.
async function withCreateUserDefaults(args) {
  const out = { ...(args || {}) };
  if (!out.username) {
    const suffix = String(Date.now()).slice(-6);
    out.username = `demo.user.${suffix}`;
    if (!out.email) out.email = `demo.user.${suffix}@example.com`;
  } else if (!out.email) {
    out.email = `${out.username}@example.com`;
  }
  if (!out.populationId) {
    try {
      const live = await adapter.listTools();
      const def = live.find((t) => t.name === 'createUser');
      const required = Array.isArray(def?.inputSchema?.required) ? def.inputSchema.required : [];
      if (required.includes('populationId')) {
        const popId = await resolveDefaultPopulationId();
        if (popId) out.populationId = popId;
      }
    } catch (_) { /* schema lookup is best-effort; the live call surfaces any gap */ }
  }
  return out;
}

async function listPingOneTools(params) {
  const filter = params?.filter ? String(params.filter).toLowerCase() : null;
  try {
    const live = await adapter.listTools();
    let rows = live.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 200) }));
    if (filter) {
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(filter) || r.description.toLowerCase().includes(filter));
    }
    return { result: { tools: rows, source: LIVE_SOURCE }, render: 'list_pingone_tools' };
  } catch (err) {
    console.warn('[pingone-admin] list_pingone_tools mock fallback:', err.message);
    return {
      result: {
        tools: CORE_TOOLS.map((n) => ({ name: n, description: '(offline core tool — mock data)' })),
        source: mockSource(err.message),
      },
      render: 'list_pingone_tools',
    };
  }
}

async function callPingOneTool(params) {
  const name = params?.name;
  if (!name) {
    return { result: { error: 'name is required. Call list_pingone_tools to see valid tool names.' }, render: 'text' };
  }
  let args = params?.arguments || {};
  try {
    if (name === 'createUser') args = await withCreateUserDefaults(args);
    const data = parseMcpResult(await adapter.callTool(name, args));
    return {
      result: { tool: name, responseSummary: summaryForResponse(name, data), source: LIVE_SOURCE },
      render: 'call_pingone_tool',
    };
  } catch (err) {
    // A JSON-RPC error is PingOne answering (e.g. validation) — render it as
    // the real response. Only transport/auth failures trigger the mock fallback.
    if (err.code === 'pingone_mcp_rpc_error') {
      return {
        result: { tool: name, responseSummary: `PingOne error: ${err.message}`, source: LIVE_SOURCE },
        render: 'call_pingone_tool',
      };
    }
    console.warn('[pingone-admin] call_pingone_tool mock fallback for %s: %s', name, err.message);
    const summary = CORE_TOOLS.includes(name)
      ? summaryForResponse(name, getMockResponse(name, args))
      : `Tool unavailable: ${err.message}`;
    return {
      result: { tool: name, responseSummary: summary, source: mockSource(err.message) },
      render: 'call_pingone_tool',
    };
  }
}

async function execute(name, params, _ctx) {
  switch (name) {
    case 'list_pingone_tools': return listPingOneTools(params);
    case 'call_pingone_tool':  return callPingOneTool(params);
    case 'api_key_demo':
    case 'dual_token_demo':
      return { result: { message: `${name} is not available in this vertical` }, render: 'text' };
    default:
      return { result: { error: `unknown tool: ${name}` }, render: 'text' };
  }
}

module.exports = { tools, execute };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest tests/oas/pingone-admin.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: PASS (all tests). Note: `plugin.getHeuristics` still returns old action names — heuristics tests move to Task 2; this file no longer asserts them.

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
git branch --show-current   # must print feat/pingone-admin-live-mcp
git add demo_api_server/config/verticals/pingone-admin/tools.js demo_api_server/tests/oas/pingone-admin.test.js
git commit -m "feat(pingone-admin): live hosted-MCP executor with labeled mock fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Heuristics + system prompt (`index.js`)

**Files:**
- Modify: `demo_api_server/config/verticals/pingone-admin/index.js`
- Modify: `demo_api_server/tests/adminChipDeadends.test.js` (pingone-admin expectations only)
- Test: `demo_api_server/tests/oas/pingone-admin.test.js` (append heuristics tests)

**Interfaces:**
- Consumes: tool names `list_pingone_tools` / `call_pingone_tool` from Task 1.
- Produces: `getHeuristics()` entries whose `action` is one of those names, with `defaultParams: { name: '<hostedTool>' }` (the NL parser spreads `defaultParams` into parsed params). Task 3's chip messages must match these regexes.

- [ ] **Step 1: Append failing heuristics tests to `demo_api_server/tests/oas/pingone-admin.test.js`:**

```js
describe('heuristics resolve chip phrasing to live tools', () => {
  const resolve = (msg) => plugin.getHeuristics().find((h) => h.re.test(msg));

  test('discovery phrasing maps to list_pingone_tools', () => {
    const h = resolve('Show me the tools available from the PingOne MCP server');
    expect(h.action).toBe('list_pingone_tools');
  });

  test('old OAS demo page phrasing still resolves to discovery', () => {
    const h = resolve('Show me all available PingOne API operations from the OpenAPI spec');
    expect(h.action).toBe('list_pingone_tools');
  });

  test('list users maps to call_pingone_tool listUsers', () => {
    const h = resolve('List the users in my PingOne environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'listUsers' });
  });

  test('create user maps to call_pingone_tool createUser', () => {
    const h = resolve('Create a demo user in my environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'createUser' });
  });

  test('list applications maps to call_pingone_tool listApplications', () => {
    const h = resolve('List the applications registered in my environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'listApplications' });
  });

  test('get environment maps to call_pingone_tool getEnvironment', () => {
    const h = resolve('Get the details of my PingOne environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'getEnvironment' });
  });
});
```

Ordering matters: `resolve` takes the FIRST matching heuristic, mirroring the parser. "List the users…" must not be swallowed by the discovery regex.

- [ ] **Step 2: Run to verify the new tests fail**

```bash
npx jest tests/oas/pingone-admin.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: FAIL — heuristics still name `discover_oas_operations` / `call_pingone_operation`.

- [ ] **Step 3: Update `demo_api_server/config/verticals/pingone-admin/index.js`**

Replace the `HEURISTICS` array and `getSystemPrompt` with:

```js
// Each call_pingone_tool heuristic pins the hosted MCP tool name it resolves to,
// so a chip's phrasing ("List Users", "Create User", …) maps deterministically to
// the right tool. The parser injects h.defaultParams into the parsed params,
// satisfying the tool's required `name` without asking the user to name the tool.
// Order matters: specific data heuristics come before the broad discovery regex.
const HEURISTICS = [
  { re: /\blist\b.*\busers?\b|\bshow\s+users?\b|\bhow many\b.*\b(users?|identit)/i, action: 'call_pingone_tool', defaultParams: { name: 'listUsers' } },
  { re: /\bcreate\b.*\buser\b|\badd\b.*\buser\b/i,                                  action: 'call_pingone_tool', defaultParams: { name: 'createUser' } },
  { re: /\blist\b.*\bapp|\bshow\b.*\bapp/i,                                          action: 'call_pingone_tool', defaultParams: { name: 'listApplications' } },
  { re: /\b(get|show|view)\b.*\benvironment\b/i,                                     action: 'call_pingone_tool', defaultParams: { name: 'getEnvironment' } },
  { re: /\b(discover|explore|show|list|what|which)\b.*\b(tools?|apis?|operat|capabilit|can you do)/i, action: 'list_pingone_tools' },
];
```

```js
function getSystemPrompt(_ctx) {
  return [
    'You are a PingOne Admin Assistant connected to the hosted PingOne MCP server.',
    'When asked what you can do, ALWAYS call list_pingone_tools first — the visible tool set is gated by the worker application\'s admin roles in PingOne.',
    'Call tools with call_pingone_tool using the exact tool name and camelCase arguments from the live tool list.',
    'Every result carries a source field: state whether the answer came from the live server or from labeled mock fallback data.',
    'This demo shows an AI agent whose capabilities are governed by the identity it runs as, not by hardcoded features.',
  ].join(' ');
}
```

Leave `getManifest`, `getTools`, `getAuthz`, `getDataStore`, `executeTool`, and `module.exports` unchanged.

- [ ] **Step 4: Update the two pingone-admin expectations in `demo_api_server/tests/adminChipDeadends.test.js`**

Change only the expected action names (messages stay):

```js
  test('pingone-admin "List Users" chip message resolves to call_pingone_tool', () => {
    const r = parseHeuristic('List the users in my PingOne environment', 'pingone-admin', {});
    expect(actionOf(r)).toBe('call_pingone_tool');
  });

  test('pingone-admin still resolves "List the applications"', () => {
    const r = parseHeuristic('List the applications', 'pingone-admin', {});
    expect(actionOf(r)).toBe('call_pingone_tool');
  });
```

- [ ] **Step 5: Run both test files — verify pass**

```bash
npx jest tests/oas/pingone-admin.test.js tests/adminChipDeadends.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
git add demo_api_server/config/verticals/pingone-admin/index.js demo_api_server/tests/oas/pingone-admin.test.js demo_api_server/tests/adminChipDeadends.test.js
git commit -m "feat(pingone-admin): heuristics and system prompt target live hosted-MCP tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Manifest (chips, renders, story) + dispatch test

**Files:**
- Modify: `demo_api_server/config/verticals/pingone-admin/manifest.json`
- Modify: `demo_api_server/tests/oas/verticalDispatch.oas.test.js` (full rewrite)

**Interfaces:**
- Consumes: tool/render names from Task 1; heuristic phrasing from Task 2 (chip messages MUST match those regexes).
- Produces: render entries `list_pingone_tools` (table) and `call_pingone_tool` (fieldList with Source row). The UI's `VerticalResult.jsx` renders tables from the first array value in `result` (`result.tools`) and fieldList rows by `path` lookup — no UI changes needed.

- [ ] **Step 1: Rewrite the failing dispatch test — replace `demo_api_server/tests/oas/verticalDispatch.oas.test.js` with:**

```js
'use strict';
/**
 * Integration smoke: exercises full BFF dispatch without an HTTP server.
 * Chain: verticalDispatch → pingone-admin plugin → mcpPingOneHttpAdapter (mocked)
 */
jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const { verticalManifest } = require('../../services/verticalManifest');
const verticalDispatch = require('../../services/verticalDispatch');

const mcpJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

beforeAll(() => { verticalManifest.init(); });
beforeEach(() => jest.clearAllMocks());

describe('pingone-admin vertical dispatch', () => {
  test('list_pingone_tools returns live tools via verticalDispatch', async () => {
    adapter.listTools.mockResolvedValue([{ name: 'listUsers', description: 'List users' }]);
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'list_pingone_tools', {}, { userId: 'test-user' }
    );
    expect(result.render).toBe('list_pingone_tools');
    expect(result.result.tools).toEqual([{ name: 'listUsers', description: 'List users' }]);
    expect(result.result.source).toBe('live — hosted PingOne MCP');
  });

  test('call_pingone_tool listUsers dispatches to the adapter', async () => {
    adapter.callTool.mockResolvedValue(mcpJson({ _embedded: { users: [{ id: 'u1' }] } }));
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'call_pingone_tool', { name: 'listUsers' }, { userId: 'test-user' }
    );
    expect(result.render).toBe('call_pingone_tool');
    expect(result.result.tool).toBe('listUsers');
    expect(result.result.responseSummary).toBe('1 users found');
    expect(result.result.source).toBe('live — hosted PingOne MCP');
  });

  test('adapter failure surfaces labeled mock fallback through dispatch', async () => {
    adapter.callTool.mockRejectedValue(
      Object.assign(new Error('PingOne MCP HTTP 401'), { code: 'pingone_mcp_http_error' })
    );
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'call_pingone_tool', { name: 'listUsers' }, { userId: 'test-user' }
    );
    expect(result.result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 401');
  });

  test('new tool names are recognized as plugin tools', () => {
    expect(verticalDispatch.isPluginToolName('list_pingone_tools')).toBe(true);
    expect(verticalDispatch.isPluginToolName('call_pingone_tool')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/oas/verticalDispatch.oas.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: The two dispatch-execution tests PASS already (plugin was rewritten in Task 1) but the manifest still advertises old chips/renders — proceed regardless; this step exists to catch manifest-load regressions after Step 3.

- [ ] **Step 3: Update `demo_api_server/config/verticals/pingone-admin/manifest.json`**

Replace the `identity.tagline`, `agent`, `dashboard`, and `render` sections (keep `id`, `schemaVersion`, `theme`, `terminology`, `scopes`, and the rest of `identity` byte-identical):

```json
  "identity": {
    "displayName": "PingOne Admin",
    "headerTitle": "PingOne Admin",
    "documentTitle": "PingOne Admin · AI IAM Core",
    "logoAlt": "PingOne Admin logo",
    "tagline": "Live PingOne Administration via Hosted MCP",
    "logoPath": "/branding/ping-logo.svg"
  },
```

```json
  "agent": {
    "persona": "PingOne Admin Assistant",
    "greeting": "Hi {name}! I'm connected to the hosted PingOne MCP server. I can list the tools my worker identity is allowed to use and call them for real answers about your environment. Try: 'Show me the tools' or 'List users in my environment'.",
    "systemPromptFlavor": "You are a PingOne Admin Assistant connected to the hosted PingOne MCP server. When asked what you can do, ALWAYS call list_pingone_tools first — the visible tool set is gated by the worker application's admin roles in PingOne. Call tools with call_pingone_tool using the exact tool name and camelCase arguments. Every result carries a source field: state whether the answer came from the live server or from labeled mock fallback data. This demo shows an AI agent whose capabilities are governed by the identity it runs as."
  },
```

```json
  "dashboard": {
    "kind": "standard",
    "chips": [
      { "key": "pa1", "label": "List Tools" },
      { "key": "pa2", "label": "List Users" },
      { "key": "pa3", "label": "List Apps" },
      { "key": "pa4", "label": "Create User" },
      { "key": "pa5", "label": "Get Environment" }
    ],
    "chips10": [
      { "id": "pa1", "label": "List Tools",      "message": "Show me the tools available from the PingOne MCP server", "tool": "list_pingone_tools", "mode": "both" },
      { "id": "pa2", "label": "List Users",      "message": "List the users in my PingOne environment",                "tool": "call_pingone_tool",  "mode": "both" },
      { "id": "pa3", "label": "List Apps",       "message": "List the applications registered in my environment",      "tool": "call_pingone_tool",  "mode": "both" },
      { "id": "pa4", "label": "Create User",     "message": "Create a demo user in my environment",                    "tool": "call_pingone_tool",  "mode": "both" },
      { "id": "pa5", "label": "Get Environment", "message": "Get the details of my PingOne environment",               "tool": "call_pingone_tool",  "mode": "both" }
    ]
  },
```

```json
  "render": {
    "list_pingone_tools": {
      "type": "table",
      "columns": [
        { "label": "Tool",        "path": "name" },
        { "label": "Description", "path": "description" }
      ]
    },
    "call_pingone_tool": {
      "type": "fieldList",
      "title": "PingOne MCP Result",
      "fields": [
        { "label": "Tool",     "path": "tool" },
        { "label": "Response", "path": "responseSummary" },
        { "label": "Source",   "path": "source" }
      ]
    }
  },
```

- [ ] **Step 4: Run the dispatch + plugin tests — verify pass**

```bash
npx jest tests/oas/ tests/adminChipDeadends.test.js --testPathIgnorePatterns="/node_modules/"
```

Expected: PASS (manifest schema validation runs inside `verticalManifest.init()` — a Zod error here means a typo in Step 3).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
git add demo_api_server/config/verticals/pingone-admin/manifest.json demo_api_server/tests/oas/verticalDispatch.oas.test.js
git commit -m "feat(pingone-admin): manifest chips, renders, and story for live MCP with Source row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Regenerate the vertical tool catalog

**Files:**
- Regenerate (never hand-edit): `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts`, plus whatever else `verticals:gen` touches (scope-topology / feature-data files — stage exactly what `git status` shows changed).

**Interfaces:**
- Consumes: `tools` export from Task 1 (the generator reads each vertical plugin's `tools.js`).
- Produces: MCP-server catalog entries `{"name":"list_pingone_tools",...,"vertical":"pingone-admin"}` and `{"name":"call_pingone_tool",...}` replacing the old two.

- [ ] **Step 1: Regenerate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp/demo_api_server
npm run verticals:gen
```

Expected: `[OK] ... tools registered ...` lines from each generator; no `[FAIL]`.

- [ ] **Step 2: Verify the rename landed and nothing else drifted**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
grep -c "call_pingone_operation\|discover_oas_operations" demo_mcp_server/src/tools/handlers/verticalTools.generated.ts; grep -c "call_pingone_tool" demo_mcp_server/src/tools/handlers/verticalTools.generated.ts
git status --short
```

Expected: first grep prints `0`, second prints `1` or more. `git status` shows only generated files.

- [ ] **Step 3: Run topology verification and the MCP server's tests**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
npm run topology:verify
cd demo_mcp_server && ([ -d node_modules ] || ln -s /Users/cmuir/Development/AI-DEMO2/demo_mcp_server/node_modules node_modules) && npx jest --testPathIgnorePatterns="/node_modules/"
```

Expected: topology verify OK; MCP server suite PASS. (If root `node_modules` is missing for topology scripts, symlink it from the main checkout the same way.)

- [ ] **Step 4: Commit (stage exactly the files git status showed)**

```bash
git add demo_mcp_server/src/tools/handlers/verticalTools.generated.ts <other-generated-files-from-git-status>
git commit -m "chore(pingone-admin): regenerate vertical tool catalog for renamed live-MCP tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: OAS Demo page launch message (UI)

**Files:**
- Modify: `demo_api_ui/src/components/OASDemoPage.jsx` (one string, line ~175)

**Interfaces:**
- Consumes: the discovery heuristic from Task 2 (the new message must match `/(discover|explore|show|list|what|which).*(tools?|apis?|operat|capabilit|can you do)/i`).

Invoke the repo's `regression-guard` skill before editing (this is a `demo_api_ui` file). Change is copy-only; no layout, style, or logic edits.

- [ ] **Step 1: Edit the launch handler message**

In `handleLaunchAgent`, replace:

```js
navigate('/?vertical=pingone-admin&msg=' + encodeURIComponent('Show me all available PingOne API operations from the OpenAPI spec'));
```

with:

```js
navigate('/?vertical=pingone-admin&msg=' + encodeURIComponent('Show me the tools available from the PingOne MCP server'));
```

- [ ] **Step 2: UI build gate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp/demo_api_ui
[ -d node_modules ] || ln -s /Users/cmuir/Development/AI-DEMO2/demo_api_ui/node_modules node_modules
npm run build
```

Expected: build succeeds with no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
git add demo_api_ui/src/components/OASDemoPage.jsx
git commit -m "feat(pingone-admin): OAS demo launch message targets live MCP tool discovery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full regression run

**Files:** none (verification only).

- [ ] **Step 1: Full api-server suite from the worktree**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp/demo_api_server
npx jest --forceExit --testPathIgnorePatterns="/node_modules/"
```

Expected: PASS. If unrelated suites fail, compare against the same command in the main checkout to confirm they were already failing before this branch (report, don't fix — out of scope).

- [ ] **Step 2: Grep for stragglers**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/pingone-admin-live-mcp
grep -rn "discover_oas_operations\|call_pingone_operation" demo_api_server demo_api_ui/src demo_mcp_server/src --include="*.js" --include="*.jsx" --include="*.ts" --include="*.json" | grep -v node_modules
```

Expected: no hits outside historical docs/spec files. Any code hit is a missed rename — fix it and re-run Step 1.

**Manual verification (needs running stack + worker creds — report as follow-up for Curtis, do not attempt in CI):** start the stack, open `/?vertical=pingone-admin`, click each chip; expect real environment data with `Source: live — hosted PingOne MCP`; remove worker creds and confirm chips answer with `Source: mock — PingOne MCP unavailable: …`.

---

## Self-Review Notes

- Spec coverage: tool rename + live execution (Task 1), createUser defaults + population resolution (Task 1), rpc-error-renders-as-live (Task 1), heuristics/story (Task 2), manifest chips/renders/Source row (Task 3), generated catalog + nlIntentParser (Task 4 — parser consumes `getHeuristics()` generically, no direct edit needed; covered by adminChipDeadends test in Task 2), OASDemoPage link (Task 5), unit + manual criteria (Tasks 1–3, 6).
- `oasDiscovery.js` / `pingone-fragment.json` intentionally untouched (fallback data source; other consumers exist — e.g. OASDemoPage's operation table still teaches OAS on its own page).
- Type consistency: result fields are `{ tool, responseSummary, source }` and `{ tools: [{name, description}], source }` everywhere (Tasks 1, 3); heuristic `defaultParams: { name }` matches `call_pingone_tool`'s required `name` input (Tasks 1, 2).
