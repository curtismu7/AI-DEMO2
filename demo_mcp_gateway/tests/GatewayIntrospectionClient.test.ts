import axios from 'axios';
import { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// The client only reads these fields; cast avoids coupling to the full GatewayConfig.
const config = {
  introspectionEndpoint: 'https://auth.example/introspect',
  clientId: 'gw',
  clientSecret: 'secret',
  tokenEndpointAuthMethod: 'basic',
} as unknown as GatewayConfig;

describe('GatewayIntrospectionClient — cold-start hardening', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    GatewayIntrospectionClient.clearCache();
  });

  test('a genuine active:false (HTTP 200) is cached — no re-call on repeat', async () => {
    mockedAxios.post.mockResolvedValue({ data: { active: false } } as never);
    const client = new GatewayIntrospectionClient(config);

    expect((await client.introspect('tok-false')).active).toBe(false);
    expect((await client.introspect('tok-false')).active).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // second call served from cache
  });

  test('a transient error is retried once, fails closed, and is NOT cached', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new GatewayIntrospectionClient(config);

    expect((await client.introspect('tok-blip')).active).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2); // initial + one retry

    // Not cached → the next tool call retries again instead of being stuck.
    expect((await client.introspect('tok-blip')).active).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(4);
  });

  test('recovers immediately after a transient blip (no sticky negative cache)', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ data: { active: true, sub: 'u1' } } as never);
    const client = new GatewayIntrospectionClient(config);

    expect((await client.introspect('tok-recover')).active).toBe(false); // both attempts fail
    const recovered = await client.introspect('tok-recover'); // AS back → active:true
    expect(recovered.active).toBe(true);
    expect(recovered.sub).toBe('u1');
  });

  test('fails closed (active:false) when no endpoint is configured', async () => {
    // Introspection is never skipped — missing GW_INTROSPECTION_ENDPOINT must
    // reject the token so a misconfigured gateway cannot silently accept traffic.
    const client = new GatewayIntrospectionClient({} as unknown as GatewayConfig);
    const r = await client.introspect('whatever');
    expect(r.active).toBe(false);
    expect(r.error).toMatch(/GW_INTROSPECTION_ENDPOINT not configured/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  describe('auth-method auto-fallback (401 invalid_client)', () => {
    test('a 401 on the configured method falls back to the other method and succeeds', async () => {
      mockedAxios.post.mockImplementationOnce(async () => {
        throw { isAxiosError: true, response: { status: 401, data: { error: 'invalid_client' } } };
      });
      mockedAxios.post.mockImplementationOnce(async (_url: string, _body: unknown, opts: any) => {
        expect(opts.headers.Authorization).toMatch(/^Basic /);
        return { data: { active: true, sub: 'u1' } };
      });

      const client = new GatewayIntrospectionClient({ ...config, tokenEndpointAuthMethod: 'post' } as GatewayConfig);
      const result = await client.introspect('tok-1');

      expect(result.active).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    test('the fallback method is cached — a later call goes straight to it', async () => {
      mockedAxios.post.mockImplementationOnce(async () => {
        throw { isAxiosError: true, response: { status: 401, data: { error: 'invalid_client' } } };
      });
      mockedAxios.post.mockImplementationOnce(async () => ({ data: { active: true, sub: 'u1' } }));
      mockedAxios.post.mockImplementationOnce(async (_url: string, _body: unknown, opts: any) => {
        expect(opts.headers.Authorization).toMatch(/^Basic /);
        return { data: { active: true, sub: 'u2' } };
      });

      const client = new GatewayIntrospectionClient({ ...config, tokenEndpointAuthMethod: 'post' } as GatewayConfig);
      await client.introspect('tok-1');
      const second = await client.introspect('tok-2');

      expect(second.active).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(3); // 2 for first call, 1 for second (cached method)
    });

    test('both methods rejected with 401 fails closed without crashing', async () => {
      mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { error: 'invalid_client' } } });
      const client = new GatewayIntrospectionClient({ ...config, tokenEndpointAuthMethod: 'post' } as GatewayConfig);

      const result = await client.introspect('tok-1');
      expect(result.active).toBe(false);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    test('a non-401 transient error does not trigger the method-fallback attempt', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new GatewayIntrospectionClient({ ...config, tokenEndpointAuthMethod: 'post' } as GatewayConfig);

      const result = await client.introspect('tok-1');
      expect(result.active).toBe(false);
      // Existing transient-retry budget (2 attempts, same method) — no extra
      // method-fallback attempts on top of it.
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});
