'use strict';
/**
 * Self-test for check-tool-scope-registration.js.
 *
 *   node --test scripts/check-tool-scope-registration.test.js
 *
 * Each case builds a throwaway repo root (scope-topology.json + a tools dir +
 * a router) and points the checker at it with TOOL_SCOPE_ROOT. The allowlist is
 * injected with TOOL_SCOPE_ALLOWLIST so these stay hermetic — the real one names
 * real repo tools, which do not exist in a temp fixture.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHECKER = path.join(__dirname, 'check-tool-scope-registration.js');

/**
 * Build a fixture root.
 * @param {{scopes?: string[], aliases?: Record<string,string>, tools?: string, router?: string}} opts
 * @returns {string} absolute path to the fixture root
 */
function fixture(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-scope-'));
  const scopes = {};
  for (const s of opts.scopes || ['read']) scopes[s] = { description: s };
  fs.writeFileSync(
    path.join(root, 'scope-topology.json'),
    JSON.stringify({ scopes, aliases: opts.aliases || {}, tools: {} }),
  );

  const toolsDir = path.join(root, 'demo_mcp_resource_server/src/tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'demoTools.ts'), opts.tools || '');

  const gatewayDir = path.join(root, 'demo_mcp_gateway/src');
  fs.mkdirSync(gatewayDir, { recursive: true });
  fs.writeFileSync(path.join(gatewayDir, 'router.ts'), opts.router || '');
  return root;
}

/**
 * Run the checker against a fixture with an injected allowlist.
 * @param {string} root
 * @param {string[]} allowlist
 * @returns {{code: number, out: string}}
 */
function run(root, allowlist = []) {
  try {
    const out = execFileSync('node', [CHECKER], {
      env: {
        ...process.env,
        TOOL_SCOPE_ROOT: root,
        TOOL_SCOPE_ALLOWLIST: JSON.stringify(allowlist),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('passes when every requiredScopes entry is a registered scope', () => {
  const root = fixture({
    scopes: ['read', 'airlines:read'],
    tools: `
      { name: 'view_records', requiredScopes: ['read'] },
      { name: 'list_flights', requiredScopes: ['airlines:read'] },
    `,
  });
  const { code, out } = run(root);
  assert.strictEqual(code, 0, out);
  assert.match(out, /2 scope reference/);
});

test('fails on a scope that is not registered in scope-topology.json', () => {
  const root = fixture({
    scopes: ['read'],
    tools: `{ name: 'get_patient_record', requiredScopes: ['healthcare:read'] },`,
  });
  const { code, out } = run(root);
  assert.strictEqual(code, 1);
  assert.match(out, /healthcare:read/);
  assert.match(out, /get_patient_record/);
});

test('accepts an alias as a real scope', () => {
  const root = fixture({
    scopes: ['mcp:invoke'],
    aliases: { 'gateway:mcp:invoke': 'mcp:invoke' },
    tools: `{ name: 'invoke_thing', requiredScopes: ['gateway:mcp:invoke'] },`,
  });
  const { code, out } = run(root);
  assert.strictEqual(code, 0, out);
});

test('allowlisted unrouted tool passes while it stays unrouted', () => {
  const root = fixture({
    scopes: ['read'],
    tools: `{ name: 'get_patient_record', requiredScopes: ['healthcare:read'] },`,
    router: `const HEALTHCARE_TOOLS = new Set(['view_records']);`,
  });
  const { code, out } = run(root, ['get_patient_record']);
  assert.strictEqual(code, 0, out);
  assert.match(out, /1 allowlisted/);
});

test('allowlisted tool FAILS the moment the router references it', () => {
  const root = fixture({
    scopes: ['read'],
    tools: `{ name: 'get_patient_record', requiredScopes: ['healthcare:read'] },`,
    router: `const HEALTHCARE_TOOLS = new Set(['view_records', 'get_patient_record']);`,
  });
  const { code, out } = run(root, ['get_patient_record']);
  assert.strictEqual(code, 1);
  assert.match(out, /get_patient_record/);
  assert.match(out, /routed/i);
});

test('allowlist entry for a tool that no longer exists is reported as stale', () => {
  const root = fixture({
    scopes: ['read'],
    tools: `{ name: 'view_records', requiredScopes: ['read'] },`,
  });
  const { code, out } = run(root, ['get_deleted_tool']);
  assert.strictEqual(code, 1);
  assert.match(out, /stale/i);
  assert.match(out, /get_deleted_tool/);
});
