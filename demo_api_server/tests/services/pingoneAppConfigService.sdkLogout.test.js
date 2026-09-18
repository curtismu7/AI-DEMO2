'use strict';

jest.mock('axios', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../../services/pingOneClientService', () => ({ getManagementToken: jest.fn(async () => 'test-token') }));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    PINGONE_ENVIRONMENT_ID: 'env-1',
    pingone_public_app_url: 'https://local.ping-devops.com:4000',
    public_app_url: 'https://local.ping-devops.com:4000',
  })[key]),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));

const axios = require('axios');
const { ensureAllRedirectUris } = require('../../services/pingoneAppConfigService');

describe('DaVinci SDK logout URI guard', () => {
  const sdkAppId = 'sdk-app';
  const callback = 'https://local.ping-devops.com:4000/davinci-orchestration-sdk';
  const oldLogout = 'https://local.ping-devops.com:4000/davinci-sdk-login';
  let app;

  beforeEach(() => {
    process.env.PINGONE_DAVINCI_LOGIN_APP_ID = sdkAppId;
    app = { id: sdkAppId, name: 'SDK login', redirectUris: [callback], postLogoutRedirectUris: [oldLogout] };
    axios.get.mockImplementation(async () => ({ data: app }));
    axios.put.mockImplementation(async (_url, updated) => {
      app = updated;
      return { data: updated };
    });
  });

  afterEach(() => {
    delete process.env.PINGONE_DAVINCI_LOGIN_APP_ID;
    jest.clearAllMocks();
  });

  it('adds the actual SDK return URL without replacing existing logout URIs', async () => {
    const result = await ensureAllRedirectUris();

    expect(result.sdkLogout.verified).toBe(true);
    expect(axios.put).toHaveBeenCalledTimes(1);
    expect(app.postLogoutRedirectUris).toEqual([oldLogout, callback]);
    expect(app.redirectUris).toEqual([callback]);
  });

  it('does not rewrite the app when the SDK logout URI is already registered', async () => {
    app.postLogoutRedirectUris.push(callback);

    const result = await ensureAllRedirectUris();

    expect(result.sdkLogout.alreadyPresent).toBe(true);
    expect(axios.put).not.toHaveBeenCalled();
  });
});
