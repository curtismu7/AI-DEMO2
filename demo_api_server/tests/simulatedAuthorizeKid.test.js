/**
 * Simulated MCP engine — signing-key guard, parity with the live P1AZ
 * "MCP Deny — Invalid Kid" rule.
 *
 * tokenKidKnown is resolved by the caller against the live JWKS. null means
 * unknown (no kid, or JWKS unavailable) and must NOT deny — parity with the
 * live path, where the attribute is omitted and the rule cannot fire.
 */
const svc = require('../services/simulatedAuthorizeService');

async function evalTool(overrides = {}) {
  return svc.evaluateMcpFirstTool({
    userId: 'user-1',
    toolName: 'get_my_accounts',
    tokenAudience: 'https://mcp.example',
    mcpResourceUri: 'https://mcp.example',
    ...overrides,
  });
}

test('DENYs when the token names a kid the issuer does not publish', async () => {
  const r = await evalTool({ tokenKid: 'kid-forged', tokenKidKnown: false });
  expect(r.decision).toBe('DENY');
  expect(r.raw.deny_reason).toBe('invalid_kid');
  expect(r.raw.reason).toMatch(/kid-forged/);
});

test('does NOT deny when the kid is published', async () => {
  const r = await evalTool({ tokenKid: 'kid-known', tokenKidKnown: true });
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('does NOT deny when JWKS was unavailable (null = unknown, not forged)', async () => {
  const r = await evalTool({ tokenKid: 'kid-abc', tokenKidKnown: null });
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('does NOT deny when the token header carries no kid', async () => {
  const r = await evalTool();
  expect(r.raw?.deny_reason).not.toBe('invalid_kid');
});

test('surfaces TokenKid / TokenKidKnown in the decision parameters', async () => {
  const r = await evalTool({ tokenKid: 'kid-known', tokenKidKnown: true });
  expect(r.raw.parameters.TokenKid).toBe('kid-known');
  expect(r.raw.parameters.TokenKidKnown).toBe(true);
});
