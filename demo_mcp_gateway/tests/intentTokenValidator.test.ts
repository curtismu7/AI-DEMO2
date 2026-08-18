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
  const savedIntent = process.env.INTENT_TOKEN_SECRET;
  const savedSession = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.INTENT_TOKEN_SECRET = TEST_SECRET;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    if (savedIntent === undefined) delete process.env.INTENT_TOKEN_SECRET;
    else process.env.INTENT_TOKEN_SECRET = savedIntent;
    if (savedSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSession;
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

  // ── deploy-wiring regression coverage ──────────────────────────────────────
  // The Node gateway's env (demo_mcp_gateway/.env, written by
  // refresh-service-envs.js) failed to carry INTENT_TOKEN_SECRET/SESSION_SECRET,
  // so getSigningKey() threw and every gw_audit_trail reported
  // IntentTokenValid='false' / IntentTokenError='no_signing_key'. These cases pin
  // the three outcomes that fix (env now supplies the BFF's key) turns on.

  test('returns no_signing_key when neither secret is configured (pre-fix symptom)', () => {
    delete process.env.INTENT_TOKEN_SECRET;
    delete process.env.SESSION_SECRET;
    const token = makeToken(VALID_PAYLOAD);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('no_signing_key');
  });

  test('verifies a token minted under the SESSION_SECRET fallback', () => {
    // setup-env.sh writes only SESSION_SECRET, and the BFF signs with it — so the
    // gateway must verify with that same fallback once the env supplies it.
    delete process.env.INTENT_TOKEN_SECRET;
    process.env.SESSION_SECRET = TEST_SECRET;
    const token = makeToken(VALID_PAYLOAD, TEST_SECRET);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(true);
    expect(result.toolPermitted).toBe(true);
  });

  test('rejects a token signed with a different key as invalid_signature', () => {
    // Guards against the gateway secret drifting from the BFF's: a valid-looking
    // token signed with the wrong key must fail closed, never verify.
    const token = makeToken(VALID_PAYLOAD, 'some-other-secret-that-is-not-the-real-one!!');
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });
});
