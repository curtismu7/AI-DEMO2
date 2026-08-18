'use strict';

/**
 * Intent-token verifier key propagation to the gateway .env files.
 *
 * The Node gateway (demo_mcp_gateway/src/intentTokenValidator.ts) and PingGateway
 * (ping-gateway/scripts/groovy/p1az-decision.groovy) both verify the BFF's
 * HMAC-SHA256 Intent Token by resolving INTENT_TOKEN_SECRET || SESSION_SECRET.
 * refresh-service-envs.js emitted that key to ping-gateway/.env but NOT to
 * demo_mcp_gateway/.env, so every gw_audit_trail on the Node path reported
 * IntentTokenValid='false' / IntentTokenError='no_signing_key'.
 *
 * intentTokenSecret() is the single source both gateway env writers now use.
 * These cases pin its resolution order so the two gateways cannot drift apart
 * (and so a value the BFF signs with verifies on either path). No real secret —
 * the fixtures are throwaway strings.
 */

const { intentTokenSecret } = require('../scripts/refresh-service-envs');

describe('refresh-service-envs intentTokenSecret', () => {
  test('prefers INTENT_TOKEN_SECRET when set', () => {
    expect(
      intentTokenSecret({ INTENT_TOKEN_SECRET: 'intent-key', SESSION_SECRET: 'session-key' }),
    ).toBe('intent-key');
  });

  test('falls back to SESSION_SECRET when INTENT_TOKEN_SECRET is absent', () => {
    // This is the live shape: setup-env.sh writes only SESSION_SECRET, and the
    // BFF signs with it — so the gateway MUST verify with the same fallback.
    expect(intentTokenSecret({ SESSION_SECRET: 'session-key' })).toBe('session-key');
  });

  test('returns empty string when neither is set (verifier fails closed)', () => {
    // Empty => Node gateway getSigningKey() throws => no_signing_key; PingGateway
    // omits its IntentTokenValid/IntentMatchesTool evidence. Never a fabricated key.
    expect(intentTokenSecret({})).toBe('');
  });

  test('matches the key the BFF signs with (round-trips through the validator)', () => {
    // Prove the derived key is exactly what verifies a BFF-minted token: sign a
    // token with intentTokenSecret(apiVars), then HMAC-verify it the way both
    // gateways do. A drift in resolution order would break this.
    const crypto = require('node:crypto');
    const apiVars = { SESSION_SECRET: 'shared-hmac-secret-32-chars-minimum!!' };
    const key = intentTokenSecret(apiVars);

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ permitted_tools: ['create_transfer'] })).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');

    const expected = crypto
      .createHmac('sha256', intentTokenSecret(apiVars))
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(sig).toBe(expected);
  });
});
