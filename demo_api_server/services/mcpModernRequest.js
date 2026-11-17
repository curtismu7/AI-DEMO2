'use strict';

/**
 * MCP 2026-07-28 stateless requests, BFF side (HTTP gateway client).
 *
 * A Modern request is self-contained: the protocol version and client
 * capabilities ride in params._meta, the routing headers mirror the body, and
 * there is no initialize handshake and no Mcp-Session-Id. The demo gateway
 * serves it (demo_mcp_gateway, Phase 2). The `mcp_modern_requests` flag (ON by
 * default) makes the BFF negotiate per gateway: it tries a stateless request
 * first and falls back to the 2025-11-25 shape when the gateway cannot take it,
 * so both kinds of gateway work side by side with nothing to flip. OFF means
 * never Modern. Only toward the Node gateway: PingGateway's MCP filter speaks
 * 2025-06-18 / 2025-11-25 only.
 *
 * Why no server/discover probe: the gateway answers it only after the bearer
 * check, so a probe needs a token, and trying the real request costs nothing
 * extra when the gateway supports it. A rejection is remembered per gateway
 * (NEGATIVE_TTL_MS) so an old gateway costs one extra request per window, not
 * one per call.
 *
 * The retry rule is what makes trying first safe. Two Modern answers are
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

// Gateways (by base URL) that rejected a stateless request, and until when.
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const unsupportedUntil = new Map();

function isModernKnownUnsupported(base) {
  const until = unsupportedUntil.get(base);
  if (!until) return false;
  if (Date.now() >= until) {
    unsupportedUntil.delete(base);
    return false;
  }
  return true;
}

function markModernUnsupported(base) {
  unsupportedUntil.set(base, Date.now() + NEGATIVE_TTL_MS);
}

function _resetModernNegotiationForTest() {
  unsupportedUntil.clear();
}

/** params with the three stateless _meta keys added. Input is not mutated. */
function withModernMeta(params) {
  return {
    ...(params || {}),
    _meta: {
      ...((params && params._meta) || {}),
      [META_VERSION]: MODERN_PROTOCOL_VERSION,
      [META_CAPABILITIES]: {},
      [META_CLIENT_INFO]: CLIENT_INFO,
    },
  };
}

/** Returns the Modern form of a built JSON-RPC body + headers. Inputs are not mutated. */
function toModernRequest(body, headers) {
  const params = withModernMeta(body.params);
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

/** True when a JSON-RPC error object is a version / header / _meta rejection. */
function isModernRejection(err) {
  if (!err || typeof err !== 'object') return false;
  if (REJECTION_CODES.has(err.code)) return true;
  return err.code === -32602 && /_meta|protocolVersion/i.test(String(err.message || ''));
}

/**
 * Why a response to a Modern request should be resent in the old shape, or null.
 *  - 'input_required': the gateway DID speak Modern and wants a confirmation.
 *  - 'rejected': the gateway cannot take the request (version / header / _meta).
 */
function legacyRetryReason(response) {
  if (!response) return null;
  const data = response.data;
  if (response.status === 200 && data && data.result && data.result.resultType === 'input_required') {
    return 'input_required';
  }
  const err = response.status === 400 && data && data.error;
  return isModernRejection(err) ? 'rejected' : null;
}

/** The same decision for a JSON-RPC frame read off a WebSocket (no HTTP status). */
function legacyRetryReasonForFrame(msg) {
  if (!msg) return null;
  if (msg.result && msg.result.resultType === 'input_required') return 'input_required';
  return isModernRejection(msg.error) ? 'rejected' : null;
}

module.exports = {
  MODERN_PROTOCOL_VERSION,
  modernRequestsEnabled,
  toModernRequest,
  withModernMeta,
  legacyRetryReason,
  legacyRetryReasonForFrame,
  isModernKnownUnsupported,
  markModernUnsupported,
  _resetModernNegotiationForTest,
};
