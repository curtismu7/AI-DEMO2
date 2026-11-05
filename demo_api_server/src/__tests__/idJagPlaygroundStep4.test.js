'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performIdJagExchange: jest.fn() }));
jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: jest.fn(),
  getMcpGatewayHttpUrl: () => 'https://gw.test',
}));
jest.mock('../../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://app.test' }));

const configStore = require('../../services/configStore');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');
const router = require('../../routes/idJagPlayground');

const CONFIG = { pf_issuer: 'https://pf.test', pf_id_jag_enabled: 'true' };

function appWith(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/pg', router);
  return app;
}
const session = (over = {}) => ({ oauthProvider: 'pingfederate', oauthTokens: { refreshToken: 'rt', idToken: 'idt' }, idJagPlayground: { redeemed: true, accessToken: 'at' }, ...over });
const getConfig = (s) => request(appWith(s)).get('/pg/config');
const postCall = (s) => request(appWith(s)).post('/pg/call').set('Origin', 'https://app.test').send({});
const setting = (value) => {
  const cfg = { ...CONFIG };
  if (value !== undefined) cfg.id_jag_playground_step4_enabled = value;
  configStore.getEffective.mockImplementation((k) => cfg[k]);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => CONFIG[k]);
  jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
});
afterEach(() => jest.restoreAllMocks());

describe('ID-JAG playground step 4 availability', () => {
  it.each([[undefined], [''], ['true'], ['TRUE']])('is available when the setting is %p', async (v) => {
    setting(v);
    const res = await getConfig(session());
    expect(res.body.gateway.step4).toEqual({ available: true, reason: null });
  });

  it.each([['false'], ['FALSE'], ['0'], ['off']])('is unavailable, with a plain reason, when the setting is %p', async (v) => {
    setting(v);
    const res = await getConfig(session());
    expect(res.body.gateway.step4.available).toBe(false);
    expect(res.body.gateway.step4.expectRejected).toBe(true);
    expect(res.body.gateway.step4.reason).toMatch(/validates tokens with PingOne only/);
  });

  it('applies to the pf-pf lane too, but not to byo', async () => {
    setting('false');
    expect((await getConfig(session({ idJagPlaygroundMode: 'pf-pf' }))).body.gateway.step4.available).toBe(false);
    expect((await getConfig(session({ idJagPlaygroundMode: 'byo' }))).body.gateway.step4).toEqual({ available: true, reason: null });
  });

  it('still sends the token to the gateway when step 4 is a negative test, and passes its refusal through', async () => {
    setting('false');
    callToolViaGateway.mockRejectedValue(Object.assign(new Error('Token is revoked or no longer active'), { httpStatus: 401, gatewayStatus: 401, gatewayErrorCode: 'TOKEN_INACTIVE' }));
    const res = await postCall(session());
    expect(callToolViaGateway).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    expect(res.body).toEqual(expect.objectContaining({ gatewayStatus: 401, gatewayErrorCode: 'TOKEN_INACTIVE' }));
  });

  it.each([[undefined], ['true']])('still calls the gateway when the setting is %p', async (v) => {
    setting(v);
    callToolViaGateway.mockResolvedValue({ result: { tools: [] } });
    const res = await postCall(session());
    expect(res.status).toBe(200);
    expect(callToolViaGateway).toHaveBeenCalledTimes(1);
  });
});
