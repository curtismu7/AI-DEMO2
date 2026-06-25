'use strict';

const { randomUUID } = require('node:crypto');
const { runWithCorrelation } = require('../utils/correlationContext');

/**
 * Correlation ID middleware.
 * Reads X-Request-ID or X-Correlation-ID from the incoming request, or
 * generates a new UUID v4 if neither is present.  The ID is stored on
 * req.requestId and echoed back in the X-Request-ID response header so
 * clients and log aggregators can correlate request/response pairs end-to-end.
 */
function correlationIdMiddleware(req, res, next) {
  const id = req.headers['x-request-id'] || req.headers['x-correlation-id'] || randomUUID();
  req.requestId = id;
  req.correlationId = id; // Also set correlationId for consistency
  res.setHeader('X-Request-ID', id);
  res.setHeader('X-Correlation-ID', id); // Echo both headers
  return runWithCorrelation(id, () => next());
}

module.exports = { correlationIdMiddleware };
