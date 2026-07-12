/**
 * Simulated MCP engine — missing-subject parity with the P1AZ snapshot's
 * "MCP Deny — Missing User ID" rule. No authenticated subject → fail closed.
 */
const svc = require('../../services/simulatedAuthorizeService');

async function evalTool(overrides = {}) {
  return svc.evaluateMcpFirstTool({
    userId: 'user-1',
    toolName: 'get_my_accounts',
    tokenAudience: 'https://mcp.example',
    mcpResourceUri: 'https://mcp.example',
    ...overrides,
  });
}

test('DENYs when userId is absent / empty / the "none" sentinel', async () => {
  for (const bad of [undefined, null, '', '   ', 'none', 'None']) {
    const r = await evalTool({ userId: bad });
    expect(r.decision).toBe('DENY');
    expect(r.raw.reason).toMatch(/missing_user_id/i);
  }
});

test('does not DENY a normal call with a subject (guard is scoped to missing subject)', async () => {
  const r = await evalTool({ userId: 'user-1' });
  expect(r.decision).not.toBe('DENY'); // permitted or gated, but not the missing-user deny
  if (r.raw?.reason) expect(r.raw.reason).not.toMatch(/missing_user_id/i);
});
