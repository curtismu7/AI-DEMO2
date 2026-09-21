'use strict';

jest.mock('axios');
let axios;

describe('OAuthUserService PingFederate browser flow', () => {
  const keys = [
    'OAUTH_PROVIDER', 'PF_ISSUER', 'PF_AUTHORIZATION_ENDPOINT', 'PF_TOKEN_ENDPOINT',
    'PF_USER_CLIENT_ID', 'PF_USER_CLIENT_SECRET', 'PF_USER_REDIRECT_URI',
    'PF_USER_TOKEN_ENDPOINT_AUTH_METHOD',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let service;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    process.env.OAUTH_PROVIDER = 'pingfederate';
    process.env.PF_ISSUER = 'https://pf.example.test';
    process.env.PF_AUTHORIZATION_ENDPOINT = 'https://pf.example.test/as/authorization.oauth2';
    process.env.PF_TOKEN_ENDPOINT = 'https://pf.example.test/as/token.oauth2';
    process.env.PF_USER_CLIENT_ID = 'pf-user-client';
    process.env.PF_USER_CLIENT_SECRET = 'pf-user-secret';
    process.env.PF_USER_REDIRECT_URI = 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback';
    process.env.PF_USER_TOKEN_ENDPOINT_AUTH_METHOD = 'basic';
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { access_token: 'access', id_token: 'id', refresh_token: 'refresh' } });
    service = require('../../services/oauthUserService');
  });

  afterAll(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  test('builds the PF authorization-code + PKCE request with the canonical callback', () => {
    const url = service.generateAuthorizationUrl({ state: 'state', codeVerifier: 'verifier', nonce: 'nonce' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://pf.example.test/as/authorization.oauth2');
    expect(parsed.searchParams.get('client_id')).toBe('pf-user-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://local.ping-devops.com:4000/api/auth/oauth/user/callback');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state');
    expect(parsed.searchParams.get('nonce')).toBe('nonce');
  });

  test('exchanges the code at PF with server-side client authentication', async () => {
    await service.exchangeCodeForToken('code', 'verifier');
    const [url, bodyText, options] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyText);
    expect(url).toBe('https://pf.example.test/as/token.oauth2');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('pf-user-client');
    expect(body.get('code_verifier')).toBe('verifier');
    expect(options.headers.Authorization).toMatch(/^Basic /);
    expect(body.has('client_secret')).toBe(false);
  });
});
