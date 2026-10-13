'use strict';

// Polling and sensitive result endpoints excluded from the API Explorer's
// process-wide response buffer. `req.path` is relative to the `/api` mount.
const TRACKING_SKIP_PREFIXES = [
  '/api-calls', '/tokens/session-preview', '/tokens/agent-cc-preview',
  '/healthz', '/health', '/mcp/traffic', '/oauth/monitor',
  '/privilege-user-api-keys',
  // PF AI callback URLs carry OAuth codes; RAR forms can carry user identifiers.
  '/pf-ai-agent/',
  // The AIC demo callback URL carries an OAuth code too.
  '/aic-demo/',
  // Swagger UI assets would bury real traffic in the API Explorer.
  '/docs', '/openapi.json', '/reference',
];

function createApiCallTrackingMiddleware({ trackApiCall, safeRequestLogUrl }) {
  if (typeof trackApiCall !== 'function' || typeof safeRequestLogUrl !== 'function') {
    throw new TypeError('API call tracking requires a tracker and safe URL formatter');
  }

  return (req, res, next) => {
    const path = req.path.toLowerCase();
    if (TRACKING_SKIP_PREFIXES.some(prefix => path.startsWith(prefix))) return next();
    const start = Date.now();
    const originalJson = res.json.bind(res);
    let captured = null;
    res.json = body => {
      captured = body;
      return originalJson(body);
    };
    res.on('finish', () => {
      trackApiCall({
        sessionId: req.session?.id || 'default',
        method: req.method,
        url: safeRequestLogUrl(req),
        requestHeaders: req.headers,
        requestBody: req.body && Object.keys(req.body).length ? req.body : null,
        responseStatus: res.statusCode,
        responseBody: captured,
        duration: Date.now() - start,
        category: 'api',
      }).catch(() => {});
    });
    next();
  };
}

module.exports = createApiCallTrackingMiddleware;
