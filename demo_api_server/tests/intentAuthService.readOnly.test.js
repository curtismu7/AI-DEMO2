'use strict';

/**
 * Drift guard: every vertical's UC1 primary read intent must be consent-free.
 *
 * The read-only allowlist in intentAuthService was hand-maintained and went
 * stale when government/university/manufacturing/investment shipped — their
 * UC1 read chips fell through to the conservative-consent fallback, so
 * /api/agent/invoke answered 428 and the UI rendered "That step couldn't be
 * completed." Deriving the expectation from useCases keeps a new vertical from
 * repeating it.
 */

jest.mock('../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../services/appEventService', () => ({ logEvent: () => {} }));
jest.mock('../services/intentRiskScorer', () => ({
  evaluateRiskAndAuthority: async () => ({ riskScore: 0.7, authorityScore: undefined }),
}));

const { evaluateIntentAuthorization } = require('../services/intentAuthService');
const {
  READ_PRIMARY_TOOL_BY_VERTICAL,
  A2A_PRIMARY_TOOL_BY_VERTICAL,
} = require('../config/useCases');

// 0.85 is what the heuristic parser emits for a UC1/UC2 chip, and it is NOT
// > 0.85, so the three-dimension permit branch can never carry these — without
// the read-only allowlist they all land on the conservative-consent fallback.
const CHIP_CONFIDENCE = 0.85;

async function decide(intent) {
  return evaluateIntentAuthorization({
    intent,
    confidence: CHIP_CONFIDENCE,
    toolName: intent,
    userId: 'test-user',
  });
}

describe('intentAuthService — UC1 read intents never require HITL consent', () => {
  const cases = [['banking', 'view_balance'], ...Object.entries(READ_PRIMARY_TOOL_BY_VERTICAL)];

  test.each(cases)('%s: %s is permitted without consent', async (vertical, intent) => {
    const decision = await decide(intent);
    expect(decision.authorized).toBe(true);
    expect(decision.requires_consent).toBe(false);
  });
});

describe('intentAuthService — UC2 sensitive reads defer consent to the downstream gate', () => {
  // Consent for these is owned by the tool's own `authz: { consent: true }` and
  // by the PingOne Authorize decision, both of which return a renderable
  // hitl_required moment. A bare 428 here pre-empts them and dead-ends the chip.
  test.each(Object.entries(A2A_PRIMARY_TOOL_BY_VERTICAL))(
    '%s: %s is not consent-gated by intentAuthService',
    async (vertical, intent) => {
      const decision = await decide(intent);
      expect(decision.authorized).toBe(true);
      expect(decision.requires_consent).toBe(false);
    },
  );
});
