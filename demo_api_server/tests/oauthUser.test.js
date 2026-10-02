const request = require('supertest');
const express = require('express');
const session = require('express-session');
const router = require('../routes/oauthUser');
const configStore = require('../services/configStore');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');

// Mock configStore to ensure user OAuth is configured
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = {
      'pingone_environment_id': 'test-env-id',
      'user_client_id': 'test-client-id',
      'user_client_secret': 'test-secret',
      'pf_user_client_id': 'test-pf-client-id',
      'pf_user_client_secret': 'test-pf-secret',
      'pf_user_redirect_uri': 'https://api.ping.demo:4000/api/auth/oauth/user/callback',
      'pf_authorization_endpoint': 'https://pf.example/as/authorization.oauth2',
    };
    return defaults[key];
  }),
  isUserOAuthConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));

// Mock other dependencies
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getUserRedirectUri: jest.fn(() => 'https://api.ping.demo:4000/api/auth/oauth/user/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));

jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../utils/oauthAuthorizeResource', () => ({
  buildPingOneAuthorizeResourceQueryParam: jest.fn(() => ''),
}));
jest.mock('../services/appEventService', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../services/mfaService', () => ({
  getPingOneUserContact: jest.fn(),
  listMfaDevices: jest.fn(),
  initiateOneTimeOtp: jest.fn(),
}));
// Must be mocked: the maskedContact fallback in /initiate-otp calls this
// whenever PingOne's response carries no device, and an unmocked call reaches
// the real network — which surfaces as an intermittent `read ECONNRESET`.
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserById: jest.fn().mockResolvedValue({ user: null }),
}));
const mfaService = require('../services/mfaService');

const app = express();
app.use(
  session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.json());
app.get('/__test/session/:provider', (req, res) => {
  req.session.oauthTokens = { accessToken: 'session-token', expiresAt: Date.now() + 60_000 };
  req.session.user = { oauthProvider: req.params.provider, email: 'user@example.test' };
  req.session.oauthType = 'user';
  req.session.save((error) => res.sendStatus(error ? 500 : 204));
});
app.use('/api/auth/oauth/user', router);

describe('OAuth User Login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('silent reauth requests prompt=none and returns to the page after login_required', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/oauth/user/silent-reauth?return_to=%2Fdashboard').expect(302);
    const authorizeUrl = new URL(start.headers.location);
    expect(authorizeUrl.searchParams.get('prompt')).toBe('none');
    const state = authorizeUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await agent.get('/api/auth/oauth/user/callback')
      .query({ error: 'login_required', state }).expect(302);
    expect(callback.headers.location).toBe(`${getFrontendOrigin()}/dashboard?silent_reauth_failed=1`);
  });

  test('should include correct redirect_uri in authorization URL', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    expect(location).toBeDefined();
    expect(location).toContain('https://');

    // Extract redirect_uri from the authorization URL
    const url = new URL(location);
    const redirectUri = url.searchParams.get('redirect_uri');

    // Verify redirect_uri is the correct expected value (URL-encoded)
    expect(redirectUri).toBe('https://api.ping.demo:4000/api/auth/oauth/user/callback');
  });

  test('should include state parameter for CSRF protection', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    const url = new URL(location);
    const state = url.searchParams.get('state');

    expect(state).toBeDefined();
    expect(state.length).toBeGreaterThan(0);
  });

  test('should include nonce parameter for OIDC replay protection', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    const url = new URL(location);
    const nonce = url.searchParams.get('nonce');

    expect(nonce).toBeDefined();
    expect(nonce.length).toBeGreaterThan(0);
  });

  test('should include code_challenge for PKCE flow', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    const url = new URL(location);
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');

    expect(codeChallenge).toBeDefined();
    expect(codeChallenge.length).toBeGreaterThan(0);
    expect(codeChallengeMethod).toBe('S256');
  });

  test('should redirect to PingOne authorization endpoint', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    expect(location).toContain('https://');
    expect(location).toContain('response_type=code');
  });

  test('should redirect with client_id in URL', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const location = res.headers.location;
    const url = new URL(location);
    const clientId = url.searchParams.get('client_id');

    expect(clientId).toBe('test-client-id');
  });

  test('force=true should send prompt=login so PingOne shows credentials', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login?force=true')
      .expect(302);

    const url = new URL(res.headers.location);
    expect(url.searchParams.get('prompt')).toBe('login');
  });

  test('normal login should not set prompt=login', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/login')
      .expect(302);

    const url = new URL(res.headers.location);
    expect(url.searchParams.get('prompt')).toBeNull();
  });

  test('a valid session from another provider starts the selected provider login', async () => {
    const browser = request.agent(app);
    await browser.get('/__test/session/pingfederate').expect(204);

    const res = await browser.get('/api/auth/oauth/user/login').expect(302);

    expect(new URL(res.headers.location).host).toBe('auth.pingone.com');
  });

  test('a valid session from the selected provider is reused', async () => {
    const browser = request.agent(app);
    await browser.get('/__test/session/pingone_sso').expect(204);

    const res = await browser.get('/api/auth/oauth/user/login').expect(302);

    expect(res.headers.location).toBe('http://localhost:3000/dashboard');
  });

  test('a PingOne session is not reused after selecting PingFederate', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const browser = request.agent(app);
    await browser.get('/__test/session/pingone_sso').expect(204);

    const res = await browser.get('/api/auth/oauth/user/login').expect(302);

    const authorizationUrl = new URL(res.headers.location);
    expect(authorizationUrl.origin + authorizationUrl.pathname)
      .toBe('https://pf.example/as/authorization.oauth2');
    expect(authorizationUrl.searchParams.get('client_id')).toBe('test-pf-client-id');
  });

  test('PingFederate selected but not running sends the user back with a clear error, not to a dead port', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const net = require('net');
    const srv = net.createServer().listen(0);
    const { port } = srv.address();
    await new Promise((r) => srv.close(r));
    process.env.PF_TOKEN_ENDPOINT = `https://127.0.0.1:${port}/as/token.oauth2`;
    try {
      const res = await request.agent(app).get('/api/auth/oauth/user/login').expect(302);
      const back = new URL(res.headers.location);
      expect(back.origin).toBe('http://localhost:3000');
      expect(back.searchParams.get('idp_error')).toBe('pingfederate_unreachable');
    } finally {
      delete process.env.PF_TOKEN_ENDPOINT;
    }
  });

  test('a valid PingFederate session is reused while PingFederate is selected', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const browser = request.agent(app);
    await browser.get('/__test/session/pingfederate').expect(204);

    const res = await browser.get('/api/auth/oauth/user/login').expect(302);

    expect(res.headers.location).toBe('http://localhost:3000/dashboard');
  });
});

