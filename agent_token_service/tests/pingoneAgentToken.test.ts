'use strict';

import axios from 'axios';
import { acquireAgentToken, clearTokenCache } from '../src/pingoneAgentToken';
import type { BrokerConfig } from '../src/config';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const baseConfig: BrokerConfig = {
  port: 3010,
  host: '127.0.0.1',
  apiKey: 'test-key',
  tokenEndpoint: 'https://auth.pingone.com/env/as/token',
  clientId: 'copilot-agent-client',
  clientSecret: 'super-secret-value',
  tokenAuthMethod: 'post',
  scope: 'agent:invoke',
  audience: '',
  usePkiCreds: false,
  agentCertPath: '',
};

beforeEach(() => {
  clearTokenCache();
  mockedPost.mockReset();
});

test('client_secret_post success returns the token fields', async () => {
  mockedPost.mockResolvedValueOnce({
    data: { access_token: 'tok-123', token_type: 'Bearer', expires_in: 300, scope: 'agent:invoke' },
  });

  const token = await acquireAgentToken(baseConfig);

  expect(token.accessToken).toBe('tok-123');
  expect(token.tokenType).toBe('Bearer');
  expect(token.expiresIn).toBe(300);
  expect(token.scope).toBe('agent:invoke');
  expect(mockedPost).toHaveBeenCalledTimes(1);

  // post mode: client_credentials grant with credentials in the body, no Basic header.
  const [url, body, opts] = mockedPost.mock.calls[0];
  expect(url).toBe(baseConfig.tokenEndpoint);
  expect(body).toContain('grant_type=client_credentials');
  expect(body).toContain('scope=agent%3Ainvoke');
  expect(body).toContain('client_id=copilot-agent-client');
  expect(body).toContain('client_secret=super-secret-value');
  expect(opts.headers.Authorization).toBeUndefined();
});

test('client_secret_basic mode sends a Basic header, not body creds', async () => {
  mockedPost.mockResolvedValueOnce({ data: { access_token: 'tok-basic', expires_in: 300 } });

  await acquireAgentToken({ ...baseConfig, tokenAuthMethod: 'basic' });

  const [, body, opts] = mockedPost.mock.calls[0];
  expect(opts.headers.Authorization).toMatch(/^Basic /);
  expect(body).not.toContain('client_secret=');
});

test('includes audience param only when configured', async () => {
  mockedPost.mockResolvedValue({ data: { access_token: 't', expires_in: 300 } });

  await acquireAgentToken(baseConfig);
  expect(mockedPost.mock.calls[0][1]).not.toContain('audience=');

  clearTokenCache();
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({ data: { access_token: 't', expires_in: 300 } });
  await acquireAgentToken({ ...baseConfig, audience: 'mcpgateway.ping.demo' });
  expect(mockedPost.mock.calls[0][1]).toContain('audience=mcpgateway.ping.demo');
});

test('caches within TTL — second call does not hit PingOne again', async () => {
  mockedPost.mockResolvedValueOnce({
    data: { access_token: 'tok-cached', expires_in: 300 },
  });

  const a = await acquireAgentToken(baseConfig);
  const b = await acquireAgentToken(baseConfig);

  expect(a.accessToken).toBe('tok-cached');
  expect(b.accessToken).toBe('tok-cached');
  expect(mockedPost).toHaveBeenCalledTimes(1);
});

test('dedups concurrent cold-start callers into one PingOne request', async () => {
  let resolveFn: (v: unknown) => void = () => {};
  mockedPost.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFn = resolve;
    }),
  );

  const p1 = acquireAgentToken(baseConfig);
  const p2 = acquireAgentToken(baseConfig);
  resolveFn({ data: { access_token: 'tok-inflight', expires_in: 300 } });

  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1.accessToken).toBe('tok-inflight');
  expect(r2.accessToken).toBe('tok-inflight');
  expect(mockedPost).toHaveBeenCalledTimes(1);
});

test('scrubs credentials from PingOne errors', async () => {
  mockedPost.mockRejectedValue({
    response: { status: 401, data: { error: 'invalid_client' } },
    config: { headers: { Authorization: 'Basic c3VwZXItc2VjcmV0' } },
  });

  let err: Error | undefined;
  try {
    await acquireAgentToken(baseConfig);
  } catch (e) {
    err = e as Error;
  }

  expect(err).toBeInstanceOf(Error);
  expect(err!.message).toMatch(/agent_cc_failed status=401 detail=invalid_client/);
  // The thrown error must not leak the secret or the Basic header.
  expect(err!.message).not.toContain('super-secret-value');
  expect(err!.message).not.toContain('Basic');
});

test('different scope/identity is cached separately', async () => {
  mockedPost
    .mockResolvedValueOnce({ data: { access_token: 'tok-rw', expires_in: 300 } })
    .mockResolvedValueOnce({ data: { access_token: 'tok-admin', expires_in: 300 } });

  const rw = await acquireAgentToken(baseConfig);
  const admin = await acquireAgentToken({ ...baseConfig, scope: 'admin' });

  expect(rw.accessToken).toBe('tok-rw');
  expect(admin.accessToken).toBe('tok-admin');
  expect(mockedPost).toHaveBeenCalledTimes(2);
});
