'use strict';

/**
 * Regression: the boot guard must enforce the RFC 8693 re-exchange contract for
 * the MCP server's expected audience.
 *
 * The gateway performs an RFC 8693 token exchange (authorizeMcpRequest.ts Step 4)
 * to mint a next-hop token scoped to the mcpServer audience before forwarding —
 * it does NOT forward the inbound gateway-audience bearer unchanged. So the MCP
 * server must validate the mcpServer audience (mcpserver.ping.demo), which is
 * DISTINCT from the gateway audience (mcpgateway.ping.demo).
 *
 * MCP_SERVER_RESOURCE_URI is list-valued to support a rollout window: it MUST
 * contain the mcpServer audience; the gateway audience alone is not sufficient.
 * This test locks in that invariant so drift fails loudly at boot.
 */

const guard = require('../../services/startupConfigGuard');
const scopeTopology = require('../../services/scopeTopology');

const KEY = 'MCP_SERVER_RESOURCE_URI';

describe('startupConfigGuard — MCP server expected audience must equal the mcpServer audience', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('flags the gateway audience alone (missing the mcpServer audience) as drift', () => {
    const aud = scopeTopology.audiences();
    // Sanity: the two audiences must actually differ, or the test is vacuous.
    expect(aud.mcpServer).not.toBe(aud.mcpGateway);

    process.env[KEY] = aud.mcpGateway; // mcpgateway.ping.demo — missing the required mcpServer entry
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(true);
  });

  it('does not flag when it contains the mcpServer audience', () => {
    process.env[KEY] = scopeTopology.audiences().mcpServer; // mcpserver.ping.demo
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });
});
