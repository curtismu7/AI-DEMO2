'use strict';

/**
 * A2A for the `admin` vertical — the Identity Verification Specialist.
 *
 * The suite exists to answer one question the nine customer verticals already
 * answer, and to answer it for admin data: can an ORDINARY read reach the same
 * answer as the *-a2a chip? If it can, the chip demonstrates nothing — PR #1275's
 * investment chip returned real data through a plain consent read and proved no
 * delegation had happened at all. Every assertion below is aimed at making that
 * impossible by shape rather than by intent:
 *
 *   1. the tool's Exchange #2 scope is its OWN, never bare `read`
 *      (REGRESSION_PLAN §4, 2026-07-27)
 *   2. the authorization engine DENIES it outright when the act chain shows no
 *      specialist — so no bearer an ordinary session holds can answer it
 *   3. the DATA is separated: get_customer_profile physically cannot return a
 *      single field the sensitive record carries
 *
 * Plus the hand-maintained wiring that fails SILENTLY when missed: configStore's
 * per-specialist env allowlist (a fully provisioned PingOne app still resolves to
 * an empty client id, reported in the same words as an unprovisioned tenant).
 *
 * The OTHER admin vertical, pingone-admin, is a DECLARED exemption rather than a
 * gap — see its manifest's a2aExemption block and the third-direction assertions
 * in a2aVerticalParity.test.js.
 */

const path = require('node:path');

const scopeTopology = require('../services/scopeTopology');
const groupPolicy = require('../services/groupPolicy');
const simulatedAuthorize = require('../services/simulatedAuthorizeService');
const { verticalManifest } = require('../services/verticalManifest');
const {
  A2A_SPECIALISTS, specialistForVertical, clientIdKey, clientSecretKey, intermediateAudienceKey,
  intermediateResourceName,
} = require('../config/a2aSpecialists');
const { deriveSpecialistScopes } = require('../services/a2aDelegationService');

verticalManifest.init();

const CASES = [
  {
    vertical: 'admin',
    tool: 'sensitive_customer_identity',
    appKey: 'identity',
    delegatedScope: 'identity:read',
    group: 'AI_Demo_Privileged',
    chipId: 'adm-a2a',
    intermediateUri: 'a2a-intermediate-identity.ping.demo',
    invokeScope: 'agent:invoke:identity',
  },
];

const cases = CASES.map((c) => [c.vertical, c]);

/**
 * src/__tests__/setup.js calls jest.resetModules() in a GLOBAL afterEach, so from
 * the second test onward every lazy require inside a plugin returns a NEW module
 * instance. A stub installed on a module captured at file scope is then invisible
 * to the plugin — and for this vertical the miss is a false pass, because the real
 * adapter throws an auth error that lands in the same labeled-mock branch a
 * deliberately-unreachable server does. Take the plugin and the modules it will
 * reach from the SAME registry generation, inside the test.
 */
function freshVertical(id) {
  return {
    plugin: require(`../config/verticals/${id}`),
    adapter: require('../services/mcpPingOneHttpAdapter'),
    pingOneUserService: require('../services/pingOneUserService'),
    store: require('../data/store'),
  };
}

