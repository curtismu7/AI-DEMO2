'use strict';
/**
 * Drift-guard (Inv-3): every scope required by a gateway-surface tool must be
 * present in the RFC 8707 scope-audience allowlist (buildAllowedScopesByAudience)
 * for BOTH the MCP Gateway and MCP Server audiences. Otherwise the BFF's token
 * exchange rejects the tool call with SCOPE_MISMATCH before it ever reaches the
 * gateway (the failure `code:search` hit during the code-search rollout).
 *
 * Since 2026-09-09 the two MCP audience lists are DERIVED from the manifest
 * (configStore.audienceScopesFromTopology), so this guards two things:
 *   1. COVERAGE — every scope a tool can request is present for both audiences.
 *      This now fails when the SoT forgets to mirror a tool scope onto the
 *      resource, which is what silently shipped `audit:read` as a hand-typed
 *      entry the manifest never carried.
 *   2. AUTHORSHIP — the lists are exactly the manifest-derived set, so a
 *      hand-typed scope cannot creep back in.
 */
const scopeTopology = require('../../services/scopeTopology');
const configStore = require('../../services/configStore');

describe('scope-audience allowlist ↔ gateway tool requiredScopes coverage', () => {
  const gwUri = scopeTopology.resourceUri('Super Banking MCP Gateway');
  const srvUri = scopeTopology.resourceUri('Super Banking MCP Server');

  // buildAllowedScopesByAudience() resolves audience URIs via getEffective
  // (env -> default) at call time; feed the manifest URIs through env so the
  // returned map is keyed by the same URIs scope-topology reports.
  const prevEnv = { ...process.env };
  let allowed;
  beforeAll(() => {
    process.env.ENDUSER_AUDIENCE = scopeTopology.resourceUri('Super Banking API') || 'enduser.ping.demo';
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = scopeTopology.resourceUri('Super Banking Agent Gateway') || 'agentgateway.ping.demo';
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = gwUri;
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = srvUri;
    allowed = configStore.buildAllowedScopesByAudience();
  });
  afterAll(() => { process.env = prevEnv; });

  // No gateway-only exemptions. `transfer` used to be exempt here on the claim
  // that it was "deliberately not re-exchanged onto the MCP Server audience",
  // but scope-topology.json mirrors it onto "Super Banking MCP Server" and the
  // BFF narrows every exchange request against pingone_resource_mcp_server_uri
  // (agentMcpTokenService → validateScopeAudience). With the exemption the
  // allow-list silently dropped `transfer`, the exchanged token carried only
  // `write mcp:invoke`, and the gateway 403'd create_transfer /
  // create_wire_transfer with `insufficient_scope: missing transfer` before
  // HITL / CIBA / step-up / tier were ever evaluated (UC6/7/8/22, 2026-09-08).
  const GATEWAY_ONLY_SCOPES = new Set();

  // agentMcpTokenService strips these from finalScopes BEFORE
  // validateScopeAudience runs (DELEGATION_ONLY_SCOPES) — they are delegation
  // signals on the USER token, never exchange scopes — so the allow-list is
  // never asked about them and must not be required to carry them.
  // NOTE: `query_user_by_email` declares `ai_agent` as its ONLY requiredScope,
  // which means it can never resolve an exchangeable scope at all. That is a
  // manifest bug, recorded in TECH_DEBT, not something this gate can fix.
  const DELEGATION_ONLY_SCOPES = new Set(['ai:agent:read', 'ai_agent', 'ai:agent']);

  const alias = scopeTopology.aliases();
  const norm = (s) => alias[s] || s;
  // Every surface, not just `gateway`: the BFF exchange requests
  // MCP_TOOL_SCOPES[tool] for whatever tool is called, and the 14 admin
  // `exchange-only` tools carry admin:*/users:* scopes that the gateway-only
  // walk never checked — the same blind spot that hid the `transfer` gap.
  const gwCases = [];
  const srvCases = [];
  for (const t of scopeTopology.allTools()) {
    for (const raw of scopeTopology.toolScopes(t)) {
      const s = norm(raw);
      if (DELEGATION_ONLY_SCOPES.has(s)) continue;
      gwCases.push([t, s]);
      if (!GATEWAY_ONLY_SCOPES.has(s)) srvCases.push([t, s]);
    }
  }

  test('there is at least one gateway tool scope to check (sanity)', () => {
    expect(gwCases.length).toBeGreaterThan(10);
  });

  test.each(gwCases)('tool "%s" scope "%s" is allowed for the MCP Gateway audience', (_t, s) => {
    expect(allowed[gwUri]).toContain(s);
  });

  test.each(srvCases)('tool "%s" scope "%s" is allowed for the MCP Server audience', (_t, s) => {
    expect(allowed[srvUri]).toContain(s);
  });

  test('negative proof: a fabricated scope is NOT allowed (guard actually discriminates)', () => {
    expect(allowed[srvUri]).not.toContain('__nonexistent:scope__');
  });

  // Authorship: recompute the expected list straight from the manifest, so a
  // hand-typed addition to buildAllowedScopesByAudience fails here.
  // A scope the manifest mirrors onto the resource but no tool requires
  // (the a2aDelegatedScope family — tax:read, pnr:read, holdings:read, ...)
  // is provisioned on the PingOne resource but is NOT exchange-requestable
  // through this path, so it is deliberately absent.
  const manifest = require('../../../scope-topology.json');
  const requestable = new Set(
    Object.values(manifest.tools).flatMap((t) => t.requiredScopes || []),
  );
  const expectedFor = (resourceName) => {
    const r = manifest.resources[resourceName];
    return [...new Set([...(r.scopes || []), ...(r.mirroredScopes || [])])]
      .filter((s) => s === 'mcp:invoke' || requestable.has(s))
      .sort();
  };

  test('MCP Gateway allow-list is exactly the manifest-derived set', () => {
    expect([...allowed[gwUri]].sort()).toEqual(expectedFor('Super Banking MCP Gateway'));
  });

  test('MCP Server allow-list is exactly the manifest-derived set', () => {
    expect([...allowed[srvUri]].sort()).toEqual(expectedFor('Super Banking MCP Server'));
  });
});
