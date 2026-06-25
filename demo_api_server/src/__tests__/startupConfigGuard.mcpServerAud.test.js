'use strict';

/**
 * Regression: the boot guard must enforce the forward-unchanged contract for
 * the MCP server's expected audience.
 *
 * The gateway forwards the inbound bearer to the MCP server WITHOUT re-exchange
 * (authorizeMcpRequest.ts Step 4 + GatewayTokenPolicy D-05). So the MCP server
 * must validate the SAME audience the gateway forwards — the GATEWAY audience.
 *
 * The original bug: MCP_SERVER_RESOURCE_URI was set to the mcpServer audience
 * (mcpserver.ping.demo) while the gateway forwarded a mcpgateway.ping.demo
 * token, so the MCP server 401'd every agent tool call with "aud validation
 * failed". The guard didn't catch it because it validated MCP_SERVER_RESOURCE_URI
 * against the mcpServer role (internal SoT consistency) rather than the gateway
 * audience (the cross-service runtime contract). This test locks in the fixed
 * invariant so that drift fails loudly at boot again.
 */

const guard = require('../../services/startupConfigGuard');
const scopeTopology = require('../../services/scopeTopology');

const KEY = 'MCP_SERVER_RESOURCE_URI';

describe('startupConfigGuard — MCP server expected audience must equal the gateway audience', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('flags the old buggy value (the mcpServer audience) as drift', () => {
    const aud = scopeTopology.audiences();
    // Sanity: the two audiences must actually differ, or the test is vacuous.
    expect(aud.mcpServer).not.toBe(aud.mcpGateway);

    process.env[KEY] = aud.mcpServer; // mcpserver.ping.demo — the original misconfig
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(true);
  });

  it('does not flag when it equals the gateway audience (forward-unchanged contract)', () => {
    process.env[KEY] = scopeTopology.audiences().mcpGateway; // mcpgateway.ping.demo
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });
});