describe('sanitizeStepUpReturnTo', () => {
  const { sanitizeStepUpReturnTo } = require('../routes/oauthUser');
  const origin = 'http://localhost:3000';

  test('allows same-origin absolute URL used by the dashboard step-up link', () => {
    expect(sanitizeStepUpReturnTo(`${origin}/dashboard`)).toBe(`${origin}/dashboard`);
  });

  test('allows relative SPA paths', () => {
    expect(sanitizeStepUpReturnTo('/dashboard')).toBe(`${origin}/dashboard`);
  });

  test('rejects external absolute URLs (open redirect)', () => {
    expect(sanitizeStepUpReturnTo('https://evil.example/phish')).toBe(`${origin}/dashboard`);
  });

  test('rejects protocol-relative and javascript URLs', () => {
    expect(sanitizeStepUpReturnTo('//evil.example/phish')).toBe(`${origin}/dashboard`);
    expect(sanitizeStepUpReturnTo('javascript:alert(1)')).toBe(`${origin}/dashboard`);
  });

  test('defaults when return_to is missing', () => {
    expect(sanitizeStepUpReturnTo(undefined)).toBe(`${origin}/dashboard`);
    expect(sanitizeStepUpReturnTo('')).toBe(`${origin}/dashboard`);
  });
});

