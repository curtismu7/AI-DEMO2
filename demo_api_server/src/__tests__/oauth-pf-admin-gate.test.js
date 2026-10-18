/**
 * PF admin sign-in must require PingOne `pingone-admin` membership (PF bypasses the PingOne
 * admin app's own group restriction). Refusal = redirect, no session, no auth cookie.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../../services/oauthService');
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingfederate'),
  getEffective: jest.fn(() => ''),
  setConfig: jest.fn().mockResolvedValue(undefined),
  isConfigured: jest.fn(() => true),
}));
jest.mock('../../data/store');
jest.mock('../../middleware/auth');
jest.mock('../../services/oidcIdTokenValidationService', () => ({
  validateIdToken: jest.fn().mockResolvedValue({ sub: 'pf-sub' }),
  assertUserInfoSubjectMatches: jest.fn(),
}));
jest.mock('../../services/adminSessionService', () => ({
  establishAdminSession: jest.fn(async (req) => {
    req.session.user = { id: 'u1', role: 'admin' };
    return { ok: true, oauthTokens: { accessToken: 'at', expiresAt: Date.now() + 3600000 } };
  }),
}));
jest.mock('../../services/pingOneGroupMembershipService', () => ({
  isPingOneAdminByUsername: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const configStore = require('../../services/configStore');
const dataStore = require('../../data/store');
const auth = require('../../middleware/auth');
const { establishAdminSession } = require('../../services/adminSessionService');
const { isPingOneAdminByUsername } = require('../../services/pingOneGroupMembershipService');

function buildApp() {
  const app = express();
  app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
  app.get('/__test/admin-login-session', (req, res) => {
    Object.assign(req.session, {
      oauthType: 'admin',
      oauthState: 's1',
      oauthCodeVerifier: 'v1',
      oauthRedirectUri: 'https://local.ping-devops.com:4000/api/auth/oauth/callback',
      oauthNonce: 'n1',
      oauthLoginProvider: req.query.provider || 'pingfederate',
    });
    req.session.save((err) => res.sendStatus(err ? 500 : 204));
  });
  app.get('/__test/session-user', (req, res) => res.json({ user: req.session.user || null }));
  app.use('/api/auth/oauth', require('../../routes/oauth'));
  return app;
}

describe('PF admin callback group gate', () => {
  let app;
  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    oauthService.exchangeCodeForToken = jest.fn().mockResolvedValue({ access_token: 'at', id_token: 'it' });
    oauthService.getUserInfo = jest.fn().mockResolvedValue({ sub: 'pf-sub', preferred_username: 'someone' });
    oauthService.createUserFromOAuth = jest.fn().mockReturnValue({ username: 'someone', email: 's@x.test' });
    dataStore.getUserByUsername = jest.fn().mockReturnValue(null);
    dataStore.createUser = jest.fn().mockResolvedValue({ id: 'u1', username: 'someone', role: 'admin' });
    dataStore.updateUser = jest.fn();
    auth.determineClientType = jest.fn().mockReturnValue('admin');
  });

  async function signIn(provider) {
    const agent = request.agent(app);
    await agent.get(`/__test/admin-login-session${provider ? `?provider=${provider}` : ''}`).expect(204);
    const res = await agent.get('/api/auth/oauth/callback?code=c1&state=s1');
    const who = await agent.get('/__test/session-user');
    return { res, sessionUser: who.body.user };
  }

  const expectRefused = ({ res, sessionUser }) => {
    expect(res.headers.location).toContain('/login?error=admin_access_required');
    expect(establishAdminSession).not.toHaveBeenCalled();
    expect(dataStore.createUser).not.toHaveBeenCalled();
    expect(dataStore.updateUser).not.toHaveBeenCalled();
    expect(sessionUser).toBeNull();
    const cookies = [].concat(res.headers['set-cookie'] || []).join(';');
    expect(cookies).not.toMatch(/auth_state=[^;]+[A-Za-z0-9]/);
  };

  test('customer-only PF user is refused admin', async () => {
    isPingOneAdminByUsername.mockResolvedValue(false);
    expectRefused(await signIn());
    expect(isPingOneAdminByUsername).toHaveBeenCalledWith('someone');
  });

  test('lookup error refuses admin (fail closed)', async () => {
    isPingOneAdminByUsername.mockRejectedValue(new Error('PingOne down'));
    const { res } = await signIn();
    expect(res.headers.location).toContain('/login?error=');
    expect(res.headers.location).not.toContain('oauth=success');
    expect(establishAdminSession).not.toHaveBeenCalled();
  });

  test('admin-group PF user signs in as admin', async () => {
    isPingOneAdminByUsername.mockResolvedValue(true);
    const { res } = await signIn();
    expect(res.headers.location).toContain('oauth=success');
    expect(establishAdminSession).toHaveBeenCalled();
  });

  test('PingOne admin sign-in is not gated here (PingOne app enforces the group)', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    const { res } = await signIn('pingone');
    expect(isPingOneAdminByUsername).not.toHaveBeenCalled();
    expect(res.headers.location).toContain('oauth=success');
  });
});
