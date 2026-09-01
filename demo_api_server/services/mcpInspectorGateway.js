'use strict';
/**
 * Gateway Showcase source for the MCP Inspector.
 *
 * Fronts the two third-party MCP servers that PingGateway scopes at the edge —
 * weather (`/mcp/weather`, geographic policy) and Brave (`/mcp/brave`, content
 * blocklist) — and presents them as ONE inspector source, tools grouped by
 * server.
 *
 * WHY THIS EXISTS RATHER THAN REUSING THE CUSTOM SERVER SOURCE
 * The plan was to point the existing "Custom Server" machinery at these URLs.
 * Its BFF half turned out to be a stub — `/custom-tools` returns `{tools: []}`
 * and `/custom-invoke` returns "Custom tools not implemented" — so there was
 * nothing to point anywhere. The FRONTEND half is real, so this keeps that
 * exact contract (a tools endpoint plus an invoke endpoint, `name`/`tool`
 * keys) and `useInspectorSource` needs only a config entry.
 *
 * WHY IT GOES THROUGH THE GATEWAY, NOT STRAIGHT TO THE SERVERS
 * The point of the tab is watching the gateway allow and refuse calls. A direct
 * connection to mcp-weather:8896 would always succeed and would prove the
 * opposite of the demo.
 */

const configStore = require('../services/configStore');

/** The two showcase doors, in the order they should appear in the tree. */
const SERVERS = [
  { key: 'weather', label: 'Weather MCP', path: '/mcp/weather', needsToken: false },
  // /mcp/brave carries an rsFilter in its route chain and /mcp/weather does
  // not, so Brave 401s without a bearer. Verified against the live gateway —
  // tools/list on Brave returned HTTP 401 while weather listed six tools.
  { key: 'brave', label: 'Brave Search MCP', path: '/mcp/brave', needsToken: true },
];

function gatewayBase() {
  const base =
    process.env.MCP_PINGGATEWAY_URL ||
    configStore.getEffective('mcp_pinggateway_url') ||
    '';
  return String(base).replace(/\/$/, '');
}

/**
 * PingGateway's McpValidationFilter rejects a request whose Accept header does
 * not list both types, with a 406 that reads exactly like a routing fault.
 * Learned on the SE cluster, where curl's `*∕*` passed locally and did not
 * there.
 */
function mcpHeaders(bearer) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

async function rpc(url, body, bearer, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: mcpHeaders(bearer),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* non-JSON body — surfaced as a transport error by the callers */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tools from both servers, each tagged with the server it came from so the tree
 * can group them.
 *
 * One server being down must not blank the whole tab, so failures are recorded
 * per server and the other still lists. An empty tools array with no error
 * would read as "this server has no tools" — a different, wrong story.
 */
async function listGatewayTools({ getToken } = {}) {
  const base = gatewayBase();
  if (!base) {
    return { tools: [], servers: [], error: 'No gateway URL configured (MCP_PINGGATEWAY_URL).' };
  }

  const results = await Promise.all(
    SERVERS.map(async (srv) => {
      try {
        // Only mint a token for the door that demands one — asking PingOne for
        // a token the weather route ignores is a round-trip for nothing, and a
        // grant failure there would take down a server that works fine.
        const bearer = srv.needsToken && getToken ? await getToken(srv) : null;
        const { ok, status, json } = await rpc(`${base}${srv.path}`, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }, bearer);
        if (!ok) return { ...srv, tools: [], error: `HTTP ${status}` };
        const tools = json?.result?.tools;
        if (!Array.isArray(tools)) return { ...srv, tools: [], error: 'Malformed tools/list response' };
        return { ...srv, tools, error: null };
      } catch (e) {
        return { ...srv, tools: [], error: e.name === 'AbortError' ? 'timeout' : e.message };
      }
    }),
  );

  // Flat list for the existing tree, with `server`/`serverLabel` on each tool so
  // the UI can group without a second shape to keep in sync.
  const tools = [];
  for (const r of results) {
    for (const t of r.tools) tools.push({ ...t, server: r.key, serverLabel: r.label });
  }
  return {
    tools,
    servers: results.map(({ key, label, path, error, tools: ts }) => ({
      key,
      label,
      path,
      error,
      count: ts.length,
    })),
  };
}

/**
 * Invoke one tool on its own server.
 *
 * A gateway DENY is a JSON-RPC error carried on HTTP 403, and it is the most
 * interesting thing this tab can show — so it comes back as a normal result
 * with `denied: true`, not thrown. Rendering a policy refusal as a transport
 * failure would bury the exact thing the demo exists to prove.
 */
async function invokeGatewayTool({ server, tool, params, getToken }) {
  const srv = SERVERS.find((s) => s.key === server);
  if (!srv) return { error: `Unknown gateway server: ${server}` };
  const base = gatewayBase();
  if (!base) return { error: 'No gateway URL configured (MCP_PINGGATEWAY_URL).' };

  const started = Date.now();
  try {
    const bearer = srv.needsToken && getToken ? await getToken(srv) : null;
    const { ok, status, json, text } = await rpc(`${base}${srv.path}`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: params || {} },
    }, bearer);
    const elapsedMs = Date.now() - started;
    if (!json?.error && !ok) {
      // Non-2xx with no JSON-RPC error body — a 401 from the rsFilter looks
      // like this. Returning it as a `result` made an auth failure render as
      // tool output, which is worse than useless: it looks like the call worked.
      return {
        status,
        elapsedMs,
        server: srv.key,
        serverLabel: srv.label,
        error:
          status === 401
            ? 'Gateway rejected the token (this server sits behind an rsFilter)'
            : `Gateway returned HTTP ${status}`,
      };
    }
    if (json?.error) {
      return {
        denied: status === 403,
        status,
        elapsedMs,
        server: srv.key,
        serverLabel: srv.label,
        error: json.error.message || 'Gateway refused the call',
        errorCode: json.error.code,
      };
    }
    return {
      status,
      elapsedMs,
      server: srv.key,
      serverLabel: srv.label,
      result: json?.result ?? text,
    };
  } catch (e) {
    return {
      error: e.name === 'AbortError' ? 'Gateway timed out' : e.message,
      server: srv.key,
      elapsedMs: Date.now() - started,
    };
  }
}

module.exports = { SERVERS, listGatewayTools, invokeGatewayTool, gatewayBase };
