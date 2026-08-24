'use strict';

/**
 * finding #65: getEffective(key) declared its ~230-entry envFallbackMap
 * object literal INSIDE the method body — allocated fresh on every single
 * call, even though the map is 100% static and never depends on `key`.
 * ~204 call sites project-wide, several in loops, made this a hot-path
 * allocation. Proves the map is now declared once at module scope, not
 * rebuilt inside getEffective().
 *
 * Static source-text check (like the pattern already used in
 * NewRelicDashboard.test.js's CSS dark-mode-ground assertions) rather than
 * an allocation-count spy: there is no reliable, non-flaky way to observe
 * "was this object literal re-evaluated" from outside the module, but the
 * module-scope-vs-method-body placement is fully deterministic and is
 * exactly what the fix changes.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../services/configStore.js'),
  'utf8',
);

test('finding #65: ENV_FALLBACK_MAP is declared once at module scope, before the class', () => {
  const mapDeclIndex = SOURCE.indexOf('const ENV_FALLBACK_MAP = {');
  const classDeclIndex = SOURCE.indexOf('class ConfigStore {');

  expect(mapDeclIndex).toBeGreaterThan(-1);
  expect(classDeclIndex).toBeGreaterThan(-1);
  expect(mapDeclIndex).toBeLessThan(classDeclIndex);
});

test('finding #65: getEffective() no longer declares the map inside its own body', () => {
  const methodStart = SOURCE.indexOf('getEffective(key) {');
  expect(methodStart).toBeGreaterThan(-1);

  // Slice out just this method's body (up to the next method declaration)
  // and confirm it doesn't redeclare the map locally.
  const nextMethodStart = SOURCE.indexOf('\n  ', methodStart + 'getEffective(key) {'.length + 200);
  const methodBody = SOURCE.slice(methodStart, nextMethodStart > -1 ? nextMethodStart + 4000 : methodStart + 4000);

  expect(methodBody).not.toContain('const envFallbackMap = {');
  expect(methodBody).not.toContain('const ENV_FALLBACK_MAP = {');
  expect(methodBody).toContain('ENV_FALLBACK_MAP[key]');
});
