'use strict';

const { randomUUID } = require('crypto');
const { runWithCorrelation } = require('./correlationContext');

function correlationMiddleware(req, res, next) {
  const hdr = req.headers && req.headers['x-correlation-id'];
  const body = req.body || {};
  const id = (typeof hdr === 'string' && hdr) ||
             (typeof body.correlationId === 'string' && body.correlationId) ||
             randomUUID();
  return runWithCorrelation(id, () => next());
}

module.exports = { correlationMiddleware };
