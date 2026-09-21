'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('../../config/oauth', () => ({
  tokenEndpoint: 'https://pf.example.com/as/token.oauth2',
  clientId: 'pf-admin-client',
  clientSecret: 'pf-admin-secret',
  tokenEndpointAuthMethod: 'basic',
}));

const providerConfig = {
  oauth_provider: 'pingfederate',
  pf_token_exchange_client_id: 'pf-exchange-client',
  pf_token_exchange_client_secret: 'pf-exchange-secret',
  pf_token_exchange_token_endpoint_auth_method: 'basic',
};

const idJagToken = [
  Buffer.from(JSON.stringify({ typ: 'oauth-id-jag+jwt', alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ iss: 'https://pf.example.com', sub: 'user-1', aud: 'https://downstream.example.test', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url'),
  'signature',
].join('.');

jest.mock('../../services/configStore', () => ({
  getOAuthProvider: () => providerConfig.oauth_provider,
  getEffective: (key) => providerConfig[key] || '',
}));

const oauthService = require('../../services/oauthService');

describe('OAuthService.performIdJagExchange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete providerConfig.pf_id_jag_redemption_token_endpoint;
    delete providerConfig.pf_id_jag_redemption_client_id;
    delete providerConfig.pf_id_jag_redemption_client_secret;
    delete providerConfig.pf_id_jag_redemption_auth_method;
  });

  test('requests a real ID-JAG from PingFederate using the configured exchange client', async () => {
    axios.post.mockResolvedValue({
      data: {
        access_token: idJagToken,
        issued_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
        token_type: 'N_A',
        expires_in: 300,
      },
    });

    const result = await oauthService.performIdJagExchange(
      'pf-refresh-token',
      'urn:ietf:params:oauth:token-type:refresh_token',
      'https://downstream.example.test',
      'https://api.example.test',
      ['accounts:read'],
    );

    expect(result).toBe(idJagToken);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, bodyText, options] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyText);

    expect(url).toBe('https://pf.example.com/as/token.oauth2');
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.get('requested_token_type')).toBe('urn:ietf:params:oauth:token-type:id-jag');
    expect(body.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:refresh_token');
    expect(body.get('subject_token')).toBe('pf-refresh-token');
    expect(body.get('audience')).toBe('https://downstream.example.test');
    expect(body.get('resource')).toBe('https://api.example.test');
    expect(body.get('scope')).toBe('accounts:read');
    expect(body.get('client_id')).toBe('pf-exchange-client');
    expect(options.headers.Authorization).toMatch(/^Basic /);
    expect(options.headers.Authorization).not.toContain('pf-refresh-token');
  });

  test('rejects a response that is not an ID-JAG', async () => {
    axios.post.mockResolvedValue({
      data: {
        access_token: 'ordinary-access-token',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    });

    await expect(oauthService.performIdJagExchange(
      'pf-refresh-token',
      'urn:ietf:params:oauth:token-type:refresh_token',
      'https://downstream.example.test',
      'https://api.example.test',
      ['accounts:read'],
    )).rejects.toThrow(/ID-JAG/i);
  });

  test('redeems the ID-JAG only at the explicitly configured downstream AS', async () => {
    providerConfig.pf_id_jag_redemption_token_endpoint = 'https://as.example.test/token';
    providerConfig.pf_id_jag_redemption_client_id = 'downstream-client';
    providerConfig.pf_id_jag_redemption_client_secret = 'downstream-secret';
    providerConfig.pf_id_jag_redemption_auth_method = 'post';
    axios.post.mockResolvedValue({
      data: {
        access_token: 'downstream-access-token',
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    });

    const result = await oauthService.redeemIdJag(
      idJagToken,
      'https://api.example.test',
      ['accounts:read'],
    );

    expect(result).toBe('downstream-access-token');
    const [url, bodyText] = axios.post.mock.calls[0];
    const body = new URLSearchParams(bodyText);
    expect(url).toBe('https://as.example.test/token');
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(body.get('assertion')).toBe(idJagToken);
    expect(body.get('scope')).toBe('accounts:read');
    expect(body.get('resource')).toBe('https://api.example.test');
    expect(body.get('client_id')).toBe('downstream-client');
    expect(body.get('client_secret')).toBe('downstream-secret');
  });

  test('fails closed when ID-JAG redemption is not configured', async () => {
    await expect(oauthService.redeemIdJag('pf-id-jag-token', 'https://api.example.test', []))
      .rejects.toThrow(/redemption token endpoint/i);
  });
});
