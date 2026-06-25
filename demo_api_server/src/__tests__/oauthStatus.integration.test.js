/**
 * oauthStatus.integration.test.js
 * Integration tests for GET /api/auth/oauth/status and GET /api/auth/oauth/user/status
 *
 * Runs against real configStore, real data store, and actual route implementations.
 * Uses .env credentials where applicable. Sessions use in-memory express-session.
 *
 * Covers 4 critical gaps in token expiry checking and session validation:
 * 1. _cookie_session stub does NOT count as authenticated (even with user + token)
 * 2. Expired token returns authenticated: false (prevents 401 loops)
 * 3. No session at all returns authenticated: false
 * 4. Valid session with future expiry returns authenticated: true
 */
'use strict';

const express = require('express');
const session = require('express-session');
const request = require('supertest');

/**
 * Build test Express app with express-session + helper endpoint to set session fields
 * Uses REAL oauth routes (no mocks on the route itself)
 */
function buildAppWithSession() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  // Helper endpoint: set session fields from request body, then return 200
  app.post('/__set-session', (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });

  // Mount REAL oauth and oauthUser routers (NOT mocked)
  // These will use real configStore values from .env
  const oauthRoutes = require('../../routes/oauth');
  const oauthUserRoutes = require('../../routes/oauthUser');
  app.use('/api/auth/oauth', oauthRoutes);
  app.use('/api/auth/oauth/user', oauthUserRoutes);

  return app;
}

/**
 * Return a request agent that carries cookies across requests (for session persistence)
 */
function agentWith(app) {
  return request.agent(app);
}

describe('OAuth Status Endpoints — Token Expiry & Session Validation (Integration)', () => {
  describe('GET /api/auth/oauth/status (admin)', () => {
    test('no session at all → authenticated: false', async () => {
      const app = buildAppWithSession();
      const res = await request(app).get('/api/auth/oauth/status');

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('_cookie_session stub token → authenticated: false', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      // Seed session with the stub token (what Vercel cold-start produces)
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: '_cookie_session',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 3600000,
          },
          user: { id: 'admin-1', username: 'admin', email: 'admin@test.com', role: 'admin' },
          oauthType: 'admin',
        });

      // Status check should return authenticated: false (stub != real token)
      const res = await agent.get('/api/auth/oauth/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('expired token → authenticated: false', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      // Seed session with an expired token
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'real-token-but-expired',
            tokenType: 'Bearer',
            expiresAt: Date.now() - 1000, // 1 second ago
          },
          user: { id: 'admin-1', username: 'admin', email: 'admin@test.com', role: 'admin' },
          oauthType: 'admin',
        });

      // Status check should return authenticated: false (token expired)
      const res = await agent.get('/api/auth/oauth/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('valid session with future expiry → authenticated: true', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      const futureExpiresAt = Date.now() + 3600000; // 1 hour from now
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'valid-token-xyz',
            tokenType: 'Bearer',
            expiresAt: futureExpiresAt,
          },
          user: {
            id: 'admin-1',
            username: 'admin',
            email: 'admin@test.com',
            firstName: 'Test',
            lastName: 'Admin',
            role: 'admin',
          },
          oauthType: 'admin',
        });

      const res = await agent.get('/api/auth/oauth/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe('admin-1');
      expect(res.body.user.username).toBe('admin');
      expect(res.body.expiresAt).toBe(futureExpiresAt);
      // Ensure accessToken is NOT leaked to frontend
      expect(res.body.accessToken).toBeUndefined();
    });
  });

  describe('GET /api/auth/oauth/user/status (end-user)', () => {
    test('no session → authenticated: false', async () => {
      const app = buildAppWithSession();
      const res = await request(app).get('/api/auth/oauth/user/status');

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('_cookie_session stub token → authenticated: false', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: '_cookie_session',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 3600000,
          },
          user: { id: 'user-1', username: 'customer', email: 'user@test.com', role: 'customer' },
          oauthType: 'user',
          clientType: 'enduser',
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('expired token → authenticated: false', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'user-token-expired',
            tokenType: 'Bearer',
            expiresAt: Date.now() - 5000,
          },
          user: { id: 'user-1', username: 'customer', email: 'user@test.com', role: 'customer' },
          oauthType: 'user',
          clientType: 'enduser',
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeNull();
    });

    test('valid user session → authenticated: true with user fields', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      const futureExpiresAt = Date.now() + 7200000; // 2 hours
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'user-token-abc123',
            tokenType: 'Bearer',
            expiresAt: futureExpiresAt,
          },
          user: {
            id: 'user-1',
            username: 'customer',
            email: 'customer@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            role: 'customer',
          },
          oauthType: 'user',
          clientType: 'enduser',
          agentConsentGiven: true,
          agentConsentedAt: Date.now(),
          mayAct: null,
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe('user-1');
      expect(res.body.user.email).toBe('customer@example.com');
      expect(res.body.clientType).toBe('enduser');
      expect(res.body.consentGiven).toBe(true);
      expect(res.body.expiresAt).toBe(futureExpiresAt);
      // Token must NOT leak
      expect(res.body.accessToken).toBeUndefined();
    });

    test('user status also accepts oauthType: admin (rare but supported)', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'admin-token-accessed-via-user-status',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 3600000,
          },
          user: {
            id: 'admin-2',
            username: 'admin',
            email: 'admin2@test.com',
            role: 'admin',
          },
          oauthType: 'admin',
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      // Should accept both oauthType: 'user' and 'admin' (line 683 of oauthUser.js)
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.role).toBe('admin');
    });
  });

  describe('Token expiry edge cases', () => {
    test('token with expiresAt = now (boundary case) → authenticated: false', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      const nowTime = Date.now();
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'edge-case-token',
            tokenType: 'Bearer',
            expiresAt: nowTime, // Expired exactly now
          },
          user: { id: 'user-1', username: 'test', email: 'test@test.com', role: 'customer' },
          oauthType: 'user',
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      expect(res.body.authenticated).toBe(false);
    });

    test('token with expiresAt = now + 1s → authenticated: true', async () => {
      const app = buildAppWithSession();
      const agent = agentWith(app);

      const futureTime = Date.now() + 1000;
      await agent
        .post('/__set-session')
        .send({
          oauthTokens: {
            accessToken: 'barely-valid-token',
            tokenType: 'Bearer',
            expiresAt: futureTime,
          },
          user: { id: 'user-1', username: 'test', email: 'test@test.com', role: 'customer' },
          oauthType: 'user',
        });

      const res = await agent.get('/api/auth/oauth/user/status');
      expect(res.body.authenticated).toBe(true);
    });
  });
});
