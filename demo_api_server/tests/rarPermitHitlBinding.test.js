'use strict';
const { __test } = require('../services/attackSimulatorService');
const { _hitlBindingFor } = __test;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.s`;

describe('_hitlBindingFor (UC14b HITL receipt binding)', () => {
  const pfToken = jwt({ sub: 'demouser', act: { sub: 'mcp-actor', act: { sub: 'agent-actor' } } });

  test('PF: binds to the exchanged token sub and top-level act.sub, not the PingOne actor', () => {
    expect(_hitlBindingFor(pfToken, 'p1-uuid', 'p1-actor', true))
      .toEqual({ userId: 'demouser', agentId: 'mcp-actor' });
  });

  test('PF: falls back to configured ids when the token carries none', () => {
    expect(_hitlBindingFor(jwt({}), 'u', 'a', true)).toEqual({ userId: 'u', agentId: 'a' });
  });

  test('PingOne: unchanged, token ignored', () => {
    expect(_hitlBindingFor(pfToken, 'p1-uuid', 'p1-actor', false))
      .toEqual({ userId: 'p1-uuid', agentId: 'p1-actor' });
  });
});
