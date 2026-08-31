/**
 * @file check-se-backend-wiring.test.js
 * @description Every in-cluster upstream an SE-applied manifest points at must
 * actually be deployed by the SE path, and every image it names must be pushed
 * to GHCR and rewritten to its GHCR URI.
 *
 * The SE deploy path (k8s/aws/deploy.sh) applies its OWN hand-maintained list of
 * manifests — a subset of what local k8s (k8s/deploy.sh) applies. Nothing tied
 * the two together, so a service could be wired into the gateways' env
 * (MCP_WEATHER_BACKEND_URL: "http://mcp-weather:8896") while its Deployment was
 * never applied and its image never pushed. Measured 2026-08-31 on the live SE
 * namespace: mcp-weather was referenced by BOTH gateways and did not exist,
 * so the weather chip could only ever fail there.
 *
 * Three lists have to agree and none of them referenced each other:
 *   - k8s/aws/deploy.sh  `for manifest in ...`  (what gets applied)
 *   - k8s/aws/deploy.sh  IMAGE_MAP             (local name -> GHCR URI rewrite)
 *   - run-k8.sh          aws_build IMAGE_MAP   (what gets pushed to GHCR)
 */
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const seDeploy = read('k8s/aws/deploy.sh');
const runK8 = read('run-k8.sh');

/**
 * Upstreams that are referenced but deliberately NOT deployed on SE.
 * ponytail: pre-existing holes, left as-is — mcp-brave needs a Brave API key and
 * mcp-jwt-verifier is a demo-auth-profile extra; neither is wired into a chip
 * that the SE demo runs. Delete an entry here the moment its Deployment joins
 * the SE list, and this guard starts holding it to the same standard.
 */
const NOT_DEPLOYED_ON_SE = new Set(['mcp-brave', 'mcp-jwt-verifier']);

/** The manifest filenames from the `for manifest in \ ... ; do` block. */
function appliedManifests(script) {
  const block = script.match(/for manifest in \\\n([\s\S]*?);\s*do\b/);
  assert.ok(block, 'could not find the SE `for manifest in` list — did deploy.sh change shape?');
  return block[1]
    .split('\n')
    .map((l) => l.replace(/\\\s*$/, '').trim().replace(/;$/, ''))
    .filter((l) => l.endsWith('.yaml'));
}

/** local-image:ghcr-image pairs out of an IMAGE_MAP=( ... ) array. */
function imageMap(script, label) {
  const block = script.match(/IMAGE_MAP=\(\n([\s\S]*?)\n\s*\)/);
  assert.ok(block, `could not find IMAGE_MAP in ${label}`);
  return new Set(
    block[1]
      .split('\n')
      .map((l) => l.trim().replace(/^"|"$/g, ''))
      .filter((l) => l.includes(':'))
      .map((l) => l.split(':')[0]),
  );
}

const manifests = appliedManifests(seDeploy);
const yamls = manifests.map((m) => ({ name: m, body: read(path.join('k8s', m)) }));

test('SE applies a Deployment for every in-cluster upstream it wires', () => {
  const defined = new Set();
  for (const { body } of yamls) {
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^kind:\s*Service\s*$/.test(lines[i])) continue;
      // metadata.name is the next `  name:` at two-space indent.
      for (let j = i + 1; j < lines.length && !/^kind:/.test(lines[j]); j += 1) {
        const m = lines[j].match(/^ {2}name:\s*(\S+)/);
        if (m) { defined.add(m[1]); break; }
      }
    }
  }

  const missing = new Set();
  for (const { body } of yamls) {
    for (const ref of body.match(/http:\/\/[a-z0-9-]+:\d+/g) || []) {
      const svc = ref.slice('http://'.length).split(':')[0];
      if (svc === 'localhost' || defined.has(svc) || NOT_DEPLOYED_ON_SE.has(svc)) continue;
      missing.add(svc);
    }
  }

  assert.deepEqual(
    [...missing].sort(),
    [],
    `SE-applied manifests point at service(s) the SE path never deploys: ${[...missing].sort().join(', ')}. ` +
      'Add the Deployment manifest to the `for manifest in` list in k8s/aws/deploy.sh ' +
      '(and its image to BOTH IMAGE_MAPs), or add it to NOT_DEPLOYED_ON_SE with a reason.',
  );
});

test('every image an SE-applied manifest names is rewritten to its GHCR URI', () => {
  // Only deploy.sh's own map is checked here. run-k8.sh pushes under the COMPOSE
  // image names, which tag_k8_images() retags to the manifest names — a second
  // indirection this guard deliberately does not model. What matters on the
  // cluster is that no manifest reaches kubectl still naming a local-only image:
  // that is an ImagePullBackOff, and the pod never starts.
  const rewritten = imageMap(seDeploy, 'k8s/aws/deploy.sh');

  const notRewritten = new Set();
  for (const { body } of yamls) {
    for (const line of body.match(/^\s*image:\s*ai-demo-k8-\S+/gm) || []) {
      const local = line.split('image:')[1].trim().replace(/:latest$/, '');
      if (!rewritten.has(local)) notRewritten.add(local);
    }
  }

  assert.deepEqual([...notRewritten].sort(), [],
    `image(s) in the SE manifest list keep their local name (ImagePullBackOff on the cluster): ${[...notRewritten].join(', ')}. ` +
      'Add the local-name:ghcr-name pair to IMAGE_MAP in k8s/aws/deploy.sh.');
});

test('the weather MCP server specifically is deployed, pushed and rewritten', () => {
  assert.ok(manifests.includes('57-mcp-weather-deployment.yaml'),
    'k8s/aws/deploy.sh must apply 57-mcp-weather-deployment.yaml — both gateways set *_WEATHER_BACKEND_URL to http://mcp-weather:8896');
  assert.match(runK8, /ai-demo-k8-mcp-weather:ai-demo-mcp-weather/);
  assert.match(seDeploy, /ai-demo-k8-mcp-weather:ai-demo-mcp-weather/);
});
