'use strict';

process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';

const {
  mintIntentToken,
  verifyIntentToken,
  permittedToolsForIntent,
} = require('../../services/intentTokenService');

const BASE_PARAMS = {
  userId: 'user-abc',
  sessionId: 'sess-123',
  prompt: 'transfer $100 to alice',
  intent: 'transfer',
  confidence: 0.95,
  vertical: 'banking',
};

describe('mintIntentToken', () => {
  test('returns a 3-part JWT string', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    expect(token.split('.').length).toBe(3);
  });

  test('payload contains expected fields', () => {
    const { payload } = mintIntentToken(BASE_PARAMS);
    expect(payload.intent).toBe('transfer');
    expect(payload.sub).toBe('user-abc');
    expect(payload.sid).toBe('sess-123');
    expect(payload.permitted_tools).toContain('create_transfer');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.prompt_hash).toBe('string');
    expect(payload.prompt_hash.length).toBe(64);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('unknown intent falls back to read-only tools', () => {
    const { payload } = mintIntentToken({ ...BASE_PARAMS, intent: 'unknown' });
    expect(payload.permitted_tools).toContain('get_my_accounts');
    expect(payload.permitted_tools).not.toContain('create_transfer');
  });

  test('A&F checkout permits checkout and A&F order reads', () => {
    const { payload } = mintIntentToken({
      ...BASE_PARAMS,
      prompt: 'checkout A&F outerwear for $2500',
      intent: 'checkout',
      vertical: 'abercrombie-fitch',
    });
    expect(payload.permitted_tools).toEqual(
      expect.arrayContaining(['checkout', 'list_anf_orders']),
    );
  });

  test.each(['view_wishlist', 'view_returns'])(
    'A&F %s fallback permits its matching read tool',
    (intent) => {
      const { payload } = mintIntentToken({
        ...BASE_PARAMS,
        prompt: `A&F ${intent}`,
        intent,
        vertical: 'abercrombie-fitch',
      });
      expect(payload.permitted_tools).toContain(intent);
    },
  );
});

describe('verifyIntentToken', () => {
  test('round-trips correctly', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    const payload = verifyIntentToken(token);
    expect(payload.intent).toBe('transfer');
    expect(payload.sub).toBe('user-abc');
  });

  test('rejects tampered payload', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    const [h, b, s] = token.split('.');
    const original = JSON.parse(Buffer.from(b, 'base64url').toString());
    const tampered = Buffer.from(
      JSON.stringify({ ...original, intent: 'withdraw' })
    ).toString('base64url');
    expect(() => verifyIntentToken(`${h}.${tampered}.${s}`)).toThrow('intent token signature invalid');
  });

  test('rejects wrong number of parts', () => {
    expect(() => verifyIntentToken('aaa.bbb')).toThrow('malformed intent token');
  });

  test('rejects expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredPayload = { ...mintIntentToken(BASE_PARAMS).payload, iat: now - 400, exp: now - 100 };
    const crypto = require('node:crypto');
    const key = process.env.SESSION_SECRET;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');
    const expiredToken = `${header}.${body}.${sig}`;
    expect(() => verifyIntentToken(expiredToken)).toThrow('intent token expired');
  });

  test('rejects wrong signing key', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    process.env.SESSION_SECRET = 'different-key-will-fail-verification!!';
    expect(() => verifyIntentToken(token)).toThrow('intent token signature invalid');
    process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';
  });
});

describe('permittedToolsForIntent', () => {
  test('transfer includes create_transfer', () => {
    expect(permittedToolsForIntent('transfer')).toContain('create_transfer');
  });

  test('view_balance does not include create_transfer', () => {
    expect(permittedToolsForIntent('view_balance')).not.toContain('create_transfer');
  });

  test('admin transaction intent permits only the admin transaction tool', () => {
    expect(permittedToolsForIntent('view_transactions', 'admin')).toEqual([
      'get_customer_transactions',
    ]);
  });

  test('banking transaction intent keeps customer-scoped tools', () => {
    expect(permittedToolsForIntent('view_transactions', 'banking')).toEqual([
      'get_my_transactions',
      'get_my_accounts',
    ]);
  });
});
