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

// The path Profile.js and App.js actually call.
const ENDPOINT = '/api/auth/oauth/user/success-screen-preference';

function buildApp() {
  const app = express();
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session.user = { id: 'user-1' };
    next();
  });
  app.use('/api/auth/oauth/user', router);
  return app;
}

describe('POST /api/auth/oauth/user/success-screen-preference', () => {
  beforeEach(loadModules);

  // Regression: the route was registered as '/user/success-screen-preference'
  // under a router already mounted at /api/auth/oauth/user, so every call from
  // the UI 404'd.
  test('is reachable at the path the UI calls', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ hideSuccessScreen: true })
      .expect(200);

    expect(res.body.hideSuccessScreen).toBe(true);
    expect(dataStore.updateUser).toHaveBeenCalledWith('user-1', { hideSuccessScreen: true });
  });

  test('rejects a non-boolean value', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ hideSuccessScreen: 'yes' })
      .expect(400);

    expect(res.body.error).toBe('invalid_hideSuccessScreen');
    expect(dataStore.updateUser).not.toHaveBeenCalled();
  });
});
