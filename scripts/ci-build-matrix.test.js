'use strict';

/**
 * The join CI depends on. Tested exhaustively here because the workflow that
 * calls it cannot be tested until it is merged — GitHub runs the pushed
 * workflow, so the first real run is the merge itself.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildMatrix, rootDependencies, buildContexts, copySources, matcher,
} = require('./ci-build-matrix');

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


// --- root-file dependencies ------------------------------------------------
// Six services build from `context: .` and COPY root-level inputs owned by no
// service's sourceDir. A merge touching only one of those used to match no
// prefix and log "no service source changed — building nothing", which reads
// as correct and is not. These are DERIVED from the Dockerfiles rather than
// hand-listed, so there is no fifteenth map to keep in sync.

const COMPOSE = [
  'services:',
  '  demo-api-server:',
  '    build:',
  '      context: .    # repo root',
  '      dockerfile: demo_api_server/Dockerfile',
  '  ui:',
  '    build:',
  '      context: .',
  '      dockerfile: demo_api_ui/Dockerfile',
  '  llm-proxy:',
  '    build:',
  '      context: ./demo_llm_proxy',
  '      dockerfile: Dockerfile',
  '',
].join('\n');

const DOCKERFILES = {
  'demo_api_server/Dockerfile': [
    'FROM node:22-alpine',
    'COPY demo_api_server/ .',
    'COPY scope-topology.json /scope-topology.json',
    'COPY docs/ /docs/',
    'COPY graphify-out/*.kb.json /graphify-out/',
  ].join('\n'),
  'demo_api_ui/Dockerfile': [
    'FROM node:22-alpine AS builder',
    'COPY demo_api_ui/ .',
    'COPY llm-timeouts.json /llm-timeouts.json',
    'FROM nginx',
    'COPY --from=builder /app/build /usr/share/nginx/html',
  ].join('\n'),
  // Local context: `scripts/` here means demo_llm_proxy/scripts, NOT the repo's.
  'demo_llm_proxy/Dockerfile': 'FROM node:22-alpine\nCOPY scripts/boot.js .\n',
};
const READ = (rel) => DOCKERFILES[rel] || null;
const DEPS = () => rootDependencies(MAP, COMPOSE, READ);

test('a root file no sourceDir owns now builds the services that COPY it', () => {
  const m = buildMatrix(MAP, ['scope-topology.json'], DEPS());
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff']);
});

test('one root file can fan out to several services', () => {
  const deps = DEPS();
  assert.deepStrictEqual(
    buildMatrix(MAP, ['llm-timeouts.json'], deps).include.map((e) => e.key),
    ['frontend'],
  );
  assert.deepStrictEqual(
    buildMatrix(MAP, ['docs/architecture.md'], deps).include.map((e) => e.key),
    ['bff'],
  );
});

test('a COPY of a directory matches paths inside it', () => {
  const m = buildMatrix(MAP, ['docs/deep/nested/page.md'], DEPS());
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff']);
});

test('a globbed COPY matches only what the glob covers', () => {
  const deps = DEPS();
  assert.deepStrictEqual(
    buildMatrix(MAP, ['graphify-out/banking-domain.kb.json'], deps).include.map((e) => e.key),
    ['bff'],
  );
  assert.deepStrictEqual(
    buildMatrix(MAP, ['graphify-out/graph.json'], deps).include.map((e) => e.key),
    [],
  );
});

// The whole reason contexts are read instead of assumed: a service built with
// `context: ./demo_llm_proxy` that COPYs `scripts/boot.js` means its OWN
// scripts dir. Attributing the repo-root scripts/ to it would rebuild it on
// every unrelated tooling change.
test('a service with a LOCAL build context gains no root dependencies', () => {
  assert.strictEqual(DEPS().has('llm'), false);
  assert.deepStrictEqual(buildMatrix(MAP, ['scripts/boot.js'], DEPS()).include, []);
});

test('an unrelated root file still builds nothing', () => {
  assert.deepStrictEqual(buildMatrix(MAP, ['README.md'], DEPS()).include, []);
});

test('sourceDir-owned COPY sources are not duplicated as root deps', () => {
  // demo_api_server/ is COPYd by its own Dockerfile, but the prefix match
  // already owns it; adding a matcher too would be redundant.
  const m = buildMatrix(MAP, ['demo_api_server/server.js'], DEPS());
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff']);
});

test('omitting rootDeps keeps the original prefix-only behaviour', () => {
  assert.deepStrictEqual(buildMatrix(MAP, ['scope-topology.json']).include, []);
});

test('copySources skips --from= copies, which come from a stage not the context', () => {
  const srcs = copySources(DOCKERFILES['demo_api_ui/Dockerfile']);
  assert.ok(srcs.includes('llm-timeouts.json'));
  assert.ok(!srcs.some((x) => x.startsWith('/app')), 'stage copies must not leak in');
});

test('buildContexts reads the context of each service that declares one', () => {
  const ctx = buildContexts(COMPOSE);
  assert.strictEqual(ctx.get('demo-api-server'), '.');
  assert.strictEqual(ctx.get('llm-proxy'), './demo_llm_proxy');
});

test('matcher treats a bare path as both the file and a directory prefix', () => {
  const m = matcher('docs');
  assert.strictEqual(m('docs'), true);
  assert.strictEqual(m('docs/a.md'), true);
  assert.strictEqual(m('docsy/a.md'), false);
});

// Guards the derivation against the real repo, not just fixtures: these are the
// exact files and services TECH_DEBT enumerated by hand.
test('the real repo derives the documented root dependencies', () => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const root = path.join(__dirname, '..');
  const map = JSON.parse(
    execFileSync(path.join(root, 'se-update-code.sh'), ['--print-map'], { encoding: 'utf8', cwd: root }),
  );
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const read = (rel) => {
    const abs = path.join(root, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const deps = rootDependencies(map, compose, read);
  const keysFor = (p) => buildMatrix(map, [p], deps).include.map((e) => e.key).sort();

  assert.deepStrictEqual(keysFor('scope-topology.json'), ['authz', 'bff', 'gateway']);
  assert.deepStrictEqual(keysFor('mcp-tool-schemas.json'), ['gateway']);
  assert.deepStrictEqual(keysFor('llm-timeouts.json'), ['bff', 'frontend']);
  // Still no false positives on a genuinely root-only doc.
  assert.deepStrictEqual(keysFor('README.md'), []);
});
