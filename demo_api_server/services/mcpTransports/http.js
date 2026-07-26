'use strict';
/**
 * mcpTransports/http.js — generic Streamable-HTTP MCP JSON-RPC client for a
 * saved profile (services/mcpProfileStore.js). Same POST-JSON-RPC pattern as
 * mcpPingOneHttpAdapter.js but with a configurable URL + auth header instead
 * of a hardcoded PingOne worker token, so it works against any remote MCP
 * server that speaks Streamable HTTP (e.g. Brave Search run with
 * `--transport http`).
 */
const axios = require('axios');
const { normalizeAxiosError } = require('../../utils/normalizeAxiosError');

const TIMEOUT_MS = 15_000;

function buildHeaders(profile) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (String(profile.authHeader || '').trim() && String(profile.authValue || '').trim()) {
    headers[profile.authHeader] = profile.authValue;
  }
  return headers;
}

/** Some MCP HTTP servers answer with text/event-stream even for a single result. */
function extractJsonRpc(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
  if (dataLines.length) return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  throw new Error('Unrecognized MCP HTTP response framing');
}

let _msgId = 0;

async function send(profile, method, params) {
  const id = ++_msgId;
  let resp;
  try {
    resp = await axios.post(
      profile.url,
      { jsonrpc: '2.0', id, method, params },
      {
        headers: buildHeaders(profile),
        timeout: TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
        responseType: 'text',
        transformResponse: (d) => d,
      }
    );
  } catch (err) {
    const status = err.response?.status;
    if (!status) {
      // Transport failure (timeout / connection refused): normalize instead of
      // leaking the raw axios message.
      throw normalizeAxiosError(err, { label: 'MCP HTTP request', timeoutMs: TIMEOUT_MS });
    }
    const body = err.response?.data;
    const msg = `MCP HTTP ${status}${body ? `: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}` : ''}`;
    const e = new Error(msg);
    e.code = 'mcp_http_error';
    e.httpStatus = status;
    throw e;
  }

  const json = extractJsonRpc(resp.data);
  if (json && json.error) {
    const e = new Error(json.error.message || 'MCP JSON-RPC error');
    e.code = 'mcp_rpc_error';
    e.mcpCode = json.error.code;
    throw e;
  }
  return json ? json.result : undefined;
}

async function listTools(profile) {
  const result = await send(profile, 'tools/list', {});
  return { tools: (result && result.tools) || [] };
}

async function callTool(profile, tool, params) {
  return send(profile, 'tools/call', { name: tool, arguments: params || {} });
}

module.exports = { listTools, callTool };
