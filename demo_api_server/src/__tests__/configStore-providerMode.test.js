'use strict';

describe('OAuth provider mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    for (const key of Object.keys(process.env)) {
      if (key === 'OAUTH_PROVIDER' || key.startsWith('PF_')) delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  test('defaults to PingOne when no provider is configured', () => {
    const configStore = require('../../services/configStore');

    expect(configStore.getOAuthProvider()).toBe('pingone');
  });

  test('selects PingFederate and exposes PF browser and ID-JAG settings', () => {
    process.env.OAUTH_PROVIDER = 'pingfederate';
    process.env.PF_USER_CLIENT_ID = 'pf-user-client';
    process.env.PF_USER_CLIENT_SECRET = 'pf-user-secret';
    process.env.PF_ID_JAG_ENABLED = 'true';
    process.env.PF_ID_JAG_AUDIENCE = 'https://downstream.example.test';
    process.env.PF_ID_JAG_RESOURCE = 'https://api.example.test';
    process.env.PF_ID_JAG_SCOPE = 'accounts:read';

    const configStore = require('../../services/configStore');

    expect(configStore.getOAuthProvider()).toBe('pingfederate');
    expect(configStore.getEffective('pf_user_client_id')).toBe('pf-user-client');
    expect(configStore.getEffective('pf_user_client_secret')).toBe('pf-user-secret');
    expect(configStore.getEffective('pf_id_jag_enabled')).toBe('true');
    expect(configStore.getEffective('pf_id_jag_audience')).toBe('https://downstream.example.test');
    expect(configStore.getEffective('pf_id_jag_resource')).toBe('https://api.example.test');
    expect(configStore.getEffective('pf_id_jag_scope')).toBe('accounts:read');
    expect(configStore.SECRET_KEYS.has('PF_USER_CLIENT_SECRET')).toBe(true);
  });

  test('rejects an unsupported provider instead of silently selecting PingOne', () => {
    process.env.OAUTH_PROVIDER = 'local-mock';
    const configStore = require('../../services/configStore');

    expect(() => configStore.getOAuthProvider()).toThrow(/unsupported oauth provider/i);
  });

  test('uses the PF browser client when PF mode is selected', () => {
    process.env.OAUTH_PROVIDER = 'pingfederate';
    process.env.PF_USER_CLIENT_ID = 'pf-user-client';
    process.env.PF_USER_CLIENT_SECRET = 'pf-user-secret';
    process.env.PF_USER_REDIRECT_URI = 'https://local.ping-devops.com:4000/pf-callback';
    process.env.PF_USER_TOKEN_ENDPOINT_AUTH_METHOD = 'post';

    const userOAuth = require('../../config/oauthUser');

    expect(userOAuth.clientId).toBe('pf-user-client');
    expect(userOAuth.clientSecret).toBe('pf-user-secret');
    expect(userOAuth.redirectUri).toBe('https://local.ping-devops.com:4000/pf-callback');
    expect(userOAuth.tokenEndpointAuthMethod).toBe('post');
  });
});
