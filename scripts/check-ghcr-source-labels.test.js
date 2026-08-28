'use strict';
// Unit tests for the GHCR source-label gate. Run: node --test scripts/check-ghcr-source-labels.test.js

const test = require('node:test');
const assert = require('node:assert');
const { inspectDockerfile, checkLabels, LABEL_KEY, EXPECTED_URL } = require('./check-ghcr-source-labels');

const LABEL = `LABEL ${LABEL_KEY}=${EXPECTED_URL}`;

test('single-stage build with the label passes', () => {
  const r = inspectDockerfile(`FROM node:22-alpine\n${LABEL}\nCMD ["node","x.js"]\n`);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.inFinalStage, true);
  assert.strictEqual(r.url, EXPECTED_URL);
});

test('missing label is reported as absent', () => {
  const r = inspectDockerfile('FROM node:22-alpine\nCMD ["node","x.js"]\n');
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.inFinalStage, false);
});

// The reason this gate checks placement and not mere presence: a LABEL applies
// only to the stage it is in, so one above an intermediate FROM never reaches
// the pushed image and the push fails exactly as if it were absent.
test('label in a NON-final stage is present but not in the final stage', () => {
  const r = inspectDockerfile(
    `FROM node:22-alpine AS build\n${LABEL}\nRUN npm ci\n\nFROM node:22-alpine\nCOPY --from=build /app /app\n`,
  );
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.inFinalStage, false);
});

test('label in the final stage of a multi-stage build passes', () => {
  const r = inspectDockerfile(
    `FROM node:22-alpine AS build\nRUN npm ci\n\nFROM node:22-alpine\n${LABEL}\nCOPY --from=build /app /app\n`,
  );
  assert.strictEqual(r.inFinalStage, true);
});

test('a commented-out label does not count', () => {
  const r = inspectDockerfile(`FROM node:22-alpine\n# ${LABEL}\nCMD ["node","x.js"]\n`);
  assert.strictEqual(r.present, false);
});

test('a label pointing at another repo is captured so the caller can reject it', () => {
  const r = inspectDockerfile(`FROM node:22-alpine\nLABEL ${LABEL_KEY}=https://github.com/someone/else\n`);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.url, 'https://github.com/someone/else');
});

test('checkLabels skips entries with no ghcrImage (owned by check-service-map-complete)', () => {
  const errs = checkLabels([{ key: 'x', sourceDir: 'nope', ghcrImage: '' }]);
  assert.deepStrictEqual(errs, []);
});

test('checkLabels reports a missing Dockerfile rather than throwing', () => {
  const errs = checkLabels([{ key: 'ghost', sourceDir: 'does_not_exist', ghcrImage: 'ai-demo-ghost' }]);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /no Dockerfile/);
});
