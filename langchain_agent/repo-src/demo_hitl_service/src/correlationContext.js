'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function runWithCorrelation(correlationId, fn) {
  return als.run({ correlationId }, fn);
}

function getCorrelationId() {
  const store = als.getStore();
  return store ? store.correlationId : undefined;
}

module.exports = { runWithCorrelation, getCorrelationId, als };
