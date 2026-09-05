// The façade's privilege-gateway door swaps in a server-side gateway token
// (mcpFacade.js ownsUpstreamAuth). That token is in-memory and single-session,
// so every BFF restart kills it and the door 503s. Nothing surfaced that state,
// which is why the door could be dead with no external signal. /state is where
// the page learns it.
const request = require('supertest');
const app = require('../../server');
const privilegeGatewaySession = require('../../services/privilegeGatewaySession');

const TOKEN_URI = 'https://mcpgw.ai-demo.ping-devops.com/oauth/token';

describe('GET /api/privilege-mcp/state — gatewaySession', () => {
  afterEach(() => privilegeGatewaySession.clear());

  it('reports no_session when no human has signed in', async () => {
    privilegeGatewaySession.clear();

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: false, reason: 'no_session' });
  });

  it('reports ready once a gateway session is remembered', async () => {
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: 'refresh', expiresIn: 3600, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: true });
  });

  it('reports expired for a lapsed token with no refresh token', async () => {
    // expiresIn of 1s is inside REFRESH_SKEW_MS (60s), so status() already
    // treats it as past its refresh point — no fake timers needed.
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: null, expiresIn: 1, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: false, reason: 'expired' });
  });

  it('reports refreshable for a lapsed token that still has a refresh token', async () => {
    privilegeGatewaySession.remember({
      accessToken: 'tok', refreshToken: 'refresh', expiresIn: 1, tokenUri: TOKEN_URI,
    });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewaySession).toEqual({ ready: true, reason: 'refreshable' });
  });
});
