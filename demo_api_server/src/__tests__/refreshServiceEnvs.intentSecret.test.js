/**
 * @file refreshServiceEnvs.intentSecret.test.js
 *
 * scripts/refresh-service-envs.js generates ping-gateway/.env. It did not emit
 * INTENT_TOKEN_SECRET, which made the Intent Token verification in
 * ping-gateway/scripts/groovy/p1az-decision.groovy dead code on the running
 * stack: the filter resolves `INTENT_TOKEN_SECRET ?: SESSION_SECRET`, found
 * NEITHER on the generated env, and silently omitted its decision keys
 * (IntentTokenValid / IntentMatchesTool) — contract C1 "binding evidence".
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process. These assertions are made against its source:
 * the property of interest is which keys the ping-gateway block emits, which is
 * statically readable and is exactly what regressed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

/**
 * The writeEnvFile({...}) argument block for ping-gateway/.env, with `//`
 * comments stripped — the prose explaining a key also names it, and matching
 * prose instead of code would let the test pass on a comment alone.
 */
function pingGatewayEnvBlock() {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const start = src.indexOf("'ping-gateway', '.env'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("Wrote ping-gateway/.env", start);
  expect(end).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('refresh-service-envs — ping-gateway/.env', () => {
  it('emits INTENT_TOKEN_SECRET so the Groovy intent filter is not dead code', () => {
    expect(pingGatewayEnvBlock()).toMatch(/INTENT_TOKEN_SECRET\s*:/);
  });

  // The gateway must land on the SAME key the BFF signs with, or every Intent
  // Token fails verification. demo_api_server/services/intentTokenService.js
  // resolves `INTENT_TOKEN_SECRET || SESSION_SECRET`; mirror that resolution
  // here so both sides agree whichever one is actually configured.
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
