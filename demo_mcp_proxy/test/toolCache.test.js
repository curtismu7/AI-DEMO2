'use strict';

/**
 * Regression tests for the per-caller tools/list cache bound + TTL.
 *
 * Before the fix a successful tools/list was cached for the process lifetime:
 * rotating tokens accumulated without bound, and scope/vertical changes that
 * alter the gateway's filtered tools/list were never reflected. The cache now
 * expires entries after a TTL and evicts the oldest once a size bound is hit.
 *
 * Uses the built-in node:test runner — the proxy has no jest/dev deps.
 */

// Small TTL + bound so the test is fast and deterministic. Must be set BEFORE
// requiring server.js — the module reads these at load time.
process.env.MCP_PROXY_TOOLS_TTL_MS = '50';
process.env.MCP_PROXY_TOOLS_MAX = '3';

const test = require('node:test');
const assert = require('node:assert');
const { setTimeout: sleep } = require('node:timers/promises');

const { toolCacheGet, toolCacheSet, _toolCacheByCaller } = require('../server');

test.beforeEach(() => _toolCacheByCaller.clear());

test('a cached entry expires after the TTL and is re-fetched', async () => {
  toolCacheSet('caller-a', [{ name: 'read_balance' }]);
  // Fresh: hit.
  assert.deepStrictEqual(toolCacheGet('caller-a'), [{ name: 'read_balance' }]);
  // After the TTL elapses: miss (undefined), and the stale entry is dropped.
  await sleep(70);
  assert.strictEqual(toolCacheGet('caller-a'), undefined);
  assert.strictEqual(_toolCacheByCaller.has('caller-a'), false);
});

test('the cache is bounded — oldest entries are evicted past the size cap', () => {
  toolCacheSet('k1', [{ name: 't1' }]);
  toolCacheSet('k2', [{ name: 't2' }]);
  toolCacheSet('k3', [{ name: 't3' }]);
  toolCacheSet('k4', [{ name: 't4' }]); // over the cap of 3 → evict oldest (k1)
  toolCacheSet('k5', [{ name: 't5' }]); // → evict k2

  assert.strictEqual(_toolCacheByCaller.size, 3);
  assert.strictEqual(_toolCacheByCaller.has('k1'), false);
  assert.strictEqual(_toolCacheByCaller.has('k2'), false);
  assert.strictEqual(_toolCacheByCaller.has('k3'), true);
  assert.strictEqual(_toolCacheByCaller.has('k5'), true);
});

test('an LRU touch protects a recently-read key from eviction', () => {
  toolCacheSet('k1', [{ name: 't1' }]);
  toolCacheSet('k2', [{ name: 't2' }]);
  toolCacheSet('k3', [{ name: 't3' }]);
  // Read k1 → moves it to most-recently-used.
  assert.deepStrictEqual(toolCacheGet('k1'), [{ name: 't1' }]);
  toolCacheSet('k4', [{ name: 't4' }]); // eviction should now drop k2, not k1

  assert.strictEqual(_toolCacheByCaller.has('k1'), true);
  assert.strictEqual(_toolCacheByCaller.has('k2'), false);
});
