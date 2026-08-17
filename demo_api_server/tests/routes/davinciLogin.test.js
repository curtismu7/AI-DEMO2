'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/oauthService', () => ({
  exchangeCodeForToken: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const davinciLoginRoutes = require('../../routes/davinciLogin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
  app.use('/api/davinci-login', davinciLoginRoutes);
  return app;
}

describe('POST /api/davinci-login/callback', () => {
  beforeEach(() => oauthService.exchangeCodeForToken.mockReset());

  test('valid code exchanges tokens and establishes a session', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      accessToken: 'at-1', idToken: 'it-1', expiresAt: Date.now() + 3600_000,
      claims: { sub: 'u1', preferred_username: 'demoUser' },
    });

    const res = await request(buildApp())
      .post('/api/davinci-login/callback')
      .send({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith('code-1', 'verifier-1', 'https://local.ping-devops.com:4000/davinci-login/callback');
  });

  test('missing code is rejected', async () => {
    const res = await request(buildApp()).post('/api/davinci-login/callback').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  });
});
