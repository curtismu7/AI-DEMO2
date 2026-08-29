'use strict';

/**
 * The gate exists because a key present in four maps and missing from the
 * fifth is invisible: `se-update-code.sh <key>` works while the build-all and
 * roll-all loops silently skip it. That shipped twice — agent-service, then
 * llm (#2495 fixed in #2505).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { checkMap, readInventory, readImageMap } = require('./check-service-map-complete');

const GOOD = [
  { key: 'bff', sourceDir: 'demo_api_server', composeService: 'demo-api-server',
    ghcrImage: 'ai-demo-demo-api-server', localImage: 'ai-demo-se-demo-api-server',
    k8sDeployment: 'demo-api-server' },
];
const INVENTORY = { demo_api_server: 'api-server' };
// The sixth map: k8s/aws/deploy.sh rewrites local image names to these.
const IMAGES = new Set(['ai-demo-demo-api-server']);

test('passes a complete map', () => {
  // Also covers the documented BFF naming mismatch: serverInventory calls this
  // directory's service `api-server`; Compose calls it `demo-api-server`. The
  // gate checks the DIRECTORY exists in the inventory, never that the service
  // names agree — that is the mismatch the whole design routes around.
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY, IMAGES), []);
});

test('fails a key with an empty field — the ALL_KEYS omission class', () => {
  const bad = [{ ...GOOD[0], k8sDeployment: '' }];
  const errs = checkMap(bad, INVENTORY, IMAGES);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /bff/);
  assert.match(errs[0], /k8sDeployment/);
});

test('fails a sourceDir that is not a real directory in the inventory', () => {
  // Also not a real directory on disk, so both the inventory-agreement check
  // and the on-disk-existence check fire — two independent problems, two errors.
  const bad = [{ ...GOOD[0], sourceDir: 'demo_api_serverrr' }];
  const errs = checkMap(bad, INVENTORY, IMAGES);
  assert.strictEqual(errs.length, 2);
  assert.match(errs[0], /demo_api_serverrr/);
  assert.match(errs[1], /demo_api_serverrr/);
});

test('fails a sourceDir that both files agree on but that does not exist on disk — the rename case', () => {
  // Both lookups agree on a path that no longer exists: a rename that updated
  // neither se-update-code.sh nor serverInventory.js. Without the on-disk
  // check this passes and CI silently builds nothing for the service forever.
  const bad = [{ ...GOOD[0], sourceDir: 'demo_api_server_renamed_away' }];
  const inventory = { demo_api_server_renamed_away: 'bff' };
  const errs = checkMap(bad, inventory, IMAGES);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /demo_api_server_renamed_away/);
  assert.match(errs[0], /bff/);
});

test('reports every offending key, not just the first', () => {
  const bad = [
    { ...GOOD[0], key: 'a', ghcrImage: '' },
    { ...GOOD[0], key: 'b', sourceDir: '' },
  ];
  assert.strictEqual(checkMap(bad, INVENTORY, IMAGES).length, 2);
});

test('readInventory parses all 18 sourceDir entries from serverInventory.js', () => {
  const inventory = readInventory();
  assert.strictEqual(Object.keys(inventory).length, 18);
  assert.strictEqual(inventory.demo_api_server, 'api-server');
});


// --- the sixth service map -------------------------------------------------
// IMAGE_MAP in k8s/aws/deploy.sh is a service map in the same sense as the
// other five, and it sat outside this gate. A service added to the five and
// missed there deploys on SE still pointing at a local image name, after an
// otherwise-clean CI build.

test('fails a ghcrImage that IMAGE_MAP does not list — the sixth-map omission', () => {
  const errs = checkMap(GOOD, INVENTORY, new Set(['ai-demo-something-else']));
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /IMAGE_MAP does not list/);
});

test('extra IMAGE_MAP entries are fine — it carries images this repo does not build', () => {
  const generous = new Set(['ai-demo-demo-api-server', 'ai-demo-tier-manager']);
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY, generous), []);
});

test('readImageMap parses the real k8s/aws/deploy.sh', () => {
  const fs = require('fs');
  const path = require('path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'k8s', 'aws', 'deploy.sh'), 'utf8');
  const names = readImageMap(text);
  assert.ok(names.size > 10, `expected >10 IMAGE_MAP pairs, got ${names.size}`);
  assert.ok(names.has('ai-demo-frontend'), 'the UI image must parse');
  assert.ok(names.has('ai-demo-demo-api-server'), 'the BFF image must parse');
  // Local names are the OTHER side of each pair and must not leak in.
  assert.ok(!names.has('ai-demo-k8-ui'), 'local names must not be collected');
});

test('readImageMap returns empty rather than throwing when the array is absent', () => {
  assert.strictEqual(readImageMap('#!/bin/bash\necho hi\n').size, 0);
});
