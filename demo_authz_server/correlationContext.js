'use strict';

/**
 * Per-request correlation context for the mock Authorization Server.
 *
 * Mirrors the BFF (demo_api_server/utils/correlationContext.js) and the gateway
 * (demo_mcp_gateway/src/correlationContext.ts) so one request's logs line up
 * across all three services. The store also carries the decision's structured
 * fields (tool / sub / actor / context) so the deny/indeterminate audit lines
 * can be emitted from the central response helpers without threading context
 * through every call site.
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function runWithCorrelation(correlationId, fn) {
  return als.run({ correlationId, decision: {} }, fn);
}

function getCorrelationId() {
  const store = als.getStore();
  return store ? store.correlationId : undefined;
}

// Stash the structured decision inputs once they are parsed, so deny()/
// indeterminate() can emit a complete audit record from the ALS store.
function setDecisionContext(fields) {
  const store = als.getStore();
  if (store) Object.assign(store.decision, fields);
}

function getDecisionContext() {
  const store = als.getStore();
  return store ? store.decision : {};
}

module.exports = {
  als,
  runWithCorrelation,
  getCorrelationId,
  setDecisionContext,
  getDecisionContext,
};
