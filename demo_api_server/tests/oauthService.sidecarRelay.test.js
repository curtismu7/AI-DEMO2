'use strict';

/**
 * oauthService routing for clients the identity sidecar manages (ff_agent_identity_sidecar).
 * A managed client's form is sent to the sidecar relay WITHOUT its secret; every other client,
 * and every client when the flag is OFF, goes to PingOne exactly as before.
 */

jest.mock('axios');
jest.mock('../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));

const mockRelay = { manages: jest.fn(), post: jest.fn() };
jest.mock('../services/sidecarClientRelay', () => mockRelay);

const axios = require('axios');
const oauthService = require('../services/oauthService');

const ENV_KEYS = ['AGENT_OAUTH_CLIENT_ID', 'AGENT_OAUTH_CLIENT_SECRET'];
const saved = {};
const formOf = (body) => new URLSearchParams(typeof body === 'string' ? body : body.toString());

beforeEach(() => {
  axios.post.mockReset();
  mockRelay.manages.mockReset();
  mockRelay.post.mockReset();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
});

describe('getClientCredentialsTokenAs', () => {
  test('a managed client goes through the relay with no secret, and PingOne is not called directly', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockResolvedValue({ status: 200, data: { access_token: 'via-sidecar' } });

    const token = await oauthService.getClientCredentialsTokenAs('agent-client', 'local-secret', 'agentgateway.ping.demo', 'post', 'agent:invoke');

    expect(token).toBe('via-sidecar');
    expect(axios.post).not.toHaveBeenCalled();
    const [kind, body] = mockRelay.post.mock.calls[0];
    expect(kind).toBe('token');
    const form = formOf(body);
    expect(form.get('client_id')).toBe('agent-client');
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('audience')).toBe('agentgateway.ping.demo');
    expect(form.get('scope')).toBe('agent:invoke');
    expect(form.has('client_secret')).toBe(false);
    expect(body.toString()).not.toContain('local-secret');
  });

  test('a client that is not managed is sent to PingOne with its secret, exactly as before', async () => {
    mockRelay.manages.mockResolvedValue(false);
    axios.post.mockResolvedValue({ data: { access_token: 'direct' } });

    const token = await oauthService.getClientCredentialsTokenAs('agent-client', 'local-secret', 'aud', 'post', 'scope');

    expect(token).toBe('direct');
    expect(mockRelay.post).not.toHaveBeenCalled();
    expect(formOf(axios.post.mock.calls[0][1]).get('client_secret')).toBe('local-secret');
  });

  test('PingOne\'s error relayed by the sidecar reaches the existing error handling unchanged', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      response: { status: 400, data: { error: 'invalid_scope', error_description: 'May not request scopes for multiple resources' } },
    }));

    const err = await oauthService.getClientCredentialsTokenAs('agent-client', undefined, 'aud', 'post', 'scope').catch((e) => e);

    expect(err.httpStatus).toBe(400);
    expect(err.pingoneError).toBe('invalid_scope');
    expect(err.message).toMatch(/May not request scopes for multiple resources/);
  });
});

describe('performTokenExchangeAs', () => {
  const exchange = (opts) =>
    oauthService.performTokenExchangeAs('subject-tok', 'actor-tok', 'exchanger-client', 'local-secret', 'mcpgateway.ping.demo', ['read'], 'post', opts);

  test('a managed exchanger sends the exchange form through the relay without its secret', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockResolvedValue({ status: 200, data: { access_token: 'delegated' } });

    await expect(exchange()).resolves.toBe('delegated');

    expect(axios.post).not.toHaveBeenCalled();
    const form = formOf(mockRelay.post.mock.calls[0][1]);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(form.get('subject_token')).toBe('subject-tok');
    expect(form.get('actor_token')).toBe('actor-tok');
    expect(form.get('client_id')).toBe('exchanger-client');
    expect(form.has('client_secret')).toBe(false);
  });

  test('an unmanaged exchanger is exchanged directly with its secret, as before', async () => {
    mockRelay.manages.mockResolvedValue(false);
    axios.post.mockResolvedValue({ data: { access_token: 'direct-delegated' } });

    await expect(exchange()).resolves.toBe('direct-delegated');

    expect(mockRelay.post).not.toHaveBeenCalled();
    expect(formOf(axios.post.mock.calls[0][1]).get('client_secret')).toBe('local-secret');
  });

  test('a PingFederate endpoint override never consults the sidecar', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'pf' } });

    await expect(exchange({ tokenEndpoint: 'https://pf.example.test/as/token.oauth2' })).resolves.toBe('pf');

    expect(mockRelay.manages).not.toHaveBeenCalled();
    expect(mockRelay.post).not.toHaveBeenCalled();
  });

  test('an error relayed from PingOne keeps its httpStatus and pingoneError', async () => {
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      response: { status: 403, data: { error: 'access_denied', error_description: 'may_act check failed' } },
    }));

    const err = await exchange().catch((e) => e);

    expect(err.httpStatus).toBe(403);
    expect(err.pingoneError).toBe('access_denied');
  });
});

describe('getMcpExchangerToken', () => {
  test('a managed exchanger needs no local secret: it is fetched through the relay', async () => {
    process.env.AGENT_OAUTH_CLIENT_ID = 'exchanger-client';
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    mockRelay.manages.mockResolvedValue(true);
    mockRelay.post.mockResolvedValue({ status: 200, data: { access_token: 'exchanger-tok' } });

    await expect(oauthService.getMcpExchangerToken()).resolves.toBe('exchanger-tok');

    const form = formOf(mockRelay.post.mock.calls[0][1]);
    expect(form.get('client_id')).toBe('exchanger-client');
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.has('client_secret')).toBe(false);
  });

  test('unmanaged with no local secret is still the original "not configured" error', async () => {
    process.env.AGENT_OAUTH_CLIENT_ID = 'exchanger-client';
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    mockRelay.manages.mockResolvedValue(false);

    await expect(oauthService.getMcpExchangerToken()).rejects.toThrow(/credentials not configured/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
