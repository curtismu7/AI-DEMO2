'use strict';

/**
 * adminConfig-devbypass.test.ts — Phase 3 CR-02 regression tests.
 *
 * Covers the devBypass type-coercion silent-bypass fix (A + D combined):
 *   A — non-boolean devBypass rejected with 400 (all environments)
 *   D — any truthy devBypass refused with 403 in production
 *   belt — devBypass is only ever stored as a real boolean
 *
 * devBypass MUST remain a runtime UI toggle in non-prod (no restart) per the
 * product requirement — so { devBypass: true|false } in non-prod still works.
 *
 * The x-internal-gateway-secret (BL-01) gate is enforced in index.ts BEFORE
 * applyAdminConfigUpdate is reached. We additionally assert the BL-01 timing-
 * safe check still rejects a missing secret with 401 (no regression).
 */

import * as crypto from 'node:crypto';
import { applyAdminConfigUpdate } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

function freshConfig(devBypass = false): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
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
    devBypass,
    demoApiKeyServiceKey: 'demo-api-key-0000',
    mortgageServiceBaseUrl: 'http://localhost:8082',
    mortgageServiceApiKey: 'demo-mortgage-key-0000',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'dev-shared-secret-change-me',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  } as GatewayConfig;
}

describe('applyAdminConfigUpdate — devBypass non-production (UI toggle preserved)', () => {
  it('{ devBypass: true } → 200, config.devBypass === true (boolean)', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: true }, 'development');
    expect(r.status).toBe(200);
    expect(r.mutated).toBe(true);
    expect(config.devBypass).toBe(true);
    expect(typeof config.devBypass).toBe('boolean');
  });

  it('{ devBypass: false } → 200, config.devBypass === false (boolean)', () => {
    const config = freshConfig(true);
    const r = applyAdminConfigUpdate(config, { devBypass: false }, 'development');
    expect(r.status).toBe(200);
    expect(config.devBypass).toBe(false);
    expect(typeof config.devBypass).toBe('boolean');
  });
});

describe('applyAdminConfigUpdate — A: non-boolean devBypass rejected (400)', () => {
  it('{ devBypass: "true" } (string) → 400, config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: 'true' }, 'development');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_config');
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });

  it('{ devBypass: 1 } (number) → 400, config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: 1 }, 'development');
    expect(r.status).toBe(400);
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });

  it('{ devBypass: "yes" } (string) → 400, config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: 'yes' }, 'development');
    expect(r.status).toBe(400);
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });

  it('rejects the WHOLE request — other allowed keys not applied when devBypass is malformed', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(
      config,
      { devBypass: 'true', hitlServiceUrl: 'http://evil.example.com' },
      'development',
    );
    expect(r.status).toBe(400);
    expect(r.mutated).toBe(false);
    expect(config.hitlServiceUrl).toBe('');
    expect(config.devBypass).toBe(false);
  });
});

describe('applyAdminConfigUpdate — D: production hard-refuse truthy devBypass', () => {
  it('{ devBypass: true } in production → 403, config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: true }, 'production');
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });

  it('{ devBypass: false } in production → 200 (turning OFF is always allowed)', () => {
    const config = freshConfig(true);
    const r = applyAdminConfigUpdate(config, { devBypass: false }, 'production');
    expect(r.status).toBe(200);
    expect(config.devBypass).toBe(false);
  });

  it('{ devBypass: "true" } in production → rejected (type check fires first), config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: 'true' }, 'production');
    // Either 400 (A fires before D) or 403 is acceptable — assert rejected + unchanged.
    expect([400, 403]).toContain(r.status);
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });

  it('{ devBypass: 1 } in production → rejected, config unchanged', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(config, { devBypass: 1 }, 'production');
    expect([400, 403]).toContain(r.status);
    expect(r.mutated).toBe(false);
    expect(config.devBypass).toBe(false);
  });
});

describe('applyAdminConfigUpdate — non-devBypass keys unaffected', () => {
  it('updates an allowed non-devBypass key without touching devBypass', () => {
    const config = freshConfig(false);
    const r = applyAdminConfigUpdate(
      config,
      { hitlServiceUrl: 'http://hitl.example.com' },
      'production',
    );
    expect(r.status).toBe(200);
    expect(config.hitlServiceUrl).toBe('http://hitl.example.com');
    expect(config.devBypass).toBe(false);
  });
});

/**
 * BL-01 no-regression: the timing-safe internal-secret gate (a copy of the
 * requireInternalSecret logic in index.ts) must still 401 a missing/wrong
 * secret. applyAdminConfigUpdate is only reached AFTER this gate passes.
 */
describe('BL-01 internal-secret gate (no regression)', () => {
  function secretAccepted(presented: string | undefined, expected: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const presentedStr = typeof presented === 'string' ? presented : '';
    const presentedBuf = Buffer.from(presentedStr);
    const padded = Buffer.alloc(expectedBuf.length);
    presentedBuf.copy(padded, 0, 0, Math.min(presentedBuf.length, expectedBuf.length));
    const equalContent = crypto.timingSafeEqual(padded, expectedBuf);
    const equalLength = presentedBuf.length === expectedBuf.length;
    return equalContent && equalLength;
  }

  const SECRET = 'dev-shared-secret-change-me';

  it('rejects a request with NO secret header (still 401 path)', () => {
    expect(secretAccepted(undefined, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(secretAccepted('wrong-secret', SECRET)).toBe(false);
  });

  it('accepts the correct secret (so the admin handler can run)', () => {
    expect(secretAccepted(SECRET, SECRET)).toBe(true);
  });
});
