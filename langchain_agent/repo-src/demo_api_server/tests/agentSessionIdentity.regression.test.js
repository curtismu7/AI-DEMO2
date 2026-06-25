/**
 * Regression: agentSessionMiddleware must resolve userId from the PingOne sub
 * (oauthId/sub) ONLY, and fail closed if it is absent — never fall back to the
 * legacy numeric/internal session.user.id.
 *
 * ARCHITECTURE-TRUTHS T-6. The old `oauthId || id` fallback silently used the
 * wrong UUID when oauthId was missing; per-user data (keyed on the PingOne sub)
 * then came back empty and looked like "no transactions".
 */
jest.mock('../services/oauthUserService', () => ({
  refreshAccessToken: jest.fn(),
}));

const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function makeReq(user) {
  return {
    path: '/message',
    method: 'POST',
    sessionID: 'sess-1',
    session: {
      id: 'sess-1',
      user,
      oauthTokens: { accessToken: 'real-token', refreshToken: 'r', expiresAt: Date.now() + 60_000 },
      save: (cb) => cb && cb(),
    },
  };
}

describe('agentSessionMiddleware — PingOne-sub-only identity (T-6)', () => {
  test('uses oauthId (PingOne sub) as userId, not legacy id', async () => {
    const req = makeReq({ oauthId: 'pingone-uuid', id: 'legacy-numeric', email: 'u@x.com' });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.agentContext.userId).toBe('pingone-uuid');
    expect(req.agentContext.userId).not.toBe('legacy-numeric');
  });

  test('falls back to session.user.sub when oauthId absent', async () => {
    const req = makeReq({ sub: 'pingone-sub', id: 'legacy-numeric' });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.agentContext.userId).toBe('pingone-sub');
  });

  test('fails closed (401) when no PingOne sub — does NOT use legacy id', async () => {
    const req = makeReq({ id: 'legacy-numeric', email: 'u@x.com' });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.agentContext).toBeUndefined();
    const payload = res.json.mock.calls[0][0];
    expect(payload.need_auth).toBe(true);
  });
});
