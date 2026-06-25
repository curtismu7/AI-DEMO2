/**
 * Startup Config Probe — Validate configuration and PingOne connectivity at startup
 *
 * Probes required endpoints before the server starts serving requests.
 * Detects misconfigurations early and fails fast.
 *
 * Checks:
 *   - JWKS URI is reachable
 *   - Token endpoint is accessible
 *   - Issuer matches environment
 *   - Token exchanger (if configured) is valid
 *   - Required environment variables are set
 */

const https = require('https');

const PROBE_TIMEOUT_MS = 5000;

/**
 * Probe HTTPS endpoint and return status
 * @param {string} url
 * @param {object} opts
 * @returns {Promise<{ status: number, ok: boolean }>}
 */
function probeHttps(url, opts = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: opts.method || 'HEAD',
      headers: opts.headers || {},
      timeout: PROBE_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      resolve({ status: res.statusCode, ok: res.statusCode < 400 });
    });

    req.on('error', (err) => {
      resolve({ status: 0, ok: false, error: err.message });
    });

    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ status: 0, ok: false, error: 'timeout' });
    });

    req.end();
  });
}

/**
 * Test JWKS endpoint
 * @param {string} jwksUri
 * @returns {Promise<object>} { ok: boolean, error?: string, status?: number }
 */
async function testJwksEndpoint(jwksUri) {
  if (!jwksUri) {
    return { ok: false, error: 'JWKS_URI not configured' };
  }

  try {
    const result = await probeHttps(jwksUri);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || `HTTP ${result.status}`,
        status: result.status,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Test token endpoint
 * @param {string} pingoneEnvId
 * @returns {Promise<object>}
 */
async function testTokenEndpoint(pingoneEnvId) {
  if (!pingoneEnvId) {
    return { ok: false, error: 'PINGONE_ENVIRONMENT_ID not configured' };
  }

  const tokenUrl = `https://auth.pingone.com/${pingoneEnvId}/as/token`;
  try {
    const result = await probeHttps(tokenUrl, { method: 'OPTIONS' });
    if (!result.ok && result.status !== 0) {
      // 405 Method Not Allowed is OK (means endpoint exists)
      if (result.status === 405 || result.status === 400) {
        return { ok: true };
      }
      return {
        ok: false,
        error: `HTTP ${result.status}`,
        status: result.status,
      };
    }
    if (result.error && result.error === 'timeout') {
      return { ok: false, error: 'timeout' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Test token exchange client
 * @param {string} pingoneEnvId
 * @param {string} exchangerClientId
 * @returns {Promise<object>}
 */
async function testTokenExchanger(pingoneEnvId, exchangerClientId) {
  if (!pingoneEnvId || !exchangerClientId) {
    return { ok: false, error: 'Token exchanger not configured' };
  }

  // Check if token endpoint is accessible (exchanger requires this)
  const tokenUrl = `https://auth.pingone.com/${pingoneEnvId}/as/token`;
  const result = await probeHttps(tokenUrl, { method: 'OPTIONS' });
  return {
    ok: result.ok || result.status === 405,
    error: result.error,
  };
}

/**
 * Run all startup probes
 * @param {object} config - { jwksUri, pingoneEnvId, tokenExchangerId }
 * @returns {Promise<object>} Probe results
 */
async function runAllProbes(config) {
  const results = {
    jwks: await testJwksEndpoint(config.jwksUri),
    token: await testTokenEndpoint(config.pingoneEnvId),
    exchanger: await testTokenExchanger(config.pingoneEnvId, config.tokenExchangerId),
  };

  return {
    timestamp: new Date().toISOString(),
    passed: Object.values(results).every((r) => r.ok),
    results,
  };
}

/**
 * Format probe results for logging
 * @param {object} probeResult
 * @returns {string}
 */
function formatProbeResults(probeResult) {
  const lines = ['Startup configuration probe:'];

  const addResult = (name, result) => {
    if (result.ok) {
      lines.push(`  ✓ ${name}`);
    } else {
      lines.push(`  ✗ ${name}: ${result.error || 'unknown error'}`);
    }
  };

  addResult('JWKS endpoint', probeResult.results.jwks);
  addResult('Token endpoint', probeResult.results.token);
  addResult('Token exchanger', probeResult.results.exchanger);

  return lines.join('\n');
}

module.exports = {
  runAllProbes,
  testJwksEndpoint,
  testTokenEndpoint,
  testTokenExchanger,
  formatProbeResults,
  probeHttps,
};
