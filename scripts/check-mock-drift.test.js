'use strict';
const test = require('node:test');
const assert = require('assert');
const { extractJestMockFactories, extractRealExports } = require('./check-mock-drift');

test('extractJestMockFactories parses an object-literal factory', () => {
  const src = `jest.mock('../../services/foo', () => ({
  bar: jest.fn(),
  baz: 5,
}));`;
  const f = extractJestMockFactories(src);
  assert.deepStrictEqual(f, [{ module: '../../services/foo', keys: ['bar', 'baz'], index: 0 }]);
});

test('extractRealExports finds shorthand + function + dotted exports', () => {
  const dir = require('fs').mkdtempSync('/tmp/mockdrift-');
  const p = `${dir}/svc.js`;
  require('fs').writeFileSync(p, "function isLocalSimulationEnabled() {}\nfunction gone() {}\nmodule.exports = { isLocalSimulationEnabled, gone };\nexports.extra = 1;\n");
  const e = extractRealExports(p);
  assert.ok(e.has('isLocalSimulationEnabled'));
  assert.ok(e.has('gone'));
  assert.ok(e.has('extra'));
  require('fs').rmSync(dir, { recursive: true, force: true });
});

// The regression this gate exists for (2026-09-26 postmortem): the mock's key
// set must be checked against the real module's exports — a mock missing
// isLocalSimulationEnabled is exactly the ciba.test.js bug.
test('ciba-shaped drift is detected: real export absent from mock keys', () => {
  const src = "jest.mock('../../services/cibaSimulatedService', () => ({\n  initiateSimulated: jest.fn(),\n  isSimulatedApproved: jest.fn(),\n}));";
  const [f] = extractJestMockFactories(src);
  assert.ok(!f.keys.includes('isLocalSimulationEnabled'));
  // and extractRealExports on the real service finds it:
  const real = extractRealExports(require('path').join(__dirname, '..', 'demo_api_server', 'services', 'cibaSimulatedService.js'));
  assert.ok(real.has('isLocalSimulationEnabled'), 'real module exports isLocalSimulationEnabled');
});
