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

// Fixture endpoints only — production code never reads a literal endpoint.
const PDP_REAL = 'https://pdp.test/authz';
const PDP_MOCK = 'http://pdp-mock.test:9001';

function cfg(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    devBypass: false,
    hitlServiceUrl: 'http://hitl:9002',
    p1azEnabled: true,
    pingAuthorizeEndpoint: PDP_REAL,
    pingAuthorizeWorkerId: 'gw',
    pingAuthorizeMockBase: PDP_MOCK,
    allowLocalScopeFallback: false,
    requireActForAgentTools: true,
    intentTokenRequired: true,
    requireRarIntent: true,
    // The actor allow-list is only armed when a client id is configured; a fully
    // armed gateway therefore has one.
    authorizedActorClientId: 'the-exchanger',
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
  delete process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
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

  /**
   * Asserting `enforcing` deep-equals the flags the test just wrote into the
   * config proves only that buildAuthzHealth copies fields. What matters is the
   * two ways `enforcing` can lie: reading a gate from the wrong SOURCE, and
   * treating a merely-truthy value as "armed". A health block that reports a
   * gate as on when it is off is worse than no health block.
   */
  test('reports every gate this contract names', () => {
    expect(Object.keys(buildAuthzHealth(cfg()).enforcing).sort())
      .toEqual(['act', 'dpop', 'intent', 'rar', 'webBotAuth']);
  });

  test('dpop is read from the env var that actually gates it, not from config', () => {
    // REQUIRE_DPOP_PROOF is an env var; the others are config fields. A refactor
    // that "tidied" dpop into config would report a gate nothing enforces.
    process.env.REQUIRE_DPOP_PROOF = 'false';
    expect(buildAuthzHealth(cfg({ requireActForAgentTools: true })).enforcing.dpop).toBe(false);
    process.env.REQUIRE_DPOP_PROOF = 'true';
    expect(buildAuthzHealth(cfg()).enforcing.dpop).toBe(true);
  });

  test('a truthy-but-not-true flag is NOT reported as armed', () => {
    // Env plumbing hands strings around; `if (x)` on the string 'false' is true.
    // Each gate must be a strict === true test or the block over-reports.
    const sloppy = cfg({
      intentTokenRequired: 'false' as unknown as boolean,
      requireRarIntent: 1 as unknown as boolean,
      requireActForAgentTools: 'true' as unknown as boolean,
    });
    const h = buildAuthzHealth(sloppy);
    expect(h.enforcing.intent).toBe(false);
    expect(h.enforcing.rar).toBe(false);
    expect(h.enforcing.act).toBe(false);
  });

  test('a gate reported OFF while its evidence arrives is named in failOpen', () => {
    // Ties `enforcing` to `failOpen` so the two cannot drift apart: whatever
    // `enforcing` says is off must show up as a bypass once evidence is seen.
    process.env.REQUIRE_DPOP_PROOF = 'false';
    const config = cfg({ intentTokenRequired: false, requireRarIntent: false, requireActForAgentTools: false });
    (['dpop', 'intent', 'rar', 'act'] as const).forEach(noteBindingHeaderSeen);
    const h = buildAuthzHealth(config);
    expect(h.enforcing).toMatchObject({ dpop: false, intent: false, rar: false, act: false });
    expect(h.failOpen).toEqual(expect.arrayContaining([
      'REQUIRE_DPOP_PROOF', 'INTENT_TOKEN_REQUIRED', 'REQUIRE_RAR_INTENT', 'REQUIRE_ACT_FOR_AGENT_TOOLS',
    ]));
  });

  test('a fully-armed gateway reports an EMPTY failOpen array', () => {
    expect(buildAuthzHealth(cfg()).failOpen).toEqual([]);
  });
});

/**
 * The derivation bug that mattered most: `usingRealEndpoint` required a mock
 * base to be configured at all, so the ONE deployment shape where P1AZ is
 * genuinely real — a cloud endpoint with no mock to fail over to — reported
 * itself as running on the mock. The signal was wrong exactly when it counted.
 *
 * The mock is DECLARED by PINGAUTHORIZE_MOCK_BASE: a deployment that talks to
 * the mock directly sets it equal to the endpoint; one that keeps the mock as a
 * failover target sets it to a different URL.
 */
