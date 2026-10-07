'use strict';

/**
 * PAR for a client the identity sidecar manages: the push goes through the relay without the
 * client secret. An unmanaged client, or the flag OFF, is pushed to PingOne directly as before.
 */

jest.mock('axios');
const mockRelay = { manages: jest.fn(), post: jest.fn() };
jest.mock('../services/sidecarClientRelay', () => mockRelay);

const axios = require('axios');
const { pushAuthorizationRequest, pushAuthorizationRequestWithRedirectFallback } = require('../services/parService');

const PAR = 'https://auth.pingone.com/env/as/par';
const payload = { scope: 'openid', redirect_uri: 'https://app.test/cb', authorization_details: [{ type: 'banking_transaction', amount: 50 }] };

beforeEach(() => {
  axios.post.mockReset();
  mockRelay.manages.mockReset();
  mockRelay.post.mockReset();
});

test('a managed client pushes through the relay with no secret and gets its request_uri', async () => {
  mockRelay.manages.mockResolvedValue(true);
  mockRelay.post.mockResolvedValue({ status: 201, data: { request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 90 } });

  const res = await pushAuthorizationRequest(PAR, 'agent-client', undefined, payload);

  expect(res.requestUri).toBe('urn:ietf:params:oauth:request_uri:abc');
  expect(res.expiresIn).toBe(90);
  expect(axios.post).not.toHaveBeenCalled();
  const [kind, form] = mockRelay.post.mock.calls[0];
  expect(kind).toBe('par');
  expect(form.get('client_id')).toBe('agent-client');
  expect(form.has('client_secret')).toBe(false);
  expect(form.get('code_challenge_method')).toBe('S256');
  expect(form.get('redirect_uri')).toBe('https://app.test/cb');
  expect(JSON.parse(form.get('authorization_details'))[0].amount).toBe(50);
});

test('an unmanaged client is pushed to PingOne directly with its secret, as before', async () => {
  mockRelay.manages.mockResolvedValue(false);
  axios.post.mockResolvedValue({ data: { request_uri: 'urn:direct', expires_in: 60 } });

  const res = await pushAuthorizationRequest(PAR, 'agent-client', 'local-secret', payload);

  expect(res.requestUri).toBe('urn:direct');
  expect(mockRelay.post).not.toHaveBeenCalled();
  expect(axios.post.mock.calls[0][0]).toBe(PAR);
  expect(axios.post.mock.calls[0][1].get('client_secret')).toBe('local-secret');
});

test('unmanaged with no secret is still the original "requires clientSecret" error', async () => {
  mockRelay.manages.mockResolvedValue(false);
  await expect(pushAuthorizationRequest(PAR, 'agent-client', undefined, payload)).rejects.toThrow(
    /PAR requires parEndpoint, clientId, and clientSecret/,
  );
  expect(axios.post).not.toHaveBeenCalled();
});

test('PingOne\'s error body relayed by the sidecar is reported the way a direct failure was', async () => {
  mockRelay.manages.mockResolvedValue(true);
  mockRelay.post.mockRejectedValue(Object.assign(new Error('Request failed'), {
    response: { status: 400, data: { error: 'invalid_request', error_description: 'Redirect URI mismatch' } },
  }));
  await expect(pushAuthorizationRequest(PAR, 'agent-client', undefined, payload)).rejects.toThrow(
    /PAR push failed: Redirect URI mismatch/,
  );
});

test('the redirect-uri fallback still moves on to the next candidate over the relay', async () => {
  mockRelay.manages.mockResolvedValue(true);
  mockRelay.post
    .mockRejectedValueOnce(Object.assign(new Error('x'), {
      response: { status: 400, data: { error: 'invalid_request', error_description: 'Redirect URI mismatch' } },
    }))
    .mockResolvedValueOnce({ status: 201, data: { request_uri: 'urn:second', expires_in: 60 } });

  const res = await pushAuthorizationRequestWithRedirectFallback(
    PAR, 'agent-client', undefined, { scope: 'openid' }, ['https://a.test/cb', 'https://b.test/cb'],
  );

  expect(res.requestUri).toBe('urn:second');
  expect(res.redirectUri).toBe('https://b.test/cb');
  expect(res.usedFallback).toBe(true);
});
