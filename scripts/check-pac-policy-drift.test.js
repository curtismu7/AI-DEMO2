#!/usr/bin/env node
/**
 * Negative tests for check-pac-policy-drift.js.
 * Run: node --test scripts/check-pac-policy-drift.test.js
 *
 * Each case builds a minimal fixture tree (scope-topology.json +
 * pac/policies/mcp-delegation.yaml) and points the checker at it with
 * PAC_DRIFT_ROOT, so the assertions never depend on the live repo contents.
 */

'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'scripts', 'check-pac-policy-drift.js');

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Minimal policy file with a DenyA2aDelegationRequired rule listing `tools`. */
function policyYaml(toolNames, ruleName = 'DenyA2aDelegationRequired') {
  const list = toolNames.map((t) => `"${t}"`).join(', ');
  return [
    'policyset SuperBankingMcpPolicies evaluate deny-overrides:',
    '',
    '  policy McpDelegationAuthorization evaluate deny-overrides:',
    '',
    `    rule ${ruleName} deny:`,
    '      obligation:',
    '        code: mcp-invalid-a2a-generalist',
    '        payload: "A2A delegation is required for this tool."',
    `      - Request.ToolName in (${list})`,
    '      - Request.ActChainDepth < 2',
    '',
    '    rule McpPermitValidToolInvocation permit',
    '',
    'tests:',
    "  test 'decoy — tool names here must never satisfy the gate':",
    '    request:',
    '      attributes:',
    '        ToolName: "sensitive_decoy_record"',
    '    expect:',
    '      decision: deny',
    '',
  ].join('\n');
}

/** Fixture: two delegated tools, one ordinary tool. */
function topologyJson(extra = {}) {
  return JSON.stringify(
    {
      tools: {
        get_portfolio_summary: { requiredScopes: ['invest:read'], surface: 'gateway', a2aDelegated: true },
        sensitive_passenger_record: {
          requiredScopes: ['read'],
          surface: 'gateway',
          challengeType: 'consent',
          a2aDelegated: true,
        },
        banking_get_accounts: { requiredScopes: ['read'], surface: 'gateway' },
        ...extra,
      },
    },
    null,
    2,
  );
}

function makeRoot(topology, policy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pac-drift-'));
  tmpRoots.push(dir);
  fs.mkdirSync(path.join(dir, 'pac', 'policies'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scope-topology.json'), topology);
  fs.writeFileSync(path.join(dir, 'pac', 'policies', 'mcp-delegation.yaml'), policy);
  return dir;
}

function runCheck(root) {
  const res = spawnSync(process.execPath, [CHECK], {
    env: { ...process.env, PAC_DRIFT_ROOT: root },
    encoding: 'utf8',
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

describe('check-pac-policy-drift', () => {
  it('passes when the rule lists exactly the a2aDelegated tools', () => {
    const root = makeRoot(
      topologyJson(),
      policyYaml(['get_portfolio_summary', 'sensitive_passenger_record']),
    );
    const { code, out } = runCheck(root);
    assert.equal(code, 0, out);
    assert.match(out, /in sync/);
  });

  it('FAILS when an a2aDelegated tool is missing from the rule (the #1279 defect)', () => {
    const root = makeRoot(topologyJson(), policyYaml(['get_portfolio_summary']));
    const { code, out } = runCheck(root);
    assert.equal(code, 1, out);
    assert.match(out, /does NOT list "sensitive_passenger_record"/);
  });

  it('FAILS when the rule lists a tool that is not a2aDelegated (stale entry)', () => {
    const root = makeRoot(
      topologyJson(),
      policyYaml(['get_portfolio_summary', 'sensitive_passenger_record', 'banking_get_accounts']),
    );
    const { code, out } = runCheck(root);
    assert.equal(code, 1, out);
    assert.match(out, /lists "banking_get_accounts" but it is not among/);
  });

  it('FAILS when the rule lists a tool that no longer exists at all', () => {
    const root = makeRoot(
      topologyJson(),
      policyYaml(['get_portfolio_summary', 'sensitive_passenger_record', 'deleted_tool']),
    );
    const { code, out } = runCheck(root);
    assert.equal(code, 1, out);
    assert.match(out, /lists "deleted_tool" but no such tool exists/);
  });

  it('FAILS (never passes vacuously) when the rule is renamed or deleted', () => {
    const root = makeRoot(
      topologyJson(),
      policyYaml(['get_portfolio_summary', 'sensitive_passenger_record'], 'SomeOtherRuleName'),
    );
    const { code, out } = runCheck(root);
    assert.equal(code, 1, out);
    assert.match(out, /rule DenyA2aDelegationRequired is missing, renamed/);
  });

  it('FAILS when scope-topology.json declares no a2aDelegated tools (inert gate)', () => {
    const topology = JSON.stringify({
      tools: { banking_get_accounts: { requiredScopes: ['read'], surface: 'gateway' } },
    });
    const root = makeRoot(topology, policyYaml([]));
    const { code, out } = runCheck(root);
    assert.equal(code, 1, out);
    assert.match(out, /derived an EMPTY tool set/);
  });

  it('passes against the real repository (shipped state is in sync)', () => {
    const { code, out } = runCheck(ROOT);
    assert.equal(code, 0, out);
  });
});
