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

  test('registers the PF two-hop exchanger and actor settings with encrypted secrets', () => {
    process.env.PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID = 'pf-agent-hop';
    process.env.PF_STANDARD_AGENT_EXCHANGE_CLIENT_SECRET = 'pf-agent-hop-secret';
    process.env.PF_STANDARD_INTERMEDIATE_AUDIENCE = 'https://pf.example.test/agent-intermediate';
    process.env.PF_MCP_SERVICE_ACTOR_CLIENT_ID = 'pf-mcp-actor';
    process.env.PF_MCP_SERVICE_ACTOR_CLIENT_SECRET = 'pf-mcp-actor-secret';

    const configStore = require('../../services/configStore');

    expect(configStore.getEffective('pf_standard_agent_exchange_client_id')).toBe('pf-agent-hop');
    expect(configStore.getEffective('pf_standard_intermediate_audience')).toBe('https://pf.example.test/agent-intermediate');
    expect(configStore.getEffective('pf_mcp_service_actor_client_id')).toBe('pf-mcp-actor');
    expect(configStore.SECRET_KEYS.has('PF_STANDARD_AGENT_EXCHANGE_CLIENT_SECRET')).toBe(true);
    expect(configStore.SECRET_KEYS.has('PF_MCP_SERVICE_ACTOR_CLIENT_SECRET')).toBe(true);
    expect(configStore.FIELD_DEFS.PF_STANDARD_AGENT_EXCHANGE_CLIENT_SECRET.public).toBe(false);
    expect(configStore.FIELD_DEFS.PF_MCP_SERVICE_ACTOR_CLIENT_SECRET.public).toBe(false);
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

  describe('user OAuth readiness', () => {
    afterEach(() => jest.restoreAllMocks());

    test.each([
      [{ oauth_provider: 'pingone', pingone_environment_id: 'env', user_client_id: 'user' }, true],
      [{ oauth_provider: 'pingone', pingone_environment_id: '', user_client_id: 'user' }, false],
      [{ oauth_provider: 'pingone', pingone_environment_id: 'env', user_client_id: '' }, false],
      [{ oauth_provider: 'pingone', pingone_environment_id: '', user_client_id: '', pf_issuer: 'https://pf.example.test', pf_user_client_id: 'pf-user' }, false],
      [{ oauth_provider: 'pingfederate', pf_issuer: 'https://pf.example.test', pf_user_client_id: 'pf-user' }, true],
      [{ oauth_provider: 'pingfederate', pf_issuer: '', pf_user_client_id: 'pf-user' }, false],
      [{ oauth_provider: 'pingfederate', pf_issuer: 'https://pf.example.test', pf_user_client_id: '' }, false],
      [{ oauth_provider: 'pingfederate', pf_issuer: '', pf_user_client_id: '', pingone_environment_id: 'env', user_client_id: 'user' }, false],
    ])('requires the selected provider configuration: %p', (settings, expected) => {
      const configStore = require('../../services/configStore');
      jest.spyOn(configStore, 'getEffective').mockImplementation((key) => settings[key] || '');

      expect(configStore.isUserOAuthConfigured()).toBe(expected);
    });
  });
});
