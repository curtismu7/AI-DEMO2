'use strict';
jest.mock('axios');
const axios = require('axios');
jest.mock('../../config/oauth', () => ({ tokenEndpoint: 'https://pingone.example/as/token', clientId: 'admin', clientSecret: 'admin-secret', tokenEndpointAuthMethod: 'post' }));
jest.mock('../../services/configStore', () => ({ getOAuthProvider: () => 'pingone', getEffective: () => '' }));
const oauthService = require('../../services/oauthService');

const call = (opts) => oauthService.performTokenExchangeAs('subj', 'act', 'ex', 'ex-secret', 'aud.example', 'obo:invoke', 'post', { tokenEndpoint: 'https://pingone.example/as/token', ...opts });

beforeEach(() => jest.clearAllMocks());

test('onWire receives the real request and response on success', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x', token_type: 'Bearer', expires_in: 900 } });
  const onWire = jest.fn();
  const out = await call({ onWire });
  expect(out).toBe('delegated.jwt.x');
  const info = onWire.mock.calls[0][0];
  expect(info.request).toMatchObject({ method: 'POST', url: 'https://pingone.example/as/token' });
  expect(info.request.body).toMatchObject({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: 'subj', actor_token: 'act',
    audience: 'aud.example', scope: 'obo:invoke', client_id: 'ex', client_secret: 'ex-secret',
  });
  expect(info.response).toEqual({ status: 200, data: expect.objectContaining({ access_token: 'delegated.jwt.x', expires_in: 900 }) });
});

test('onWire receives PingOne\'s real error response when the exchange fails, and the call still throws', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: 'invalid_scope', error_description: 'bad scope' } } }));
  const onWire = jest.fn();
  await expect(call({ onWire })).rejects.toThrow(/invalid_scope|bad scope/);
  expect(onWire).toHaveBeenCalledTimes(1);
  expect(onWire.mock.calls[0][0].response).toEqual({ status: 400, data: { error: 'invalid_scope', error_description: 'bad scope' } });
});

test('a throwing hook changes nothing: success still returns the token', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x' } });
  await expect(call({ onWire: () => { throw new Error('hook bug'); } })).resolves.toBe('delegated.jwt.x');
});

test('a 200 response without an access token is reported once (no double hook call)', async () => {
  axios.post.mockResolvedValue({ status: 200, data: {} });
  const onWire = jest.fn();
  await expect(call({ onWire })).rejects.toThrow(/missing access_token/);
  expect(onWire).toHaveBeenCalledTimes(1);
});

test('without a hook the result and the request are exactly as before', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated.jwt.x' } });
  await expect(call({})).resolves.toBe('delegated.jwt.x');
  expect(axios.post).toHaveBeenCalledTimes(1);
});
