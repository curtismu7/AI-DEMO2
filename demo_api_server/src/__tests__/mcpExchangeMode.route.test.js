// Route tests for routes/mcpExchangeMode.js — the session-scoped single/double
// RFC 8693 exchange-mode toggle the UI ExchangeModeContext drives.
//
// The router has no service dependencies (just express), and its auth guard is
// inline (`if (!req.session?.user)`), not middleware. So we mount it in a minimal
// app with a configurable session-injection middleware — that exercises the real
// handler code while letting us drive the unauthenticated branch, which mounting
// the full server.js (which always injects a user) cannot.

const express = require('express');
const request = require('supertest');
const exchangeModeRoutes = require('../../routes/mcpExchangeMode');

// Build an app whose session is whatever the test sets via `setSession`.
function buildApp() {
  const app = express();
  let session = {};
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/mcp', exchangeModeRoutes);
  return {
    app,
    setSession: (s) => { session = s; },
    getSession: () => session,
  };
}

describe('routes/mcpExchangeMode', () => {
  describe('GET /api/mcp/exchange-mode', () => {
    it('returns 401 not_authenticated when no session user', async () => {
      const { app, setSession } = buildApp();
      setSession({});
      const res = await request(app).get('/api/mcp/exchange-mode');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
    });

    it("defaults to 'double' when authenticated and no mode set", async () => {
      const { app, setSession } = buildApp();
      setSession({ user: { id: 'u1' } });
      const res = await request(app).get('/api/mcp/exchange-mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'double' });
    });

    it('returns the stored mode when set on the session', async () => {
      const { app, setSession } = buildApp();
      setSession({ user: { id: 'u1' }, mcpExchangeMode: 'single' });
      const res = await request(app).get('/api/mcp/exchange-mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'single' });
    });
  });

  describe('POST /api/mcp/exchange-mode', () => {
    it('returns 401 not_authenticated when no session user', async () => {
      const { app, setSession } = buildApp();
      setSession({});
      const res = await request(app).post('/api/mcp/exchange-mode').send({ mode: 'single' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'not_authenticated' });
    });

    it('returns 400 invalid_mode for an unrecognized mode', async () => {
      const { app, setSession } = buildApp();
      setSession({ user: { id: 'u1' } });
      const res = await request(app).post('/api/mcp/exchange-mode').send({ mode: 'bogus' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_mode', valid: ['single', 'double'] });
    });

    it('returns 400 invalid_mode when mode is omitted', async () => {
      const { app, setSession } = buildApp();
      setSession({ user: { id: 'u1' } });
      const res = await request(app).post('/api/mcp/exchange-mode').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_mode');
    });

    it("saves mode='single' to the session and echoes it", async () => {
      const { app, setSession, getSession } = buildApp();
      setSession({ user: { id: 'u1' } });
      const res = await request(app).post('/api/mcp/exchange-mode').send({ mode: 'single' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'single' });
      expect(getSession().mcpExchangeMode).toBe('single');
    });

    it("saves mode='double' to the session and echoes it", async () => {
      const { app, setSession, getSession } = buildApp();
      setSession({ user: { id: 'u1' } });
      const res = await request(app).post('/api/mcp/exchange-mode').send({ mode: 'double' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'double' });
      expect(getSession().mcpExchangeMode).toBe('double');
    });
  });
});
