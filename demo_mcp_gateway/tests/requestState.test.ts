'use strict';

/**
 * Signed MRTR requestState (MCP 2026-07-28): integrity, binding, expiry, single use.
 */

import {
  mintRequestState,
  consumeRequestState,
  digestToolArgs,
  _resetRequestStateForTest,
} from '../src/requestState';

const binding = { tool: 'transfer_funds', sub: 'user-1', argsDigest: digestToolArgs({ amount: 10, to: 'acct-2' }) };

beforeEach(() => {
  process.env.GW_REQUEST_STATE_SECRET = 'unit-test-secret-0123456789';
  _resetRequestStateForTest();
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env.GW_REQUEST_STATE_SECRET;
  _resetRequestStateForTest();
});

describe('digestToolArgs', () => {
  it('ignores key order and undefined fields, and treats missing args as {}', () => {
    expect(digestToolArgs({ a: 1, b: { c: 2, d: 3 } })).toBe(digestToolArgs({ b: { d: 3, c: 2 }, a: 1, z: undefined }));
    expect(digestToolArgs(undefined)).toBe(digestToolArgs({}));
  });
  it('differs when a value differs', () => {
    expect(digestToolArgs({ amount: 10 })).not.toBe(digestToolArgs({ amount: 11 }));
    expect(digestToolArgs({ a: [1, 2] })).not.toBe(digestToolArgs({ a: [2, 1] }));
  });
});

describe('requestState', () => {
  it('redeems a token minted for exactly this tool, principal and arguments', () => {
    const t = mintRequestState(binding);
    expect(t.startsWith('gw1.')).toBe(true);
    expect(consumeRequestState(t, binding)).toBe(true);
  });

  it('is single use', () => {
    const t = mintRequestState(binding);
    expect(consumeRequestState(t, binding)).toBe(true);
    expect(consumeRequestState(t, binding)).toBe(false);
  });

  it('rejects another tool, another principal, or changed arguments — and leaves the token redeemable', () => {
    const t = mintRequestState(binding);
    expect(consumeRequestState(t, { ...binding, tool: 'other_tool' })).toBe(false);
    expect(consumeRequestState(t, { ...binding, sub: 'user-2' })).toBe(false);
    expect(consumeRequestState(t, { ...binding, argsDigest: digestToolArgs({ amount: 9999, to: 'acct-2' }) })).toBe(false);
    expect(consumeRequestState(t, binding)).toBe(true);
  });

  it('rejects a tampered payload or signature', () => {
    const [p, body, sig] = mintRequestState(binding).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, jti: 'x', tool: binding.tool, sub: binding.sub, ad: binding.argsDigest, exp: Date.now() + 1e9 })).toString('base64url');
    expect(consumeRequestState(`${p}.${forgedPayload}.${sig}`, binding)).toBe(false);
    expect(consumeRequestState(`${p}.${body}.${sig.slice(0, -2)}AA`, binding)).toBe(false);
    expect(consumeRequestState(`${p}.${body}.`, binding)).toBe(false);
  });

  it('rejects malformed input and a Legacy elicitation id', () => {
    for (const bad of ['', 'nope', 'a.b', 'gw1.x.y.z', 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6']) {
      expect(consumeRequestState(bad, binding)).toBe(false);
    }
    expect(consumeRequestState(undefined as unknown as string, binding)).toBe(false);
  });

  it('expires', () => {
    jest.useFakeTimers();
    const t = mintRequestState(binding, 1000);
    jest.advanceTimersByTime(1001);
    expect(consumeRequestState(t, binding)).toBe(false);
  });

  it('is not redeemable under a different secret (another deployment, or a restart without a configured secret)', () => {
    const t = mintRequestState(binding);
    process.env.GW_REQUEST_STATE_SECRET = 'a-completely-different-secret-value';
    _resetRequestStateForTest();
    expect(consumeRequestState(t, binding)).toBe(false);
  });

  it('works across replicas that share the configured secret', () => {
    const t = mintRequestState(binding);
    // A second process would start with an empty redeemed set but the same secret.
    _resetRequestStateForTest();
    expect(consumeRequestState(t, binding)).toBe(true);
  });

  it('falls back to a random per-process secret when none is configured', () => {
    delete process.env.GW_REQUEST_STATE_SECRET;
    _resetRequestStateForTest();
    const t = mintRequestState(binding);
    expect(consumeRequestState(t, binding)).toBe(true);
    const t2 = mintRequestState(binding);
    _resetRequestStateForTest(); // new random secret, as after a restart
    expect(consumeRequestState(t2, binding)).toBe(false);
  });
});
