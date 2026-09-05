'use strict';

/**
 * Prometheus metrics for this resource server (demo_api_resource_server, k8s
 * Service `api-resource-server` — mortgage API-key-gated backend). Prefixed
 * `apirs_`, matching PingGateway's own `ig_` convention.
 */

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'apirs_' });

const httpRequestDuration = new client.Histogram({
  name: 'apirs_http_request_duration_seconds',
  help: 'Duration of HTTP requests to this resource server',
  labelNames: ['route', 'method', 'status'],
  registers: [register],
});

/** Express middleware — records on res 'finish', never alters the response. */
function requestMetrics(req, res, next) {
  const endTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // req.route is only set once Express matches a route; unmatched (404)
    // requests fall back to the raw path so they're still visible rather
    // than silently dropped from the metric.
    const route = (req.route && req.route.path) || req.path || 'unknown';
    endTimer({ route, method: req.method, status: res.statusCode });
  });
  next();
}

module.exports = { register, requestMetrics };
