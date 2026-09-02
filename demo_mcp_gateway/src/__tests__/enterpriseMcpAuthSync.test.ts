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
import { bffEnterpriseMcpAuthUrl, syncEnterpriseMcpAuthFromBff } from '../enterpriseMcpAuthSync';
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

describe('syncEnterpriseMcpAuthFromBff', () => {
  it('adopts the BFF value, overriding the env seed — the actual fix', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: true } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config)).resolves.toBe(true);
    expect(config.enterpriseManagedMcpAuth).toBe(true);
  });

  it('turns the flag OFF when the BFF says off', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: false } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: true });

    await expect(syncEnterpriseMcpAuthFromBff(config)).resolves.toBe(false);
  });

  it('sends the internal secret — the BFF route 403s without it', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: true } } as never);
    await syncEnterpriseMcpAuthFromBff(cfg());

    expect(mockedGet).toHaveBeenCalledWith(
      expect.stringContaining('/internal/feature-flags/enterprise-managed-mcp-auth'),
      expect.objectContaining({ headers: { 'x-internal-gateway-secret': 's3cret' } }),
    );
  });

  // The regression that matters most: a 403/404/500 body has no `enabled`, and
  // coercing it would read as "disabled" and silently switch ID-JAG off across
  // the whole gateway on any BFF hiccup.
  it.each([403, 404, 500])('keeps the seed when the BFF returns HTTP %i', async (status) => {
    mockedGet.mockResolvedValue({ status, data: { error: 'forbidden' } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: true });

    await expect(syncEnterpriseMcpAuthFromBff(config)).resolves.toBe(true);
    expect(config.enterpriseManagedMcpAuth).toBe(true);
  });

  it('keeps the seed when the BFF is unreachable', async () => {
    mockedGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const config = cfg({ enterpriseManagedMcpAuth: true });

    await expect(syncEnterpriseMcpAuthFromBff(config)).resolves.toBe(true);
  });

  it('ignores a 200 whose enabled field is not a boolean', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: { enabled: 'true' } } as never);
    const config = cfg({ enterpriseManagedMcpAuth: false });

    await expect(syncEnterpriseMcpAuthFromBff(config)).resolves.toBe(false);
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
