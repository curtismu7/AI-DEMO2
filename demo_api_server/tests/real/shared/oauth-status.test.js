// demo_api_server/tests/real/shared/oauth-status.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('OAuth status endpoints (real)', () => {
  let enduser, admin;

  beforeAll(() => {
    skipIfNoSession();
    enduser = createBffClient('enduser');
    admin   = createBffClient('admin');
  });

  describe('GET /api/auth/oauth/status (admin)', () => {
    it('returns authenticated: true with user fields', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(true);
      expect(r.data.user).toMatchObject({
        id:        expect.any(String),
        username:  expect.any(String),
        email:     expect.any(String),
        firstName: expect.any(String),
        lastName:  expect.any(String),
      });
      // Token never sent to browser — only metadata
      expect(r.data.user.accessToken).toBeUndefined();
    });

    it('tokenType is Bearer', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.data.tokenType).toBe('Bearer');
    });

    it('expiresAt is in the future', async () => {
      const r = await admin.get('/api/auth/oauth/status');
      expect(r.data.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /api/auth/oauth/user/status (enduser)', () => {
    it('returns authenticated: true for enduser session', async () => {
      const r = await enduser.get('/api/auth/oauth/user/status');
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(true);
    });

    it('returns user object with id, username, email', async () => {
      const r = await enduser.get('/api/auth/oauth/user/status');
      expect(r.data.user).toMatchObject({
        id:       expect.any(String),
        username: expect.any(String),
        email:    expect.any(String),
      });
    });

    it('does not leak accessToken in response', async () => {
      const r = await enduser.get('/api/auth/oauth/user/status');
      expect(r.data.user.accessToken).toBeUndefined();
      // Verify no token appears in serialized response
      expect(JSON.stringify(r.data)).not.toMatch(/access[_-]?token|Bearer\s+[a-zA-Z0-9]/i);
    });
  });

  describe('Unauthenticated request', () => {
    it('returns authenticated: false without a session cookie', async () => {
      const axios = require('axios');
      const https = require('https');
      const r = await axios.get('https://api.ping.demo:3001/api/auth/oauth/status', {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: () => true,
      });
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(false);
      expect(r.data.user).toBeNull();
    });
  });
});
