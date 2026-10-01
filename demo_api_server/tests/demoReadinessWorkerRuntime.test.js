'use strict';

const {
  loadLaneSettings,
  createLaneSessionFactory,
  laneSecretNames,
} = require('../services/demoReadinessWorkerRuntime');

const ENV = {
  DEMO_READINESS_WORKER_TARGET: 'local',
  DEMO_READINESS_WORKER_PROVIDER: 'pingone',
  DEMO_READINESS_WORKER_IDENTITY_REF: 'readiness-p1-local',
  DEMO_READINESS_WORKER_BFF_URL: 'https://lane-bff.example.test',
  DEMO_READINESS_WORKER_EXPECTED_ISSUER: 'https://auth.example.test/env/as',
};
const SECRETS = {
  DEMO_READINESS_LOCAL_PINGONE_WORKER_TOKEN: 'w'.repeat(40),
  DEMO_READINESS_LOCAL_PINGONE_USERNAME: 'private-user',
  DEMO_READINESS_LOCAL_PINGONE_PASSWORD: 'private-password',
  DEMO_READINESS_LOCAL_PINGONE_EXPECTED_SUBJECT: 'private-subject',
};
const readSecret = (name) => SECRETS[name];

test('laneSecretNames derives the vault names from target and provider', () => {
  expect(laneSecretNames('se', 'pingfederate')).toEqual({
    workerToken: 'DEMO_READINESS_SE_PINGFEDERATE_WORKER_TOKEN',
    username: 'DEMO_READINESS_SE_PINGFEDERATE_USERNAME',
    password: 'DEMO_READINESS_SE_PINGFEDERATE_PASSWORD',
    expectedSubject: 'DEMO_READINESS_SE_PINGFEDERATE_EXPECTED_SUBJECT',
  });
});

test('loadLaneSettings returns settings without echoing secrets in its error path', () => {
  const settings = loadLaneSettings({ env: ENV, readSecret });
  expect(settings).toMatchObject({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1-local' });
  expect(settings.workerToken).toHaveLength(40);
});

test('loadLaneSettings names every missing setting and never a value', () => {
  let error;
  try { loadLaneSettings({ env: { DEMO_READINESS_WORKER_TARGET: 'local', DEMO_READINESS_WORKER_PROVIDER: 'pingone' }, readSecret: () => undefined }); }
  catch (e) { error = e; }
  expect(error.message).toMatch(/DEMO_READINESS_WORKER_IDENTITY_REF/);
  expect(error.message).toMatch(/DEMO_READINESS_LOCAL_PINGONE_PASSWORD/);
  expect(error.message).not.toMatch(/private-/);
});

test('loadLaneSettings rejects a BFF URL that is not plain HTTPS origin', () => {
  expect(() => loadLaneSettings({ env: { ...ENV, DEMO_READINESS_WORKER_BFF_URL: 'http://lane-bff.example.test' }, readSecret }))
    .toThrow(/DEMO_READINESS_WORKER_BFF_URL/);
});

test('session factory logs in with lane credentials and returns a contract-shaped, distinct-id session', async () => {
  const dispose = jest.fn();
  const loginClient = jest.fn(async () => ({ authenticated: true, provider: 'pingone', dispose }));
  const settings = loadLaneSettings({ env: ENV, readSecret });
  const createSession = createLaneSessionFactory(settings, { loginClient });
  const session = await createSession({ targetId: 'local', provider: 'pingone', identityRef: 'readiness-p1-local', runId: 'run-1' });

  expect(loginClient).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'pingone', dedicatedBffUrl: 'https://lane-bff.example.test', identityRef: 'readiness-p1-local',
    username: 'private-user', password: 'private-password',
    expectedIssuer: 'https://auth.example.test/env/as', expectedSubject: 'private-subject',
  }));
  expect(session.userSession).toEqual({ authenticated: true, provider: 'pingone', identityRef: 'readiness-p1-local' });
  expect(new Set([session.runtimeId, session.cookieJarId, session.sessionStoreId]).size).toBe(3);
  expect(JSON.stringify(session)).not.toMatch(/private-/);
  await session.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('session factory refuses a request for a different lane', async () => {
  const loginClient = jest.fn();
  const createSession = createLaneSessionFactory(loadLaneSettings({ env: ENV, readSecret }), { loginClient });
  await expect(createSession({ targetId: 'se', provider: 'pingone', identityRef: 'readiness-p1-local', runId: 'r' }))
    .rejects.toThrow(/lane/);
  expect(loginClient).not.toHaveBeenCalled();
});
