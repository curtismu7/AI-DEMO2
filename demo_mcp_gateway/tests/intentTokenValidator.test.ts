import * as crypto from 'node:crypto';
import { validateIntentToken } from '../src/intentTokenValidator';

const TEST_SECRET = 'gateway-test-secret-at-least-32-chars!!';

function makeToken(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const VALID_PAYLOAD = {
  jti: 'test-jti-1',
  iss: 'bff:intent-token',
  sub: 'user-123',
  sid: 'sess-abc',
  iat: Math.floor(Date.now() / 1000) - 10,
  exp: Math.floor(Date.now() / 1000) + 290,
  prompt_hash: 'abc123',
  intent: 'transfer',
  confidence: 0.95,
  permitted_tools: ['create_transfer', 'get_my_accounts'],
  vertical: 'banking',
};

describe('validateIntentToken', () => {
  beforeEach(() => {
    process.env.INTENT_TOKEN_SECRET = TEST_SECRET;
  });

  test('returns valid=true and toolPermitted=true when tool is in permitted_tools', () => {
    const token = makeToken(VALID_PAYLOAD);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(true);
    expect(result.toolPermitted).toBe(true);
    expect(result.payload?.intent).toBe('transfer');
  });

  test('returns valid=true but toolPermitted=false when tool not in permitted_tools', () => {
    const token = makeToken(VALID_PAYLOAD);
    const result = validateIntentToken(token, 'create_withdrawal');
    expect(result.valid).toBe(true);
    expect(result.toolPermitted).toBe(false);
  });

  test('returns valid=false when token is absent', () => {
    const result = validateIntentToken(undefined, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('no_intent_token');
  });

  test('returns valid=false for tampered payload', () => {
    const token = makeToken(VALID_PAYLOAD);
    const [h, b, s] = token.split('.');
    const original = JSON.parse(Buffer.from(b, 'base64url').toString());
    const tampered = Buffer.from(JSON.stringify({ ...original, intent: 'withdraw' })).toString('base64url');
    const result = validateIntentToken(`${h}.${tampered}.${s}`, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });

  test('returns valid=false for expired token', () => {
    const expiredPayload = { ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 5 };
    const token = makeToken(expiredPayload);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  test('returns valid=false for malformed token (wrong part count)', () => {
    const result = validateIntentToken('not.a.valid.jwt.parts', 'create_transfer');
    expect(result.valid).toBe(false);
  });
});
