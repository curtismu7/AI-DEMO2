/**
 * gateway-upstream.test.ts — D-05 enforcement at the upstream MCP server boundary (Phase 243)
 *
 * Verifies that the upstream MCP server correctly enforces the gateway-first
 * next-hop token contract:
 *   - Tokens with gateway audience are rejected (D-05 anti-bypass)
 *   - Tokens with upstream MCP server audience are accepted
 *   - RFC 9728 metadata in gateway mode communicates upstream-behind-gateway status
 */

import { HttpMCPTransport } from '../src/server/HttpMCPTransport';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeExp(offsetSeconds = 300): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

const UPSTREAM_AUD = 'https://mcp-server.example.com';
const GATEWAY_AUD  = 'https://mcp-gateway.example.com';

// --------------------------------------------------------------------------
// Test suite: upstream contract enforcement (D-05)
// --------------------------------------------------------------------------

describe('HttpMCPTransport.enforceUpstreamContract — D-05 next-hop token enforcement', () => {
  it('Test 1: rejects direct caller tokens with the gateway audience at the upstream', () => {
    // A token issued to the gateway audience must NOT be accepted at the upstream.
    // This prevents a client from obtaining a gateway-aud token and bypassing the
    // gateway's PingOne Authorize evaluation + RFC 8693 exchange (D-05).
    const claims = {
      sub: 'agent-client-1',
      aud: GATEWAY_AUD,
      exp: makeExp(),
    };

    const result = HttpMCPTransport.enforceUpstreamContract(claims, {
      upstreamAudience: UPSTREAM_AUD,
      gatewayAudience:  GATEWAY_AUD,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('D-05');
  });

  it('Test 2: accepts gateway-issued next-hop tokens with the upstream MCP server audience', () => {
    // After the gateway performs RFC 8693 exchange, the resulting token has
    // aud = upstream MCP server URI. This token MUST be accepted at the upstream.
    const claims = {
      sub:     'agent-client-1',
      aud:     UPSTREAM_AUD,
      exp:     makeExp(),
      act:     { sub: 'gateway-client-id' },  // delegation chain via gateway
    };

    const result = HttpMCPTransport.enforceUpstreamContract(claims, {
      upstreamAudience: UPSTREAM_AUD,
      gatewayAudience:  GATEWAY_AUD,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('Test 3: in gateway mode, discovery metadata communicates upstream-behind-gateway status', () => {
    // When MCP_GATEWAY_MODE=true + MCP_GW_RESOURCE_URI set, the RFC 9728 metadata
    // at the upstream must include a gateway indicator so clients are not misled
    // into treating the upstream as the public front door.
    const metadata = HttpMCPTransport.buildGatewayModeMetadataHints(
      'https://mcp-server.example.com',
      GATEWAY_AUD,
    );

    expect(metadata).toHaveProperty('x_gateway_protected_by', GATEWAY_AUD);
    expect(metadata).toHaveProperty('x_direct_access', 'blocked_in_gateway_mode');
  });

  it('accepts tokens when no audience constraints are configured (dev / unconfigured mode)', () => {
    // When neither upstreamAudience nor gatewayAudience is set, the check is a
    // no-op — allows local dev without env vars.
    const claims = { sub: 'dev-agent', aud: 'local-dev', exp: makeExp() };
    const result = HttpMCPTransport.enforceUpstreamContract(claims, {});
    expect(result.valid).toBe(true);
  });

  it('rejects tokens with an array audience that contains only the gateway URI', () => {
    const claims = {
      sub: 'agent-bypass-attempt',
      aud: [GATEWAY_AUD],
      exp: makeExp(),
    };
    const result = HttpMCPTransport.enforceUpstreamContract(claims, {
      upstreamAudience: UPSTREAM_AUD,
      gatewayAudience:  GATEWAY_AUD,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('D-05');
  });

  it('rejects tokens where array audience includes gateway URI even alongside upstream URI', () => {
    // A token with aud: [gateway, upstream] has been issued to the wrong resource.
    // Proper token exchange produces a token with aud: [upstream] only.
    const claims = {
      sub: 'agent-multi-aud',
      aud: [GATEWAY_AUD, UPSTREAM_AUD],
      exp: makeExp(),
    };
    const result = HttpMCPTransport.enforceUpstreamContract(claims, {
      upstreamAudience: UPSTREAM_AUD,
      gatewayAudience:  GATEWAY_AUD,
    });
    // Gateway aud present → D-05 violation regardless of other aud values
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('D-05');
  });

  it('rejects tokens missing aud entirely', () => {
    const claims = { sub: 'agent-no-aud', exp: makeExp() };
    const result = HttpMCPTransport.enforceUpstreamContract(claims, {
      upstreamAudience: UPSTREAM_AUD,
      gatewayAudience:  GATEWAY_AUD,
    });
    expect(result.valid).toBe(false);
  });
});
