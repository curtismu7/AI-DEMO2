'use strict';

// node --test scripts/sync-gateway-scope-topology.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compare, sync, SOURCE, COPY } = require('./sync-gateway-scope-topology');

function fixture(sourceText, copyText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-topology-'));
  fs.mkdirSync(path.join(root, path.dirname(COPY)), { recursive: true });
  fs.writeFileSync(path.join(root, SOURCE), sourceText);
  if (copyText !== undefined) fs.writeFileSync(path.join(root, COPY), copyText);
  return root;
}

test('an identical copy is in sync', () => {
  assert.deepStrictEqual(compare(fixture('{"tools":{}}', '{"tools":{}}')), { inSync: true, reason: null });
});

test('a copy that fell behind is reported', () => {
  const result = compare(fixture('{"tools":{"a":{},"b":{}}}', '{"tools":{"a":{}}}'));
  assert.strictEqual(result.inSync, false);
  assert.match(result.reason, /differs/);
});

test('a missing copy is reported, not thrown', () => {
  const result = compare(fixture('{"tools":{}}'));
  assert.strictEqual(result.inSync, false);
  assert.match(result.reason, /missing/);
});

test('sync makes the copy match', () => {
  const root = fixture('{"tools":{"a":{},"b":{}}}', '{"tools":{"a":{}}}');
  sync(root);
  assert.deepStrictEqual(compare(root), { inSync: true, reason: null });
});

test('the committed copy matches the committed root topology', () => {
  assert.deepStrictEqual(compare(path.resolve(__dirname, '..')), { inSync: true, reason: null });
});
