/**
 * Privilege-gateway token detection + open-access scope bypass.
 * The Privilege MCP gateway forwards its own infra token (kid infra-root-jwt /
 * aud procyon), which carries no banking scopes. Under MCP_AUTH_DISABLED the
 * gateway owns authorization, so the banking scope check must be skipped for
 * that token shape ONLY — banking / A2A tokens stay fully enforced.
 */
import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');

function jwt(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.sig`;
}

describe('BankingToolProvider.isPrivilegeGatewayToken', () => {
  let provider: any;
  beforeEach(() => {
    const api = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
    const auth = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    const sess = new BankingSessionManager('t', 'k') as jest.Mocked<BankingSessionManager>;
    provider = new BankingToolProvider(api, auth, sess);
  });

  it('matches a Privilege token by kid infra-root-jwt', () => {
    const t = jwt({ alg: 'RS256', kid: 'infra-root-jwt' }, { aud: 'procyon', user: 'u' });
    expect(provider.isPrivilegeGatewayToken(t)).toBe(true);
  });

  it('matches by aud procyon even with a different kid', () => {
    const t = jwt({ alg: 'RS256', kid: 'something-else' }, { aud: 'procyon' });
    expect(provider.isPrivilegeGatewayToken(t)).toBe(true);
  });

  it('matches when aud is an array containing procyon', () => {
    const t = jwt({ alg: 'RS256', kid: 'x' }, { aud: ['procyon', 'other'] });
    expect(provider.isPrivilegeGatewayToken(t)).toBe(true);
  });

  it('does NOT match a banking OAuth token', () => {
    const t = jwt({ alg: 'RS256', kid: 'b3676630-823d-11f1' }, { aud: 'https://api.pingone.com', scope: 'read' });
    expect(provider.isPrivilegeGatewayToken(t)).toBe(false);
  });

  it('does NOT match an A2A delegated token (per-vertical aud)', () => {
    const t = jwt({ alg: 'RS256', kid: 'pingone-key' }, { aud: 'urn:banking:records', scope: 'records:read' });
    expect(provider.isPrivilegeGatewayToken(t)).toBe(false);
  });

  it('returns false for garbage / non-JWT input', () => {
    expect(provider.isPrivilegeGatewayToken('not-a-jwt')).toBe(false);
    expect(provider.isPrivilegeGatewayToken('')).toBe(false);
  });
});
