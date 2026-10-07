'use strict';

/**
 * The BFF side of the sidecar's credential-injecting relay. Flag OFF must touch nothing; flag ON
 * must never fall back silently; results and errors must look like axios's, because every call
 * site keeps its existing response handling and catch blocks.
 */

const mockGetEffective = jest.fn();
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: (...a) => mockGetEffective(...a) }));

const axios = require('axios');
const relay = require('../services/sidecarClientRelay');

const KEY = 'sidecar-key-do-not-leak';
const flag = (on) =>
  mockGetEffective.mockImplementation((k) => (k === 'ff_agent_identity_sidecar' ? (on ? 'true' : 'false') : undefined));

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  mockGetEffective.mockReset();
  relay.resetForTests();
  process.env.AGENT_IDENTITY_SIDECAR_API_KEY = KEY;
  delete process.env.AGENT_IDENTITY_SIDECAR_URL;
  delete process.env.AGENT_IDENTITY_SIDECAR_SOCKET;
});

afterAll(() => {
  delete process.env.AGENT_IDENTITY_SIDECAR_API_KEY;
  delete process.env.AGENT_IDENTITY_SIDECAR_SOCKET;
});

describe('manages', () => {
  test('flag OFF: false, and the sidecar is never contacted', async () => {
    flag(false);
    await expect(relay.manages('agent-client')).resolves.toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('no client id: false without a request', async () => {
    flag(true);
    await expect(relay.manages(undefined)).resolves.toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('flag ON: true only for a client the sidecar lists', async () => {
    flag(true);
    axios.get.mockResolvedValue({ data: { clients: ['agent-client', 'exchanger-client'] } });
    await expect(relay.manages('agent-client')).resolves.toBe(true);
    await expect(relay.manages('exchanger-client')).resolves.toBe(true);
    await expect(relay.manages('user-client')).resolves.toBe(false);
  });

  test('the client list is cached, so it is not fetched on every call', async () => {
    flag(true);
    axios.get.mockResolvedValue({ data: { clients: ['agent-client'] } });
    await relay.manages('agent-client');
    await relay.manages('agent-client');
    await relay.manages('other');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('flag ON with the sidecar down is an error, not a quiet false (no fallback to the local secret)', async () => {
    flag(true);
    axios.get.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(relay.manages('agent-client')).rejects.toThrow(/unreachable/);
  });

  test('it asks the sidecar with the api key, over the socket when one is configured', async () => {
    flag(true);
    process.env.AGENT_IDENTITY_SIDECAR_SOCKET = '/run/agent-identity/sidecar.sock';
    axios.get.mockResolvedValue({ data: { clients: [] } });
    await relay.manages('x');
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toMatch(/\/v1\/clients$/);
    expect(opts.headers).toEqual({ 'x-api-key': KEY });
    expect(opts.socketPath).toBe('/run/agent-identity/sidecar.sock');
  });
});

describe('post', () => {
  const upstream = (status, body, contentType = 'application/json') =>
    axios.post.mockResolvedValue({ status, headers: { 'content-type': contentType }, data: body });

  test('sends the form to /as/<kind> with the key and returns the parsed 2xx body', async () => {
    upstream(200, '{"access_token":"tok","expires_in":300}');
    const res = await relay.post('token', new URLSearchParams({ grant_type: 'client_credentials', client_id: 'agent-client' }));

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ access_token: 'tok', expires_in: 300 });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/as\/token$/);
    const form = new URLSearchParams(body);
    expect(form.get('client_id')).toBe('agent-client');
    expect(form.has('client_secret')).toBe(false);
    expect(opts.headers['x-api-key']).toBe(KEY);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  test.each([['par'], ['introspect']])('%s goes to its own path', async (kind) => {
    upstream(200, '{}');
    await relay.post(kind, { client_id: 'c' });
    expect(axios.post.mock.calls[0][0]).toMatch(new RegExp(`/as/${kind}$`));
  });

  test('a non-2xx is thrown with an axios-style .response, so existing catch blocks read it unchanged', async () => {
    upstream(401, '{"error":"invalid_client","error_description":"Request denied"}');
    const err = await relay.post('token', { client_id: 'c' }).catch((e) => e);
    expect(err.response.status).toBe(401);
    expect(err.response.data).toEqual({ error: 'invalid_client', error_description: 'Request denied' });
    expect(err.response.data.error_description).toBe('Request denied');
  });

  test('a non-JSON body is returned as text', async () => {
    upstream(200, 'plain text', 'text/plain');
    expect((await relay.post('token', { client_id: 'c' })).data).toBe('plain text');
  });

  test('an unreachable sidecar is a normalized error that does not carry the key', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', config: { headers: { 'x-api-key': KEY } } }));
    const err = await relay.post('token', { client_id: 'c' }).catch((e) => e);
    expect(err.message).toMatch(/unreachable/);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(KEY);
  });
});
