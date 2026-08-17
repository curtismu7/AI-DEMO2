'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/oauthService', () => ({
  exchangeCodeForToken: jest.fn(),
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
}));

jest.mock('../../data/store', () => ({
  getUserByUsername: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const dataStore = require('../../data/store');
const davinciLoginRoutes = require('../../routes/davinciLogin');

function buildApp(sessionObj) {
  const app = express();
  app.use(express.json());
  if (sessionObj) {
    // Inject a persistent session object so tests can verify session state after the request.
    app.use((req, _res, next) => {
      req.session = sessionObj;
      req.session.regenerate = (cb) => cb(null);
      req.session.save = (cb) => cb && cb(null);
      next();
    });
  } else {
    app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
  }
  app.use('/api/davinci-login', davinciLoginRoutes);
  return app;
}

describe('POST /api/davinci-login/callback', () => {
  beforeEach(() => {
    oauthService.exchangeCodeForToken.mockReset();
    oauthService.getUserInfo.mockReset();
    oauthService.createUserFromOAuth.mockReset();
    dataStore.getUserByUsername.mockReset();
  });

  test('valid code exchanges tokens and establishes a session for an existing demo user', async () => {
    // Real oauthService.exchangeCodeForToken shape: raw PingOne token response
    // (snake_case), no `.claims` property.
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-1',
      id_token: 'it-1',
      refresh_token: 'rt-1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u1', preferred_username: 'demoUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u1', username: 'demoUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue({ id: 'u1', username: 'demoUser', role: 'customer' });

    const session = {};
    const res = await request(buildApp(session))
      .post('/api/davinci-login/callback')
      .send({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith('code-1', 'verifier-1', 'https://local.ping-devops.com:4000/davinci-login/callback');
    expect(oauthService.getUserInfo).toHaveBeenCalledWith('at-1');
    expect(dataStore.getUserByUsername).toHaveBeenCalledWith('demoUser');

    // Verify session was established with correct tokens (from the real snake_case shape)
    // and the real user record from dataStore — not an invented `.claims` shape.
    expect(session.oauthTokens).toEqual({
      accessToken: 'at-1',
      idToken: 'it-1',
      refreshToken: 'rt-1',
      expiresAt: session.oauthTokens.expiresAt, // Use the actual value set by the handler
      tokenType: 'Bearer',
      scope: 'openid profile',
    });
    expect(session.user).toEqual({ id: 'u1', username: 'demoUser', role: 'customer' });
  });

  test('missing code is rejected', async () => {
    const res = await request(buildApp()).post('/api/davinci-login/callback').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  });

  test('unknown demo user is rejected, not auto-created', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-2',
      id_token: 'it-2',
      refresh_token: 'rt-2',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u2', preferred_username: 'strangerUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u2', username: 'strangerUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue(null);

    const session = {};
    const res = await request(buildApp(session))
      .post('/api/davinci-login/callback')
      .send({ code: 'code-2', codeVerifier: 'verifier-2', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'user_not_found', message: 'No demo user found for "strangerUser".' });
    expect(session.oauthTokens).toBeUndefined();
    expect(session.user).toBeUndefined();
  });

  test('session regenerate failure aborts login', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at-3',
      id_token: 'it-3',
      refresh_token: 'rt-3',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
    oauthService.getUserInfo.mockResolvedValue({ sub: 'u3', preferred_username: 'demoUser' });
    oauthService.createUserFromOAuth.mockReturnValue({ id: 'u3', username: 'demoUser', role: 'customer' });
    dataStore.getUserByUsername.mockReturnValue({ id: 'u3', username: 'demoUser', role: 'customer' });

    const app = express();
    app.use(express.json());
    const session = {};
    app.use((req, _res, next) => {
      req.session = session;
      req.session.regenerate = (cb) => cb(new Error('store unavailable'));
      req.session.save = (cb) => cb && cb(null);
      next();
    });
    app.use('/api/davinci-login', davinciLoginRoutes);

    const res = await request(app)
      .post('/api/davinci-login/callback')
      .send({ code: 'code-3', codeVerifier: 'verifier-3', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
    expect(session.oauthTokens).toBeUndefined();
    expect(session.user).toBeUndefined();
  });
});
