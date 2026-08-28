'use strict';

/**
 * The join CI depends on. Tested exhaustively here because the workflow that
 * calls it cannot be tested until it is merged — GitHub runs the pushed
 * workflow, so the first real run is the merge itself.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { buildMatrix } = require('./ci-build-matrix');

const MAP = [
  { key: 'bff', sourceDir: 'demo_api_server', composeService: 'demo-api-server',
    ghcrImage: 'ai-demo-demo-api-server', localImage: 'x', k8sDeployment: 'demo-api-server' },
  { key: 'frontend', sourceDir: 'demo_api_ui', composeService: 'ui',
    ghcrImage: 'ai-demo-frontend', localImage: 'x', k8sDeployment: 'frontend' },
  { key: 'llm', sourceDir: 'demo_llm_proxy', composeService: 'llm-proxy',
    ghcrImage: 'ai-demo-llm-proxy', localImage: 'x', k8sDeployment: 'llm-proxy' },
];

test('selects the one service whose directory changed', () => {
  const m = buildMatrix(MAP, ['demo_llm_proxy/router.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['llm']);
});

test('maps the UI to ai-demo-frontend, not ai-demo-ui', () => {
  // The irregular name. A prefix rule over composeService would produce
  // "ai-demo-ui", which does not exist in GHCR — the image would build and
  // push under a name nothing pulls.
  const m = buildMatrix(MAP, ['demo_api_ui/src/App.js']);
  assert.strictEqual(m.include[0].ghcrImage, 'ai-demo-frontend');
  assert.strictEqual(m.include[0].composeService, 'ui');
  assert.strictEqual(m.include[0].localImage, 'x');
});

test('selects several services when the change spans them', () => {
  const m = buildMatrix(MAP, ['demo_api_server/server.js', 'demo_api_ui/src/App.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff', 'frontend']);
});

test('lists a service once however many of its files changed', () => {
  const m = buildMatrix(MAP, [
    'demo_api_server/server.js',
    'demo_api_server/routes/a.js',
    'demo_api_server/routes/b.js',
  ]);
  assert.strictEqual(m.include.length, 1);
});

test('returns an empty matrix when no service owns the changed paths', () => {
  // Docs and specs must not trigger a 14-image build.
  const m = buildMatrix(MAP, ['README.md', 'docs/superpowers/specs/x.md']);
  assert.deepStrictEqual(m.include, []);
});

test('does not match a directory that merely shares a prefix', () => {
  // demo_api_server must not claim demo_api_server_extra/.
  const m = buildMatrix(MAP, ['demo_api_server_extra/file.js']);
  assert.deepStrictEqual(m.include, []);
});

test('ignores an exact-name file that is not inside the directory', () => {
  const m = buildMatrix(MAP, ['demo_api_server']);
  assert.deepStrictEqual(m.include, []);
});

test('preserves ALL_KEYS order regardless of changed-path order', () => {
  const m = buildMatrix(MAP, ['demo_llm_proxy/a.js', 'demo_api_server/b.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff', 'llm']);
});

test('treats an empty changed-path list as build nothing', () => {
  // An unresolvable base resolves to no paths. Building nothing is recoverable
  // by hand; a surprise 14-image build on a force-push is not what anyone asked
  // for.
  assert.deepStrictEqual(buildMatrix(MAP, []).include, []);
});
