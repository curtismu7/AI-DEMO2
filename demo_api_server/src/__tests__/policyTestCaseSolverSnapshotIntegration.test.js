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

  test('MCP Deny — Invalid A2A Generalist: trigger needs a 2+ hop chain with an unverified generalist', () => {
    const tc = findRule(policies, 'MCP Deny — Invalid A2A Generalist').testCases;
    expect(tc.trigger.preset).toBe('custom');
    expect(tc.trigger.parameters).toMatchObject({ ActChainDepth: 2, NestedActClientId: '' });
    expect(tc.avoid.parameters.ActChainDepth).toBe(1);
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
