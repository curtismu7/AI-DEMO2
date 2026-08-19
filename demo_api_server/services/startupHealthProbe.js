'use strict';

/**
 * startupHealthProbe.js — live connectivity checks run once at boot.
 *
 * 1. MCP Gateway — GET {MCP_GATEWAY_HTTP_URL}/health
 *    The topology guard already validates the port, but not that the process is up.
 *    A wrong port was caught at deploy time; a crashed gateway needs this live probe.
 *
 * 2. PingOne Authorize — verify that the configured decision endpoint IDs actually
 *    exist in PingOne. If someone deletes the endpoint in the console, every agent
 *    tool call silently DENY-alls until restart. Catches it at boot instead.
 *
 * Both checks are non-fatal warnings. Neither blocks startup.
 */

const https = require('node:https');
const http = require('node:http');
const configStore = require('./configStore');
const appEventService = require('./appEventService');

const TAG_GW   = '[mcp-gateway-probe]';
const TAG_P1AZ = '[p1az-probe]';

// ── MCP Gateway health probe ──────────────────────────────────────────────────

/**
 * GET {base}/health and return { ok, status, ms, error }.
 * Uses a short timeout (5 s) so a down gateway doesn't stall boot.
 * Skips TLS verification when MCP_GATEWAY_REJECT_UNAUTHORIZED=0 (same flag as mcpGatewayClient).
 */
function _probeGateway(baseUrl, timeoutMs) {
  return new Promise((resolve) => {
    var url;
    try { url = new URL('/health', baseUrl); } catch (e) {
      return resolve({ ok: false, error: 'invalid URL: ' + baseUrl });
    }
    const rejectUnauthorized = process.env.MCP_GATEWAY_REJECT_UNAUTHORIZED !== '0';
    const lib = url.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    var done = false;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized,
      },
      (res) => {
        res.resume(); // drain so socket closes
        if (!done) { done = true; resolve({ ok: res.statusCode < 500, status: res.statusCode, ms: Date.now() - t0 }); }
      }
    );
    req.on('timeout', () => {
      req.destroy();
      if (!done) { done = true; resolve({ ok: false, error: 'timeout after ' + timeoutMs + 'ms' }); }
    });
    req.on('error', (e) => {
      if (!done) { done = true; resolve({ ok: false, error: e.message }); }
    });
    req.end();
  });
}

async function probeMcpGateway() {
  const gwUrl = configStore.getEffective('mcp_gateway_http_url') ||
                process.env.MCP_GATEWAY_HTTP_URL ||
                'https://api.ping.demo:3005';

  const result = await _probeGateway(gwUrl, 5000);

  if (result.ok) {
    console.log(TAG_GW + ' OK — ' + gwUrl + ' responded ' + result.status + ' in ' + result.ms + 'ms');
  } else {
    console.warn(TAG_GW + ' WARN — ' + gwUrl + ' unreachable: ' + (result.error || 'HTTP ' + result.status));
    console.warn(TAG_GW + '   Agent tool calls will fail until the MCP Gateway is available.');
  }

  appEventService.logEvent('startup', result.ok ? 'info' : 'warn', 'mcp-gateway-probe', {
    tag: 'startup/mcp-gateway-probe',
    url: gwUrl,
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    error: result.error,
  });

  return result;
}

// ── PingOne Authorize decision endpoint existence check ───────────────────────

async function probeP1AZEndpoints() {
  var pingOneAuthorizeService;
  try {
    pingOneAuthorizeService = require('./pingOneAuthorizeService');
  } catch (e) {
    console.warn(TAG_P1AZ + ' Skipped — could not load pingOneAuthorizeService: ' + e.message);
    return { skipped: true };
  }

  if (!pingOneAuthorizeService.isWorkerCredentialReady()) {
    // Silent skip — the startupConfigGuard and authorize warmup already warn about missing creds.
    return { skipped: true, reason: 'worker_creds_missing' };
  }

  var liveEndpoints;
  try {
    liveEndpoints = await pingOneAuthorizeService.getDecisionEndpoints();
  } catch (e) {
    console.warn(TAG_P1AZ + ' WARN — could not list decision endpoints: ' + e.message);
    return { ok: false, error: e.message };
  }

  const liveIds = new Set((liveEndpoints || []).map((ep) => ep.id));

  const toCheck = [
    { key: 'authorize_decision_endpoint_id',     label: 'Transaction decision endpoint' },
    { key: 'authorize_mcp_decision_endpoint_id', label: 'MCP first-tool decision endpoint' },
  ];

  var allOk = true;
  const results = [];

  for (let i = 0; i < toCheck.length; i++) {
    const item = toCheck[i];
    const id = configStore.getEffective(item.key) || process.env[item.key.toUpperCase()];
    if (!id) {
      results.push({ label: item.label, skipped: true, reason: 'not_configured' });
      continue;
    }
    const exists = liveIds.has(id);
    if (exists) {
      console.log(TAG_P1AZ + ' OK — ' + item.label + ' (' + id.slice(0, 8) + '…) exists in PingOne Authorize');
    } else {
      console.warn(TAG_P1AZ + ' WARN — ' + item.label + ' id=' + id + ' NOT found in PingOne Authorize.');
      console.warn(TAG_P1AZ + '   Every agent authorization decision will DENY until this endpoint is re-created.');
      allOk = false;
    }
    results.push({ label: item.label, id: id, exists: exists });
  }

  appEventService.logEvent('startup', allOk ? 'info' : 'warn', 'p1az-probe', {
    tag: 'startup/p1az-probe',
    endpointsFound: liveEndpoints.length,
    checks: results,
  });

  return { ok: allOk, results: results };
}

/**
 * Run all live startup health probes. Never throws.
 */
async function runStartupHealthProbes() {
  try { await probeMcpGateway(); } catch (e) {
    console.warn(TAG_GW + ' probe threw unexpectedly: ' + e.message);
  }
  try { await probeP1AZEndpoints(); } catch (e) {
    console.warn(TAG_P1AZ + ' probe threw unexpectedly: ' + e.message);
  }
}

module.exports = { runStartupHealthProbes, probeMcpGateway, probeP1AZEndpoints };
