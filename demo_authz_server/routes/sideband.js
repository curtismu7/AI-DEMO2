'use strict';

/**
 * POST /sideband/request
 *
 * Mock of the PingOne Authorize Sideband API, so API Access Management is
 * demonstrable without a live PingOne environment — the same mock/real split
 * the decision endpoint already has (P1AZ_MOCK_BASE / P1AZ_REAL_BASE).
 * PingGateway selects this backend per request when the BFF sends
 * X-Authz-Simulated: true; see ping-gateway/scripts/groovy/aam-sideband-capture.groovy.
 *
 * CONTRACT (recorded from the live service 2026-07-27 — not published in the
 * PingAuthorize docs). The response ECHOES the request and adds a `response`
 * object ONLY to deny:
 *
 *   allow -> { ...echoed request fields... }
 *   deny  -> { ...echoed..., response: { response_code, response_status,
 *                                        http_version, headers } }
 *
 * Getting any of these wrong fails inside PingGateway's Java SidebandApiFilter,
 * not here, so they are pinned by sideband.test.js:
 *   - `response` present/absent IS the decision. There is no `decision` field.
 *   - response_code is a STRING.
 *   - headers is an ARRAY OF SINGLE-KEY OBJECTS, not a map.
 *   - url and http_version must be echoed or the filter throws.
 *
 * Deliberately thin: this stands in for PingOne, it is not a policy engine or a
 * token service. It reads a demo group header rather than verifying a JWT —
 * the point is demonstrating the integration and the trace.
 */

const REQUIRED_GROUP = process.env.AAM_MOCK_REQUIRED_GROUP || 'Full access';

/** Read a header value out of the Sideband array-of-single-key-objects shape. */
function headerValue(headers, name) {
  if (!Array.isArray(headers)) return '';
  const wanted = name.toLowerCase();
  for (const entry of headers) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [k, v] of Object.entries(entry)) {
      if (String(k).toLowerCase() === wanted) return String(v);
    }
  }
  return '';
}

/**
 * POST /sideband/response — the RESPONSE leg.
 *
 * Only reached on ALLOW: once the request is permitted and the backend has
 * answered, PingGateway posts that answer here so AAM can rewrite it (strip a
 * field, add a header) before the client sees it. Omitting this route makes the
 * allow path fail with a 404 from the "Sideband API" while the deny path keeps
 * working — a confusing split, since deny never needs this leg.
 *
 * This mock never rewrites anything, so it echoes the payload back verbatim.
 * Echoing is deliberately shape-agnostic: whatever fields the gateway sends come
 * straight back, so the mock cannot drift from the real contract on this leg.
 */
function sidebandResponse(req, res) {
  return res.status(200).json((req && req.body) || {});
}

module.exports = function sideband(req, res) {
  const body = (req && req.body) || {};

  const groups = headerValue(body.headers, 'X-Demo-Groups')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  // Echo every field the gateway needs back, unchanged. `headers` is coerced to
  // an array even when the caller sent nothing, because the filter iterates it.
  const echoed = {
    source_ip: body.source_ip,
    source_port: body.source_port,
    method: body.method,
    url: body.url,
    http_version: body.http_version,
    headers: Array.isArray(body.headers) ? body.headers : [],
  };

  if (groups.includes(REQUIRED_GROUP)) {
    return res.status(200).json(echoed); // no `response` => allow
  }

  return res.status(200).json({
    ...echoed,
    response: {
      response_code: '403',
      response_status: 'Forbidden',
      http_version: '1.1',
      headers: [
        { 'content-length': '0' },
        { 'x-aam-mock-rule': `member of ${REQUIRED_GROUP}` },
      ],
    },
  });
};

module.exports.sidebandResponse = sidebandResponse;
