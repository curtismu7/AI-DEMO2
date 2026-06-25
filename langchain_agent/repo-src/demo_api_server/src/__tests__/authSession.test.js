'use strict';
/**
 * Tests for GET /api/auth/session
 *
 * Covers:
 *   - Returns { authenticated: false } when no session
 *   - Returns user info when a local (username/password) session exists
 *   - Returns user info for an OAuth admin session
 *   - Returns user info for an OAuth end-user session
 *   - Returns user info for a cookie-restored session (_restoredFromCookie)
 *   - cookieOnlyBffSession true only for stub/cookie-restored OAuth marker
 *   - authType field reflects session.oauthType / tokenType
 *   - Does NOT leak the password field
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

// ── helpers ────────────────────────────────────────────────────────────────────

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

  // Mount only the auth router (no other deps needed for /session)
  const authRoutes = require('../../routes/auth');
  app.use('/api/auth', authRoutes);

  return app;
}

/** Inject a user into the session via a helper endpoint so supertest can do it. */
function buildAppWithSession(sessionData = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  // Helper endpoint: sets session fields from the JSON body, then returns 200.
  app.post('/__set-session', (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });

  const authRoutes = require('../../routes/auth');
  app.use('/api/auth', authRoutes);

  return app;
}

/** Get a supertest agent that can carry cookies (session) across requests. */
function agentWith(app) {
  return request.agent(app);
}

/**
 * Same order as server.js: session → attach req._sessionStore* → set-session helper → /api/auth routes.
 * Mirrors production middleware that exposes Upstash ping cache to GET /api/auth/session.
 */
function buildAppWithSessionAndStorePing(ping = { healthy: true, error: null }) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  app.use('/api/auth', (req, res, next) => {
    req._sessionStoreError = ping.error ?? null;
    req._sessionStoreHealthy = typeof ping.healthy === 'boolean' ? ping.healthy : null;
    next();
  });

  app.post('/__set-session', (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });

  const authRoutes = require('../../routes/auth');
  app.use('/api/auth', authRoutes);

  return app;
}

// ── sample user objects ────────────────────────────────────────────────────────

const LOCAL_USER = {
  id:        'user-local-001',
  username:  'alice',
  email:     'alice@example.com',
  firstName: 'Alice',
  lastName:  'Smith',
  role:      'customer',
  password:  'THIS-SHOULD-NOT-APPEAR',
};

const OAUTH_ADMIN_USER = {
  id:        'user-admin-001',
  username:  'admin@example.com',
  email:     'admin@example.com',
  firstName: 'Admin',
  lastName:  'User',
  role:      'admin',
};

// ── tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/auth/session — unauthenticated', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  it('returns 200 with authenticated: false when no session', async () => {
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBeNull();
  });
});

describe('GET /api/auth/session — local session (username+password)', () => {
  let agent;

  beforeAll(async () => {
    const app = buildAppWithSession();
    agent = agentWith(app);
    // Seed session with a local user
    await agent.post('/__set-session').send({
      user:      LOCAL_USER,
      tokenType: 'local_session',
    });
  });

  it('returns authenticated: true', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
  });

  it('returns user fields', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.user).toMatchObject({
      id:        'user-local-001',
      username:  'alice',
      email:     'alice@example.com',
      firstName: 'Alice',
      lastName:  'Smith',
      role:      'customer',
    });
  });

  it('does NOT leak the password field', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.user.password).toBeUndefined();
  });

  it('returns authType reflecting tokenType', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authType).toBe('local_session');
  });

  it('returns cookieOnlyBffSession: false for local session', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.cookieOnlyBffSession).toBe(false);
  });
});

describe('GET /api/auth/session — OAuth admin session', () => {
  let agent;

  beforeAll(async () => {
    const app = buildAppWithSession();
    agent = agentWith(app);
    await agent.post('/__set-session').send({
      user:       OAUTH_ADMIN_USER,
      oauthType:  'admin',
      oauthTokens: { accessToken: 'tok-admin-abc', tokenType: 'Bearer' },
    });
  });

  it('returns authenticated: true', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authenticated).toBe(true);
  });

  it('returns authType: admin', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authType).toBe('admin');
  });

  it('returns correct user fields', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.email).toBe('admin@example.com');
  });

  it('returns cookieOnlyBffSession: false when a real OAuth token is present', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.cookieOnlyBffSession).toBe(false);
  });
});

