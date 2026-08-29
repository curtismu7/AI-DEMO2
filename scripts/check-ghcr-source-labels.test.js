'use strict';
// Unit tests for the GHCR source-label gate. Run: node --test scripts/check-ghcr-source-labels.test.js

const test = require('node:test');
const assert = require('node:assert');
const {
  inspectDockerfile, checkLabels, checkComposeAgreement, LABEL_KEY, EXPECTED_URL,
} = require('./check-ghcr-source-labels');

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


// --- label forms other than the one this repo happens to use ---------------
// The original regex demanded an unquoted key followed immediately by `=`, so
// both forms below parsed to url === null. The caller then skipped the
// wrong-repo comparison via a `url &&` truthiness guard, and a label pointing
// at somebody else's repo passed the gate. Each of these fails without the fix.

test('a QUOTED key/value wrong-repo label is still captured', () => {
  const r = inspectDockerfile(
    `FROM node:22-alpine\nLABEL "${LABEL_KEY}"="https://github.com/someone/else"\n`,
  );
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.url, 'https://github.com/someone/else');
});

test('the legacy space-separated label form is still captured', () => {
  const r = inspectDockerfile(
    `FROM node:22-alpine\nLABEL ${LABEL_KEY} https://github.com/someone/else\n`,
  );
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.url, 'https://github.com/someone/else');
});

test('a quoted correct label parses to the expected URL, not null', () => {
  const r = inspectDockerfile(`FROM node:22-alpine\nLABEL "${LABEL_KEY}"="${EXPECTED_URL}"\n`);
  assert.strictEqual(r.url, EXPECTED_URL);
  assert.strictEqual(r.inFinalStage, true);
});

// --- compose agreement -----------------------------------------------------
// checkLabels assumes `<sourceDir>/Dockerfile`; CI builds what compose says.
// These assert the assumption rather than reimplementing compose resolution.

const ENTRY = { key: 'svc', sourceDir: 'svc_dir', ghcrImage: 'ai-demo-svc', composeService: 'svc' };

test('compose agreeing with <sourceDir>/Dockerfile produces no error', () => {
  const compose = 'services:\n  svc:\n    build:\n      context: .\n      dockerfile: svc_dir/Dockerfile\n';
  assert.deepStrictEqual(checkComposeAgreement([ENTRY], compose), []);
});

test('a context-relative Dockerfile resolves and agrees', () => {
  const compose = 'services:\n  svc:\n    build:\n      context: ./svc_dir\n      dockerfile: Dockerfile\n';
  assert.deepStrictEqual(checkComposeAgreement([ENTRY], compose), []);
});

test('a non-default dockerfile name is caught instead of silently checking the wrong file', () => {
  const compose = 'services:\n  svc:\n    build:\n      context: ./svc_dir\n      dockerfile: Dockerfile.tier-manager\n';
  const errs = checkComposeAgreement([ENTRY], compose);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /inspecting the wrong file/);
});

test('a build target is caught — the gate only understands the final stage', () => {
  const compose = 'services:\n  svc:\n    build:\n      context: ./svc_dir\n      dockerfile: Dockerfile\n      target: runtime\n';
  const errs = checkComposeAgreement([ENTRY], compose);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /target: runtime/);
});

test('a trailing comment on context: does not corrupt the resolved path', () => {
  const compose = 'services:\n  svc:\n    build:\n      context: .    # repo root\n      dockerfile: svc_dir/Dockerfile\n';
  assert.deepStrictEqual(checkComposeAgreement([ENTRY], compose), []);
});

test('a service the build map names but compose does not have is reported', () => {
  const errs = checkComposeAgreement([ENTRY], 'services:\n  other:\n    image: x\n');
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /no service "svc"/);
});

test('a service with no build: block is skipped — nothing is built from it', () => {
  assert.deepStrictEqual(checkComposeAgreement([ENTRY], 'services:\n  svc:\n    image: x\n'), []);
});
