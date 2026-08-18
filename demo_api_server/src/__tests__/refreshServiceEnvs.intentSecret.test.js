/**
 * @file refreshServiceEnvs.intentSecret.test.js
 *
 * scripts/refresh-service-envs.js generates both gateways' .env. It did not emit
 * INTENT_TOKEN_SECRET, which made the Intent Token verification dead code on the
 * running stack: PingGateway's p1az-decision.groovy and the Node gateway's
 * intentTokenValidator.ts both resolve `INTENT_TOKEN_SECRET ?: SESSION_SECRET`,
 * found NEITHER on the generated env, and failed closed (Groovy omits its
 * IntentTokenValid / IntentMatchesTool decision keys; Node returns
 * no_signing_key). Both gateway env blocks must emit the key with the SAME
 * resolution order the BFF signs with, or a token the BFF mints fails on that
 * path.
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process. These assertions are made against its source:
 * the property of interest is which keys each gateway block emits, which is
 * statically readable and is exactly what regressed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

/**
 * The writeEnvFile({...}) argument block for one service's .env, with `//`
 * comments stripped — the prose explaining a key also names it, and matching
 * prose instead of code would let the test pass on a comment alone.
 *
 * @param startNeedle  the writeEnvFile path literal (e.g. "'ping-gateway', '.env'")
 * @param endNeedle    the trailing "Wrote <service>/.env" log marker
 */
function envBlock(startNeedle, endNeedle) {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const start = src.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(endNeedle, start);
  expect(end).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const pingGatewayEnvBlock = () => envBlock("'ping-gateway', '.env'", 'Wrote ping-gateway/.env');
const demoMcpGatewayEnvBlock = () => envBlock("'demo_mcp_gateway', '.env'", 'Wrote demo_mcp_gateway/.env');

// The gateway must land on the SAME key the BFF signs with, or every Intent
// Token fails verification. demo_api_server/services/intentTokenService.js
// resolves `INTENT_TOKEN_SECRET || SESSION_SECRET`; both gateway blocks mirror
// that resolution so every side agrees whichever one is actually configured.
function assertIntentSecretWiring(block) {
  const line = block.split('\n').find((l) => l.includes('INTENT_TOKEN_SECRET'));
  expect(line).toBeDefined();
  expect(line).toMatch(/fb\('INTENT_TOKEN_SECRET'\)/);
  expect(line).toMatch(/fb\('SESSION_SECRET'\)/);
  // INTENT_TOKEN_SECRET wins over SESSION_SECRET (resolution order).
  expect(line.indexOf("fb('INTENT_TOKEN_SECRET')"))
    .toBeLessThan(line.indexOf("fb('SESSION_SECRET')"));
}

describe('refresh-service-envs — ping-gateway/.env', () => {
  it('emits INTENT_TOKEN_SECRET so the Groovy intent filter is not dead code', () => {
    expect(pingGatewayEnvBlock()).toMatch(/INTENT_TOKEN_SECRET\s*:/);
  });

  it('sources it from the same value the BFF signs with', () => {
    const block = pingGatewayEnvBlock();
    const line = block.split('\n').find((l) => l.includes('INTENT_TOKEN_SECRET'));
    expect(line).toBeDefined();
    expect(line).toMatch(/fb\('INTENT_TOKEN_SECRET'\)/);
    expect(line).toMatch(/fb\('SESSION_SECRET'\)/);
  });

  it('keeps the BFF resolution order (INTENT_TOKEN_SECRET wins over SESSION_SECRET)', () => {
    const block = pingGatewayEnvBlock();
    const line = block.split('\n').find((l) => l.includes('INTENT_TOKEN_SECRET'));
    expect(line.indexOf("fb('INTENT_TOKEN_SECRET')"))
      .toBeLessThan(line.indexOf("fb('SESSION_SECRET')"));
  });
});

describe('refresh-service-envs — demo_mcp_gateway/.env (Node gateway)', () => {
  it('emits INTENT_TOKEN_SECRET so intentTokenValidator has a signing key', () => {
    // Without it, getSigningKey() throws and every gw_audit_trail on the Node
    // path reports IntentTokenValid='false' / IntentTokenError='no_signing_key'.
    expect(demoMcpGatewayEnvBlock()).toMatch(/INTENT_TOKEN_SECRET\s*:/);
  });

  it('sources it from the BFF signing key with the same resolution order', () => {
    // Parity with the ping-gateway block: same key the BFF signs with, same
    // INTENT_TOKEN_SECRET-wins-over-SESSION_SECRET order, so a token the BFF
    // mints verifies on the Node path exactly as it does through PingGateway.
    assertIntentSecretWiring(demoMcpGatewayEnvBlock());
  });
});
