'use strict';

/**
 * UC48 — Consumer agent booking (airlines-only). Gates the full wiring chain:
 * the chip routes, the tool is amount-gated (HITL band), the intent token
 * permits the tool, and the entry is invisible to every other vertical.
 */

const { USE_CASES, VERTICALS, listUseCases, resolveUseCase } = require('../config/useCases');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { WRITE_TOOL_TYPE_MAP } = require('../services/mcpToolAuthorizationService');
const { mintIntentToken, INTENT_TO_PERMITTED_TOOLS } = require('../services/intentTokenService');

const CHIP = 'book a flight from San Francisco to Paris for me under $800';

function claimsFor({ intent, vertical }) {
  const { token } = mintIntentToken({
    userId: 'u1', sessionId: 's1', prompt: CHIP, intent, confidence: 0.9, vertical,
  });
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('UC48 consumer-agent-booking', () => {
  test('exists in the catalog and is airlines-only', () => {
    const uc = USE_CASES.find((u) => u.id === 'UC48');
    expect(uc).toBeDefined();
    expect(uc.useCaseId).toBe('consumer-agent-booking');
    expect(uc.verticals).toEqual(['airlines']);
  });

  test('airlines resolves the chip trigger; other verticals keep the link', () => {
    const airlines = resolveUseCase('UC48', 'airlines');
    expect(airlines.trigger.type).toBe('chip');
    expect(airlines.trigger.text).toBe(CHIP);
    expect(airlines.primaryTool).toBe('book_airline_flight');
    expect(airlines.expectedOutcome).toBe('HITL_REQUIRED');

    for (const v of VERTICALS.filter((x) => x !== 'airlines')) {
      expect(listUseCases(v).find((u) => u.id === 'UC48')).toBeUndefined();
    }
  });

  test('the chip routes through the airlines heuristics with the scenario amount', () => {
    const r = parseHeuristic(CHIP, 'airlines', resolveVerticalCtx('airlines'), {});
    const action = r && (r.banking?.action ?? r.action);
    expect(action).toBe('book_airline_flight');
    // $346 — the HITL consent band (>= $250, < $500 step-up). "under $800" must
    // NOT be extracted as the amount.
    expect(r.banking?.params ?? r.params).toMatchObject({ amount: 346 });
  });

  test('the tool is in WRITE_TOOL_TYPE_MAP — the amount policy fires', () => {
    expect(WRITE_TOOL_TYPE_MAP.book_airline_flight).toBe('transfer');
  });

  test('the minted intent token permits the booking tool', () => {
    expect(INTENT_TO_PERMITTED_TOOLS.book_airline_flight).toBeDefined();
    const permitted = claimsFor({ intent: 'book_airline_flight', vertical: 'airlines' }).permitted_tools;
    expect(permitted).toContain('book_airline_flight');
    // The read-back: "show my reservations" after booking must also be permitted.
    expect(permitted).toContain('get_airline_bookings');
  });
});
