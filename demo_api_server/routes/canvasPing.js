const { Router } = require('express');
const http = require('http');
const https = require('https');

const router = Router();

// Internal Docker service map — hostname matches Docker service name, port is container-internal
const SERVICES = {
  frontend:          { host: 'demo-api-ui',      port: 4000, scheme: 'https', path: '/' },
  bff:               { host: 'demo-api-server',   port: 3001, scheme: 'https', path: '/api/health' },
  'agent-service':   { host: 'agent-service',     port: 3006, scheme: 'http',  path: '/health' },
  'langchain-agent': { host: 'langchain-agent',   port: 8888, scheme: 'http',  path: '/health' },
  'openai-agent':    { host: 'openai-agent',      port: 8891, scheme: 'http',  path: '/health' },
  'mastra-agent':    { host: 'mastra-agent',      port: 8892, scheme: 'http',  path: '/health' },
  'pydantic-agent':  { host: 'pydantic-agent',    port: 8893, scheme: 'http',  path: '/health' },
  'mcp-gateway':     { host: 'mcp-gateway',       port: 3005, scheme: 'http',  path: '/health' },
  'mcp-server':      { host: 'mcp-server',        port: 8080, scheme: 'http',  path: '/health' },
  'mcp-resource-server':      { host: 'mcp-resource-server',        port: 8081, scheme: 'http',  path: '/health' },
  'mcp-proxy':       { host: 'mcp-proxy',         port: 8895, scheme: 'http',  path: '/health' },
  'ping-gateway':    { host: 'ping-gateway',      port: 8080, scheme: 'http',  path: '/health' },
  'api-resource-server':{ host: 'api-resource-server',  port: 8082, scheme: 'http',  path: '/health' },
  'hitl-service':    { host: 'hitl-service',      port: 3009, scheme: 'http',  path: '/health' },
};

const TIMEOUT_MS = 3000;

function pingService(id) {
  return new Promise(resolve => {
    const svc = SERVICES[id];
    if (!svc) return resolve({ id, status: 'unknown', ms: null });

    const start = Date.now();
    const lib = svc.scheme === 'https' ? https : http;
    const req = lib.request(
      { host: svc.host, port: svc.port, path: svc.path, method: 'GET', timeout: TIMEOUT_MS,
        rejectUnauthorized: false },
      res => {
        const ms = Date.now() - start;
        res.resume();
        resolve({ id, status: res.statusCode < 500 ? 'up' : 'error', statusCode: res.statusCode, ms });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ id, status: 'timeout', ms: TIMEOUT_MS }); });
    req.on('error', () => { resolve({ id, status: 'down', ms: Date.now() - start }); });
    req.end();
  });
}

// POST /api/canvas/ping  body: { ids: ['frontend','bff',...] } or {} for all
router.post('/ping', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) && req.body.ids.length
    ? req.body.ids
    : Object.keys(SERVICES);

  const safe = ids.filter(id => SERVICES[id]);
  const results = await Promise.all(safe.map(pingService));
  res.json({ results });
});

module.exports = router;
