/**
 * pinggateway-dual-gateway-aud.test.ts
 *
 * Locks the dual-gateway audience reconciliation for the PingGateway second-gateway
 * feature. The same MCP server validates tokens from BOTH gateways, each over its own
 * transport with its own contract — WITHOUT any MCP-server code change (the
 * reconciliation is env config: MCP_AUDIENCE vs MCP_UPSTREAM_RESOURCE_URI):
 *
 *   - PingGateway (HTTP path, MCP_GATEWAY_MODE=true): performs an IG-native RFC 8693
 *     exchange to the backend audience (mcpserver.ping.demo / mcp-invest.ping.demo).
 *     Validated by HttpMCPTransport.enforceUpstreamContract (D-05). Tested for real
 *     below against the production code.
 *
 *   - Node gateway (WebSocket path): forwards the inbound token UNCHANGED, aud =
 *     gateway aud (mcpgateway.ping.demo). Validated by validateTokenAtGateway with
 *     expectedAudience = MCP_AUDIENCE. That source file is UNCHANGED by this feature;
 *     its aud rule (Array-aware `includes(expectedAudience)`) is mirrored below for
 *     the cross-path invariant. It cannot be imported here because it is an ESM `.js`
 *     module and jest.config.js only transforms `.ts` (changing that is out of scope).
 *
 * Design decision proven here: the PingGateway exchange is SINGLE-resource (upstream
 * aud only). A multi-resource token carrying BOTH the gateway and upstream auds is
 * REJECTED by D-05 — so multi-resource is NOT used.
 */

import { HttpMCPTransport } from '../src/server/HttpMCPTransport';

const GATEWAY_AUD = 'mcpgateway.ping.demo';
const OLB_UPSTREAM = 'mcpserver.ping.demo';
const INVEST_UPSTREAM = 'mcp-invest.ping.demo';

function exp(offset = 300): number {
  return Math.floor(Date.now() / 1000) + offset;
}

// Mirror of the aud rule in src/middleware/validateTokenAtGateway.js (RFC 8693 §2.3),
// which this feature does NOT modify. Array-aware membership check.
function wsPathAudAccepts(aud: string | string[], expectedAudience: string): boolean {
  const audValues = Array.isArray(aud) ? aud : [aud];
  return audValues.includes(expectedAudience);
}

describe('PingGateway dual-gateway audience reconciliation', () => {
  describe('PingGateway HTTP path (D-05 enforceUpstreamContract — production code)', () => {
    it('accepts the single-resource exchanged token (aud = upstream OLB aud)', () => {
      const result = HttpMCPTransport.enforceUpstreamContract(
        { sub: 'agent', aud: OLB_UPSTREAM, exp: exp(), act: { sub: 'mcp-exchanger' } },
        { upstreamAudience: OLB_UPSTREAM, gatewayAudience: GATEWAY_AUD },
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts the invest backend exchanged token (aud = mcp-invest.ping.demo)', () => {
      const result = HttpMCPTransport.enforceUpstreamContract(
        { sub: 'agent', aud: INVEST_UPSTREAM, exp: exp(), act: { sub: 'mcp-exchanger' } },
        { upstreamAudience: INVEST_UPSTREAM, gatewayAudience: GATEWAY_AUD },
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a gateway-aud token at the upstream (D-05 anti-bypass)', () => {
      const result = HttpMCPTransport.enforceUpstreamContract(
        { sub: 'agent', aud: GATEWAY_AUD, exp: exp() },
        { upstreamAudience: OLB_UPSTREAM, gatewayAudience: GATEWAY_AUD },
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('D-05');
    });

    it('rejects a MULTI-resource token (gateway + upstream aud) — why single-resource is used', () => {
      const result = HttpMCPTransport.enforceUpstreamContract(
        { sub: 'agent', aud: [GATEWAY_AUD, OLB_UPSTREAM], exp: exp() },
        { upstreamAudience: OLB_UPSTREAM, gatewayAudience: GATEWAY_AUD },
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('D-05');
    });
  });

  describe('Node gateway WS path aud rule (mirror of unchanged validateTokenAtGateway.js)', () => {
    it('accepts the unchanged gateway-aud token (aud = mcpgateway.ping.demo)', () => {
      expect(wsPathAudAccepts(GATEWAY_AUD, GATEWAY_AUD)).toBe(true);
    });

    it('rejects an upstream-aud token on the WS path (Node path expects the gateway aud)', () => {
      expect(wsPathAudAccepts(OLB_UPSTREAM, GATEWAY_AUD)).toBe(false);
    });
  });

  describe('cross-path invariant: both gateways validate at the same MCP server', () => {
    it('Node token passes WS aud rule AND PingGateway token passes HTTP D-05 contract', () => {
      const nodePasses = wsPathAudAccepts(GATEWAY_AUD, GATEWAY_AUD);
      const pgHttp = HttpMCPTransport.enforceUpstreamContract(
        { sub: 'agent', aud: OLB_UPSTREAM, exp: exp(), act: { sub: 'mcp-exchanger' } },
        { upstreamAudience: OLB_UPSTREAM, gatewayAudience: GATEWAY_AUD },
      );
      expect(nodePasses).toBe(true);
      expect(pgHttp.valid).toBe(true);
      // And the two auds are disjoint — neither gateway's token satisfies the other's contract.
      expect(wsPathAudAccepts(OLB_UPSTREAM, GATEWAY_AUD)).toBe(false);
    });
  });
});
