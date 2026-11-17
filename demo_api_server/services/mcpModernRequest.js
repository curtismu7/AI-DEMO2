'use strict';

/**
 * MCP 2026-07-28 stateless requests, BFF side (HTTP gateway client).
 *
 * A Modern request is self-contained: the protocol version and client
 * capabilities ride in params._meta, the routing headers mirror the body, and
 * there is no initialize handshake and no Mcp-Session-Id. The demo gateway
 * serves it (demo_mcp_gateway, Phase 2). Opt-in via the `mcp_modern_requests`
 * flag, and only toward the Node gateway: PingGateway's MCP filter speaks
 * 2025-06-18 / 2025-11-25 only.
 *
 * The retry rule is the reason this is safe to turn on. Two Modern answers are
 * not usable by the BFF as they stand:
 *   - input_required: the gateway wants a confirmation. The BFF's elicitation
 *     and HITL flows speak the old shape (428 + elicitation_id), and a 200
 *     carrying input_required would otherwise be taken for a finished tool call.
 *   - a version / header / _meta rejection (-32022, -32020, -32602 on _meta),
 *     which is what an older gateway answers.
 * Both mean the call never ran, so resending it once in the old shape is safe.
 */

const configStore = require('./configStore');

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const CLIENT_INFO = { name: 'banking-bff', version: '1.0.0' };

function modernRequestsEnabled() {
  try {
    return String(configStore.getEffective('mcp_modern_requests')).toLowerCase() === 'true';
  } catch (_) {
    return false;
  }
}

/** Returns the Modern form of a built JSON-RPC body + headers. Inputs are not mutated. */
function toModernRequest(body, headers) {
  const params = {
    ...(body.params || {}),
    _meta: {
      ...((body.params && body.params._meta) || {}),
      [META_VERSION]: MODERN_PROTOCOL_VERSION,
      [META_CAPABILITIES]: {},
      [META_CLIENT_INFO]: CLIENT_INFO,
    },
  };
  const modernHeaders = {
    ...headers,
    'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
    'Mcp-Method': body.method,
  };
  if (body.method === 'tools/call' && body.params && body.params.name) {
    modernHeaders['Mcp-Name'] = body.params.name;
  }
  return { body: { ...body, params }, headers: modernHeaders };
}

const REJECTION_CODES = new Set([-32022, -32020]);

/** True when a response to a Modern request should be answered by resending it in the old shape. */
function needsLegacyRetry(response) {
  if (!response) return false;
  const data = response.data;
  if (response.status === 200 && data && data.result && data.result.resultType === 'input_required') {
    return true;
  }
  const err = response.status === 400 && data && data.error;
  if (!err || typeof err !== 'object') return false;
  if (REJECTION_CODES.has(err.code)) return true;
  return err.code === -32602 && /_meta|protocolVersion/i.test(String(err.message || ''));
}

module.exports = {
  MODERN_PROTOCOL_VERSION,
  modernRequestsEnabled,
  toModernRequest,
  needsLegacyRetry,
};
