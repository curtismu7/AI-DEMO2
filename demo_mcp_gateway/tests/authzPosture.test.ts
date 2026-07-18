'use strict';

/**
 * Contract C3 — gate-armed health.
 *
 * F5/F6: the gateway has a pile of individually-defensible bypasses and
 * advisory-by-default controls, and NOTHING reported the aggregate posture. So
 * "we implement RFC 9449/9421/9396" was true of the code and false of the
 * running default, with no way to tell the two apart from outside.
 *
 * `GET /health` now carries an `authz` block whose `failOpen` array names every
 * currently-active bypass. Empty array = fully armed.
 */

import {
  buildAuthzHealth,
  noteBindingHeaderSeen,
  resetAuthzPosture,
} from '../src/authzPosture';
import type { GatewayConfig } from '../src/config';

function cfg(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    devBypass: false,
    hitlServiceUrl: 'http://hitl:9002',
    p1azEnabled: true,
    pingAuthorizeEndpoint: 'https://real.example/authz',
    pingAuthorizeWorkerId: 'gw',
    pingAuthorizeMockBase: 'http://authz-server:9001',
    allowLocalScopeFallback: false,
    requireActForAgentTools: true,
    intentTokenRequired: true,
    requireRarIntent: true,
    wbaMode: 'monitor',
    ...over,
  } as GatewayConfig;
}

const OLD = { ...process.env };
beforeEach(() => {
  resetAuthzPosture();
  process.env.PINGONE_JWKS_ENDPOINT = 'https://auth.example/jwks';
  delete process.env.STRICT_AUTH;
  delete process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS;
  process.env.REQUIRE_DPOP_PROOF = 'true';
});
afterAll(() => { process.env = OLD; });

describe('C3 — the authz health block', () => {
  test('reports the active policy source', () => {
    expect(buildAuthzHealth(cfg()).policySource).toBe('p1az');
  });

  test('reports local-fallback when P1AZ is not active', () => {
    expect(buildAuthzHealth(cfg({ p1azEnabled: false })).policySource).toBe('local-fallback');
  });

  test('reports each enforcement gate', () => {
    const h = buildAuthzHealth(cfg());
    expect(h.enforcing).toEqual({
      dpop: true, intent: true, rar: true, act: true, webBotAuth: 'monitor',
    });
  });

  test('a fully-armed gateway reports an EMPTY failOpen array', () => {
    expect(buildAuthzHealth(cfg()).failOpen).toEqual([]);
  });
});

describe('C3 — failOpen names every active bypass', () => {
  test('MCP_GW_DEV_BYPASS', () => {
    expect(buildAuthzHealth(cfg({ devBypass: true })).failOpen).toContain('MCP_GW_DEV_BYPASS');
  });

  test('unverified tokens accepted (no JWKS, STRICT_AUTH off, opt-in on)', () => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    expect(buildAuthzHealth(cfg()).failOpen).toContain('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  });

  test('no JWKS but STRICT_AUTH=true is NOT a bypass', () => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    process.env.STRICT_AUTH = 'true';
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  });

  test('HITL_SERVICE_URL unset — receipts are silently ignored', () => {
    expect(buildAuthzHealth(cfg({ hitlServiceUrl: '' })).failOpen).toContain('HITL_SERVICE_URL');
  });

  test('the local scope fallback is itself a bypass when enabled', () => {
    const h = buildAuthzHealth(cfg({ p1azEnabled: false, allowLocalScopeFallback: true }));
    expect(h.failOpen).toContain('MCP_GW_ALLOW_LOCAL_SCOPE_FALLBACK');
  });
});

/**
 * The subtle half of C3: a control being OFF is only a *bypass* if the
 * corresponding evidence is actually being presented. A gateway nobody sends
 * DPoP proofs to is not "failing open on DPoP" — but one that receives proofs
 * and ignores them is.
 */
describe('C3 — an off control counts as fail-open only once the header is seen', () => {
  test('REQUIRE_DPOP_PROOF off is not listed until a DPoP proof arrives', () => {
    process.env.REQUIRE_DPOP_PROOF = 'false';
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('REQUIRE_DPOP_PROOF');
    noteBindingHeaderSeen('dpop');
    expect(buildAuthzHealth(cfg()).failOpen).toContain('REQUIRE_DPOP_PROOF');
  });

  test('INTENT_TOKEN_REQUIRED off is listed once an intent token arrives', () => {
    noteBindingHeaderSeen('intent');
    const h = buildAuthzHealth(cfg({ intentTokenRequired: false }));
    expect(h.failOpen).toContain('INTENT_TOKEN_REQUIRED');
  });

  test('REQUIRE_RAR_INTENT off is listed once a TraT/RAR context arrives', () => {
    noteBindingHeaderSeen('rar');
    const h = buildAuthzHealth(cfg({ requireRarIntent: false }));
    expect(h.failOpen).toContain('REQUIRE_RAR_INTENT');
  });

  test('REQUIRE_ACT_FOR_AGENT_TOOLS off is listed once an act claim arrives', () => {
    noteBindingHeaderSeen('act');
    const h = buildAuthzHealth(cfg({ requireActForAgentTools: false }));
    expect(h.failOpen).toContain('REQUIRE_ACT_FOR_AGENT_TOOLS');
  });

  test('a control that is ON is never listed, even when its header is seen', () => {
    noteBindingHeaderSeen('intent');
    noteBindingHeaderSeen('act');
    const h = buildAuthzHealth(cfg({ intentTokenRequired: true, requireActForAgentTools: true }));
    expect(h.failOpen).not.toContain('INTENT_TOKEN_REQUIRED');
    expect(h.failOpen).not.toContain('REQUIRE_ACT_FOR_AGENT_TOOLS');
  });
});

/** The block has to actually reach an operator — it is served on GET /health. */
describe('C3 — GET /health carries the authz block', () => {
  function healthBody(config: GatewayConfig) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GatewayServer } = require('../src/server/GatewayServer');
    const server = new GatewayServer({ config, upstreamMcpUrl: 'http://upstream.test' });
    const chunks: string[] = [];
    const res: any = {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    };
    return server.handleRequest({ url: '/health', method: 'GET', headers: {} } as any, res)
      .then(() => JSON.parse(chunks.join('')));
  }

  test('exposes policySource, enforcing and failOpen', async () => {
    const body = await healthBody(cfg());
    expect(body.authz).toBeDefined();
    expect(body.authz.policySource).toBe('p1az');
    expect(body.authz.enforcing).toHaveProperty('webBotAuth');
    expect(Array.isArray(body.authz.failOpen)).toBe(true);
  });

  test('names an active bypass in the served payload', async () => {
    const body = await healthBody(cfg({ devBypass: true, hitlServiceUrl: '' }));
    expect(body.authz.failOpen).toEqual(
      expect.arrayContaining(['MCP_GW_DEV_BYPASS', 'HITL_SERVICE_URL']),
    );
  });

  test('keeps the existing health fields intact', async () => {
    const body = await healthBody(cfg());
    expect(body.status).toBe('ok');
    expect(body.service).toBe('banking-mcp-gateway');
  });
});
