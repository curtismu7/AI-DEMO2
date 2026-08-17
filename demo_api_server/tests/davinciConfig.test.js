'use strict';

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
const configStore = require('../services/configStore');
const davinci = require('../config/davinci');

describe('config/davinci', () => {
  const ENV_KEYS = [
    'PINGONE_DAVINCI_API_CLIENT_ID', 'PINGONE_DAVINCI_API_CLIENT_SECRET',
    'PINGONE_DAVINCI_TRANSACTION_COMPANY_ID', 'PINGONE_DAVINCI_TRANSACTION_APP_ID',
    'PINGONE_DAVINCI_TRANSACTION_FLOW_ID', 'PINGONE_DAVINCI_LOGIN_APP_ID',
    'PINGONE_DAVINCI_LOGIN_FLOW_ID_V1', 'PINGONE_DAVINCI_LOGIN_FLOW_ID_V2',
    'DAVINCI_WEBHOOK_URL',
  ];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    configStore.getEffective.mockReset();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  test('reads transaction flow identifiers from env', () => {
    process.env.PINGONE_DAVINCI_TRANSACTION_COMPANY_ID = 'co-1';
    process.env.PINGONE_DAVINCI_TRANSACTION_APP_ID = 'app-1';
    process.env.PINGONE_DAVINCI_TRANSACTION_FLOW_ID = 'flow-1';
    expect(davinci.transaction).toEqual({ companyId: 'co-1', appId: 'app-1', flowId: 'flow-1' });
  });

  test('reads login flow identifiers (two versions) from env', () => {
    process.env.PINGONE_DAVINCI_LOGIN_APP_ID = 'login-app';
    process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V1 = 'flow-v1';
    process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V2 = 'flow-v2';
    expect(davinci.login).toEqual({ appId: 'login-app', flowIdV1: 'flow-v1', flowIdV2: 'flow-v2' });
  });

  test('webhookUrl uses DAVINCI_WEBHOOK_URL when set, ignoring pingone_public_app_url', () => {
    process.env.DAVINCI_WEBHOOK_URL = 'https://example.test/webhook/davinci';
    expect(davinci.webhookUrl).toBe('https://example.test/webhook/davinci');
  });

  test('webhookUrl falls back to pingone_public_app_url + /webhook/davinci when unset', () => {
    configStore.getEffective.mockImplementation((k) =>
      k === 'pingone_public_app_url' ? 'https://local.ping-devops.com:4000' : undefined);
    expect(davinci.webhookUrl).toBe('https://local.ping-devops.com:4000/webhook/davinci');
  });
});
