'use strict';

const { randomUUID } = require('crypto');
const { runWithCorrelation } = require('./correlationContext');

/**
 * Correlation-ID middleware for the mock Authorization Server.
 *
 * Reads X-Correlation-ID (or X-Request-ID) forwarded by the gateway, generating
 * a UUID if neither is present, stamps it on req.correlationId, echoes it back
 * on the response, and runs the handler inside the correlation context so every
 * log line + audit record carries the id.
 */
module.exports = function correlationId(req, res, next) {
  const id =
    req.headers['x-correlation-id'] ||
    req.headers['x-request-id'] ||
    randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  return runWithCorrelation(id, () => next());
};
