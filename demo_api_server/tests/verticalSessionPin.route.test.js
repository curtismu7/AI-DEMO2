// demo_api_server/tests/verticalSessionPin.route.test.js
'use strict';

// Regression: another session switching verticals used to yank THIS session's
// screen. setActive() writes the process-global and SSE-broadcasts to every
// client; a session that never pinned a vertical fell back to that global on
// every /me, so it followed whatever another user picked mid-demo.
// GET /me now pins the vertical to the session on first hydration, making the
// global a first-load default instead of a live channel between sessions.

jest.mock('../services/configStore', () => ({ get: jest.fn(() => null) }));

// Process-global active vertical, as the resolver holds it.
let mockGlobalActiveId = 'banking';

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    list: () => [],
    scope: {
      // Mirrors scope.resolveForRequest → resolver.activeIdFor(req):
      // session preference wins, else the process-global.
      resolveForRequest: (req) => ({
        activeId: (req && req.session && req.session.active_vertical) || mockGlobalActiveId,
        pageManifest: { theme: { cssVars: {} } },
        isAdmin: false,
      }),
    },
  },
}));

const request = require('supertest');
const express = require('express');
const router = require('../routes/verticalManifest');

/** App whose session object persists across requests, like a real session store. */
function buildApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1', role: 'user' };
    req.session = session;
    req.session.save = (cb) => cb && cb(null);
    next();
  });
  app.use('/api/verticals', router);
  return app;
}

beforeEach(() => { mockGlobalActiveId = 'banking'; });

describe('GET /api/verticals/me — session vertical pin', () => {
  test('first /me pins the current vertical onto the session', async () => {
    const session = {};
    const res = await request(buildApp(session)).get('/api/verticals/me').expect(200);

    expect(res.body.activeId).toBe('banking');
    expect(session.active_vertical).toBe('banking'); // pinned
  });

  test('another session switching the global does NOT move a pinned session', async () => {
    const session = {};
    const app = buildApp(session);

    // This session hydrates → pins to banking.
    await request(app).get('/api/verticals/me').expect(200);
    expect(session.active_vertical).toBe('banking');

    // A DIFFERENT session switches vertical: setActive() moves the process-global
    // and SSE-broadcasts, so this client refetches /me.
    mockGlobalActiveId = 'retail';

    const res = await request(app).get('/api/verticals/me').expect(200);
    expect(res.body.activeId).toBe('banking'); // still banking — no yank
    expect(session.active_vertical).toBe('banking');
  });

  test('an unpinned (fresh) session still inherits the global as its default', async () => {
    mockGlobalActiveId = 'retail'; // admin set the demo default

    const session = {};
    const res = await request(buildApp(session)).get('/api/verticals/me').expect(200);

    expect(res.body.activeId).toBe('retail');
    expect(session.active_vertical).toBe('retail');
  });

  test('an explicit session preference is never overwritten by the pin', async () => {
    const session = { active_vertical: 'healthcare' }; // user switched earlier
    mockGlobalActiveId = 'retail';

    const res = await request(buildApp(session)).get('/api/verticals/me').expect(200);

    expect(res.body.activeId).toBe('healthcare');
    expect(session.active_vertical).toBe('healthcare');
  });

  test('missing session object does not throw (unauthenticated/edge harnesses)', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'u1', role: 'user' }; next(); }); // no req.session
    app.use('/api/verticals', router);

    const res = await request(app).get('/api/verticals/me').expect(200);
    expect(res.body.activeId).toBe('banking');
  });
});
