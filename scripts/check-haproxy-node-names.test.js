'use strict';

// The mcpgw-lb node names (ownName + peers[].name) are written into the HAProxy config as server names, use-server
// rules and the callback strip. This pins what the chart does with them. Needs `helm`; the behaviour checks also
// need `docker` (haproxy:3.2-alpine, the live image) and `openssl`. Locally a missing tool skips with a message; in CI
// (CI=true) it fails, so a runner without them cannot give a green run with no coverage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHART = path.join(ROOT, 'pingone-privgateway-helm-main/agentless/agentless-mcpgw');
const OVERLAY = path.join(ROOT, 'pingone-privgateway-helm-main/agentless/gateway1-lb.values.yaml');
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const HELM = has('helm', ['version']);
const DOCKER = has('docker', ['info']) && has('openssl', ['version']);
const IMAGE = 'haproxy:3.2-alpine';
const skipUnless = (ok, why) => (ok || process.env.CI ? false : `${why} (this skips locally and fails in CI)`);

test('CI has the tools this test needs', { skip: !process.env.CI && 'only enforced in CI' }, () => {
  assert.ok(HELM && DOCKER, 'helm, docker and openssl must be installed on the CI runner');
});

function render(valuesYaml) {
  const files = [OVERLAY];
  if (valuesYaml) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lbnames-')), 'v.yaml');
    fs.writeFileSync(f, valuesYaml);
    files.push(f);
  }
  const args = ['template', 'lb', CHART, '-n', 'x', '--set', 'hostname=h.example.com', '--set', 'namespace=x', ...files.flatMap((f) => ['-f', f])];
  const r = spawnSync('helm', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

// The haproxy.cfg text inside the mcpgw-lb-config ConfigMap.
function cfgOf(out) {
  const doc = out.split(/^---$/m).find((d) => /name:\s*mcpgw-lb-config/.test(d));
  const m = doc && doc.match(/haproxy\.cfg: \|\n([\s\S]*?)(?:\n\S|$)/);
  assert.ok(m, 'mcpgw-lb-config haproxy.cfg not found in the render');
  return m[1].replace(/^ {4}/gm, '');
}

const NAMES = (own, peers, legacy = []) => `loadBalancer:\n  ownName: ${JSON.stringify(own)}\n  legacyNodeNames: ${JSON.stringify(legacy)}\n  peers:\n${peers.map((p) => `    - name: ${JSON.stringify(p)}\n      address: peer.x.svc.cluster.local:8623\n      scheme: https\n`).join('')}`;
const stripExpr = (cfg) => cfg.match(/set-query %\[query,(.*)\] if \{ path \/callback \}/)[1];

test('the overlay renders: every node name is a server, a use-server rule and a strip; legacy tags are stripped; the generic pattern is last', { skip: skipUnless(HELM, 'helm not installed') }, () => {
  const r = render();
  assert.ok(r.ok, r.err);
  const cfg = cfgOf(r.out);
  const names = ['mcpgw-ct-retired1', 'mcpgw-cm-pool1', 'mcpgw-cm-spare1', 'mcpgw-ct-pool2'];
  assert.deepEqual([...cfg.matchAll(/^\s+server (\S+) /gm)].map((m) => m[1]), names, 'server order = hash order, unchanged by a rename');
  assert.deepEqual([...cfg.matchAll(/^\s+use-server (\S+) /gm)].map((m) => m[1]), names);
  const expr = stripExpr(cfg);
  assert.ok(expr.endsWith('regsub(~gateway-[0-9]+,,g)'), 'the generic gateway-<n> pattern goes last, so it cannot eat the front of a longer name');
  for (const n of names) assert.ok(expr.includes(`regsub(~${n},,g)`), `${n} is stripped`);
  // the tags a login in flight carries today (the names the live LB uses) are still stripped after the rename
  for (const old of ['gateway-old-1', 'gateway-pingid-1', 'gateway-pingid-2', 'gateway-pingid-3']) assert.ok(expr.includes(`regsub(~${old},,g)`), `legacy ${old} is stripped`);
  assert.match(cfg, /server mcpgw-cm-spare1 .* disabled/, 'the parked spare stays disabled');
  assert.match(cfg, /server mcpgw-ct-retired1 .* disabled/, 'the parked own node stays disabled');
});

test('a name that is a prefix of another is stripped after it (otherwise ~pool10 would leave a 0)', { skip: skipUnless(HELM, 'helm not installed') }, () => {
  const r = render(NAMES('n-pool1', ['n-pool10', 'n-pool2']));
  assert.ok(r.ok, r.err);
  const expr = stripExpr(cfgOf(r.out));
  assert.ok(expr.indexOf('~n-pool10,') < expr.indexOf('~n-pool1,'), expr);
});

test('names that would change the regex, are too short, start with a dash, or repeat fail the render with a clear message', { skip: skipUnless(HELM, 'helm not installed') }, () => {
  for (const bad of ['bad name)', 'a.b-pool', 'x|y-pool', '-leading-dash', 'abc', 'ab_', '']) {
    const asPeer = render(NAMES('ok-node-1', [bad]));
    assert.equal(asPeer.ok, false, `peer "${bad}" must be refused`);
    assert.match(asPeer.err, /must start with a letter or digit, use only letters, digits, - and _, and be at least 6 characters/);
    if (bad) { // an empty ownName is not an error: the chart defaults it to gateway-1
      const asOwn = render(NAMES(bad, ['ok-node-2']));
      assert.equal(asOwn.ok, false, `ownName "${bad}" must be refused`);
    }
    const asLegacy = render(NAMES('ok-node-1', ['ok-node-2'], [bad]));
    assert.equal(asLegacy.ok, false, `legacy name "${bad}" must be refused`);
  }
  for (const [label, v] of [['ownName and a peer', NAMES('same-node', ['same-node'])], ['two peers', NAMES('ok-node-1', ['dup-node', 'dup-node'])], ['a peer and a legacy name', NAMES('ok-node-1', ['ok-node-2'], ['ok-node-2'])]]) {
    const r = render(v);
    assert.equal(r.ok, false, `${label} sharing a name must be refused`);
    assert.match(r.err, /must be unique/);
  }
});

async function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

test('HAProxy accepts the rendered config and strips exactly the node tag (real haproxy:3.2)', { skip: skipUnless(HELM && DOCKER, 'helm, docker or openssl missing'), timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lbhap-'));
  // 1. the full rendered config parses (a throwaway certificate stands in for the mounted site.pem)
  const r = render(NAMES('n-pool1', ['n-pool10', 'n-pool2', 'gateway-2-new'], ['gateway-pingid-1', 'gateway-old-1']));
  assert.ok(r.ok, r.err);
  const cfg = cfgOf(r.out);
  fs.writeFileSync(path.join(tmp, 'full.cfg'), cfg);
  spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=t', '-days', '1', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmp, 'site.pem'), fs.readFileSync(path.join(tmp, 'k.pem'), 'utf8') + fs.readFileSync(path.join(tmp, 'c.pem'), 'utf8'));
  const check = spawnSync('docker', ['run', '--rm', '-v', `${tmp}/full.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro`, '-v', `${tmp}/site.pem:/tls/site.pem:ro`, IMAGE, 'haproxy', '-c', '-f', '/usr/local/etc/haproxy/haproxy.cfg'], { encoding: 'utf8' });
  assert.equal(check.status, 0, `haproxy -c failed: ${check.stdout}${check.stderr}`);
  assert.ok(!/\[ALERT\]/.test(check.stdout + check.stderr), check.stdout + check.stderr);

  // 2. the same strip expression, run for real
  const mini = `global\n  maxconn 100\ndefaults\n  mode http\n  timeout client 5s\n  timeout server 5s\n  timeout connect 5s\nfrontend f\n  bind :8080\n`
    + `  http-request set-var(txn.cbnode) url_param(state),field(2,~) if { path /callback }\n`
    + `  http-request set-query %[query,${stripExpr(cfg)}] if { path /callback } { var(txn.cbnode) -m found }\n`
    + `  http-request return status 200 content-type text/plain lf-string "%[query]"\n`;
  fs.writeFileSync(path.join(tmp, 'mini.cfg'), mini);
  const port = await freePort();
  const name = `lbnames-${process.pid}`;
  spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:8080`, '-v', `${tmp}/mini.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro`, IMAGE], { stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) { up = await fetch(`http://127.0.0.1:${port}/callback?x=1`).then(() => true, () => false); if (!up) await new Promise((s) => setTimeout(s, 300)); }
    assert.ok(up, 'haproxy did not start');
    const q = async (query) => (await fetch(`http://127.0.0.1:${port}/callback?${query}`)).text();
    assert.equal(await q('code=A~B&state=xyz~n-pool1'), 'code=A~B&state=xyz', 'a ~ inside code is untouched');
    assert.equal(await q('state=xyz~n-pool10&code=A'), 'state=xyz&code=A', 'the longer name is stripped whole');
    assert.equal(await q('state=xyz~n-pool2'), 'state=xyz');
    assert.equal(await q('state=xyz~gateway-3&code=Q~R'), 'state=xyz&code=Q~R', 'a legacy tag from before a rename is stripped');
    assert.equal(await q('state=xyz~gateway-2-new&code=A'), 'state=xyz&code=A', 'a name that starts with gateway-<n> is stripped whole');
    assert.equal(await q('state=s~gateway-pingid-1&code=A'), 'state=s&code=A', 'a tag from before the rename (the live name) is stripped');
    assert.equal(await q('state=s~gateway-old-1'), 'state=s');
    assert.equal(await q('code=A~B&state=plain'), 'code=A~B&state=plain', 'no tag, nothing changes');
  } finally {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  }
});
