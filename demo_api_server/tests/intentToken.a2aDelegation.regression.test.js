'use strict';

/**
 * Regression: Demo steps UC2 / UC2.5 (A2A delegation) were denied by the A2A
 * gateway in every non-banking vertical (live, 2026-09-08):
 *
 *   [GW] Intent Token: valid=true intent=unknown confidence=0.3 not in permitted_tools
 *        tool=sensitive_membership_details
 *
 * /api/agent/invoke minted the intent token from the vertical-blind regex
 * extractor, which returns "unknown" for "show my sensitive membership
 * details" and "delegate this to a specialist". Unknown intents are limited
 * to the vertical's non-sensitive reads, so the specialist's tool was never
 * permitted. Banking only passed because get_portfolio_summary happens to be
 * in its read list.
 */

const { extractIntentAndConfidence } = require('../services/nlIntentParser');
const { permittedToolsForIntent, mintIntentToken, verifyIntentToken } = require('../services/intentTokenService');

describe('intent token for the A2A demo steps', () => {
  const PREV = process.env.INTENT_TOKEN_SECRET;
  beforeAll(() => { process.env.INTENT_TOKEN_SECRET = PREV || 'test-intent-secret-a2a'; });
  afterAll(() => { if (PREV === undefined) delete process.env.INTENT_TOKEN_SECRET; else process.env.INTENT_TOKEN_SECRET = PREV; });

  test('UC2 chip: the vertical-aware extractor names the sensitive read, the blind one stays unknown', () => {
    const prompt = 'show my sensitive membership details';
    expect(extractIntentAndConfidence(prompt).intent).toBe('unknown');
    expect(extractIntentAndConfidence(prompt, 'sporting-goods').intent).toBe('sensitive_membership_details');
  });

  test('UC2.5 chip: "delegate this to a specialist" mints delegate_to_specialist', () => {
    expect(extractIntentAndConfidence('delegate this to a specialist', 'sporting-goods').intent).toBe('delegate_to_specialist');
  });

  test('delegate_to_specialist permits exactly the vertical specialist tools', () => {
    expect(permittedToolsForIntent('delegate_to_specialist', 'sporting-goods')).toEqual(['sensitive_membership_details']);
    expect(permittedToolsForIntent('delegate_to_specialist', 'banking')).toContain('get_portfolio_summary');
  });

  test('a minted UC2 token carries the specialist tool in permitted_tools', () => {
    const prompt = 'show my sensitive membership details';
    const { intent, confidence } = extractIntentAndConfidence(prompt, 'sporting-goods');
    const { token } = mintIntentToken({ userId: 'u1', sessionId: 's1', prompt, intent, confidence, vertical: 'sporting-goods' });
    expect(verifyIntentToken(token).permitted_tools).toContain('sensitive_membership_details');
  });

  test('a prompt no heuristic matches still mints unknown', () => {
    expect(extractIntentAndConfidence('zzz qqq', 'sporting-goods').intent).toBe('unknown');
  });
});
