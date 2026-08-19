// demo_api_server/tests/mcpGatewayClient.backstopDenyTrail.test.js
'use strict';
/**
 * PingGateway's `denyLocal` backstop (p1az-decision.groovy:444) answers 403 with a
 * bare `{error, message, tool}` body and NO X-Gw-Audit-Trail header. Every one of its
 * ~8 reasons (tier_amount_exceeded, tier_tool_not_allowed, insufficient_scope,
 * invalid_iat, token_too_old, token_not_yet_valid, ...) therefore reached the UI with
 * no authorize evidence at all, so ProofStrip scored a correct, intentional DENY as
 * "Authz denied — Incomplete / Run failed before authorize-decision".
 *
 * Observed live 2026-08-18, sporting-goods UC6 "extend my rental $2500":
 *   { reply: "❌ 2500 exceeds tier ceiling 2000", error: "gateway_policy_denied" }
 *   tokenEvents ended at session-token-introspection — no gw-authorize.
 * The same chip on a PERMIT (UC20) carried gw-introspection + gw-authorize +
 * gw-mcp-audit + gw-mtls + gw-filter-chain.
 *
 * In gateway-authoritative mode the gateway IS the PDP, so a 403 from it is a real
 * authorization decision and must carry evidence. Synthesized BFF-side (rather than
 * in groovy) so it also works against a gateway that has not been redeployed —
 * the same reason the 403 branch still recognises the pre-428 consent body.
 */

const {
  _syntheticBackstopDenyTrail,
  _trailWithDenyFallback,
} = require('../services/mcpGatewayClient');

describe('mcpGatewayClient — gateway backstop DENY carries authorize evidence', () => {
  test('synthesizes an authorize DENY block from a bare denyLocal body', () => {
    const trail = _syntheticBackstopDenyTrail(
      { error: 'tier_amount_exceeded', message: '2500 exceeds tier ceiling 2000', tool: 'extend_rental' },
      '2500 exceeds tier ceiling 2000',
      'extend_rental',
    );
    expect(trail).not.toBeNull();
    expect(trail.authorize.decision).toBe('DENY');
    // Must NOT claim cloud P1AZ evaluated this — the tier ceiling is a gateway-local
    // rule precisely because P1AZ cannot map a PingOne group array to a tier.
    expect(trail.authorize.backend).toBe('gateway-backstop');
    expect(trail.authorize.reason).toMatch(/tier_amount_exceeded/);
    expect(trail.authorize.reason).toMatch(/2500 exceeds tier ceiling 2000/);
    expect(trail.denyingFilter).toBe('p1az-decision.groovy');
  });

  test('covers every denyLocal reason, not just the tier ones', () => {
    for (const code of [
      'insufficient_scope', 'tier_tool_not_allowed', 'invalid_iat',
      'token_too_old', 'token_not_yet_valid', 'forbidden',
    ]) {
      const trail = _syntheticBackstopDenyTrail({ error: code, message: 'nope' }, 'nope', 'some_tool');
      expect(trail.authorize.decision).toBe('DENY');
      expect(trail.authorize.reason).toMatch(new RegExp(code));
    }
  });

  test('does NOT synthesize for the infra fault (bare Unauthorized, no correlationId)', () => {
    // This must stay gateway_misconfigured (503, "fix the gateway"), never a policy
    // DENY — mcpToolPipeline distinguishes the two by exactly this shape.
    expect(_syntheticBackstopDenyTrail({ message: 'Unauthorized' }, 'Unauthorized', 'x')).toBeNull();
    expect(_syntheticBackstopDenyTrail({ error: 'Unauthorized' }, 'Unauthorized', 'x')).toBeNull();
  });

  test('does NOT overwrite a real X-Gw-Audit-Trail authorize block', () => {
    const real = {
      authorize: { decision: 'DENY', backend: 'real', rawResponse: { correlationId: 'corr-1' } },
    };
    const merged = _trailWithDenyFallback(real, { error: 'tier_amount_exceeded' }, 'msg', 'extend_rental');
    expect(merged.authorize.backend).toBe('real');
    expect(merged.authorize.rawResponse.correlationId).toBe('corr-1');
  });

  test('fills in authorize when the header carried introspection but no decision', () => {
    const partial = { introspection: { active: true, sub: 'u1' } };
    const merged = _trailWithDenyFallback(partial, { error: 'insufficient_scope' }, 'missing write', 'extend_rental');
    expect(merged.introspection.active).toBe(true);
    expect(merged.authorize.decision).toBe('DENY');
    expect(merged.authorize.backend).toBe('gateway-backstop');
  });

  test('weather denials keep their own filter-chain trail (no double-synthesis)', () => {
    const msg = 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas';
    const merged = _trailWithDenyFallback(null, { error: 'jsonrpc_-32000' }, msg, 'get_weather');
    expect(merged.denyingFilter).toBe('tx-weather-scope.groovy');
  });
});
