'use strict';

// node --test scripts/check-demo-health-gate.loadedConfig.test.js

const test = require('node:test');
const assert = require('node:assert');
const { gatewayLoadedConfigDrift } = require('./check-demo-health-gate');

const STARTED = Date.parse('2026-10-02T12:00:00Z');
const at = (iso) => Date.parse(iso);

test('a gateway started after every file changed is not stale', () => {
  const result = gatewayLoadedConfigDrift(STARTED, [
    { file: 'ping-gateway/scripts/groovy/p1az-decision.groovy', mtimeMs: at('2026-10-02T11:00:00Z') },
    { file: 'ping-gateway/config/routes/01-mcp-olb.json', mtimeMs: at('2026-10-01T09:00:00Z') },
  ]);
  assert.deepStrictEqual(result, { stale: false, newest: null, count: 0 });
});

test('a file changed after the gateway started is reported, newest first', () => {
  const result = gatewayLoadedConfigDrift(STARTED, [
    { file: 'a.groovy', mtimeMs: at('2026-10-02T12:30:00Z') },
    { file: 'b.json', mtimeMs: at('2026-10-02T13:00:00Z') },
    { file: 'c.json', mtimeMs: at('2026-10-02T11:00:00Z') },
  ]);
  assert.strictEqual(result.stale, true);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.newest.file, 'b.json');
});