describe('C3 — policySource reflects which PDP is actually configured', () => {
  test('a real endpoint with NO mock base configured reports p1az', () => {
    expect(buildAuthzHealth(cfg({ pingAuthorizeMockBase: undefined })).policySource).toBe('p1az');
  });

  test('an endpoint that IS the declared mock reports p1az-mock', () => {
    const h = buildAuthzHealth(cfg({ pingAuthorizeEndpoint: PDP_MOCK, pingAuthorizeMockBase: PDP_MOCK }));
    expect(h.policySource).toBe('p1az-mock');
  });

  test('a real endpoint with the mock as failover target still reports p1az', () => {
    expect(buildAuthzHealth(cfg()).policySource).toBe('p1az');
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

  /**
   * A check that is configured out of existence is the quietest bypass of all:
   * the code is present, the tests pass, and it returns "valid" for every input.
   * validateActClaim() short-circuits to {valid:true} when the allow-list is
   * empty, so an unset actor client id means ANY act.sub is accepted.
   */
  test('an unset actor allow-list — validateActClaim accepts every actor', () => {
    const h = buildAuthzHealth(cfg({ authorizedActorClientId: '' }));
    expect(h.failOpen).toContain('PINGONE_TOKEN_EXCHANGER_CLIENT_ID');
  });

  test('a configured actor allow-list is not a bypass', () => {
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('PINGONE_TOKEN_EXCHANGER_CLIENT_ID');
  });

  /**
   * With ALLOW_UNSIGNED_TRAT_CONTEXT the gateway accepts purp/reqctx/azd from an
   * unsigned caller-supplied header and feeds them to the PDP and to RAR subset
   * enforcement. The RAR check still runs — against evidence the caller wrote.
   */
  test('ALLOW_UNSIGNED_TRAT_CONTEXT — binding evidence is caller-supplied', () => {
    process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
    expect(buildAuthzHealth(cfg()).failOpen).toContain('ALLOW_UNSIGNED_TRAT_CONTEXT');
  });

  test('unsigned TraT context off is not listed', () => {
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('ALLOW_UNSIGNED_TRAT_CONTEXT');
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

describe('failOpen: MCP_GW_ALLOW_UNVERIFIED_TOKENS resolves JWKS like the validator', () => {
  // The orphan-name bug, third occurrence. authzPosture read only
  // PINGONE_JWKS_ENDPOINT — a name nothing in this stack sets — so the "no JWKS
  // configured" term was permanently true and /health listed
  // MCP_GW_ALLOW_UNVERIFIED_TOKENS as fail-open while the gateway was genuinely
  // verifying signatures (a forged token 401s).
  //
  // A lie in the SAFE direction is still a lie: an operator reading failOpen
  // cannot tell a real bypass from a phantom one, so the list stops being
  // actionable. Both names must resolve.
  const KEYS = ['PINGONE_JWKS_ENDPOINT', 'PINGONE_JWKS_URI', 'MCP_GW_ALLOW_UNVERIFIED_TOKENS', 'STRICT_AUTH'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }); });
  afterEach(() => {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  });

  const cfg = () => ({ wbaMode: 'monitor', hitlServiceUrl: 'http://hitl' } as unknown as Parameters<typeof buildAuthzHealth>[0]);

  test('PINGONE_JWKS_URI alone clears the fail-open — it is the name this stack sets', () => {
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/env/as/jwks';
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  });

  test('PINGONE_JWKS_ENDPOINT alone also clears it', () => {
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    process.env.PINGONE_JWKS_ENDPOINT = 'https://auth.pingone.com/env/as/jwks';
    expect(buildAuthzHealth(cfg()).failOpen).not.toContain('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  });

  test('with NO jwks configured and the opt-in on, it IS reported — the real bypass still surfaces', () => {
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    expect(buildAuthzHealth(cfg()).failOpen).toContain('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  });
});
