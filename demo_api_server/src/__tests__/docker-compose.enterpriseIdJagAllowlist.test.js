/**
 * @file docker-compose.enterpriseIdJagAllowlist.test.js
 * @description The two resource allow-lists that native ID-JAG needs must agree.
 *
 * Native ID-JAG has two legs and each one checks the requested resource against
 * a DIFFERENT list:
 *
 *   leg 1 (mint)   demo-api-server  -> ENTERPRISE_MCP_RESOURCE_URIS
 *                  (routes/enterpriseIdp.js: `allowed.includes(resource)`, else
 *                   400 invalid_target)
 *   leg 2 (redeem) mcp-server       -> MCP_SERVER_RESOURCE_URI
 *                  (IdJagGrantHandler: "not served by this authorization server")
 *
 * Under this demo's DEFAULT routing (ff_mcp_gateway_pinggateway=true),
 * mcpToolAuthorizationService.resolveExpectedMcpResourceUri() returns
 * pingone_resource_pinggateway_uri — https://api.ping.demo:3036/mcp — so BOTH
 * legs are asked for that URI.
 *
 * It was listed in MCP_SERVER_RESOURCE_URI but NOT in
 * ENTERPRISE_MCP_RESOURCE_URIS, so every native ID-JAG mint 400'd with
 *   invalid_target: resource https://api.ping.demo:3036/mcp is not an approved MCP server
 * and the tool call was never attempted. MCP_SERVER_RESOURCE_URI's own comment
 * asserted that the demo-api-server side "already allow-lists the same URI" —
 * a claim nothing checked, and which was false.
 *
 * This test checks the claim.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const COMPOSE = path.join(__dirname, '..', '..', '..', 'docker-compose.yml');

/** Pull `KEY: "${KEY:-<default>}"` (or a plain literal) out of docker-compose.yml. */
function composeDefault(key) {
  const src = fs.readFileSync(COMPOSE, 'utf8');
  const line = src.split('\n').find((l) => l.trim().startsWith(`${key}:`));
  if (!line) throw new Error(`${key} not found in docker-compose.yml`);
  const value = line.slice(line.indexOf(':') + 1).trim().replace(/^"|"$/g, '');
  const interpolated = value.match(/^\$\{[A-Z0-9_]+:-(.*)\}$/);
  return interpolated ? interpolated[1] : value;
}

const list = (key) => composeDefault(key).split(',').map((s) => s.trim()).filter(Boolean);

// The resource both legs are asked for under the demo's default routing mode.
const PINGGATEWAY_RESOURCE = 'https://api.ping.demo:3036/mcp';

describe('native ID-JAG resource allow-lists (docker-compose defaults)', () => {
  it('mcp-server (leg 2) accepts the PingGateway resource', () => {
    expect(list('MCP_SERVER_RESOURCE_URI')).toContain(PINGGATEWAY_RESOURCE);
  });

  // The regression: this side was missing it, so leg 1 rejected before leg 2 ran.
  it('demo-api-server (leg 1) accepts the PingGateway resource', () => {
    expect(list('ENTERPRISE_MCP_RESOURCE_URIS')).toContain(PINGGATEWAY_RESOURCE);
  });

  // Leg 1 is the gate; anything leg 2 would serve must survive leg 1 first, or
  // the mint 400s and the redeem never happens.
  it('every audience leg 2 serves that leg 1 could be asked for is allow-listed on leg 1', () => {
    const legOne = list('ENTERPRISE_MCP_RESOURCE_URIS');
    const legTwo = list('MCP_SERVER_RESOURCE_URI');
    // https://api.pingone.com is PingOne's own API audience for Privilege
    // client_credentials tokens — never a native ID-JAG mint target.
    const mintable = legTwo.filter((uri) => uri !== 'https://api.pingone.com');
    const missing = mintable.filter((uri) => !legOne.includes(uri));
    expect(missing).toEqual([]);
  });

  it('both lists are non-empty (vacuity guard — a parse change must not silently pass)', () => {
    expect(list('ENTERPRISE_MCP_RESOURCE_URIS').length).toBeGreaterThan(2);
    expect(list('MCP_SERVER_RESOURCE_URI').length).toBeGreaterThan(2);
  });
});
