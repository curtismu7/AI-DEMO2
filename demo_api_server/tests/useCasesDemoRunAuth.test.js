'use strict';

/**
 * POST /api/use-cases/demo/run gates per use case instead of demanding a
 * session from everyone.
 *
 * Before: `authenticateToken` refused every signed-out caller with a bare 401.
 * Wrong twice over — UC24 (Act 1) is defined as running without a session and
 * could not run at all, and a protected step answered with nothing a client
 * could act on, so the UI had no way to offer the sign-in that would fix it.
 */

const request = require('supertest');
const express = require('express');

const useCasesRouter = require('../routes/useCases');

function makeApp({ user = null } = {}) {
  const app = express();
  app.use(express.json());
  // Stand in for the session middleware. A caller with no token reaches the
  // route as a guest; one with a token arrives authenticated.
  app.use((req, _res, next) => {
    if (user) {
      req.session = { oauthTokens: { accessToken: 'test-token' } };
      req.user = user;
    }
    next();
  });
  app.use('/api/use-cases', useCasesRouter);
  return app;
}

// authenticateToken would otherwise try to introspect the fake token above.
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
}));

describe('POST /api/use-cases/demo/run — auth by declared level', () => {
  test('a guest may run a public use case', async () => {
    const res = await request(makeApp())
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'progressive-trust-public-access', vertical: 'banking' });

    expect(res.status).toBe(200);
    expect(res.body.success).not.toBe(false);
  });

  test('a guest is refused a user-level use case, and told which sign-in', async () => {
    const res = await request(makeApp())
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'delegated-access-with-proof', vertical: 'banking' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'authentication_required',
      requiresLogin: true,
      requiredAuth: 'user',
      useCaseId: 'delegated-access-with-proof',
    });
    // The message is what the button sits next to — it must say something.
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  test('a signed-in customer may run a user-level use case', async () => {
    const res = await request(makeApp({ user: { sub: 'u1', role: 'customer' } }))
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'delegated-access-with-proof', vertical: 'banking' });

    expect(res.status).toBe(200);
  });

  test('an unknown use case is still a 400, not an auth answer', async () => {
    const res = await request(makeApp())
      .post('/api/use-cases/demo/run')
      .send({ useCaseId: 'no-such-use-case', vertical: 'banking' });

    expect(res.status).toBe(400);
    expect(res.body.requiresLogin).toBeUndefined();
  });
});
