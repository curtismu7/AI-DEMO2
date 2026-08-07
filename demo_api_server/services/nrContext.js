'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const _store = new AsyncLocalStorage();

function mintCorrelation(useCaseId, useCaseName) {
  return {
    correlationId: crypto.randomUUID(),
    useCaseId: useCaseId || null,
    useCaseName: useCaseName || null,
    startedAt: Date.now(),
  };
}

function run(context, fn) {
  return _store.run(context, fn);
}

function get() {
  return _store.getStore() || {};
}

function getCorrelationId() {
  return get().correlationId || null;
}

module.exports = { mintCorrelation, run, get, getCorrelationId };
