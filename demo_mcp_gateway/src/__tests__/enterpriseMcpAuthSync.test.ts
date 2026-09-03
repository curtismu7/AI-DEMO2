/**
 * ID-JAG must have ONE answer: the BFF's UI toggle.
 *
 * The bug this guards: the gateway read FF_ENTERPRISE_MANAGED_MCP_AUTH from its
 * own env and nothing else, so it could disagree with the BFF forever. On the SE
 * cluster it did — BFF `true`, gateway unset — and the split was invisible
 * because each process reported only its own value.
 */
import axios from 'axios';
import type { GatewayConfig } from '../config';
import { bffEnterpriseMcpAuthUrl, syncEnterpriseMcpAuthFromBff, SYNC_RETRY_DELAYS_MS } from '../enterpriseMcpAuthSync';
import { isEnterpriseManagedMcpAuthEnabled, appendEnterpriseWwwAuthHint } from '../enterpriseMcpAuth';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

function cfg(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    bffInternalIdTokenUrl: 'https://api.ping.demo:3001/internal/id-token',
    bffInternalSecret: 's3cret',
    enterpriseManagedMcpAuth: false,
    ...over,
  } as unknown as GatewayConfig;
}

afterEach(() => jest.resetAllMocks());

describe('SYNC_RETRY_DELAYS_MS', () => {
  it('sums to the ~31s documented in the module header', () => {
    expect(SYNC_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(31000);
  });
});

describe('bffEnterpriseMcpAuthUrl', () => {
  it('derives the flag URL from the id-token URL, so no new env var is needed', () => {
    expect(bffEnterpriseMcpAuthUrl(cfg())).toBe(
      'https://api.ping.demo:3001/internal/feature-flags/enterprise-managed-mcp-auth',
    );
  });

  it('returns null when the id-token URL is unset or an unexpected shape', () => {
    expect(bffEnterpriseMcpAuthUrl(cfg({ bffInternalIdTokenUrl: '' }))).toBeNull();
    expect(bffEnterpriseMcpAuthUrl(cfg({ bffInternalIdTokenUrl: 'https://x/other' }))).toBeNull();
  });
});

// Every test drives the retry loop through a no-op sleep so none of them
// actually wait out the backoff — the schedule itself is asserted separately.
const NO_WAIT = { sleep: async () => {} };

describe('syncEnterpriseMcpAuthFromBff', () => {
  it('adopts the BFF value, overriding the env seed — the actual fix', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: true } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(true);
    expect(config.enterpriseManagedMcpAuth).toBe(true);
  });

  it('turns the flag OFF when the BFF says off', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: false } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: true });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(false);
  });

  it('sends the internal secret — the BFF route 403s without it', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: true } } as never);
    await syncEnterpriseMcpAuthFromBff(cfg(), NO_WAIT);

    expect(mockedGet).toHaveBeenCalledWith(
      expect.stringContaining('/internal/feature-flags/enterprise-managed-mcp-auth'),
      expect.objectContaining({ headers: { 'x-internal-gateway-secret': 's3cret' } }),
    );
  });

  // 403/404 are settled answers — a wrong secret or an old BFF does not
  // improve by asking again — and must not retry. The regression that matters
  // most: neither body has an `enabled` field, and coercing one would read as
  // "disabled" and silently switch ID-JAG off across the whole gateway.
  it.each([403, 404])('gives up immediately (no retry) on HTTP %i and keeps the seed', async (status) => {
    mockedGet.mockResolvedValue({ status, data: { error: 'forbidden' } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: true });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('ignores a 200 whose enabled field is not a boolean, and does not retry it', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: 'true' } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(false);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  // The gap this retry logic exists to close: observed live on SE 2026-09-03 —
  // a co-restart brings the gateway up before the BFF, the first attempt hits
  // ECONNREFUSED, and a single-attempt sync would keep the wrong seed until
  // the next flag save.
  it('retries a connection failure and adopts the value once the BFF answers', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, data: { enabled: true } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it('retries a 5xx (BFF unhealthy, not a settled answer) and then succeeds', async () => {
    mockedGet
      .mockResolvedValueOnce({ status: 503, data: {} } as never)
      .mockResolvedValueOnce({ status: 200, data: { enabled: true } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config, NO_WAIT)).resolves.toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('keeps the seed after exhausting all retries against a BFF that never answers', async () => {
    mockedGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const config = cfg({ enterpriseManagedMcpAuth: true });
    const delays = [1, 1, 1];

    await expect(
      syncEnterpriseMcpAuthFromBff(config, { retryDelaysMs: delays, sleep: async () => {} }),
    ).resolves.toBe(true);
    // Initial attempt + one retry per configured delay.
    expect(mockedGet).toHaveBeenCalledTimes(delays.length + 1);
  });

  it('waits between attempts using the configured backoff schedule', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, data: { enabled: true } } as never);
    const waited: number[] = [];
    const config = cfg();

    await syncEnterpriseMcpAuthFromBff(config, {
      retryDelaysMs: [42],
      sleep: async (ms) => { waited.push(ms); },
    });

    expect(waited).toEqual([42]);
  });
});

describe('the advertised surfaces follow live config, not process.env', () => {
  const ORIG = process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH;
    else process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH = ORIG;
  });

  it('reads config even when the env var disagrees', () => {
    process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH = 'false';
    expect(isEnterpriseManagedMcpAuthEnabled({ enterpriseManagedMcpAuth: true })).toBe(true);
  });

  it('adds the enterprise hint to WWW-Authenticate from config alone', () => {
    delete process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH;
    const hinted = appendEnterpriseWwwAuthHint('Bearer realm="x"', { enterpriseManagedMcpAuth: true });
    expect(hinted).toContain('authorization_type="enterprise-managed"');

    const plain = appendEnterpriseWwwAuthHint('Bearer realm="x"', { enterpriseManagedMcpAuth: false });
    expect(plain).not.toContain('authorization_type');
  });

  it('still falls back to env when no config is passed', () => {
    process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH = 'true';
    expect(isEnterpriseManagedMcpAuthEnabled()).toBe(true);
  });
});
