'use strict';

/**
 * The gate exists because a key present in four maps and missing from the
 * fifth is invisible: `se-update-code.sh <key>` works while the build-all and
 * roll-all loops silently skip it. That shipped twice — agent-service, then
 * llm (#2495 fixed in #2505).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { checkMap } = require('./check-service-map-complete');

const GOOD = [
  { key: 'bff', sourceDir: 'demo_api_server', composeService: 'demo-api-server',
    ghcrImage: 'ai-demo-demo-api-server', localImage: 'ai-demo-se-demo-api-server',
    k8sDeployment: 'demo-api-server' },
];
const INVENTORY = { demo_api_server: 'api-server' };

test('passes a complete map', () => {
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY), []);
});

test('fails a key with an empty field — the ALL_KEYS omission class', () => {
  const bad = [{ ...GOOD[0], k8sDeployment: '' }];
  const errs = checkMap(bad, INVENTORY);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /bff/);
  assert.match(errs[0], /k8sDeployment/);
});

test('fails a sourceDir that is not a real directory in the inventory', () => {
  const bad = [{ ...GOOD[0], sourceDir: 'demo_api_serverrr' }];
  const errs = checkMap(bad, INVENTORY);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /demo_api_serverrr/);
});

test('accepts the documented BFF naming mismatch without special-casing it away', () => {
  // serverInventory calls this directory's service `api-server`; Compose calls
  // it `demo-api-server`. The gate checks the DIRECTORY exists in the
  // inventory, never that the service names agree — that is the mismatch the
  // whole design routes around.
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY), []);
});

test('reports every offending key, not just the first', () => {
  const bad = [
    { ...GOOD[0], key: 'a', ghcrImage: '' },
    { ...GOOD[0], key: 'b', sourceDir: '' },
  ];
  assert.strictEqual(checkMap(bad, INVENTORY).length, 2);
});
