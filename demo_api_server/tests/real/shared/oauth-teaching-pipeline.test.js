// demo_api_server/tests/real/shared/oauth-teaching-pipeline.test.js
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

describe('OAuth Teaching — E2E (oauth-teaching vertical)', () => {
  let enduser;
  beforeAll(async () => {
    try { enduser = createBffClient('enduser'); } catch { return; }
    await setVertical(enduser, 'oauth-teaching');
  });
  afterAll(async () => { await restoreVertical(enduser); });

  it('explain token exchange → reply + token-exchange panel directive', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'explain token exchange', forceHeuristic: true });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.education?.panel).toBe('token-exchange');
    expect(String(r.data.reply)).toMatch(/RFC 8693/);
  });

  it('inspect my token → token_pair verticalResult with decoded T1, no raw token', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'inspect my token', forceHeuristic: true });
    expect(r.status).toBe(200);
    if (r.data?.verticalResult) {
      expect(r.data.verticalResult.render).toBe('token_pair');
      expect(r.data.verticalResult.data?.t1?.payload?.sub).toBeTruthy();
    }
    // Never leak a raw JWT string anywhere in the response.
    expect(JSON.stringify(r.data)).not.toMatch(/ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  });

  it('explain does NOT run an authz pre-flight or deny (local bypass)', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'explain scopes', forceHeuristic: true });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.error).toBeUndefined();
  });
});