describe('GET /api/auth/session — OAuth end-user session', () => {
  let agent;

  beforeAll(async () => {
    const app = buildAppWithSession();
    agent = agentWith(app);
    await agent.post('/__set-session').send({
      user:       { ...LOCAL_USER, role: 'customer' },
      oauthType:  'user',
      oauthTokens: { accessToken: 'tok-user-xyz', tokenType: 'Bearer' },
    });
  });

  it('returns authType: user', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authType).toBe('user');
  });

  it('returns authenticated: true', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authenticated).toBe(true);
  });

  it('returns cookieOnlyBffSession: false when a real OAuth token is present', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.cookieOnlyBffSession).toBe(false);
  });
});

describe('GET /api/auth/session — cookie-restored session (_restoredFromCookie)', () => {
  let agent;

  beforeAll(async () => {
    const app = buildAppWithSession();
    agent = agentWith(app);
    await agent.post('/__set-session').send({
      user:                OAUTH_ADMIN_USER,
      oauthType:           'admin',
      _restoredFromCookie: true,
      oauthTokens:         { accessToken: '_cookie_session', tokenType: 'Bearer' },
    });
  });

  // Stub sessions carry no OAuth token — callers must treat them as unauthenticated
  // and prompt sign-in again. cookieOnlyBffSession:true is preserved so the P1
  // reconnect-polling loop in BankingAgent can detect when Redis propagates.
  it('returns authenticated: false for cookie-only stub (no real OAuth token)', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.authenticated).toBe(false);
  });

  it('returns user: null for cookie-only stub', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.user).toBeNull();
  });

  it('returns cookieOnlyBffSession: true', async () => {
    const res = await agent.get('/api/auth/session');
    expect(res.body.cookieOnlyBffSession).toBe(true);
  });
});

/**
 * Regression: server.js sets req._sessionStoreError / req._sessionStoreHealthy before auth routes;
 * GET /api/auth/session must surface them so BankingAgent can distinguish quota vs stub token.
 */
describe('GET /api/auth/session — session store ping contract (production middleware shape)', () => {
  it('includes sessionStoreHealthy and sessionStoreError when ping middleware runs (healthy)', async () => {
    const app = buildAppWithSessionAndStorePing({ healthy: true, error: null });
    const agent = agentWith(app);
    await agent.post('/__set-session').send({
      user: LOCAL_USER,
      oauthType: 'user',
      oauthTokens: { accessToken: 'eyJ-real-shaped-token', tokenType: 'Bearer' },
    });
    const res = await agent.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.sessionStoreHealthy).toBe(true);
    expect(res.body.sessionStoreError).toBeNull();
    expect(res.body.cookieOnlyBffSession).toBe(false);
  });

  it('surfaces unhealthy store + error string from ping middleware', async () => {
    const app = buildAppWithSessionAndStorePing({
      healthy: false,
      error: 'max requests limit exceeded',
    });
    const agent = agentWith(app);
    await agent.post('/__set-session').send({
      user: LOCAL_USER,
      oauthType: 'user',
      oauthTokens: { accessToken: 'tok', tokenType: 'Bearer' },
    });
    const res = await agent.get('/api/auth/session');
    expect(res.body.sessionStoreHealthy).toBe(false);
    expect(res.body.sessionStoreError).toBe('max requests limit exceeded');
  });

  it('without ping middleware sessionStore fields are null (no fake healthy flag)', async () => {
    const app = buildAppWithSession();
    const agent = agentWith(app);
    await agent.post('/__set-session').send({
      user: LOCAL_USER,
      tokenType: 'local_session',
    });
    const res = await agent.get('/api/auth/session');
    expect(res.body.sessionStoreHealthy).toBeNull();
    expect(res.body.sessionStoreError).toBeNull();
  });
});
