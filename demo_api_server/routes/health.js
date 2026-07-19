/**
 * Health and Readiness Endpoints
 * Provides comprehensive health checks for monitoring and load balancing
 */

const express = require('express');
const https = require('node:https');
const router = express.Router();
const axios = require('axios');

// Dev HTTPS agent — allows self-signed mkcert certs on loopback. Production keeps
// TLS verification ON (undefined → axios uses its default secure agent); matches
// the CR-04/BL-04 pattern. Never disable verification in production.
const _devHttpsAgent = process.env.NODE_ENV === 'production'
  ? undefined
  : new https.Agent({ rejectUnauthorized: false });

/**
 * Liveness probe - checks if the application is alive
 * Returns 200 if the process is running
 */
router.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

/**
 * Readiness probe - checks if the application is ready to serve traffic
 * Verifies all dependencies are healthy
 */
router.get('/ready', async (_req, res) => {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'ready',
    checks: {}
  };

  let allHealthy = true;

  // Check PingOne JWKS endpoint
  try {
    const jwksUri = process.env.PINGONE_JWKS_URI;
    if (jwksUri) {
      const startTime = Date.now();
      const resp = await axios.get(jwksUri, { timeout: 3000, validateStatus: () => true });
      // A 5xx from the dependency is not "healthy" — only network failures were
      // being caught before, so server errors slipped through as healthy.
      const ok = resp.status < 500;
      if (!ok) allHealthy = false;
      checks.checks.pingone_jwks = {
        status: ok ? 'healthy' : 'unhealthy',
        httpStatus: resp.status,
        responseTime: Date.now() - startTime
      };
    } else {
      checks.checks.pingone_jwks = {
        status: 'not_configured',
        message: 'PINGONE_JWKS_URI not set'
      };
    }
  } catch (error) {
    allHealthy = false;
    checks.checks.pingone_jwks = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check MCP server connectivity (if configured)
  try {
    const mcpServerUrl = process.env.MCP_SERVER_URL;
    if (mcpServerUrl) {
      const startTime = Date.now();
      // Try to connect to MCP server health endpoint
      const healthUrl = `${mcpServerUrl}/health`;
      await axios.get(healthUrl, { timeout: 3000, validateStatus: () => true });
      checks.checks.mcp_server = {
        status: 'healthy',
        responseTime: Date.now() - startTime
      };
    } else {
      checks.checks.mcp_server = {
        status: 'not_configured',
        message: 'MCP_SERVER_URL not set'
      };
    }
  } catch (error) {
    // MCP server might not have health endpoint, don't fail on this
    checks.checks.mcp_server = {
      status: 'unknown',
      message: 'Could not verify MCP server health',
      error: error.message
    };
  }

  // Check database connectivity (if using database)
  try {
    const dataStore = require('../data/store');
    if (dataStore && typeof dataStore.healthCheck === 'function') {
      const dbHealth = await dataStore.healthCheck();
      checks.checks.database = {
        status: dbHealth ? 'healthy' : 'unhealthy'
      };
      if (!dbHealth) allHealthy = false;
    } else {
      checks.checks.database = {
        status: 'not_applicable',
        message: 'Using in-memory store'
      };
    }
  } catch (error) {
    allHealthy = false;
    checks.checks.database = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check session store
  try {
    // Session store is healthy if we can access it
    checks.checks.session_store = {
      status: 'healthy',
      message: 'Session middleware loaded'
    };
  } catch (error) {
    allHealthy = false;
    checks.checks.session_store = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Overall status
  checks.status = allHealthy ? 'ready' : 'not_ready';
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json(checks);
});

/**
 * Detailed health check with all components
 */
router.get('/', async (_req, res) => {
  const health = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    version: process.env.npm_package_version || '1.1.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    components: {}
  };

  let allHealthy = true;

  // Check all critical components
  const components = [
    {
      name: 'pingone_auth',
      check: async () => {
        const tokenEndpoint = process.env.PINGONE_TOKEN_ENDPOINT;
        if (!tokenEndpoint) {
          return { status: 'not_configured' };
        }
        try {
          // Just check if endpoint is reachable (will return 400 for missing params, which is fine).
          // A 5xx, however, means the provider itself is unhealthy.
          const resp = await axios.post(tokenEndpoint, {}, { timeout: 3000, validateStatus: () => true });
          return resp.status >= 500
            ? { status: 'unhealthy', httpStatus: resp.status }
            : { status: 'healthy' };
        } catch (error) {
          return { status: 'unhealthy', error: error.message };
        }
      }
    },
    {
      name: 'pingone_jwks',
      check: async () => {
        const jwksUri = process.env.PINGONE_JWKS_URI;
        if (!jwksUri) {
          return { status: 'not_configured' };
        }
        try {
          const resp = await axios.get(jwksUri, { timeout: 3000, validateStatus: () => true });
          return resp.status >= 500
            ? { status: 'unhealthy', httpStatus: resp.status }
            : { status: 'healthy' };
        } catch (error) {
          return { status: 'unhealthy', error: error.message };
        }
      }
    },
    {
      name: 'token_introspection',
      check: async () => {
        const introspectionEndpoint = process.env.PINGONE_INTROSPECTION_ENDPOINT;
        if (!introspectionEndpoint) {
          return { status: 'not_configured' };
        }
        return { status: 'configured', endpoint: introspectionEndpoint };
      }
    },
    {
      name: 'token_revocation',
      check: async () => {
        const revocationEndpoint = process.env.PINGONE_REVOCATION_ENDPOINT;
        if (!revocationEndpoint) {
          return { status: 'not_configured' };
        }
        return { status: 'configured', endpoint: revocationEndpoint };
      }
    },
    {
      name: 'ciba',
      check: async () => {
        const cibaEnabled = process.env.CIBA_ENABLED === 'true';
        if (!cibaEnabled) {
          return { status: 'disabled' };
        }
        const cibaService = require('../services/cibaService');
        return { 
          status: cibaService.isEnabled() ? 'enabled' : 'disabled' 
        };
      }
    }
  ];

  // Run all checks
  for (const component of components) {
    try {
      health.components[component.name] = await component.check();
      if (health.components[component.name].status === 'unhealthy') {
        allHealthy = false;
      }
    } catch (error) {
      allHealthy = false;
      health.components[component.name] = {
        status: 'error',
        error: error.message
      };
    }
  }

  health.status = allHealthy ? 'healthy' : 'degraded';
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json(health);
});

/**
 * GET /introspection
 * Tests whether the BFF can reach the PingOne introspection endpoint.
 * Useful for demo operators to verify connectivity before live operations.
 *
 * Response:
 *   200: { status: 'connected', endpoint, timestamp, details: { responseTime, mode, message } }
 *   503: { status: 'failed',    endpoint, timestamp, details: { error, hint } }
 */
router.get('/introspection', async (req, res) => {
  const introspectionEndpoint = process.env.PINGONE_INTROSPECTION_ENDPOINT;

  if (!introspectionEndpoint) {
    return res.status(503).json({
      status: 'not_configured',
      endpoint: null,
      timestamp: new Date().toISOString(),
      details: {
        error: 'PINGONE_INTROSPECTION_ENDPOINT is not set',
        hint: 'Set PINGONE_INTROSPECTION_ENDPOINT in your .env file (e.g., https://auth.pingone.com/{env-id}/oauth2/introspect)',
      },
    });
  }

  const startTime = Date.now();

  try {
    // Test connectivity by calling introspection with a dummy token.
    // PingOne returns 200 { active: false } for invalid tokens — this proves the endpoint is
    // reachable and accepting requests without needing to supply a real token.
    const workerClientId = process.env.WORKER_CLIENT_ID || process.env.PINGONE_WORKER_CLIENT_ID;
    const workerSecret  = process.env.WORKER_CLIENT_SECRET || process.env.PINGONE_WORKER_CLIENT_SECRET;

    if (!workerClientId || !workerSecret) {
      return res.status(503).json({
        status: 'not_configured',
        endpoint: introspectionEndpoint,
        timestamp: new Date().toISOString(),
        details: {
          error: 'Worker credentials not configured (WORKER_CLIENT_ID / WORKER_CLIENT_SECRET)',
          hint: 'Set WORKER_CLIENT_ID and WORKER_CLIENT_SECRET to enable introspection health checks',
        },
      });
    }

    // POST to introspection endpoint with a test token (will return active:false — that's fine)
    const credentials = Buffer.from(`${workerClientId}:${workerSecret}`).toString('base64');
    const response = await axios.post(
      introspectionEndpoint,
      'token=health_check_probe_token',
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 5000,
        validateStatus: () => true, // Accept any status — we only care if it's reachable
      }
    );

    const responseTime = Date.now() - startTime;

    // 200 means endpoint is reachable (token was just rejected as inactive)
    // 401 means endpoint is reachable but credentials are wrong
    // 5xx or timeout means endpoint is unreachable
    if (response.status >= 500) {
      return res.status(503).json({
        status: 'failed',
        endpoint: introspectionEndpoint,
        timestamp: new Date().toISOString(),
        details: {
          responseTime,
          error: `PingOne returned HTTP ${response.status}`,
          hint: 'PingOne introspection endpoint returned a server error. Check PingOne status.',
        },
      });
    }

    if (response.status === 401) {
      return res.status(503).json({
        status: 'auth_failed',
        endpoint: introspectionEndpoint,
        timestamp: new Date().toISOString(),
        details: {
          responseTime,
          error: 'Worker credentials rejected by PingOne (401 Unauthorized)',
          hint: 'Verify WORKER_CLIENT_ID and WORKER_CLIENT_SECRET are correct in .env',
        },
      });
    }

    // Endpoint is reachable and returned a valid response (200 with active:false is expected)
    const validationModeConfig = (() => {
      try { return require('../config/validationModeConfig'); } catch { return null; }
    })();

    return res.status(200).json({
      status: 'connected',
      endpoint: introspectionEndpoint,
      timestamp: new Date().toISOString(),
      details: {
        responseTime,
        httpStatus: response.status,
        mode: validationModeConfig ? validationModeConfig.getValidationMode() : 'unknown',
        message: 'PingOne introspection endpoint is reachable and responding',
      },
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    return res.status(503).json({
      status: 'failed',
      endpoint: introspectionEndpoint,
      timestamp: new Date().toISOString(),
      details: {
        responseTime,
        error: error.message || 'Unknown error',
        hint: 'Check network connectivity to PingOne. Verify PINGONE_INTROSPECTION_ENDPOINT is correct.',
      },
    });
  }
});

/**
 * Startup probe - checks if application has finished starting up
 */
router.get('/startup', (_req, res) => {
  // Check if critical environment variables are set
  const requiredEnvVars = [
    'PINGONE_ENVIRONMENT_ID',
    'PINGONE_TOKEN_ENDPOINT'
  ];

  const missing = requiredEnvVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    return res.status(503).json({
      status: 'not_started',
      missing_config: missing,
      message: 'Required configuration missing'
    });
  }

  res.status(200).json({
    status: 'started',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /demo-status
 * Lightweight startup check used by the UI on first load.
 * Returns which required servers are reachable and exact start commands for any that are not.
 * No auth required — called before the user may have logged in.
 */
router.get('/demo-status', async (_req, res) => {
  const normalizeMcpHttpUrl = (url) => (url || 'http://localhost:8080')
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/\/$/, '');

  // Probe /health on a base URL; retry https when mkcert dev TLS is in use.
  const probeMcpHealth = async (rawUrl) => {
    const base = normalizeMcpHttpUrl(rawUrl);
    try {
      await axios.get(`${base}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
      return { up: true, url: base };
    } catch (e) {
      if (base.startsWith('http://')) {
        try {
          const httpsBase = base.replace('http://', 'https://');
          await axios.get(`${httpsBase}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
          return { up: true, url: httpsBase };
        } catch (e2) {
          return { up: false, url: base, error: e2.code || e2.message };
        }
      }
      return { up: false, url: base, error: e.code || e.message };
    }
  };

  const servers = [];

  // ── BFF API Server ─────────────────────────────────────────────────────────
  // The fact that this endpoint is responding means the API server is up.
  servers.push({
    name: 'Banking API Server',
    key: 'api_server',
    up: true,
    startCmd: 'cd demo_api_server && npm start',
    description: 'Express BFF — OAuth, sessions, banking REST API',
    port: process.env.PORT || 3001,
  });

  // ── MCP Tool Server / Gateway ─────────────────────────────────────────────
  // Prefer MCP_GATEWAY_HTTP_URL when the demo gateway container is up; in real-stack
  // mode (demo-auth off) the gateway is stopped — fall back to direct MCP_SERVER_URL.
  const gatewayProbe = process.env.MCP_GATEWAY_HTTP_URL
    ? await probeMcpHealth(process.env.MCP_GATEWAY_HTTP_URL)
    : null;
  const directProbe = await probeMcpHealth(process.env.MCP_SERVER_URL);
  const mcpProbe = (gatewayProbe?.up && gatewayProbe) || directProbe;
  servers.push({
    name: 'Banking MCP Server',
    key: 'mcp_server',
    up: mcpProbe.up,
    startCmd: 'cd demo_mcp_server && npm run dev',
    description: 'MCP tool server — provides AI agent banking tools over WebSocket',
    port: 8080,
    url: mcpProbe.url,
    error: mcpProbe.up ? undefined : mcpProbe.error,
  });

  const allUp = servers.every(s => s.up);
  return res.status(allUp ? 200 : 503).json({
    ok: allUp,
    servers,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /services
 * Per-service liveness for the agent footer "connected services" chips.
 *
 * Unlike /demo-status this NEVER gates (always 200) and is NOT consumed by the
 * startup "please start these servers" modal — the HITL and agent-reasoning
 * services are optional in many setups, so a down probe here must not block the
 * UI. Each entry is { up: boolean }. The chips that have no standalone "up"
 * probe (PingOne Identity, Authorize) are resolved client-side from config.
 */
router.get('/services', async (_req, res) => {
  // Probe a base URL's /health, trying https as a fallback for mkcert dev TLS.
  // withChecks: include the target's health `checks` object in the result
  // (used for the agent service's prompt-store status).
  const probe = async (baseUrl, { withChecks = false } = {}) => {
    if (!baseUrl) return { up: false, error: 'not_configured' };
    const base = baseUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')
      .replace(/\/$/, '');
    const ok = (resp) => (withChecks && resp?.data?.checks)
      ? { up: true, checks: resp.data.checks }
      : { up: true };
    try {
      const resp = await axios.get(`${base}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
      return ok(resp);
    } catch (e) {
      if (base.startsWith('http://')) {
        try {
          const resp = await axios.get(`${base.replace('http://', 'https://')}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
          return ok(resp);
        } catch (e2) {
          return { up: false, error: e2.code || e2.message };
        }
      }
      return { up: false, error: e.code || e.message };
    }
  };

  const [mcpGateway, mcpServer, hitl, agent, llmProxy] = await Promise.all([
    probe(process.env.MCP_GATEWAY_HTTP_URL || 'http://localhost:3005'),
    probe((process.env.MCP_SERVER_URL || 'http://localhost:8080')),
    probe(process.env.HITL_SERVICE_URL || 'http://localhost:3009'),
    probe(process.env.AGENT_SERVICE_URL || 'http://localhost:3006', { withChecks: true }),
    probe(process.env.LLM_PROXY_URL || process.env.LLAMACPP_BASE_URL || 'http://localhost:8090'),
  ]);

  return res.status(200).json({
    services: {
      mcp_gateway: mcpGateway,
      mcp_server: mcpServer,
      hitl_service: hitl,
      agent_service: agent,
      llm_proxy: llmProxy,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /readiness
 * Credential-level readiness: are the PingOne credentials configured?
 * Used by the import script health check and the UI import-verified banner.
 * No auth required.
 */
router.get('/readiness', async (_req, res) => {
  try {
    const configStore = require('../services/configStore');
    await configStore.ensureInitialized();
    res.json({
      configured: configStore.isConfigured(),
      userOAuthConfigured: configStore.isUserOAuthConfigured(),
    });
  } catch (err) {
    res.status(500).json({
      configured: false,
      userOAuthConfigured: false,
      error: err.message,
    });
  }
});

/**
 * GET /packages
 * Package pre-flight status: are the packages needed for import/export available?
 * Used by the import mode UI panel to show machine readiness.
 * No auth required.
 */
router.get('/packages', (_req, res) => {
  const nodePath = require('node:path');
  const SERVER_ROOT = nodePath.resolve(__dirname, '..');

  const checks = {};

  // node_modules present
  checks.node_modules = require('node:fs').existsSync(nodePath.join(SERVER_ROOT, 'node_modules'));

  // tar loadable
  try { require('tar'); checks.tar = true; } catch { checks.tar = false; }

  // lmdb driver
  try { require('lmdb'); checks.lmdb_ok = true; } catch { checks.lmdb_ok = false; }

  // TLS certs (machine-bound — not in migration archive)
  const REPO_ROOT = nodePath.resolve(SERVER_ROOT, '..');
  const certFile = nodePath.join(REPO_ROOT, 'certs', 'api.ping.demo+2.pem');
  checks.tls_certs = require('node:fs').existsSync(certFile);

  // mkcert available (needed to generate certs on a new machine)
  const { spawnSync: certSpawn } = require('node:child_process');
  const mkcertCheck = certSpawn('mkcert', ['--version'], { encoding: 'utf8' });
  checks.mkcert = mkcertCheck.status === 0;

  const ready =
    checks.node_modules &&
    checks.tar &&
    checks.lmdb_ok !== false;

  res.json({
    ready,
    checks,
    remediation: {
      node_modules: 'cd demo_api_server && npm install',
      tar: 'cd demo_api_server && npm install',
      lmdb_ok: 'cd demo_api_server && npm install',
      tls_certs: 'mkdir -p certs && cd certs && mkcert -cert-file api.ping.demo+2.pem -key-file api.ping.demo+2-key.pem api.ping.demo local.ping-devops.com demo-api-server localhost 127.0.0.1',
      mkcert: 'brew install mkcert && mkcert -install',
    },
  });
});


// MCP Server liveness proxy — use configured URL (in-cluster service name), not localhost.
router.get('/mcp-server', async (_req, res) => {
  try {
    const axios = require('axios');
    const configStore = require('../services/configStore');
    const raw = process.env.MCP_SERVER_URL
      || configStore.getEffective('mcp_server_url')
      || 'http://localhost:8080';
    const base = raw.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
    const resp = await axios.get(`${base}/health`, { timeout: 3000, httpsAgent: _devHttpsAgent, validateStatus: () => true });
    if (resp.status === 200) return res.json({ ok: true, url: `${base}/health` });
    res.status(503).json({ ok: false, error: `MCP Server health HTTP ${resp.status}`, url: `${base}/health` });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message || 'MCP Server not reachable' });
  }
});

// MCP Gateway liveness proxy — resolve via mcpGatewayClient (PingGateway / demo gateway), not localhost:3005.
router.get('/mcp-gateway', async (_req, res) => {
  try {
    const axios = require('axios');
    const { getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');
    const url = getMcpGatewayHttpUrl().replace(/\/mcp\/?$/, '');
    const resp = await axios.get(`${url}/health`, { timeout: 3000, httpsAgent: _devHttpsAgent, validateStatus: () => true });
    // Any HTTP answer proves the gateway process is up; /health may 404 on some builds.
    if (resp.status > 0) return res.json({ ok: true, url: `${url}/health`, httpStatus: resp.status });
    res.status(503).json({ ok: false, error: 'MCP Gateway returned no status', url: `${url}/health` });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message || 'MCP Gateway not reachable' });
  }
});

/**
 * GET /inventory
 * Full server inventory (docs/server-inventory-sot.md) + live probes for the
 * /servers page. Always 200 — a down service is data, not an error. Probes
 * try each candidate base URL in order (env override → compose hostname →
 * localhost) so the endpoint works in docker and native runs alike.
 */
router.get('/inventory', async (_req, res) => {
  const { SERVER_INVENTORY } = require('../data/serverInventory');

  const probeEntry = async (entry) => {
    const path = entry.healthPath || '/health';
    let lastError = 'no_candidates';
    for (const base of entry.candidates || []) {
      const url = `${base.replace(/\/$/, '')}${path}`;
      const start = Date.now();
      try {
        await axios.get(url, {
          timeout: 2500,
          httpsAgent: _devHttpsAgent,
          ...(entry.acceptAnyStatus ? { validateStatus: () => true } : {}),
        });
        return { up: true, latencyMs: Date.now() - start, url };
      } catch (e) {
        lastError = e.code || e.message;
      }
    }
    return { up: false, error: lastError };
  };

  const services = await Promise.all(
    SERVER_INVENTORY.map(async (entry) => {
      const meta = {
        key: entry.key, name: entry.name, container: entry.container,
        hostPort: entry.hostPort, internalPort: entry.internalPort,
        lang: entry.lang, purpose: entry.purpose, category: entry.category,
        probe: entry.probe,
      };
      if (entry.probe === 'self') return { ...meta, up: true };
      if (entry.probe !== true) return { ...meta, up: null };
      return { ...meta, ...(await probeEntry(entry)) };
    })
  );

  return res.status(200).json({ services, timestamp: new Date().toISOString() });
});

/**
 * GET /inventory/sizes
 * Docker image size, live container memory, and codebase size per inventory
 * entry — separate from /inventory so the 15s status poll never pays for
 * docker-stats or directory walks. Always 200; unavailable data is null.
 */
router.get('/inventory/sizes', async (_req, res) => {
  const { getServerSizes } = require('../services/serverSizes');
  return res.status(200).json(await getServerSizes());
});

router.use('/tracing', require('./tracing'));

module.exports = router;

