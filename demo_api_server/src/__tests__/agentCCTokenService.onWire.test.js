'use strict';
const axios = require('axios');
jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => ({ pingone_mcp_token_exchanger_client_id: 'agent-client', pingone_mcp_token_exchanger_client_secret: 'agent-secret', pingone_mcp_token_exchanger_cc_auth_method: 'post' })[key],
}));
jest.mock('../../config/oauth', () => ({ tokenEndpoint: 'https://pf.example.test/as/token.oauth2' }));
jest.mock('../../services/oauthEndpointResolver', () => ({ getPingOneTokenEndpoint: () => 'https://auth.pingone.com/test-env/as/token' }));
jest.mock('../../utils/tokenUtils', () => ({ decodeJwt: () => ({ claims: { sub: 'agent-client' } }) }));
const { getAgentCCToken } = require('../../services/agentCCTokenService');

beforeEach(() => jest.clearAllMocks());

test('onWire receives the real client-credentials request and response', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', token_type: 'Bearer', expires_in: 3600, scope: 'agent:invoke' } });
  const onWire = jest.fn();
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 'agent-sec', scope: ['agent:invoke'], authMethod: 'post', onWire });
  expect(out.access_token).toBe('actor.jwt.x');
  const info = onWire.mock.calls[0][0];
  expect(info.request).toMatchObject({ method: 'POST', url: 'https://auth.pingone.com/test-env/as/token' });
  expect(info.request.body).toMatchObject({ grant_type: 'client_credentials', scope: 'agent:invoke', client_id: 'AGENT', client_secret: 'agent-sec' });
  expect(info.response).toEqual({ status: 200, data: expect.objectContaining({ access_token: 'actor.jwt.x', expires_in: 3600 }) });
});

test('onWire also receives an error response (non-2xx), and the call still throws', async () => {
  axios.post.mockResolvedValue({ status: 401, data: { error: 'invalid_client' } });
  const onWire = jest.fn();
  await expect(getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 'bad', scope: ['agent:invoke'], authMethod: 'post', onWire })).rejects.toThrow(/Failed to obtain agent CC token/);
  expect(onWire.mock.calls[0][0].response).toEqual({ status: 401, data: { error: 'invalid_client' } });
});

test('a throwing hook changes nothing', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', scope: 'agent:invoke' } });
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 's', scope: ['agent:invoke'], authMethod: 'post', onWire: () => { throw new Error('hook bug'); } });
  expect(out.access_token).toBe('actor.jwt.x');
});

test('without a hook the call is unchanged', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { access_token: 'actor.jwt.x', scope: 'agent:invoke' } });
  const out = await getAgentCCToken({}, { clientId: 'AGENT', clientSecret: 's', scope: ['agent:invoke'], authMethod: 'post' });
  expect(out).toMatchObject({ access_token: 'actor.jwt.x', clientId: 'AGENT' });
});
