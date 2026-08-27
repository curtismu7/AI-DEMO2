// Guards the probe split that caused six llm-proxy restarts on 2026-08-27.
//
// /health is dependency-aware: it returns 503 while no tier is loaded, which is
// correct for READINESS. Pointing LIVENESS at it means Kubernetes kills the
// process for the sin of waiting — the 20B tier takes ~11 minutes to pull and
// load, liveness gives up after ~100s, and a restart cannot make a model load
// faster. Liveness must ask only "is this process serving HTTP".
//
// No YAML dependency on purpose: demo_llm_proxy has no parser and this needs to
// run under a bare `node --test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = path.join(__dirname, '..', 'k8s', '56-llm-stack.yaml');
const ROUTER = path.join(__dirname, 'router.js');

/** The llm-proxy container block, so sibling tiers' probes cannot satisfy these. */
function llmProxyBlock() {
  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const start = yaml.indexOf('component: llm-proxy');
  assert.ok(start > 0, 'llm-proxy block not found in 56-llm-stack.yaml');
  const svc = yaml.indexOf('kind: Service', start);
  return yaml.slice(start, svc > 0 ? svc : undefined);
}

test('llm-proxy liveness does NOT use the dependency-aware /health', () => {
  const block = llmProxyBlock();
  const liveness = block.slice(block.indexOf('livenessProbe:'));
  const probePath = /path:\s*(\S+)/.exec(liveness);

  assert.ok(probePath, 'llm-proxy has no livenessProbe path');
  assert.strictEqual(
    probePath[1],
    '/livez',
    'liveness must hit /livez — /health reports 503 while tiers load, so liveness on it SIGTERMs the proxy during every cold start',
  );
});

test('llm-proxy readiness still uses /health, so traffic waits for a backend', () => {
  const block = llmProxyBlock();
  const readiness = block.slice(block.indexOf('readinessProbe:'));
  const probePath = /path:\s*(\S+)/.exec(readiness);

  assert.ok(probePath, 'llm-proxy has no readinessProbe path');
  assert.strictEqual(probePath[1], '/health');
});

test('readiness and liveness ask DIFFERENT questions', () => {
  const block = llmProxyBlock();
  const readiness = /path:\s*(\S+)/.exec(block.slice(block.indexOf('readinessProbe:')))[1];
  const liveness = /path:\s*(\S+)/.exec(block.slice(block.indexOf('livenessProbe:')))[1];

  assert.notStrictEqual(
    readiness,
    liveness,
    'one endpoint cannot serve both: readiness must fail while a dependency is missing, liveness must not',
  );
});

test('the router actually serves /livez', () => {
  const src = fs.readFileSync(ROUTER, 'utf8');
  assert.match(
    src,
    /req\.url === '\/livez'/,
    'router.js must handle /livez or the liveness probe 404s and restarts the pod anyway',
  );
});

test('/livez is unconditional — it must not consult tier health', () => {
  const src = fs.readFileSync(ROUTER, 'utf8');
  const start = src.indexOf("req.url === '/livez'");
  // Stop at the NEXT route, or the window runs into /health's handler — which
  // legitimately calls checkHealth() and would fail this for the wrong reason.
  const next = src.indexOf('req.url ===', start + 20);
  const body = src.slice(start, next > 0 ? next : start + 400);

  assert.match(body, /writeHead\(200/, '/livez must always answer 200');
  assert.ok(
    !/TIERS\.some|anyHealthy|checkHealth\(/.test(body),
    '/livez must not depend on tier state — that is what made /health unusable for liveness',
  );
});
