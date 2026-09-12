'use strict';

// C1: listApplicationsRaw's `opts` argument is its ONLY source of auth — there is
// no axios.defaults token in this service. Callers that omitted it (the secret
// rotation route, scripts/describeApp.js) sent an unauthenticated request that
// validateStatus:()=>true swallowed into an empty list, so the rotation page's
// app list was always empty and describeApp always said "app not found".

jest.mock('axios');
const axios = require('axios');

jest.mock('../services/configStore', () => ({
  getEffective: (k) => ({ PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_REGION: 'com' }[k] || ''),
  get: () => '',
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('tok-from-worker'),
  resolveWorkerCredentials: jest.fn(() => ({ clientId: 'w', clientSecret: 's' })),
  WORKER_CREDENTIAL_FAMILIES: [['PINGONE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_SECRET']],
}));

const { listApplicationsRaw } = require('../services/agentBuilderService');

describe('listApplicationsRaw auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: { _embedded: { applications: [{ id: 'a1' }] } } });
  });

  test('called with NO argument, it still sends an Authorization header', async () => {
    const apps = await listApplicationsRaw();
    expect(apps).toEqual([{ id: 'a1' }]);
    const [, cfg] = axios.get.mock.calls[0];
    expect(cfg.headers.Authorization).toBe('Bearer tok-from-worker');
  });

  test('an explicitly supplied opts object still wins', async () => {
    await listApplicationsRaw({ headers: { Authorization: 'Bearer explicit' } });
    const [, cfg] = axios.get.mock.calls[0];
    expect(cfg.headers.Authorization).toBe('Bearer explicit');
  });
});
