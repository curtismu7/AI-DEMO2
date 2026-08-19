'use strict';

/**
 * Follows the pointer nobody followed.
 *
 * PG_GATEWAY_RESOURCE_ID serves two unrelated contracts (TECH_DEBT
 * 2026-08-17): an OAuth audience (any stable opaque string works) and the base
 * IG's McpProtectionFilter derives the RFC 9728 `resource_metadata` URL from
 * (must actually serve a document). Nothing enforced the second property, and
 * for months it did not hold — every WWW-Authenticate challenge pointed
 * clients at a TLS handshake that failed, and nothing reported it because the
 * audience half kept working. PR #1938 made the advertisement true by moving
 * the listener; THIS check keeps it true by dereferencing the advertised URL
 * on every posture run, so the failure mode can never be silent again.
 *
 * Probe: unauthenticated POST to the gateway's /mcp → expect a 401 challenge
 * carrying WWW-Authenticate: ... resource_metadata="URL" → GET that URL →
 * expect 200 + JSON that names a `resource`. Any break in that chain names
 * the exact hop.
 */

const http = require('http');
const https = require('https');
const { callPingGateway } = require('../pingGatewayClient');
const { register } = require('./registry');

/** GET a URL with the same relaxed non-prod TLS the gateway client uses. */
function fetchUrl(rawUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const isHttps = url.protocol === 'https:';
    const req = (isHttps ? https : http).get(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        timeout: 8000,
        ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

register({
  id: 'gateway.metadata_reachable',
  name: 'RFC 9728 resource_metadata pointer answers 200',
  category: 'Agent Gateway',
  severity: 'advisory',
  appliesWhen: (flags) => flags.ff_mcp_gateway_pinggateway === true,
  async run() {
    // Unauthenticated on purpose: the 401 challenge IS the surface under test.
    let challenge;
    try {
      challenge = await callPingGateway('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        headers: { Accept: 'application/json, text/event-stream' },
      });
    } catch (err) {
      return { status: 'fail', detail: `gateway unreachable for the challenge probe: ${err.message}` };
    }
    const wwwAuth = challenge.headers?.['www-authenticate'] || '';
    if (challenge.statusCode !== 401 || !wwwAuth) {
      return {
        status: 'fail',
        detail: `expected an unauthenticated 401 challenge with WWW-Authenticate, got ${challenge.statusCode}` +
          (wwwAuth ? '' : ' (no WWW-Authenticate header)'),
      };
    }
    const m = wwwAuth.match(/resource_metadata="([^"]+)"/);
    if (!m) {
      return {
        status: 'fail',
        detail: `WWW-Authenticate carries no resource_metadata pointer: ${wwwAuth.slice(0, 160)}`,
        nextAction: 'McpProtectionFilter config regressed — clients cannot discover the resource metadata.',
      };
    }
    const metadataUrl = m[1];
    let doc;
    try {
      doc = await fetchUrl(metadataUrl);
    } catch (err) {
      return {
        status: 'fail',
        detail: `advertised resource_metadata URL is unreachable: ${metadataUrl} (${err.message})`,
        nextAction: 'The audience half keeps working while discovery is dead — this is the silent failure ' +
          'PG_GATEWAY_RESOURCE_ID\'s dual role produces (TECH_DEBT 2026-08-17). Check the listener/TLS on that origin.',
      };
    }
    if (doc.statusCode !== 200) {
      return { status: 'fail', detail: `resource_metadata URL answered ${doc.statusCode}: ${metadataUrl}` };
    }
    let parsed;
    try { parsed = JSON.parse(doc.body); } catch {
      return { status: 'fail', detail: `resource_metadata URL answered 200 but not JSON: ${metadataUrl}` };
    }
    if (!parsed.resource) {
      return { status: 'fail', detail: `resource metadata document has no "resource" field: ${metadataUrl}` };
    }
    return {
      status: 'pass',
      detail: `challenge advertises ${metadataUrl}; it answers 200 with resource="${parsed.resource}"`,
    };
  },
});
