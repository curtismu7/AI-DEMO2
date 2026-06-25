const request = require('supertest');
const express = require('express');
const session = require('express-session');
const router = require('../routes/oauthUser');
const configStore = require('../services/configStore');

// Mock configStore to ensure user OAuth is configured
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = {
      'pingone_environment_id': 'test-env-id',
      'user_client_id': 'test-client-id',
      'user_client_secret': 'test-secret',
    };
    return defaults[key];
  }),
  isUserOAuthConfigured: jest.fn(() => true),
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

const app = express();
app.use(
  session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.json());
app.use('/api/auth/oauth/user', router);

describe('OAuth User Login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
