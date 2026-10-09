'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { staleServices } = require('./ci-heal-stale.js');

const KEYS = ['frontend', 'bff', 'invest', 'mcp', 'gateway'];

// Runs are NEWEST-FIRST, exactly as `gh run list` emits them. A run's jobs
// array holds every job GitHub reported for it (matrix jobs named by key,
// plus the parent "Build and push service images" job, which is not a
// service). The FIRST attempt seen for a key is its latest.

test('a failed latest job is stale', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), ['bff']);
});

test('a fresh success supersedes an older failure', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'success' }] },
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('a failed latest attempt is stale even with an older success', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'failure' }] },
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'success' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), ['bff']);
});

test('a cancelled run counts as not-built (the concurrency-eviction case)', () => {
  // The original incident (5b22e3a1c): a newer pending run evicted this one
  // before any job started. Cancelled is a missing build, not a pass.
  const runs = [
    { conclusion: 'cancelled', jobs: [{ name: 'invest', conclusion: 'cancelled' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), ['invest']);
});

test('a run whose jobs array is empty records nothing', () => {
  // Matrix computation died before jobs launched: no per-service signal
  // exists, so nothing is flagged from this run alone.
  const runs = [
    { conclusion: 'failure', jobs: [] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('the parent job name is never treated as a service', () => {
  const runs = [
    { conclusion: 'failure', jobs: [{ name: 'Build and push service images', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('unknown job names are ignored even when failed', () => {
  const runs = [
    { conclusion: 'failure', jobs: [{ name: 'not-a-service', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('unknown keys in the map filter what is reported', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'ghost', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('multiple stale services accumulate in map order', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'mcp', conclusion: 'failure' }] },
    { conclusion: 'success', jobs: [{ name: 'frontend', conclusion: 'failure' }] },
  ];
  // Order is not load-bearing (the filter is a set); map order is the simplest.
  assert.deepEqual(staleServices(runs, KEYS), ['frontend', 'mcp']);
});

test('a service that failed, was fixed, then failed again is stale', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'failure' }] },
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'success' }] },
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'failure' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), ['bff']);
});

test('services with no job history are not stale', () => {
  const runs = [
    { conclusion: 'success', jobs: [{ name: 'bff', conclusion: 'success' }] },
  ];
  assert.deepEqual(staleServices(runs, KEYS), []);
});

test('empty runs list means nothing is stale', () => {
  assert.deepEqual(staleServices([], KEYS), []);
});
