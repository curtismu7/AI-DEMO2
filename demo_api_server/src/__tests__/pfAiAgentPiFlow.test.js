'use strict';

const { openFlow } = require('../../services/pfAiAgentPiFlowService');

const values = {
  pf_issuer: 'https://pf.example.test', pf_authorization_endpoint: 'https://pf.example.test/as/authorization.oauth2',
  pf_token_endpoint: 'https://pf.example.test/as/token.oauth2', pf_jwks_uri: 'https://pf.example.test/pf/JWKS',
  pf_user_client_id: 'user-client', pf_user_redirect_uri: 'https://app.example.test/cb',
};
const store = (over = {}) => ({ getEffective: (k) => ({ ...values, ...over })[k] ?? '' });
const flow = { id: 'flowid12345678', status: 'USERNAME_PASSWORD_REQUIRED', _links: { self: {}, checkUsernamePassword: {} } };

beforeAll(() => { process.env.PUBLIC_APP_URL = 'https://app.example.test'; });

test('opens a pi.flow, reads it back with the flow cookie, and never shows the full flow id', async () => {
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => flow, headers: { getSetCookie: () => ['PF=abc; Path=/; Secure'] } })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => flow });
  const result = await openFlow({ session: {} }, { store: store(), fetchImpl });

  const opened = new URL(fetchImpl.mock.calls[0][0]);
  expect(opened.searchParams.get('response_mode')).toBe('pi.flow');
  expect(opened.searchParams.get('client_id')).toBe('user-client');
  expect(fetchImpl.mock.calls[1][0]).toBe('https://pf.example.test/pf-ws/authn/flows/flowid12345678');
  expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({ Cookie: 'PF=abc', 'X-XSRF-Header': 'PingFederate' });
  expect(result).toMatchObject({ status: 'USERNAME_PASSWORD_REQUIRED', actions: ['self', 'checkUsernamePassword'] });
  expect(JSON.stringify(result)).not.toContain('flowid12345678');
  expect(JSON.stringify(result)).not.toContain('PF=abc');
});

test('explains what to enable when PingFederate does not open a flow', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
  await expect(openFlow({ session: {} }, { store: store(), fetchImpl })).rejects.toMatchObject({ code: 'PF_AI_PIFLOW_NOT_OPENED' });
});

test('names the missing sign-in client', async () => {
  await expect(openFlow({ session: {} }, { store: store({ pf_user_client_id: '' }), fetchImpl: jest.fn() }))
    .rejects.toMatchObject({ code: 'PF_AI_PIFLOW_NOT_CONFIGURED', httpStatus: 503 });
});
