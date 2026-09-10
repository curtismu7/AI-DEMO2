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

const ENDPOINT = '/api/auth/oauth/user/agent-permissions';
const DEFAULTS = {
  agentEnabled: true,
  minAmount: 0,
  maxAmount: 500,
  restrictToPayees: true,
  avoidNewCategories: false,
  useSavedPaymentMethod: true,
  updateEmail: false,
  updatePassword: false,
  updateContactInfo: false,
  requireApproval: true,
  approvalOverAmount: true,
  approvalNewPayee: true,
  approvalEveryTransaction: false,
  operatingMode: 'copilot',
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

describe('POST /api/auth/oauth/user/agent-permissions', () => {
  beforeEach(loadModules);

  test('persists the submitted permissions', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { ...DEFAULTS, maxAmount: 1000, operatingMode: 'autopilot' } })
      .expect(200);

    expect(res.body.agentPermissions).toEqual({ ...DEFAULTS, maxAmount: 1000, operatingMode: 'autopilot' });
    expect(dataStore.updateUser).toHaveBeenCalledWith('user-1', {
      agentPermissions: { ...DEFAULTS, maxAmount: 1000, operatingMode: 'autopilot' },
    });
  });

  test('defaults an omitted field', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { agentEnabled: false } })
      .expect(200);

    expect(res.body.agentPermissions).toEqual({ ...DEFAULTS, agentEnabled: false });
  });

  test('drops unknown keys instead of widening the stored user record', async () => {
    await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { ...DEFAULTS, role: 'admin' } })
      .expect(200);

    expect(dataStore.updateUser).toHaveBeenCalledWith('user-1', { agentPermissions: DEFAULTS });
  });

  test('rejects a non-boolean field', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { requireApproval: 'yes' } })
      .expect(400);

    expect(res.body.error).toBe('invalid_requireApproval');
    expect(dataStore.updateUser).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric amount', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { maxAmount: 'lots' } })
      .expect(400);

    expect(res.body.error).toBe('invalid_maxAmount');
  });

  test('rejects an invalid operating mode', async () => {
    const res = await request(buildApp())
      .post(ENDPOINT)
      .send({ agentPermissions: { operatingMode: 'godmode' } })
      .expect(400);

    expect(res.body.error).toBe('invalid_operatingMode');
  });

  test('rejects a missing body', async () => {
    const res = await request(buildApp()).post(ENDPOINT).send({}).expect(400);
    expect(res.body.error).toBe('invalid_agentPermissions');
  });

  test('requires a session', async () => {
    const res = await request(buildApp({ authenticated: false }))
      .post(ENDPOINT)
      .send({ agentPermissions: DEFAULTS })
      .expect(401);

    expect(res.body.error).toBe('not_authenticated');
  });
});

describe('POST route path', () => {
  beforeEach(loadModules);

  test('is registered directly under the mount point, not /user/... twice', () => {
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths).toContain('/agent-permissions');
  });
});
