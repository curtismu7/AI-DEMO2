'use strict';
const adapter = require('../../../services/mcpPingOneHttpAdapter');
const pingOneUserService = require('../../../services/pingOneUserService');
const { getMockResponse } = require('../../../services/oasDiscovery');

// Hosted-MCP tool names that have offline mock payloads in oasDiscovery.
// The labeled mock fallback only has data for these five. Every name here must
// also exist on the hosted server — a name that is real in neither place is a
// ghost the chip can never resolve (see tests/oas/pingone-admin.ghostTools.test.js).
const CORE_TOOLS = ['listUsers', 'getUser', 'listPopulations', 'listApplications', 'getEnvironment'];

// Same tools, reachable via the direct Management API with the same worker
// credentials the hosted MCP server itself authenticates with. Tried before
// the mock fallback on a transport/auth failure so "MCP unavailable" degrades
// to a real (if unlabeled-as-MCP) answer instead of canned data. Returns null
// when the call can't be resolved to a REST request (e.g. getUser with no id).
// PingOneUserService.baseUrl already ends in /environments/{envId}, so
// getEnvironment's path is the empty string.
const REST_FALLBACK = {
  listUsers: (args) => {
    const query = new URLSearchParams();
    if (args?.filter) query.set('filter', String(args.filter));
    if (args?.limit) query.set('limit', String(args.limit));
    const suffix = query.toString();
    return { method: 'GET', path: `/users${suffix ? `?${suffix}` : ''}` };
  },
  listApplications: () => ({ method: 'GET', path: '/applications' }),
  listPopulations:  () => ({ method: 'GET', path: '/populations' }),
  getEnvironment:   () => ({ method: 'GET', path: '' }),
  getUser: (args) => {
    const id = args?.id || args?.userId;
    if (id) return { method: 'GET', path: `/users/${encodeURIComponent(id)}` };
    if (args?.username) {
      const filter = encodeURIComponent('username eq "' + args.username + '"');
      return { method: 'GET', path: `/users?filter=${filter}` };
    }
    return null;
  },
};

const LIVE_SOURCE = 'live — hosted PingOne MCP';
const apiSource = (reason) => `api — hosted PingOne MCP unavailable, used direct Management API: ${reason}`;
const mockSource = (reason) => `mock — PingOne MCP unavailable: ${reason}`;
const mockAfterApiSource = (reason) => `mock — PingOne MCP and Management API both unavailable: ${reason}`;

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

// The hosted MCP and the direct Management API disagree on envelope shape:
// REST wraps collections in HAL (`_embedded.users`), the hosted MCP returns
// some of them bare (`{ applications: [...] }` — verified live 2026-08-10).
// Accept both so neither transport degrades to a JSON.stringify blob.
function collectionFor(tool, data) {
  const key = { listUsers: 'users', listApplications: 'applications', listPopulations: 'populations' }[tool];
  if (!key) return null;
  const arr = data?._embedded?.[key] ?? data?.[key];
  return Array.isArray(arr) ? arr : null;
}

// Compact object rows for the LLM (and anything else reading the tool
// result). Without these the model only ever saw "87 users found" and could
// not name a single user — a count is not an answer to "list the users
// starting with curt". Capped and field-trimmed: the admin LLM is llama.cpp
// with a frozen context budget, so the full PingOne records (which carry
// _links, lifecycle blocks, etc.) must never be forwarded verbatim.
const ROW_CAP = 20;
function rowsForResponse(tool, data) {
  try {
    const arr = collectionFor(tool, data);
    if (!arr) {
      if (tool === 'getUser' && data?.username) {
        return [{ username: data.username, email: data.email || undefined, enabled: data.enabled }];
      }
      if (tool === 'getEnvironment' && data?.name) {
        return [{ name: data.name, type: data.type, region: data.region, id: data.id }];
      }
      return null;
    }
    const rows = arr.slice(0, ROW_CAP).map((item) => {
      if (tool === 'listUsers') {
        return { username: item.username, email: item.email || undefined, enabled: item.enabled };
      }
      if (tool === 'listApplications') {
        return { name: item.name, type: item.type, enabled: item.enabled };
      }
      return { name: item.name, description: (item.description || '').slice(0, 80) || undefined };
    });
    return rows.length ? rows : null;
  } catch (_) {
    return null;
  }
}

function summaryForResponse(tool, data) {
  if (typeof data === 'string') return data.slice(0, 200);
  try {
    const arr = collectionFor(tool, data);
    if (arr) {
      const noun = { listUsers: 'users', listApplications: 'applications', listPopulations: 'populations' }[tool];
      return `${arr.length} ${noun} found`;
    }
    switch (tool) {
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
  // Pin environmentId to the configured environment. The hosted MCP tool
  // schemas REQUIRE it as an argument (listUsers et al fail -32602 without
  // it — verified live 2026-08-10), so dropping it outright broke every live
  // call and the RPC validation error masqueraded as a real answer. The
  // model still never needs to supply it (the system prompt says not to),
  // and a model-supplied value is discarded so a call can never be pointed
  // at another environment.
  const { environmentId: _ignoredEnvId, ...args } = params?.arguments || {};
  if (process.env.PINGONE_ENVIRONMENT_ID) {
    args.environmentId = process.env.PINGONE_ENVIRONMENT_ID;
  }
  try {
    const data = parseMcpResult(await adapter.callTool(name, args));
    return {
      result: {
        tool: name,
        responseSummary: summaryForResponse(name, data),
        rows: rowsForResponse(name, data) || undefined,
        source: LIVE_SOURCE,
      },
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
    const mockFallback = (source) => {
      console.warn('[pingone-admin] call_pingone_tool mock fallback for %s: %s', name, err.message);
      const summary = CORE_TOOLS.includes(name)
        ? summaryForResponse(name, getMockResponse(name, args))
        : `Tool unavailable: ${err.message}`;
      return { result: { tool: name, responseSummary: summary, source }, render: 'call_pingone_tool' };
    };

    const restReq = REST_FALLBACK[name]?.(args);
    if (restReq) {
      try {
        pingOneUserService.initialize();
        const data = await pingOneUserService.makeRequest(restReq.method, restReq.path);
        console.warn('[pingone-admin] call_pingone_tool API fallback for %s: %s', name, err.message);
        return {
          result: {
            tool: name,
            responseSummary: summaryForResponse(name, data),
            rows: rowsForResponse(name, data) || undefined,
            source: apiSource(err.message),
          },
          render: 'call_pingone_tool',
        };
      } catch (restErr) {
        console.warn('[pingone-admin] API fallback also failed for %s: %s', name, restErr.message);
        return mockFallback(mockAfterApiSource(err.message));
      }
    }

    return mockFallback(mockSource(err.message));
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
