'use strict';
const { getCorrelationId } = require('../utils/correlationContext');

function buildSsePayload(type, event) {
  const base = Object.assign({ type }, (event && typeof event === 'object') ? event : {});
  const cid = getCorrelationId();
  if (cid) base.correlation_id = cid;
  return base;
}

module.exports = { buildSsePayload };
