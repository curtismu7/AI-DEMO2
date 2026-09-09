'use strict';
/**
 * Drift-guard (Inv-3): every scope required by a gateway-surface tool must be
 * present in the RFC 8707 scope-audience allowlist (buildAllowedScopesByAudience)
 * for BOTH the MCP Gateway and MCP Server audiences. Otherwise the BFF's token
 * exchange rejects the tool call with SCOPE_MISMATCH before it ever reaches the
 * gateway (the failure `code:search` hit during the code-search rollout).
 *
 * The allowlist in configStore.buildAllowedScopesByAudience() is hand-curated
 * (it also carries infra scopes like mcp:invoke that no tool requires), so this
 * guards COVERAGE — every tool scope is present — not authorship.
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

  const alias = scopeTopology.aliases();
  const norm = (s) => alias[s] || s;
  const gatewayTools = scopeTopology.allTools().filter((t) => scopeTopology.toolSurface(t) === 'gateway');
  const gwCases = [];
  const srvCases = [];
  for (const t of gatewayTools) {
    for (const raw of scopeTopology.toolScopes(t)) {
      const s = norm(raw);
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
});
