const { getAuthorizationPoliciesFromSnapshot } = require('../../services/pingOneAuthorizeService');

function findRule(nodes, name) {
  for (const n of nodes) {
    if (n.kind === 'RULE' && n.name === name) return n;
    const found = findRule(n.children || [], name);
    if (found) return found;
  }
  return null;
}

describe('getAuthorizationPoliciesFromSnapshot testCases wiring', () => {
  const policies = getAuthorizationPoliciesFromSnapshot();

  test('snapshot loads', () => {
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
  });

  test('unconditional rules get no test cases', () => {
    expect(findRule(policies, 'Permit Standard Transactions').testCases).toBeNull();
    expect(findRule(policies, 'MCP Permit Valid Tool Invocation').testCases).toBeNull();
  });

  test('Deny Large Transactions: Amount > 2000', () => {
    const tc = findRule(policies, 'Deny Large Transactions').testCases;
    expect(tc.trigger.preset).toBe('transaction');
    expect(tc.trigger.parameters.Amount).toBe(2001);
    expect(tc.avoid.parameters.Amount).toBe(2000);
  });

  test('Require Step-Up MFA for High-Value Transfers: Amount > 500, transfer/withdrawal, no MFA', () => {
    const tc = findRule(policies, 'Require Step-Up MFA for High-Value Transfers').testCases;
    expect(tc.trigger.preset).toBe('transaction');
    expect(tc.trigger.parameters).toMatchObject({ Amount: 501, TransactionType: 'transfer', Acr: '' });
    expect(tc.avoid.parameters).toMatchObject({ Amount: 500, TransactionType: 'transfer', Acr: '' });
  });

  test('Require Consent for Mid-Value Transactions: Amount > 250', () => {
    const tc = findRule(policies, 'Require Consent for Mid-Value Transactions').testCases;
    expect(tc.trigger.parameters.Amount).toBe(251);
    expect(tc.avoid.parameters.Amount).toBe(250);
  });

  test('MCP Deny — Invalid Token Audience: TokenAudience must differ from McpResourceUri to trigger', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid Token Audience').testCases;
    expect(tc.trigger.preset).toBe('mcp');
    expect(tc.trigger.parameters.TokenAudience).toBe('__generated__');
    expect(tc.avoid.parameters.TokenAudience).toBe(tc.avoid.parameters.McpResourceUri);
  });

  test('MCP Deny — Missing User ID: UserId must be "none" to trigger', () => {
    const tc = findRule(policies, 'MCP Deny — Missing User ID').testCases;
    expect(tc.trigger.parameters.UserId).toBe('none');
    expect(tc.avoid.parameters.UserId).toBe('demoUser');
  });

  test('MCP Deny — Invalid Actor Chain: avoid uses a registered actor id', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid Actor Chain').testCases;
    expect(tc.avoid.parameters.ActClientId).toBe('f4dd707d-f78d-4417-ba56-dc8707d10a1f');
  });

  test('MCP Require HITL Consent for sensitive tools: trigger uses a gated tool with HitlApproved false', () => {
    const tc = findRule(policies, 'MCP Require HITL Consent for sensitive tools').testCases;
    expect(tc.trigger.parameters).toMatchObject({ ToolName: 'book_appointment', HitlApproved: false });
  });

  // Inverted by #1003, and this assertion was left behind asserting the OLD
  // semantics (trigger on a 2-hop chain). It red-gated every push in the repo.
  //
  // The rule denies a SHALLOW chain: an A2A-delegated tool reached without the
  // specialist hop. So the triggering case is depth 1 on a delegated tool.
  //
  // The tool list is read from scope-topology.json rather than hardcoded — the
  // condition is generated from that same source, so pinning a literal tool name
  // here would just restate the generator and rot the moment a specialist tool
  // is added.
  test('MCP Deny — A2A Delegation Required: a SHALLOW chain on a delegated tool triggers', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid A2A Generalist').testCases;
    const sot = require('../../../scope-topology.json');
    const a2aTools = Object.entries(sot.tools)
      .filter(([, m]) => m && m.a2aDelegated === true)
      .map(([n]) => n);
    expect(a2aTools.length).toBeGreaterThan(0);

    expect(tc.trigger.preset).toBe('custom');
    expect(tc.trigger.parameters.ActChainDepth).toBe(1);
    expect(a2aTools).toContain(tc.trigger.parameters.ToolName);

    // The solver escapes this condition via the TOOL, not the depth — `avoid`
    // picks a non-delegated tool and leaves depth at 1. Asserted as-is rather
    // than wished otherwise. NOTE the limitation: this control proves the rule
    // ignores unrelated tools, NOT that a proper two-hop chain is permitted.
    // That second property is covered live by verify:a2a-policy, which is where
    // it belongs — it needs a real decision, not a solved parameter set.
    expect(a2aTools).not.toContain(tc.avoid.parameters.ToolName);
  });

  test('MCP Require Step-Up for sensitive tools: trigger uses a gated tool with no MFA', () => {
    const tc = findRule(policies, 'MCP Require Step-Up for sensitive tools').testCases;
    expect(tc.trigger.preset).toBe('custom');
    expect(tc.trigger.parameters).toMatchObject({ ToolName: 'cash_out_store_credit', Acr: '' });
  });

  test('MCP Deny — Tier Tool Not Allowed: trigger is a Standard-tier user on a restricted tool', () => {
    const tc = findRule(policies, 'MCP Deny — Tier Tool Not Allowed').testCases;
    expect(tc.trigger.parameters).toMatchObject({ UserTier: 'Standard', ToolName: 'create_withdrawal' });
    expect(tc.avoid.parameters.UserTier).toBe('PrivateBanking');
  });

  test('MCP Deny — Tier Amount Exceeded: trigger is a Standard-tier user over the $2000 cap', () => {
    const tc = findRule(policies, 'MCP Deny — Tier Amount Exceeded').testCases;
    expect(tc.trigger.parameters).toMatchObject({ UserTier: 'Standard', Amount: 2001 });
    expect(tc.avoid.parameters.UserTier).toBe('PrivateBanking');
  });

  test('MCP Deny — Not In Required Group: trigger requires a group the user lacks', () => {
    const tc = findRule(policies, 'MCP Deny — Not In Required Group').testCases;
    expect(tc.trigger.parameters).toMatchObject({ InRequiredGroup: false });
    expect(tc.trigger.parameters.RequiredGroup).not.toBe('none');
    expect(tc.avoid.parameters.RequiredGroup).toBe('none');
  });
});
