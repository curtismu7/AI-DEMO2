'use strict';

// The /internal/agent-tool callback (routes/agentTool.js) builds a fakeReq
// with no .headers at all — it resolves the session server-side via
// sessionStore.get() and only carries req.sessionID. mintIdJag's loopback
// call to /api/enterprise-idp/token used to forward req.headers.cookie
// verbatim, which was always empty for that path, so the loopback request
// arrived with no session and enterpriseIdp.js returned 401 invalid_grant
// ("No signed-in user for this exchange") on every follow-up agent turn.
// mintIdJag must re-sign a connect.sid cookie from req.sessionID in that
// case so the loopback call authenticates like the original browser request.

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'enterprise_idp_issuer') return 'https://idp.example';
    if (key === 'enterprise_idp_jwks_url') return 'https://idp.example/jwks';
    return null;
  }),
}));

const crypto = require('crypto');
const axios = require('axios');
const { mintIdJag } = require('../../services/idJagService');

const SECRET = 'test-session-secret';

function unsignCookieSignature(signed, secret) {
  // Mirrors cookie-signature's own sign/unsign algorithm independently of
  // the production code under test.
  const val = signed.slice(2); // strip 's:'
  const str = val.slice(0, val.lastIndexOf('.'));
  const mac = crypto.createHmac('sha256', secret).update(str).digest('base64').replace(/=+$/, '');
  const expected = `${str}.${mac}`;
  return expected === val ? str : false;
}

let prevSecret;
beforeAll(() => {
  prevSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = prevSecret;
});

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { access_token: 'jag-token', expires_in: 120 } });
});

test('forwards a real browser Cookie header unchanged', async () => {
  const req = {
    session: { user: { oauthId: 'user-1' } },
    headers: { cookie: 'connect.sid=s%3Areal-session.sig' },
  };

  await mintIdJag(req, { audience: 'aud', resource: 'res', scope: 'scope' });

  const [, , opts] = axios.post.mock.calls[0];
  expect(opts.headers.Cookie).toBe('connect.sid=s%3Areal-session.sig');
});

test('re-signs a connect.sid cookie from req.sessionID when headers are absent', async () => {
  const req = {
    session: { user: { oauthId: 'user-1' } },
    sessionID: 'agent-tool-session-id',
  };

  await mintIdJag(req, { audience: 'aud', resource: 'res', scope: 'scope' });

  const [, , opts] = axios.post.mock.calls[0];
  const [name, value] = opts.headers.Cookie.split('=');
  expect(name).toBe('connect.sid');
  const signed = decodeURIComponent(value);
  expect(unsignCookieSignature(signed, SECRET)).toBe('agent-tool-session-id');
});

test('falls back to an empty Cookie header when neither headers nor sessionID are present', async () => {
  const req = { session: { user: { oauthId: 'user-1' } } };

  await mintIdJag(req, { audience: 'aud', resource: 'res', scope: 'scope' });

  const [, , opts] = axios.post.mock.calls[0];
  expect(opts.headers.Cookie).toBe('');
});
