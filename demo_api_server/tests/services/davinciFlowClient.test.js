'use strict';

jest.mock('axios');
const mockCfg = {
  apiClientId: 'client-id', apiClientSecret: 'client-secret',
  transaction: { companyId: 'co-1', appId: 'app-1', flowId: 'flow-1' },
};
jest.mock('../../config/davinci', () => mockCfg);
jest.mock('../../services/oauthEndpointResolver', () => ({
  getPingOneTokenEndpoint: jest.fn(() => 'https://auth.pingone.com/env-1/as/token'),
}));

const TOKEN_URL = 'https://auth.pingone.com/env-1/as/token';

// invokeFlow makes two axios.post calls (token, then flow start). Route the
// mock by URL so each test states the FLOW response and gets a token for free.
function mockPosts(axios, { flow, token } = {}) {
  axios.post.mockImplementation(async (url) => {
    const reply = url === TOKEN_URL
      ? (token || { data: { access_token: 'at-1', expires_in: 3600 } })
      : flow;
    if (reply instanceof Error) throw reply;
    return reply;
  });
}
const tokenCalls = (axios) => axios.post.mock.calls.filter(([url]) => url === TOKEN_URL);
const flowCalls = (axios) => axios.post.mock.calls.filter(([url]) => url !== TOKEN_URL);

describe('davinciFlowClient.invokeFlow', () => {
  let axios;
  let invokeFlow;
  // Fresh module registry per test: the client caches its token at module scope.
  beforeEach(() => {
    mockCfg.apiClientId = 'client-id';
    mockCfg.apiClientSecret = 'client-secret';
    jest.isolateModules(() => {
      axios = require('axios');
      ({ invokeFlow } = require('../../services/davinciFlowClient'));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('PERMIT: posts to the flow start endpoint and returns the parsed decision', async () => {
    mockPosts(axios, {
      flow: { data: { decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false } },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 50, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result).toEqual({ decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/company/co-1/applications/app-1/flows/flow-1/start'),
      { Amount: 50, TransactionType: 'transfer', Username: 'demoUser' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }) }),
    );
  });

  test('STEP_UP: returns stepUpRequired true from the flow response', async () => {
    mockPosts(axios, {
      flow: { data: { decision: 'STEP_UP', stepUpRequired: true, stepUpCompleted: true } },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 15000, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result.stepUpRequired).toBe(true);
  });

  test('unknown flowKey throws synchronously without calling axios', async () => {
    await expect(invokeFlow('notAFlow', {})).rejects.toThrow(/unknown flow/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('axios failure is normalized, never leaks raw error', async () => {
    const raw = new Error('connect ECONNREFUSED');
    raw.code = 'ECONNREFUSED';
    mockPosts(axios, { flow: raw });

    await expect(invokeFlow('transactionAuthorization', { Amount: 1, TransactionType: 'transfer', Username: 'u' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE', httpStatus: 503 });
    expect(flowCalls(axios)).toHaveLength(1);
  });

  const PARAMS = { Amount: 1, TransactionType: 'transfer', Username: 'u' };
  const OK_FLOW = { data: { decision: 'PERMIT' } };

  test('flow request carries the fetched access token, not id:secret', async () => {
    mockPosts(axios, { flow: OK_FLOW });

    await invokeFlow('transactionAuthorization', PARAMS);

    const [[url, body, cfg]] = tokenCalls(axios);
    expect(url).toBe(TOKEN_URL);
    expect(body).toBe('grant_type=client_credentials');
    expect(cfg.auth).toEqual({ username: 'client-id', password: 'client-secret' });
    const [[, , flowCfg]] = flowCalls(axios);
    expect(flowCfg.headers.Authorization).toBe('Bearer at-1');
    expect(flowCfg.headers.Authorization).not.toContain('client-secret');
  });

  test('token is fetched once and reused, then refetched shortly before expiry', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockPosts(axios, { flow: OK_FLOW, token: { data: { access_token: 'at-1', expires_in: 3600 } } });

    await invokeFlow('transactionAuthorization', PARAMS);
    await invokeFlow('transactionAuthorization', PARAMS);
    expect(tokenCalls(axios)).toHaveLength(1);

    // 30s before expiry is inside the 60s refresh margin.
    now.mockReturnValue(1_000_000 + (3600 - 30) * 1000);
    mockPosts(axios, { flow: OK_FLOW, token: { data: { access_token: 'at-2', expires_in: 3600 } } });
    await invokeFlow('transactionAuthorization', PARAMS);

    expect(tokenCalls(axios)).toHaveLength(2);
    expect(flowCalls(axios)[2][2].headers.Authorization).toBe('Bearer at-2');
  });

  test('missing credentials: not-configured error, no token or flow request', async () => {
    mockCfg.apiClientSecret = undefined;
    mockPosts(axios, { flow: OK_FLOW });

    await expect(invokeFlow('transactionAuthorization', PARAMS))
      .rejects.toMatchObject({ code: 'davinci_not_configured', httpStatus: 503 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('token endpoint failure is normalized with no credential material', async () => {
    const raw = new Error('Request failed with status code 401');
    raw.response = { status: 401, data: { error: 'invalid_client' } };
    raw.config = {
      auth: { username: 'client-id', password: 'client-secret' },
      headers: { Authorization: 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=' },
    };
    mockPosts(axios, { flow: OK_FLOW, token: raw });

    const err = await invokeFlow('transactionAuthorization', PARAMS).catch((e) => e);

    expect(err).toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', httpStatus: 401 });
    expect(err.message).toMatch(/DaVinci API token request/);
    expect(err.config).toBeUndefined();
    expect(JSON.stringify({ m: err.message, c: err.cause })).not.toMatch(/client-secret|Y2xpZW50/);
    expect(flowCalls(axios)).toHaveLength(0);
  });

  test('token response without an access_token never becomes "Bearer undefined"', async () => {
    mockPosts(axios, { flow: OK_FLOW, token: { data: {} } });

    await expect(invokeFlow('transactionAuthorization', PARAMS))
      .rejects.toMatchObject({ code: 'davinci_token_missing', httpStatus: 502 });
    expect(flowCalls(axios)).toHaveLength(0);
  });
});
