'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDeployments, readSeDeploy } = require('./se-deploy');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const deploy = (replicas, ...images) => ({ spec: { replicas, template: { spec: { containers: images.map((image) => ({ image })) } } } });

test('parseDeployments keeps app images by sha tag, skips third-party, scaled-to-zero and duplicates', () => {
  const markers = parseDeployments({ items: [
    deploy(1, `ghcr.io/o/ai-demo-frontend:sha-${A}`),
    deploy(1, `ghcr.io/o/ai-demo-demo-api-server:sha-${B}`, `ghcr.io/o/ai-demo-authz-server:sha-${A}`),
    deploy(1, `ghcr.io/o/ai-demo-authz-server:sha-${A}`),
    deploy(0, `ghcr.io/o/ai-demo-mastra-agent:sha-${A}`),
    deploy(1, 'grafana@sha256:abc', 'nginx:1.27-alpine', 'ghcr.io/o/ai-demo-opensearch-mcp-server:latest'),
  ] });
  assert.deepEqual(markers, [
    { image: 'ai-demo-frontend', service: 'frontend', sha: A }, { image: 'ai-demo-demo-api-server', service: 'demo-api-server', sha: B }, { image: 'ai-demo-authz-server', service: 'authz-server', sha: A },
  ]);
});

test('readSeDeploy counts changed source files per service against origin/main', async () => {
  const C = 'c'.repeat(40);
  const items = [deploy(1, `ghcr.io/o/ai-demo-frontend:sha-${A}`), deploy(1, `ghcr.io/o/ai-demo-llm-proxy:sha-${B}`), deploy(1, `ghcr.io/o/ai-demo-tier-manager:sha-${C}`)];
  const map = [{ ghcrImage: 'ai-demo-frontend', sourceDir: 'demo_api_ui' }, { ghcrImage: 'ai-demo-llm-proxy', sourceDir: 'demo_llm_proxy' }];
  const execFile = (command, args, options, callback) => {
    if (command === 'kubectl') return callback(null, JSON.stringify({ items }));
    if (command === 'bash') return callback(null, JSON.stringify(map));
    if (args[0] === 'rev-parse') return callback(null, `${B}\n`);
    return callback(null, args[5] === 'demo_api_ui' ? 'demo_api_ui/a.js\ndemo_api_ui/b.js\n' : '');
  };
  const state = await readSeDeploy({ repoRoot: '/repo', execFile });
  assert.equal(state.available, true);
  assert.equal(state.head, 'bbbbbbbbb');
  assert.deepEqual(state.outOfDate, [{ service: 'frontend', sha: 'aaaaaaaaa', files: 2 }]);
  assert.deepEqual(state.current, ['llm-proxy']);
  assert.deepEqual(state.unknown, [{ service: 'tier-manager', sha: 'ccccccccc' }]);
});

test('a service behind in one deployment is not also listed as current', async () => {
  const items = [deploy(1, `ghcr.io/o/ai-demo-mcp-brave:sha-${A}`), deploy(1, `ghcr.io/o/ai-demo-mcp-brave:sha-${B}`)];
  const execFile = (command, args, options, callback) => {
    if (command === 'kubectl') return callback(null, JSON.stringify({ items }));
    if (command === 'bash') return callback(null, JSON.stringify([{ ghcrImage: 'ai-demo-mcp-brave', sourceDir: 'demo_mcp_brave' }]));
    if (args[0] === 'rev-parse') return callback(null, `${B}\n`);
    return callback(null, args[2] === A ? 'demo_mcp_brave/x.js\n' : '');
  };
  const state = await readSeDeploy({ repoRoot: '/repo', execFile });
  assert.deepEqual(state.outOfDate.map((item) => item.service), ['mcp-brave']);
  assert.deepEqual(state.current, []);
});

test('readSeDeploy reports unavailable when kubectl fails', async () => {
  const state = await readSeDeploy({ repoRoot: '/repo', execFile: (command, args, options, callback) => callback(new Error('no cluster')) });
  assert.deepEqual(state, { available: false });
});
