// banking_api_server/src/__tests__/bffSessionGating.test.js
const {
  isCookieOnlyBffSession,
  mcpNoBearerResponse,
  SESSION_NOT_HYDRATED_MESSAGE,
} = require('../../services/bffSessionGating');

describe('bffSessionGating', () => {
  describe('isCookieOnlyBffSession', () => {
    it('is true when session was restored from _auth cookie', () => {
      expect(
        isCookieOnlyBffSession({
          session: { user: { id: '1' }, _restoredFromCookie: true, oauthTokens: { accessToken: 'real' } },
        }),
      ).toBe(true);
    });

    it('is true when access token is the cookie stub', () => {
      expect(
        isCookieOnlyBffSession({
          session: {
            user: { id: '1' },
            oauthTokens: { accessToken: '_cookie_session' },
          },
        }),
      ).toBe(true);
    });

    it('is false for a normal OAuth session', () => {
      expect(
        isCookieOnlyBffSession({
          session: {
            user: { id: '1' },
            oauthTokens: { accessToken: 'eyJhbGciOiJSUzI1NiJ9.x.y' },
          },
        }),
      ).toBe(false);
    });
  });

  describe('mcpNoBearerResponse', () => {
    it('returns session_not_hydrated when cookie-only session', () => {
      const req = {
        session: { user: { id: '1' }, oauthTokens: { accessToken: '_cookie_session' } },
      };
      const r = mcpNoBearerResponse(req, []);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('session_not_hydrated');
      expect(r.body.message).toBe(SESSION_NOT_HYDRATED_MESSAGE);
      expect(r.body.tokenEvents).toEqual([]);
    });

    it('returns authentication_required when not signed in at all', () => {
      const r = mcpNoBearerResponse({ session: {} }, null);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('authentication_required');
    });
  });
});
