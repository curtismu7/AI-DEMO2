'use strict';

// PingOne worker credentials exist only in PingOne. With the login provider
// switched to PingFederate, the provider-aware token endpoint is PF's, and
// sending the worker client there is rejected as invalid_client — which broke
// in-app MFA, OTP email and the agent-authorization write for every PF session.

const fs = require('node:fs');
const path = require('node:path');

const mockPfToken = 'https://pf.example.test:9031/as/token.oauth2';
const mockConfig = {
  pingone_environment_id: 'env-1',
  pingone_region: 'com',
  pf_token_endpoint: mockPfToken,
  pingone_worker_token_client_id: 'worker',
  pingone_worker_token_client_secret: 'secret',
  pingone_mfa_policy_id: 'policy-1',
};

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => mockConfig[key] ?? null),
  get: jest.fn(() => null),
  getOAuthProvider: jest.fn(() => 'pingfederate'),
}));
jest.mock('axios', () => ({
  post: jest.fn(async (url) => (String(url).endsWith('/token')
    ? { data: { access_token: 'worker-token' } }
    : { data: { id: 'da-1', status: 'DEVICE_SELECTION_REQUIRED' } })),
  get: jest.fn(async () => ({ data: {} })),
}));

const axios = require('axios');

test('MFA requests its worker token from PingOne while the login provider is PingFederate', async () => {
  const mfaService = require('../services/mfaService');
  await mfaService.initiateDeviceAuth('user-1', 'user-access-token');
  const tokenCall = axios.post.mock.calls[0][0];
  expect(tokenCall).toBe('https://auth.pingone.com/env-1/as/token');
  expect(axios.post.mock.calls.map(([url]) => url)).not.toContain(mockPfToken);
});

test.each(['mfaService.js', 'emailService.js', 'pingOneUserService.js'])('%s never resolves the provider-aware token endpoint', (file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', file), 'utf8');
  expect(source).toContain('getPingOneTokenEndpoint');
  expect(source).not.toMatch(/\bgetTokenEndpoint\b/);
});
