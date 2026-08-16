'use strict';

/**
 * Regression: POST /api/agent/run must mint an Intent Token when
 * ff_intent_token_enabled is on (the default).
 *
 * agentRun.js used to destructure `extractIntentFromPrompt` from
 * nlIntentParser — that name is a local helper in agentInvokeRoute.js and is
 * NOT exported. The call threw TypeError, the try/catch marked it non-fatal,
 * and the AG-UI Token Chain never showed an Intent Token step. Gateway
 * enforcement (when INTENT_TOKEN_REQUIRED) also saw no binding on this path.
 */

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'ff_intent_token_enabled') return 'true';
    return undefined;
  }),
}));

describe('agentRun Intent Token mint — uses the exported extractor', () => {
  const PREV_SECRET = process.env.SESSION_SECRET;
  const PREV_INTENT = process.env.INTENT_TOKEN_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-for-intent-mint';
    process.env.INTENT_TOKEN_SECRET = process.env.INTENT_TOKEN_SECRET || 'test-intent-secret-for-mint';
  });

  afterAll(() => {
    if (PREV_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = PREV_SECRET;
    if (PREV_INTENT === undefined) delete process.env.INTENT_TOKEN_SECRET;
    else process.env.INTENT_TOKEN_SECRET = PREV_INTENT;
  });

  test('nlIntentParser does not export extractIntentFromPrompt (the trap this bug hit)', () => {
    const parser = require('../services/nlIntentParser');
    expect(parser.extractIntentFromPrompt).toBeUndefined();
    expect(typeof parser.extractIntentAndConfidence).toBe('function');
  });

  test('the extractor agentRun must call resolves transfer intents', () => {
    const { extractIntentAndConfidence } = require('../services/nlIntentParser');
    const out = extractIntentAndConfidence('Transfer $100 from checking to savings');
    expect(out.intent).toBe('transfer');
    expect(out.confidence).toBeGreaterThan(0.5);
  });

  test('minting with that extractor produces a session-storable Intent Token', () => {
    const { extractIntentAndConfidence } = require('../services/nlIntentParser');
    const { mintIntentToken } = require('../services/intentTokenService');
    const prompt = 'show my balance';
    const { intent, confidence } = extractIntentAndConfidence(prompt);
    const { token } = mintIntentToken({
      userId: 'user-1',
      sessionId: 'sess-1',
      prompt,
      intent,
      confidence,
      vertical: 'banking',
    });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  test('agentRun source calls extractIntentAndConfidence, not the missing export', () => {
    // Source canary for this specific defect class: importing a name that is
    // not on module.exports. A behavioral HTTP test of /run would re-mock half
    // the stack; the one-line contract that broke is the require+call pair.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../routes/agentRun.js'), 'utf8');
    expect(src).toMatch(/extractIntentAndConfidence\s*\(\s*prompt\s*\)/);
    expect(src).not.toMatch(/extractIntentFromPrompt\s*\(\s*prompt\s*\)/);
  });
});