describe('the two admin verticals each have a registered A2A specialist', () => {
  it.each(cases)('%s maps to its own specialist identity', (vertical, c) => {
    const spec = specialistForVertical(vertical);
    expect(spec).toBeTruthy();
    expect(spec.appKey).toBe(c.appKey);
    expect(spec.tools).toEqual([c.tool]);
  });

  it('every specialist appKey is unique — a shared one collides on PingOne scope names', () => {
    const keys = Object.values(A2A_SPECIALISTS).map((s) => s.appKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(cases)('%s gets its OWN RFC 8707 intermediate resource, not a shared one', (vertical, c) => {
    const spec = specialistForVertical(vertical);
    const name = intermediateResourceName(spec);
    expect(scopeTopology.resourceUri(name)).toBe(c.intermediateUri);
    // The invoke scope is per-specialist for the same reason (one scope name per
    // client across ALL grants — a shared name binds the exchange to the wrong aud).
    expect(scopeTopology.scopeMeta(c.invokeScope).resource).toBe(name);
  });
});

describe('un-fakeable #1 — the specialist scope is its own, never bare read', () => {
  it.each(cases)('%s derives a dedicated Exchange #2 scope', (vertical, c) => {
    expect(scopeTopology.a2aDelegatedScope(c.tool)).toBe(c.delegatedScope);
    expect(scopeTopology.a2aDelegatedScope(c.tool)).not.toBe('read');
    // Driven through the real derivation, not read off the manifest: dropping
    // a2aDelegatedScope silently collapses this to the coarse ['read'] every
    // session token already carries.
    expect(deriveSpecialistScopes(specialistForVertical(vertical))).toEqual([c.delegatedScope]);
  });

  it.each(cases)("%s's delegated scope is on the A2A MCP Gateway resource (Exchange #2 audience)", (_vertical, c) => {
    expect(scopeTopology.resourceScopes('Super Banking A2A MCP Gateway')).toContain(c.delegatedScope);
  });
});

describe('un-fakeable #2 — an ordinary read cannot answer the chip', () => {
  /**
   * BASE satisfies the guards that run BEFORE the A2A guard, so a DENY here is
   * attributable to the delegation check and not to something incidental.
   */
  const ORDINARY = { userId: 'u-123', actClientId: 'generalist' };

  it.each(cases)('%s: the tool is flagged a2aDelegated in the SoT', (_vertical, c) => {
    expect(scopeTopology.isA2aDelegatedTool(c.tool)).toBe(true);
  });

  it.each(cases)(
    '%s: the generalist acting alone is DENIED — act depth < 2',
    async (_vertical, c) => {
      const res = await simulatedAuthorize.evaluateMcpFirstTool({ ...ORDINARY, toolName: c.tool });
      expect(res.decision).toBe('DENY');
      expect(res.raw.reason).toMatch(/a2a_delegation_required/);
    },
  );

  it.each(cases)(
    '%s: the same call with a specialist in the act chain is NOT denied for that reason',
    async (_vertical, c) => {
      const res = await simulatedAuthorize.evaluateMcpFirstTool({
        ...ORDINARY, toolName: c.tool, actClientId: 'specialist', nestedActClientId: 'generalist',
      });
      expect(String(res.raw.reason || '')).not.toMatch(/a2a_delegation_required/);
    },
  );

  it.each(cases)('%s: the tool is group-gated on top of that', (vertical, c) => {
    expect(groupPolicy.requiredGroupForTool(c.tool, vertical)).toBe(c.group);
    expect(groupPolicy.groupsForUserSync('demoDelegate', vertical)).not.toContain(c.group);
  });
});

describe('un-fakeable #3 — admin: the sensitive record is data get_customer_profile does not hold', () => {
  const plugin = () => freshVertical('admin').plugin;
  const CUSTOMER = '1';

  it('the identity record carries fields the profile read has none of', async () => {
    const p = plugin();
    const sensitive = await p.executeTool('sensitive_customer_identity', { userId: CUSTOMER }, {});
    const profile = await p.executeTool('get_customer_profile', { userId: CUSTOMER }, {});

    expect(sensitive.result.found).toBe(true);
    const flat = JSON.stringify(profile.result);
    for (const field of ['governmentId', 'dateOfBirth', 'residentialAddress', 'kyc', 'screening', 'riskRating']) {
      expect(sensitive.result[field]).toBeDefined();
      expect(flat).not.toContain(field);
    }
    // And the actual values, not just the key names — a profile that happened to
    // spell a field differently would still be a leak.
    expect(flat).not.toContain(sensitive.result.governmentId.value);
    expect(flat).not.toContain(sensitive.result.dateOfBirth);
  });

  it('the profile read still returns what it always did', async () => {
    const profile = await plugin().executeTool('get_customer_profile', { userId: CUSTOMER }, {});
    expect(profile.result.user).toEqual(expect.objectContaining({ id: CUSTOMER, username: expect.any(String) }));
    expect(profile.result.user.password).toBeUndefined();
  });

  it('a customer with no record on file is told so — never handed another customer\'s PII', async () => {
    const out = await plugin().executeTool('sensitive_customer_identity', { userId: '4' }, {});
    expect(out.result.found).toBe(false);
    expect(out.result.note).toMatch(/No identity-verification record on file/);
    expect(out.result.governmentId).toBeUndefined();
  });

  it('no customer selected is an explicit refusal, matching every other admin tool', async () => {
    const out = await plugin().executeTool('sensitive_customer_identity', {}, {});
    expect(out.result.error).toBe('no customer selected');
  });

  it('the dashboard picker supplies the customer on the A2A path, which passes no params', async () => {
    const ctx = { req: { body: { customer: { id: CUSTOMER, name: 'John Doe' } } } };
    const out = await plugin().executeTool('sensitive_customer_identity', {}, ctx);
    expect(out.result.found).toBe(true);
    expect(out.result.userId).toBe(CUSTOMER);
  });
});

describe('the hand-maintained wiring that fails silently when missed', () => {
  /**
   * configStore's env allowlist + alias map and envReconcile's classification are
   * per-specialist and hand-written. Miss them and resolveA2aConfig reports the app
   * "not configured" in the SAME words it uses for a tenant where the PingOne app
   * genuinely does not exist. Enumerated from the registry, so specialist twelve
   * fails here the day it lands rather than at a demo.
   */
  it('every A2A specialist can resolve its credentials and audience from env', () => {
    const configStore = require('../services/configStore');
    const missing = [];
    for (const spec of Object.values(A2A_SPECIALISTS)) {
      const KEY = spec.appKey.toUpperCase();
      const pairs = [
        [`PINGONE_A2A_${KEY}_AGENT_CLIENT_ID`, clientIdKey(spec.appKey)],
        [`PINGONE_A2A_${KEY}_AGENT_CLIENT_SECRET`, clientSecretKey(spec.appKey)],
        [`A2A_INTERMEDIATE_AUDIENCE_${KEY}`, intermediateAudienceKey(spec.appKey)],
      ];
      for (const [envVar, storeKey] of pairs) {
        const sentinel = `sentinel-${spec.appKey}-${envVar}`;
        const had = Object.prototype.hasOwnProperty.call(process.env, envVar);
        const prev = process.env[envVar];
        process.env[envVar] = sentinel;
        try {
          if (configStore.getEffective(storeKey) !== sentinel) missing.push(`${envVar} -> ${storeKey}`);
        } finally {
          if (had) process.env[envVar] = prev; else delete process.env[envVar];
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('envReconcile classifies every specialist credential as environment-scoped', () => {
    const { ENV_SCOPED_KEYS } = require('../services/envReconcile');
    const missing = [];
    for (const spec of Object.values(A2A_SPECIALISTS)) {
      for (const key of [
        `pingone_a2a_${spec.appKey}_agent_client_id`,
        `pingone_a2a_${spec.appKey}_agent_client_secret`,
        `pingone_${spec.appKey}_agent_client_id`,
        `pingone_${spec.appKey}_agent_client_secret`,
      ]) {
        if (!ENV_SCOPED_KEYS.has(key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the sensitive read is a read-only intent, so intentAuth cannot 428 it', () => {
    const src = require('node:fs').readFileSync(
      path.join(__dirname, '..', 'services', 'intentAuthService.js'), 'utf8',
    );
    expect(src).toContain("'sensitive_customer_identity'");
  });
});

describe('delivery — where the tool is actually answered', () => {
  /**
   * `admin` is deliberately NOT in either catalog, and that is a property of the
   * generator's walk: verticalManifest.list() applies HIDDEN_IDS, which excludes
   * admin from the vertical switcher and therefore from gen-vertical-tools.js.
   *
   * Pinned in BOTH directions so nobody "fixes" the absence by hand — the generator
   * compares the whole rendered file, so a hand-added line fails `verticals:check`.
   * The consequence is delivery-only: the gateway still authorizes (the nested-act
   * token is real and Authorize runs), the MCP server answers "unknown tool", and
   * executeA2aDelegation's local-serve path runs the plugin, exactly as it already
   * does for every other specialist tool whose gateway backend is null.
   */
  it('admin is hidden from the generator walk, so its tool is BFF-served by design', () => {
    expect(verticalManifest.list().map((v) => v.id)).not.toContain('admin');
    // Derived, not hardcoded: gen-vertical-tools.js owns which trees it writes.
    // It was briefly two ('demo_mcp_server' + 'oauth-mcp'); hardcoding that list
    // made this test read a path that no longer exists. Read the generator's own
    // source of truth so a future tree add/remove cannot silently skip the check.
    const fs = require('node:fs');
    const genSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'gen-vertical-tools.js'), 'utf8');
    const trees = [...genSrc.matchAll(/^const GENERATED_TS_PATHS = \[([^\]]*)\]/gm)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1]));
    expect(trees.length).toBeGreaterThan(0);
    for (const svc of trees) {
      const p = path.join(__dirname, '..', '..', svc, 'src', 'tools', 'handlers', 'verticalTools.generated.ts');
      expect(fs.readFileSync(p, 'utf8')).not.toContain('sensitive_customer_identity');
    }
    // Local-serve requires the ACTIVE vertical's plugin to own the tool by name.
    const verticalDispatch = require('../services/verticalDispatch');
    const names = (verticalDispatch.toolSchemasFor('admin', { isAdmin: false }, () => []) || [])
      .map((t) => t.name);
    expect(names).toContain('sensitive_customer_identity');
  });

});

describe('the gates go RED when the wiring is reverted', () => {
  it.each(cases)('%s: dropping a2aDelegatedScope collapses the specialist to bare read', (vertical, c) => {
    const fakeTopo = {
      a2aDelegatedScope: () => null,
      toolScopes: (t) => scopeTopology.toolScopes(t),
    };
    expect(deriveSpecialistScopes(specialistForVertical(vertical), fakeTopo)).toEqual(['read']);
    expect(deriveSpecialistScopes(specialistForVertical(vertical), fakeTopo)).not.toEqual([c.delegatedScope]);
  });

  it.each(cases)('%s: dropping a2aDelegated lets the lone generalist through', async (_vertical, c) => {
    const real = scopeTopology.isA2aDelegatedTool;
    scopeTopology.isA2aDelegatedTool = (name) => (name === c.tool ? false : real(name));
    try {
      const res = await simulatedAuthorize.evaluateMcpFirstTool({
        userId: 'u-123', actClientId: 'generalist', toolName: c.tool,
      });
      expect(String(res.raw.reason || '')).not.toMatch(/a2a_delegation_required/);
    } finally {
      scopeTopology.isA2aDelegatedTool = real;
    }
  });

  it('admin: moving the identity fields onto the user row would leak them via the profile read', async () => {
    const { plugin, store } = freshVertical('admin');
    const real = store.getUserById.bind(store);
    store.getUserById = (id) => ({ ...real(id), dateOfBirth: '1979-06-04' });
    try {
      const profile = await plugin.executeTool('get_customer_profile', { userId: '1' }, {});
      expect(JSON.stringify(profile.result)).toContain('dateOfBirth');
    } finally {
      store.getUserById = real;
    }
  });
});
