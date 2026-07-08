'use strict';

jest.mock('../../services/pingoneProvisionService', () => {
  const actual = jest.requireActual('../../services/pingoneProvisionService');
  return {
    ...actual,
    PingOneProvisionService: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      findUserByUsername: jest.fn(async (name) => (
        name === 'demoUser' ? { id: 'u1', username: 'demoUser' } : null
      )),
      provisionVerticalGroupsFromManifest: jest.fn(async (_users, steps) => {
        steps.push({ step: 'banking-privileged-group', icon: '✅', message: 'Banking_Privileged ready' });
      }),
    })),
  };
});

const configStore = require('../../services/configStore');
const { provisionVerticalGroups } = require('../../services/pingOneGroupProvisionService');

describe('pingOneGroupProvisionService', () => {
  beforeEach(() => {
    jest.spyOn(configStore, 'ensureInitialized').mockResolvedValue(undefined);
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      const map = {
        pingone_environment_id: 'env-1',
        PINGONE_REGION: 'com',
        pingone_worker_token_client_id: 'worker-id',
        pingone_worker_token_client_secret: 'worker-secret',
      };
      return map[key] || process.env[key] || '';
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_WORKER_CLIENT_ID;
    delete process.env.PINGONE_WORKER_CLIENT_SECRET;
  });

  it('provisions groups via Management API using env creds', async () => {
    process.env.PINGONE_ENVIRONMENT_ID = 'env-from-env';
    process.env.PINGONE_WORKER_CLIENT_ID = 'cid';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'secret';

    const result = await provisionVerticalGroups();
    expect(result.transport).toBe('management-api');
    expect(result.summary.groupsEnsured).toBe(1);
    expect(result.note).toMatch(/no group tools/i);
  });

  it('throws when worker credentials are missing', async () => {
    jest.spyOn(configStore, 'getEffective').mockReturnValue('');
    await expect(provisionVerticalGroups()).rejects.toThrow(/Missing PingOne worker credentials/);
  });
});
