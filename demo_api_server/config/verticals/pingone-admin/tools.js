'use strict';
const adapter = require('../../../services/mcpPingOneHttpAdapter');
const pingOneUserService = require('../../../services/pingOneUserService');
const configStore = require('../../../services/configStore');
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

function _trimWildcard(value) {
  return String(value || '').trim().replace(/[*%]+$/, '');
}

function normalizeListUsersArgs(args = {}) {
  const normalized = {};
  const rawLimit = Number(args?.limit);
  if (Number.isFinite(rawLimit) && rawLimit > 0) {
    normalized.limit = Math.min(100, Math.floor(rawLimit));
  }

  const rawFilter = typeof args?.filter === 'string' ? args.filter.trim() : '';
  const prefix =
    typeof args?.usernamePrefix === 'string' ? args.usernamePrefix
      : typeof args?.prefix === 'string' ? args.prefix
        : typeof args?.startsWith === 'string' ? args.startsWith
          : typeof args?.usernameStartsWith === 'string' ? args.usernameStartsWith
            : typeof args?.query === 'string' ? args.query
              : '';
  const exactUsername = typeof args?.username === 'string' ? args.username.trim() : '';

  if (rawFilter) {
    normalized.filter = rawFilter;
    if (!/\b(sw|eq|co|ne|lt|gt|le|ge)\b/i.test(rawFilter)) {
      const wildcardMatch = rawFilter.match(/^(.+?)[*%]$/);
      if (wildcardMatch) {
        normalized.filter = `username sw "${_trimWildcard(wildcardMatch[1])}"`;
      }
    }
  } else if (prefix) {
    const trimmed = _trimWildcard(prefix);
    if (trimmed) normalized.filter = `username sw "${trimmed}"`;
  } else if (exactUsername) {
    normalized.filter = `username eq "${exactUsername}"`;
  }

  return normalized;
}

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
        if (Array.isArray(data?.users)) return `${data.users.length} users found`;
        if (typeof data?.count === 'number') return `${data.count} users found`;
        break;
      case 'listApplications':
        if (Array.isArray(data?._embedded?.applications)) return `${data._embedded.applications.length} applications found`;
        break;
      case 'listPopulations':
        if (Array.isArray(data?._embedded?.populations)) return `${data._embedded.populations.length} populations found`;
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

function buildDebugSummary({ backend, transport, tool, args = {}, reason = null }) {
  const parts = [`backend=${backend}`, `transport=${transport}`, `tool=${tool}`];
  if (args.environmentId) parts.push(`environmentId=${args.environmentId}`);
  if (args.filter) parts.push(`filter=${args.filter}`);
  if (args.limit != null) parts.push(`limit=${args.limit}`);
  if (reason) parts.push(`reason=${reason}`);
  return parts.join(' · ');
}

function enrichToolArgs(tool, args = {}) {
  const normalized = { ...(args || {}) };
  const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (envId && !Object.prototype.hasOwnProperty.call(normalized, 'environmentId')) {
    normalized.environmentId = envId;
  }
  return normalized;
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
  const rawArgs = params?.arguments || {};
  const args = name === 'listUsers' ? normalizeListUsersArgs(rawArgs) : rawArgs;
  const liveArgs = enrichToolArgs(name, args);
  try {
    console.info('[pingone-admin] call_pingone_tool live request', { name, args: liveArgs });
    const data = parseMcpResult(await adapter.callTool(name, liveArgs));
    return {
      result: {
        tool: name,
        responseSummary: summaryForResponse(name, data),
        source: LIVE_SOURCE,
        debug: {
          backend: 'hosted-mcp',
          transport: 'live',
          tool: name,
          args: liveArgs,
          summary: buildDebugSummary({ backend: 'hosted-mcp', transport: 'live', tool: name, args: liveArgs }),
        },
      },
      render: 'call_pingone_tool',
    };
  } catch (err) {
    // A JSON-RPC error is PingOne answering (e.g. validation) — render it as
    // the real response. Only transport/auth failures trigger the mock fallback.
    if (err.code === 'pingone_mcp_rpc_error') {
      console.warn('[pingone-admin] call_pingone_tool live RPC error for %s: %s', name, err.message);
      return {
        result: {
          tool: name,
          responseSummary: `PingOne error: ${err.message}`,
          source: LIVE_SOURCE,
          debug: {
            backend: 'hosted-mcp',
            transport: 'rpc-error',
            tool: name,
            args: liveArgs,
            reason: err.message,
            summary: buildDebugSummary({
              backend: 'hosted-mcp',
              transport: 'rpc-error',
              tool: name,
              args: liveArgs,
              reason: err.message,
            }),
          },
        },
        render: 'call_pingone_tool',
      };
    }
    const mockFallback = (source) => {
      console.warn('[pingone-admin] call_pingone_tool mock fallback for %s: %s', name, err.message);
      const summary = CORE_TOOLS.includes(name)
        ? summaryForResponse(name, getMockResponse(name, args))
        : `Tool unavailable: ${err.message}`;
      return {
        result: {
          tool: name,
          responseSummary: summary,
          source,
          debug: {
            backend: 'mock',
            transport: 'mock',
            tool: name,
            args: liveArgs,
            reason: err.message,
            summary: buildDebugSummary({ backend: 'mock', transport: 'mock', tool: name, args: liveArgs, reason: err.message }),
          },
        },
        render: 'call_pingone_tool',
      };
    };

    const restReq = REST_FALLBACK[name]?.(liveArgs);
    if (name === 'listUsers' && Object.keys(liveArgs).length > 0) {
      try {
        pingOneUserService.initialize();
        const data = await pingOneUserService.listUsers(liveArgs);
        console.warn('[pingone-admin] call_pingone_tool API fallback for %s: %s', name, err.message);
        return {
          result: {
            tool: name,
            responseSummary: summaryForResponse(name, data),
            source: apiSource(err.message),
            debug: {
              backend: 'management-api',
              transport: 'fallback',
              tool: name,
              args: liveArgs,
              reason: err.message,
              summary: buildDebugSummary({
                backend: 'management-api',
                transport: 'fallback',
                tool: name,
                args: liveArgs,
                reason: err.message,
              }),
            },
          },
          render: 'call_pingone_tool',
        };
      } catch (restErr) {
        console.warn('[pingone-admin] API fallback also failed for %s: %s', name, restErr.message);
        return mockFallback(mockAfterApiSource(err.message));
      }
    }

    if (restReq) {
      try {
        pingOneUserService.initialize();
        const data = await pingOneUserService.makeRequest(restReq.method, restReq.path);
        console.warn('[pingone-admin] call_pingone_tool API fallback for %s: %s', name, err.message);
        return {
          result: {
            tool: name,
            responseSummary: summaryForResponse(name, data),
            source: apiSource(err.message),
            debug: {
              backend: 'management-api',
              transport: 'fallback',
              tool: name,
              args: liveArgs,
              reason: err.message,
              summary: buildDebugSummary({
                backend: 'management-api',
                transport: 'fallback',
                tool: name,
                args: liveArgs,
                reason: err.message,
              }),
            },
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
