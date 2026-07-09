'use strict';

/**
 * Path B: when PingGateway mode is ON the BFF mints tokens for the PingGateway
 * resource URI, but dual_token tools are routed to the Node gateway. Accept a
 * comma-separated MCP_GW_RESOURCE_URI list so both audiences validate.
 */

import { validateInboundToken, TokenValidationError } from '../src/tokenValidator';

function makeToken(aud: string | string[]): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    aud,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://auth.example.com',
  })).toString('base64url');
  return `${header}.${payload}.`;
}

describe('validateInboundToken multi-audience', () => {
  const accepted =
    'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';

  test('accepts Node gateway audience from comma-separated list', async () => {
    const decoded = await validateInboundToken(makeToken('mcpgateway.ping.demo'), accepted);
    expect(decoded.sub).toBe('user-1');
  });

  test('accepts PingGateway audience from comma-separated list', async () => {
    const decoded = await validateInboundToken(
      makeToken('https://api.ping.demo:3036/mcp'),
      accepted,
    );
    expect(decoded.aud).toBe('https://api.ping.demo:3036/mcp');
  });

  test('rejects unknown audience', async () => {
    await expect(
      validateInboundToken(makeToken('other.ping.demo'), accepted),
    ).rejects.toBeInstanceOf(TokenValidationError);
  });
});
