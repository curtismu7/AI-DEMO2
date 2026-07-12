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
