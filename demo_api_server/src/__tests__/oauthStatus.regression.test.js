'use strict';
/**
 * OAuth Status Route Regression Tests
 *
 * Tests for GET /api/auth/oauth/status (admin) and GET /api/auth/oauth/user/status (user)
 * Critical gaps covered:
 * - No session: unauthenticated
 * - Stub token ('_cookie_session'): unauthenticated
 * - Expired token: unauthenticated
 * - Valid session: authenticated with user populated
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = { 'ff_hitl_enabled': 'true' };
    return defaults[key] || null;
  }),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  app.post('/__set-session', (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });

  const oauthRoutes = require('../../routes/oauth');
  const oauthUserRoutes = require('../../routes/oauthUser');
  app.use('/api/auth/oauth', oauthRoutes);
  app.use('/api/auth/oauth/user', oauthUserRoutes);

  return app;
}

describe('GET /api/auth/oauth/status (Admin OAuth)', () => {
  let app, agent;

  beforeEach(() => {
    app = buildApp();
    agent = request.agent(app);
  });

  test('No session: returns { authenticated: false }', async () => {
    const res = await agent.get('/api/auth/oauth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Stub token (_cookie_session): returns { authenticated: false }', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u1', username: 'admin', email: 'admin@example.com', role: 'admin' },
      oauthTokens: { accessToken: '_cookie_session', expiresAt: Date.now() + 9999999 },
      oauthType: 'admin',
    });

    const res = await agent.get('/api/auth/oauth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Expired token: returns { authenticated: false }', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u2', username: 'admin2', email: 'admin2@example.com', role: 'admin' },
      oauthTokens: { accessToken: 'valid_token', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      oauthType: 'admin',
    });

    const res = await agent.get('/api/auth/oauth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Valid session: returns { authenticated: true, user populated }', async () => {
    await agent.post('/__set-session').send({
      user: {
        id: 'u3',
        username: 'admin3',
        email: 'admin3@example.com',
        firstName: 'Ad',
        lastName: 'Min',
        role: 'admin',
        oauthProvider: 'PingOne',
      },
      oauthTokens: { accessToken: 'valid_tok', expiresAt: Date.now() + 9999999, tokenType: 'Bearer' },
      oauthType: 'admin',
      clientType: 'confidential',
    });

    const res = await agent.get('/api/auth/oauth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toMatchObject({
      id: 'u3',
      username: 'admin3',
      email: 'admin3@example.com',
      firstName: 'Ad',
      lastName: 'Min',
      role: 'admin',
    });
    expect(res.body.oauthProvider).toBe('PingOne');
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.expiresAt).toEqual(expect.any(Number));
  });
});

describe('GET /api/auth/oauth/user/status (User OAuth)', () => {
  let app, agent;

  beforeEach(() => {
    app = buildApp();
    agent = request.agent(app);
  });

  test('No session: returns { authenticated: false }', async () => {
    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Stub token (_cookie_session): returns { authenticated: false }', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u4', username: 'customer', email: 'cust@example.com', role: 'customer' },
      oauthTokens: { accessToken: '_cookie_session', expiresAt: Date.now() + 9999999 },
      oauthType: 'user',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Expired token: returns { authenticated: false }', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u5', username: 'customer2', email: 'cust2@example.com', role: 'customer' },
      oauthTokens: { accessToken: 'valid_token', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      oauthType: 'user',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBe(null);
  });

  test('Expired token: flags staleSession with reason token_expired', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u5b', username: 'customer2b', email: 'cust2b@example.com', role: 'customer' },
      oauthTokens: { accessToken: 'valid_token', expiresAt: Date.now() - 1000, tokenType: 'Bearer' },
      oauthType: 'user',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.staleSession).toBe(true);
    expect(res.body.staleReason).toBe('token_expired');
  });

  test('OAuth user with tokens cleared (refresh failed): staleSession with reason tokens_missing', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u5c', username: 'customer2c', email: 'cust2c@example.com', role: 'customer' },
      oauthType: 'user',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.staleSession).toBe(true);
    expect(res.body.staleReason).toBe('tokens_missing');
  });

  test('No session: staleSession is false (never logged in is not stale)', async () => {
    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.staleSession).toBe(false);
    expect(res.body.staleReason).toBe(null);
  });

  test('Valid user session: returns { authenticated: true, user populated }', async () => {
    await agent.post('/__set-session').send({
      user: {
        id: 'u6',
        username: 'customer3',
        email: 'cust3@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'customer',
        oauthProvider: 'PingOne',
      },
      oauthTokens: { accessToken: 'valid_tok', expiresAt: Date.now() + 9999999, tokenType: 'Bearer' },
      oauthType: 'user',
      clientType: 'public',
      agentConsentGiven: true,
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toMatchObject({
      id: 'u6',
      username: 'customer3',
      email: 'cust3@example.com',
      firstName: 'John',
      lastName: 'Doe',
      role: 'customer',
    });
    expect(res.body.consentGiven).toBe(true);
  });

  test('Valid admin session (oauthType=admin): returns authenticated true', async () => {
    await agent.post('/__set-session').send({
      user: {
        id: 'u7',
        username: 'admin_via_user_route',
        email: 'admin@example.com',
        role: 'admin',
        oauthProvider: 'PingOne',
      },
      oauthTokens: { accessToken: 'valid_tok', expiresAt: Date.now() + 9999999, tokenType: 'Bearer' },
      oauthType: 'admin',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.role).toBe('admin');
  });

  test('Does not leak accessToken in response', async () => {
    await agent.post('/__set-session').send({
      user: { id: 'u8', username: 'customer4', email: 'cust4@example.com', role: 'customer' },
      oauthTokens: { accessToken: 'secret_token_12345', expiresAt: Date.now() + 9999999, tokenType: 'Bearer' },
      oauthType: 'user',
    });

    const res = await agent.get('/api/auth/oauth/user/status');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('secret_token_12345');
  });
});
