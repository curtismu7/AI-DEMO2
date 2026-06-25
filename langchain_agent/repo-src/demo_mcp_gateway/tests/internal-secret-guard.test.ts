'use strict';

/**
 * internal-secret-guard.test.ts — WR-07 regression.
 *
 * The admin surface (/admin/config) is gated by requireInternalSecret, a
 * timing-safe compare. With an empty/whitespace BFF_INTERNAL_SECRET the
 * compare degenerates to timingSafeEqual(Buffer.alloc(0), Buffer.alloc(0))
 * === true, so a request with NO x-internal-gateway-secret header is
 * authorized — an unauthenticated control plane.
 *
 * The fix makes the precondition explicit and shared:
 *   - isInternalSecretUsable(secret): pure predicate the gate consults.
 *     index.ts's IIFE is not directly unit-testable, so the gate and this
 *     test share this one definition.
 *   - assertProductionSecrets(): refuses to start in production when the
 *     secret is < 32 bytes (catches the whitespace BFF_INTERNAL_SECRET=" "
 *     case that slips past the dev-default-literal check).
 */

import { isInternalSecretUsable, assertProductionSecrets } from '../src/config';
import type { GatewayConfig } from '../src/config';

function cfgWith(secret: string): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    clientId: 'c',
    clientSecret: 's',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.example.com/token',
    gatewayResourceUri: 'https://mcp-gateway.example.com',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpInvestWsUrl: 'ws://localhost:8081',
    mcpOlbResourceUri: 'https://mcp-olb.example.com',
    mcpInvestResourceUri: 'https://mcp-invest.example.com',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    p1azEnabled: false,
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    devBypass: false,
    demoApiKeyServiceKey: 'demo-api-key-0000',
    mortgageServiceBaseUrl: 'http://localhost:8082',
    mortgageServiceApiKey: 'demo-mortgage-key-0000',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: secret,
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  } as GatewayConfig;
}

describe('isInternalSecretUsable (WR-07 gate predicate)', () => {
  it('rejects an empty secret — gate must refuse, never accept a header-less request', () => {
    expect(isInternalSecretUsable('')).toBe(false);
  });

  it('rejects a whitespace-only secret', () => {
    expect(isInternalSecretUsable('   ')).toBe(false);
  });

  it('rejects undefined / null', () => {
    expect(isInternalSecretUsable(undefined)).toBe(false);
    expect(isInternalSecretUsable(null)).toBe(false);
  });

  it('rejects a too-short secret (< 16 chars)', () => {
    expect(isInternalSecretUsable('short')).toBe(false);
  });

  it('accepts a correct, sufficiently long secret', () => {
    expect(isInternalSecretUsable('dev-shared-secret-change-me')).toBe(true);
  });
});

describe('assertProductionSecrets (WR-07 startup refusal)', () => {
  const ORIG_ENV = process.env.NODE_ENV;
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIG_ENV;
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('refuses to start when the secret is whitespace in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets(cfgWith(' '));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('refuses to start when the secret is too short in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets(cfgWith('x'.repeat(20)));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit for a strong 32+ byte secret in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets(cfgWith('x'.repeat(40)));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    assertProductionSecrets(cfgWith(''));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
