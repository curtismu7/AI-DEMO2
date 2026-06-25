// demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js
// Gated real suite for OAuth Teaching P4 (DEMONSTRATE). Self-skips without a live
// enduser session (createBffClient throws → enduser stays undefined → each test returns).
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

describe('OAuth Teaching P4 DEMONSTRATE (oauth-teaching vertical)', () => {
  let enduser;
  beforeAll(async () => {
    try { enduser = createBffClient('enduser'); } catch { return; }
    await setVertical(enduser, 'oauth-teaching');
  });
  afterAll(async () => { if (enduser) await restoreVertical(enduser); });

  const ask = (prompt) =>
    enduser.post('/api/agent/invoke', { prompt, forceHeuristic: true }).then((r) => r.data);

  it('demonstrate_token_exchange records real token-chain events', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate a real token exchange');
    expect(Array.isArray(data.tokenEvents)).toBe(true);
    expect(data.tokenEvents.length).toBeGreaterThan(0);
    expect(String(data.reply)).toMatch(/RFC 8693/);
  });

  it('demonstrate_scope_denial returns a real denial (or honest permitted)', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate a scope denial');
    expect(String(data.reply)).toMatch(/denied|permitted/i);
  });

  it('demonstrate_hitl returns a real consent challenge and does not auto-execute', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate hitl with a real transfer');
    expect(data.error).toBe('hitl_required');
    expect(data.hitlChallengeId).toBeTruthy();
    // No raw JWT leaks anywhere in the response (matches the P2/P3 leakage assertion).
    expect(JSON.stringify(data)).not.toMatch(/ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  });
});
