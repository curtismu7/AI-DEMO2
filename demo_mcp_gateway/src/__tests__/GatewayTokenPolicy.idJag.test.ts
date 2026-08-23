/**
 * GatewayTokenPolicy's D-05 anti-bypass check — a native-ID-JAG-redeemed token
 * legitimately carries the OLB server's own audience (that's what the
 * extension mints it for), which D-05 exists to block for every OTHER caller.
 * The exemption must fire ONLY for tokens isIdJagIssuedToken() recognizes
 * (iss already verified against oauth-mcp's own JWKS in tokenValidator.ts) —
 * a PingOne-issued token carrying the same aud, by accident or by attack, must
 * still be blocked exactly as before.
 */

import { GatewayTokenPolicy, GatewayTokenPolicyError } from '../auth/GatewayTokenPolicy';
import type { DecodedGatewayToken } from '../tokenValidator';
import type { GatewayConfig } from '../config';

const OLB_AUD = 'mcpserver.ping.demo';
const GATEWAY_AUD = 'mcpgateway.ping.demo';
const ID_JAG_ISSUER = 'https://localhost:8080';

const config = {
  gatewayResourceUri: GATEWAY_AUD,
  mcpOlbResourceUri: OLB_AUD,
  mcpResourceServerResourceUri: 'mcp-invest.ping.demo',
  bankingResourceServerResourceUri: '',
  requireActForAgentTools: false,
} as unknown as GatewayConfig;

function baseToken(overrides: Partial<DecodedGatewayToken> = {}): DecodedGatewayToken {
  return {
    sub: 'user-1',
    aud: GATEWAY_AUD,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

describe('GatewayTokenPolicy D-05 — ID-JAG exemption', () => {
  it('still blocks a PingOne-issued token whose aud targets the OLB server (D-05 unaffected)', () => {
    const decoded = baseToken({ aud: OLB_AUD, iss: 'https://auth.pingone.com/env/as' });
    expect(() => GatewayTokenPolicy.validate(decoded, config)).toThrow(GatewayTokenPolicyError);
    try {
      GatewayTokenPolicy.validate(decoded, config);
    } catch (err) {
      expect((err as GatewayTokenPolicyError).code).toBe('bypass_attempt');
    }
  });

  it('allows a token audienced for the OLB server when iss is the recognized ID-JAG issuer', () => {
    const decoded = baseToken({ aud: OLB_AUD, iss: ID_JAG_ISSUER });
    expect(() => GatewayTokenPolicy.validate(decoded, config)).not.toThrow();
  });

  it('a token merely claiming the ID-JAG issuer string, with a DIFFERENT aud shape, still gets every OTHER check enforced', () => {
    // sub-required and act-chain checks must still run for ID-JAG tokens —
    // the filter narrows ONLY the upstream-audience blacklist, nothing else.
    const decoded = baseToken({ aud: OLB_AUD, iss: ID_JAG_ISSUER, sub: '' });
    expect(() => GatewayTokenPolicy.validate(decoded, config)).toThrow(GatewayTokenPolicyError);
    try {
      GatewayTokenPolicy.validate(decoded, config);
    } catch (err) {
      expect((err as GatewayTokenPolicyError).code).toBe('missing_sub');
    }
  });

  it('a normal gateway-audienced token (no upstream aud at all) passes regardless of iss', () => {
    const decoded = baseToken({ aud: GATEWAY_AUD, iss: 'https://auth.pingone.com/env/as' });
    expect(() => GatewayTokenPolicy.validate(decoded, config)).not.toThrow();
  });
});
