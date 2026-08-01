const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => undefined),
  isUserOAuthConfigured: jest.fn(() => true),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../data/store', () => ({ updateUser: jest.fn() }));

// The route resolves `../data/store` lazily, and the shared jest setup calls
// jest.resetModules() after every test — so both must be re-required per test
// or the handler ends up with a different mock than the one configured here.
let dataStore;
let router;

function loadModules() {
  jest.resetModules();
  dataStore = require('../data/store');
  router = require('../routes/oauthUser');
  dataStore.updateUser.mockResolvedValue({});
}

const ENDPOINT = '/api/auth/oauth/user/notification-preferences';
const ALL_ON = {
  agentActivity: true,
  transfers: true,
  securityAlerts: true,
  lowBalance: true,
};

function buildApp({ authenticated = true } = {}) {
  const app = express();
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authenticated) req.session.user = { id: 'user-1' };
    next();
  });
  app.use('/api/auth/oauth/user', router);
  return app;
}

describe('POST /api/auth/oauth/user/notification-preferences', () => {
  beforeEach(loadModules);

  test('persists the submitted preferences', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ notificationPrefs: { ...ALL_ON, transfers: false } })
      .expect(200);

    expect(res.body.notificationPrefs).toEqual({ ...ALL_ON, transfers: false });
    expect(dataStore.updateUser).toHaveBeenCalledWith('user-1', {
      notificationPrefs: { ...ALL_ON, transfers: false },
    });
  });

  test('defaults an omitted category to allowed', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ notificationPrefs: { lowBalance: false } })
      .expect(200);

    expect(res.body.notificationPrefs).toEqual({ ...ALL_ON, lowBalance: false });
  });

  test('drops unknown keys instead of widening the stored user record', async () => {
    await request(buildApp())
      .post(ENDPOINT)
      .send({ notificationPrefs: { ...ALL_ON, role: 'admin' } })
      .expect(200);

    expect(dataStore.updateUser).toHaveBeenCalledWith('user-1', { notificationPrefs: ALL_ON });
  });

  test('rejects a non-boolean category', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ notificationPrefs: { transfers: 'yes' } })
      .expect(400);

    expect(res.body.error).toBe('invalid_transfers');
    expect(dataStore.updateUser).not.toHaveBeenCalled();
  });

  test('rejects a missing body', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send({}).expect(400);
    expect(res.body.error).toBe('invalid_notificationPrefs');
  });

  test('requires a session', async () => {
    const res = await request(buildApp({ authenticated: false }))
      .post(ENDPOINT)
      .send({ notificationPrefs: ALL_ON })
      .expect(401);

    expect(res.body.error).toBe('not_authenticated');
  });
});

describe('POST route path', () => {
  beforeEach(loadModules);

  test('is registered directly under the mount point, not /user/... twice', () => {
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths).toContain('/notification-preferences');
  });
});
