'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const a2aOverlay = require('../config/verticals/a2a/index');

test('a2a overlay heuristic matches the mismatch-probe trigger phrase', () => {
  const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
  assert.ok(mismatchHeuristic, 'expected a second heuristic entry for the mismatch probe');
  assert.strictEqual(mismatchHeuristic.action, 'a2a_generalist_mismatch');
  assert.ok(mismatchHeuristic.re.test('simulate an agent identity mismatch'));
});

test('a2a overlay heuristic does not match the plain delegate phrase', () => {
  const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
  assert.ok(!mismatchHeuristic.re.test('hand off to a specialist'));
});

test('a2a overlay exposes the mismatch tool', () => {
  const tools = a2aOverlay.getTools();
  assert.ok(tools.some((t) => t.name === 'a2a_generalist_mismatch'));
});
