#!/usr/bin/env node
/**
 * Negative tests for check-resource-server-audience-drift.js (table-driven
 * form: bindings are declared in scope-topology.json resources[*].audienceEnv).
 * Run: node --test scripts/check-resource-server-audience-drift.test.js
 *
 * Each case builds a minimal fixture tree and points the checker at it with
 * RS_AUDIENCE_DRIFT_ROOT, so the assertions never depend on live repo contents.
 * A gate that only ever passes proves nothing — these cases prove it fails on
 * each shape of drift it claims to catch, and that a SECOND declared binding is
 * enforced with no checker change.
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

/** The invest binding as the fixtures declare it, mirroring the real topology. */
function investBinding() {
  return {
    var: OWN_VAR,
    surfaces: [
      { file: 'docker-compose.yml', kind: 'yaml' },
      { file: 'k8s/02-configmap.yaml', kind: 'yaml' },
      { file: 'privilege/ai-demo-whole-stack/ai-demo-stack/templates/02-configmap.yaml', kind: 'yaml' },
      { file: 'demo_mcp_resource_server/.env.example', kind: 'env' },
      { file: 'demo_api_server/scripts/refresh-service-envs.js', kind: 'js' },
    ],
    sourcePin: {
      file: 'demo_mcp_resource_server/src/server/acceptedAudiences.ts',
      mustInclude: `RESOURCE_URI_ENV = '${OWN_VAR}'`,
    },
  };
}

/**
 * Build a fixture tree. `overrides` replaces the value written for a given
 * surface; `omit` drops the var from that surface entirely.
 */
function makeRoot({ uri = 'mcp-invest.ping.demo', overrides = {}, omit = [], ownVarInSrc = true, extraResources = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-aud-drift-'));
  tmpRoots.push(dir);

  const write = (rel, body) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  write('scope-topology.json', JSON.stringify({
    resources: {
      'Super Banking MCP Invest': { uri, audienceEnv: investBinding() },
      ...extraResources,
    },
  }));

  const val = (name) => overrides[name] ?? GOOD;
  const has = (name) => !omit.includes(name);

  write(
    'docker-compose.yml',
    ['services:', '  mcp-resource-server:', '    environment:',
      has('compose') ? `      ${OWN_VAR}: "${val('compose')}"` : '      OTHER: "x"',
      ...(overrides.composeExtra ? [overrides.composeExtra] : [])].join('\n'),
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
    assert.match(res.stderr, /must contain/);
  });

  it('exits 1 with a clear message when NO binding is declared (vacuity guard)', () => {
    const dir = makeRoot();
    fs.writeFileSync(path.join(dir, 'scope-topology.json'), JSON.stringify({ resources: {} }));
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /NO audienceEnv bindings/);
  });

  it('a SECOND declared binding is enforced with no checker change', () => {
    // Declare a banking-server binding whose compose value drifts; the invest
    // binding stays green — the failure must name the second binding's var.
    const dir = makeRoot({
      overrides: { composeExtra: '      MCP_SERVER_RESOURCE_URI: "wrong.ping.demo,mcpgateway.ping.demo"' },
      extraResources: {
        'Super Banking MCP Server': {
          uri: 'mcpserver.ping.demo',
          audienceEnv: {
            var: 'MCP_SERVER_RESOURCE_URI',
            surfaces: [{ file: 'docker-compose.yml', kind: 'yaml' }],
          },
        },
      },
    });
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /MCP_SERVER_RESOURCE_URI starts with "wrong\.ping\.demo"/);
  });

  it('validates EVERY occurrence of the var on a surface, not just the first', () => {
    const dir = makeRoot({
      overrides: { composeExtra: `      ${OWN_VAR}: "sneaky-second.ping.demo"` },
    });
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /starts with "sneaky-second\.ping\.demo"/);
  });

  it('fails when a binding names a resource with no uri', () => {
    const dir = makeRoot({
      extraResources: { 'No URI Resource': { audienceEnv: { var: 'X_VAR', surfaces: [] } } },
    });
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /has no uri/);
  });
});
