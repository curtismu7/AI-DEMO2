'use strict';
// Unit tests for the compose env-change detector.
// Run: node --test scripts/compose-env-diff.test.js

const test = require('node:test');
const assert = require('node:assert');
const { changedEnvServices, serviceBlocks, envSignature } = require('./compose-env-diff');

const compose = (envLines, svc = 'mcp-gateway') => [
  'services:',
  `  ${svc}:`,
  '    image: ai-demo-mcp-gateway',
  '    environment:',
  ...envLines.map((l) => `      ${l}`),
  '    ports:',
  '      - "8081:8081"',
  '',
].join('\n');

test('an added environment entry names the owning service', () => {
  const before = compose(['A=1']);
  const after = compose(['A=1', 'GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID=abc']);
  assert.deepStrictEqual(changedEnvServices(before, after), ['mcp-gateway']);
});

test('a changed environment VALUE is detected, not just added keys', () => {
  assert.deepStrictEqual(changedEnvServices(compose(['A=1']), compose(['A=2'])), ['mcp-gateway']);
});

test('a removed environment entry is detected', () => {
  assert.deepStrictEqual(changedEnvServices(compose(['A=1', 'B=2']), compose(['A=1'])), ['mcp-gateway']);
});

test('an identical file reports nothing', () => {
  assert.deepStrictEqual(changedEnvServices(compose(['A=1']), compose(['A=1'])), []);
});

// The whole point of comparing structurally rather than by diff hunk: a hunk
// says which LINES moved, not which SERVICE owns them.
test('only the service that actually changed is named', () => {
  const two = (a, b) => [
    'services:',
    '  ui:', '    environment:', `      A=${a}`,
    '  demo-api-server:', '    environment:', `      B=${b}`,
    '',
  ].join('\n');
  assert.deepStrictEqual(changedEnvServices(two(1, 1), two(1, 2)), ['demo-api-server']);
});

test('a comment-only or whitespace edit does NOT force a recreate', () => {
  const before = 'services:\n  ui:\n    environment:\n      A=1\n';
  const after = 'services:\n  ui:\n    environment:\n      # explains A\n\n      A=1\n';
  assert.deepStrictEqual(changedEnvServices(before, after), []);
});

test('an env_file change counts — it is read once at create too', () => {
  const before = 'services:\n  ui:\n    env_file:\n      - path: ./a.env\n';
  const after = 'services:\n  ui:\n    env_file:\n      - path: ./a.env\n      - path: ./b.env\n';
  assert.deepStrictEqual(changedEnvServices(before, after), ['ui']);
});

test('a build.args change counts — it bakes into the image', () => {
  const before = 'services:\n  ui:\n    build:\n      context: .\n      args:\n        GIT_SHA: old\n';
  const after = 'services:\n  ui:\n    build:\n      context: .\n      args:\n        GIT_SHA: new\n';
  assert.deepStrictEqual(changedEnvServices(before, after), ['ui']);
});

// context:/dockerfile: changes move a path deploy-live already maps, so
// treating them as env changes would double-report.
test('a build context change alone is NOT reported here', () => {
  const before = 'services:\n  ui:\n    build:\n      context: .\n      dockerfile: a/Dockerfile\n';
  const after = 'services:\n  ui:\n    build:\n      context: .\n      dockerfile: b/Dockerfile\n';
  assert.deepStrictEqual(changedEnvServices(before, after), []);
});

test('a ports-only change is not an env change', () => {
  const before = 'services:\n  ui:\n    environment:\n      A=1\n    ports:\n      - "1:1"\n';
  const after = 'services:\n  ui:\n    environment:\n      A=1\n    ports:\n      - "2:2"\n';
  assert.deepStrictEqual(changedEnvServices(before, after), []);
});

// A brand-new service is not yet running, so asking deploy-live to recreate it
// would name a container that does not exist.
test('a service added in this range is not reported', () => {
  const before = 'services:\n  ui:\n    environment:\n      A=1\n';
  const after = `${before}  brand-new:\n    environment:\n      B=2\n`;
  assert.deepStrictEqual(changedEnvServices(before, after), []);
});

test('a service removed in this range is not reported', () => {
  const before = 'services:\n  ui:\n    environment:\n      A=1\n  gone:\n    environment:\n      B=2\n';
  const after = 'services:\n  ui:\n    environment:\n      A=1\n';
  assert.deepStrictEqual(changedEnvServices(before, after), []);
});

test('an empty old file (no compose at that revision) reports nothing', () => {
  assert.deepStrictEqual(changedEnvServices('', compose(['A=1'])), []);
});

test('top-level keys after services: do not leak into the last service block', () => {
  const text = 'services:\n  ui:\n    environment:\n      A=1\nvolumes:\n  data:\n';
  assert.deepStrictEqual([...serviceBlocks(text).keys()], ['ui']);
});

test('envSignature ignores keys that do not affect a running container', () => {
  const block = ['    image: x', '    ports:', '      - "1:1"'];
  assert.strictEqual(envSignature(block), '');
});

test('the real docker-compose.yml parses into many services', () => {
  const fs = require('fs');
  const path = require('path');
  const text = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  const names = [...serviceBlocks(text).keys()];
  assert.ok(names.length > 20, `expected >20 services, got ${names.length}`);
  assert.ok(names.includes('demo-api-server'), 'demo-api-server must parse');
  assert.ok(names.includes('mcp-gateway'), 'mcp-gateway must parse');
  // Self-comparison must be empty, or deploy-live would recreate the world.
  assert.deepStrictEqual(changedEnvServices(text, text), []);
});