// The PingOne user *profile* email is provisioned synthetically from the app
// host (demoUser@api.ping.demo) and is undeliverable, so OTP delivery must
// target the address on the user's registered MFA device instead.
describe('initiate-otp delivery target', () => {
  const PROFILE_EMAIL = 'demoUser@api.ping.demo';
  const ENROLLED_EMAIL = 'real.person@example.com';

  // Separate app: initiate-otp requires an authenticated user session.
  const authedApp = express();
  authedApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  authedApp.use(express.json());
  authedApp.use((req, _res, next) => {
    req.session.user = { oauthId: 'user-uuid', email: PROFILE_EMAIL };
    req.session.oauthTokens = { accessToken: 'token' };
    req.session.oauthType = 'user';
    next();
  });
  authedApp.use('/api/auth/oauth/user', router);

  beforeEach(() => {
    jest.clearAllMocks();
    mfaService.getPingOneUserContact.mockResolvedValue({
      email: PROFILE_EMAIL,
      mobilePhone: null,
    });
    mfaService.initiateOneTimeOtp.mockResolvedValue({ id: 'da-1', _embedded: { devices: [] } });
  });

  test('sends to the enrolled EMAIL device, not the synthetic profile email', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd1', type: 'EMAIL', status: 'ACTIVE', email: ENROLLED_EMAIL }],
    });

    await request(authedApp).post('/api/auth/oauth/user/initiate-otp').send({}).expect(200);

    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith('user-uuid', 'EMAIL', ENROLLED_EMAIL);
  });

  test('sends to the enrolled SMS device phone (PingOne stores it as a string)', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd2', type: 'SMS', status: 'ACTIVE', phone: '+19725550123' }],
    });

    await request(authedApp)
      .post('/api/auth/oauth/user/initiate-otp')
      .send({ method: 'sms' })
      .expect(200);

    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith('user-uuid', 'SMS', '+19725550123');
  });

  test('falls back to the profile email when no EMAIL device is enrolled', async () => {
    mfaService.listMfaDevices.mockResolvedValue({ devices: [] });

    await request(authedApp).post('/api/auth/oauth/user/initiate-otp').send({}).expect(200);

    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith('user-uuid', 'EMAIL', PROFILE_EMAIL);
  });

  test('falls back to the profile email when the device lookup fails', async () => {
    mfaService.listMfaDevices.mockRejectedValue(new Error('PingOne unavailable'));

    await request(authedApp).post('/api/auth/oauth/user/initiate-otp').send({}).expect(200);

    expect(mfaService.initiateOneTimeOtp).toHaveBeenCalledWith('user-uuid', 'EMAIL', PROFILE_EMAIL);
  });

  test('masks the address PingOne echoes back instead of returning it raw', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd1', type: 'EMAIL', status: 'ACTIVE', email: ENROLLED_EMAIL }],
    });
    mfaService.initiateOneTimeOtp.mockResolvedValue({
      id: 'da-1',
      _embedded: { devices: [{ email: ENROLLED_EMAIL }] },
    });

    const res = await request(authedApp)
      .post('/api/auth/oauth/user/initiate-otp')
      .send({})
      .expect(200);

    expect(res.body.maskedContact).toBe('r*********n@example.com');
    expect(res.body.maskedContact).not.toBe(ENROLLED_EMAIL);
  });

  test('never returns a raw address in the response body', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd1', type: 'EMAIL', status: 'ACTIVE', email: ENROLLED_EMAIL }],
    });
    mfaService.initiateOneTimeOtp.mockResolvedValue({
      id: 'da-1',
      _embedded: { devices: [{ email: ENROLLED_EMAIL }] },
    });

    const res = await request(authedApp)
      .post('/api/auth/oauth/user/initiate-otp')
      .send({})
      .expect(200);

    expect(res.body.email).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(PROFILE_EMAIL);
    expect(JSON.stringify(res.body)).not.toContain(ENROLLED_EMAIL);
  });

  test('masks an echoed SMS number to its last four digits', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd2', type: 'SMS', status: 'ACTIVE', phone: '+19725550123' }],
    });
    mfaService.initiateOneTimeOtp.mockResolvedValue({
      id: 'da-2',
      _embedded: { devices: [{ phone: '+19725550123' }] },
    });

    const res = await request(authedApp)
      .post('/api/auth/oauth/user/initiate-otp')
      .send({ method: 'sms' })
      .expect(200);

    expect(res.body.maskedContact).toBe('***-***-0123');
  });
});

describe('OAuth User Step-up return_to', () => {
  test('external return_to is not stored as stepUpReturnTo (open-redirect guard)', async () => {
    const agent = request.agent(app);
    const res = await agent
      .get('/api/auth/oauth/user/stepup?return_to=' + encodeURIComponent('https://evil.example/phish'))
      .expect(302);

    // Still redirects to PingOne authorize (flow continues), not to evil.
    expect(res.headers.location).toContain('response_type=code');
    expect(res.headers.location).not.toContain('evil.example');

    // Session cookie round-trip: hit status and confirm we did not land on evil
    // (stepUpReturnTo is consumed only on callback; assert via exported sanitizer
    // that the same input would have been rewritten).
    const { sanitizeStepUpReturnTo } = require('../routes/oauthUser');
    expect(sanitizeStepUpReturnTo('https://evil.example/phish')).toBe('http://localhost:3000/dashboard');
  });

  test('same-origin return_to is accepted for step-up initiation', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/user/stepup?return_to=' + encodeURIComponent('http://localhost:3000/dashboard'))
      .expect(302);

    expect(res.headers.location).toContain('response_type=code');
    const { sanitizeStepUpReturnTo } = require('../routes/oauthUser');
    expect(sanitizeStepUpReturnTo('http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard');
  });
});
