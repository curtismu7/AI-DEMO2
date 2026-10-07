'use strict';

/**
 * ff_agent_identity_sidecar BFF client: names a target, never carries the API
 * key into an error, and never falls back silently.
 */

const mockGetEffective = jest.fn();
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: (...a) => mockGetEffective(...a) }));

const axios = require('axios');
const client = require('../services/identitySidecarClient');

const KEY = 'sidecar-key-do-not-leak';

beforeEach(() => {
  axios.post.mockReset();
  mockGetEffective.mockReset();
  process.env.AGENT_IDENTITY_SIDECAR_API_KEY = KEY;
  delete process.env.AGENT_IDENTITY_SIDECAR_URL;
});

afterAll(() => {
  delete process.env.AGENT_IDENTITY_SIDECAR_API_KEY;
});

describe('isEnabled', () => {
  test('only the string "true" turns it on', () => {
    mockGetEffective.mockImplementation((k) => (k === 'ff_agent_identity_sidecar' ? 'true' : undefined));
    expect(client.isEnabled()).toBe(true);
    for (const v of ['false', undefined, '', '1']) {
      mockGetEffective.mockReturnValue(v);
      expect(client.isEnabled()).toBe(false);
    }
  });
});

describe('fetchActorToken', () => {
  test('posts the target with the api key and returns the access token', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'tok-1', expires_in: 3600 } });

    await expect(client.fetchActorToken()).resolves.toBe('tok-1');

    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('http://agent-identity-sidecar:8097/v1/token');
    expect(body).toEqual({ target: 'agent-gateway' });
    expect(opts.headers).toEqual({ 'x-api-key': KEY });
  });

  test('honors AGENT_IDENTITY_SIDECAR_URL and trims a trailing slash', async () => {
    process.env.AGENT_IDENTITY_SIDECAR_URL = 'http://sidecar.test:9000/';
    axios.post.mockResolvedValue({ data: { access_token: 'tok-2' } });
    await client.fetchActorToken({ target: 'other-target' });
    expect(axios.post.mock.calls[0][0]).toBe('http://sidecar.test:9000/v1/token');
    expect(axios.post.mock.calls[0][1]).toEqual({ target: 'other-target' });
  });

  test('a missing api key fails before any network call', async () => {
    delete process.env.AGENT_IDENTITY_SIDECAR_API_KEY;
    await expect(client.fetchActorToken()).rejects.toThrow(/AGENT_IDENTITY_SIDECAR_API_KEY/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('an upstream failure is a normalized error that does not leak the api key', async () => {
    const err = Object.assign(new Error('Request failed'), {
      response: { status: 502, data: { error: 'token_issuance_failed' } },
      config: { headers: { 'x-api-key': KEY } },
    });
    axios.post.mockRejectedValue(err);

    const thrown = await client.fetchActorToken().catch((e) => e);

    expect(thrown.message).toMatch(/502/);
    expect(thrown.message).toMatch(/token_issuance_failed/);
    expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))).not.toContain(KEY);
  });

  test('an unreachable sidecar is a clear error, not a fallback', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(client.fetchActorToken()).rejects.toThrow(/unreachable/);
  });

  test('a response without an access_token is an error', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await expect(client.fetchActorToken()).rejects.toThrow(/missing access_token/);
  });
});

describe('fetchActorToken expectations (the sidecar target is static, the BFF audience and scope are not)', () => {
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const issue = (claims) => axios.post.mockResolvedValue({ data: { access_token: jwt(claims) } });

  test('a token carrying the expected audience and scope is returned', async () => {
    issue({ aud: ['agentgateway.ping.demo'], scope: 'agent:invoke other' });
    await expect(
      client.fetchActorToken({ audience: 'agentgateway.ping.demo', scope: 'agent:invoke' }),
    ).resolves.toEqual(expect.any(String));
  });

  test('a string aud is accepted as well as an array', async () => {
    issue({ aud: 'agentgateway.ping.demo', scope: 'agent:invoke' });
    await expect(client.fetchActorToken({ audience: 'agentgateway.ping.demo' })).resolves.toEqual(expect.any(String));
  });

  test('a different audience is rejected, naming both', async () => {
    issue({ aud: ['mcpgateway.ping.demo'], scope: 'agent:invoke' });
    await expect(
      client.fetchActorToken({ audience: 'agentgateway.ping.demo' }),
    ).rejects.toThrow(/mcpgateway\.ping\.demo.*agentgateway\.ping\.demo/);
  });

  test('a token missing an expected scope is rejected, naming it', async () => {
    issue({ aud: ['agentgateway.ping.demo'], scope: 'read' });
    await expect(
      client.fetchActorToken({ scope: ['agent:invoke', 'read'] }),
    ).rejects.toThrow(/missing the expected agent:invoke/);
  });

  test('an opaque token cannot be verified, so it is rejected when an expectation is set', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'opaque-token' } });
    await expect(client.fetchActorToken({ audience: 'agentgateway.ping.demo' })).rejects.toThrow(/not a JWT/);
  });

  test('with no expectation nothing is checked, so any token is returned', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'opaque-token' } });
    await expect(client.fetchActorToken()).resolves.toBe('opaque-token');
  });
});
