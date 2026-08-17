#!/usr/bin/env node
/**
 * Negative tests for check-resource-server-audience-drift.js.
 * Run: node --test scripts/check-resource-server-audience-drift.test.js
 *
 * Each case builds a minimal fixture tree and points the checker at it with
 * RS_AUDIENCE_DRIFT_ROOT, so the assertions never depend on live repo contents.
 * A gate that only ever passes proves nothing — these cases prove it fails on
 * each shape of drift it claims to catch.
 */

'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'scripts', 'check-resource-server-audience-drift.js');
const OWN_VAR = 'MCP_RESOURCE_SERVER_RESOURCE_URI';
const GOOD = 'mcp-invest.ping.demo,mcp-resource-server.ping.demo,mcpgateway.ping.demo';

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a fixture tree. `overrides` replaces the value written for a given
 * surface; `omit` drops the var from that surface entirely.
 */
function makeRoot({ uri = 'mcp-invest.ping.demo', overrides = {}, omit = [], ownVarInSrc = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-aud-drift-'));
  tmpRoots.push(dir);

  const write = (rel, body) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  write('scope-topology.json', JSON.stringify({ resources: { 'Super Banking MCP Invest': { uri } } }));

  const val = (name) => overrides[name] ?? GOOD;
  const has = (name) => !omit.includes(name);

  write(
    'docker-compose.yml',
    ['services:', '  mcp-resource-server:', '    environment:',
      has('compose') ? `      ${OWN_VAR}: "${val('compose')}"` : '      OTHER: "x"'].join('\n'),
  );
  write(
    'k8s/02-configmap.yaml',
    ['data:', '  MCP_SERVER_RESOURCE_URI: "mcpserver.ping.demo,mcpgateway.ping.demo"',
      has('k8s') ? `  ${OWN_VAR}: "${val('k8s')}"` : ''].join('\n'),
  );
  write(
    'privilege/ai-demo-whole-stack/ai-demo-stack/templates/02-configmap.yaml',
    ['data:', has('helm') ? `  ${OWN_VAR}: "${val('helm')}"` : ''].join('\n'),
  );
  write(
    'demo_mcp_resource_server/.env.example',
    has('env') ? `${OWN_VAR}=${val('env')}` : 'OTHER=x',
  );
  write(
    'demo_api_server/scripts/refresh-service-envs.js',
    has('writer') ? `    ${OWN_VAR}: investAudList + ',mcpgateway.ping.demo',` : '    OTHER: 1,',
  );
  write(
    'demo_mcp_resource_server/src/server/acceptedAudiences.ts',
    ownVarInSrc
      ? `export const RESOURCE_URI_ENV = '${OWN_VAR}';`
      : "export const RESOURCE_URI_ENV = 'MCP_SERVER_RESOURCE_URI';",
  );

  return dir;
}

function run(root) {
  return spawnSync(process.execPath, [CHECK], {
    env: { ...process.env, RS_AUDIENCE_DRIFT_ROOT: root },
    encoding: 'utf8',
  });
}

describe('check-resource-server-audience-drift', () => {
  it('passes on a consistent tree', () => {
    const res = run(makeRoot());
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /in sync with scope-topology\.json/);
  });

  it('accepts the env writer building the value from a variable', () => {
    // refresh-service-envs.js assigns investAudList, already topology-derived —
    // there is no literal to compare, and demanding one would force a hardcode.
    const res = run(makeRoot());
    assert.equal(res.status, 0, res.stderr);
  });

  for (const surface of ['compose', 'k8s', 'helm', 'env', 'writer']) {
    it(`fails when the ${surface} surface does not set the var at all`, () => {
      const res = run(makeRoot({ omit: [surface] }));
      assert.equal(res.status, 1);
      assert.match(res.stderr, new RegExp(`does not set ${OWN_VAR}|missing`));
    });
  }

  it('fails when a surface leads with the BANKING audience', () => {
    // The exact live regression: the banking list reaching the invest server.
    const res = run(makeRoot({ overrides: { k8s: 'mcpserver.ping.demo,mcpgateway.ping.demo' } }));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /starts with "mcpserver\.ping\.demo"/);
  });

  it('fails when a surface drifts from a renamed topology URI', () => {
    // Topology renames the resource; surfaces still carry the old URI.
    const res = run(makeRoot({ uri: 'mcp-invest-v2.ping.demo' }));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /mcp-invest-v2\.ping\.demo/);
  });

  it('fails when the server goes back to preferring the shared banking name', () => {
    const res = run(makeRoot({ ownVarInSrc: false }));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /RESOURCE_URI_ENV must be/);
  });

  it('exits 1 with a clear message when the topology resource is missing', () => {
    const dir = makeRoot();
    fs.writeFileSync(path.join(dir, 'scope-topology.json'), JSON.stringify({ resources: {} }));
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no resources\["Super Banking MCP Invest"\]\.uri/);
  });
});
