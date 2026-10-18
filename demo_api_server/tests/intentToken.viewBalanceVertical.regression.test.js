'use strict';

/**
 * Regression: "show my balance" (the ID-JAG demo chip, /pingfederate-id-jag/demo)
 * was denied in every non-banking vertical:
 *   DENY intent_mismatch: tool "loyalty_balance" not permitted for intent "view_balance"
 *
 * The intent comes from nlIntentParser's banking-centric regex (view_balance) and
 * is vertical-blind, but the agent dispatches the ACTIVE vertical's own balance
 * tool. INTENT_TO_PERMITTED_TOOLS.view_balance grants banking tools only.
 *
 * TOOL_BY_VERTICAL is what the agent actually dispatched for "show my balance",
 * "what is my balance" and "check balance", measured 2026-10-17 against the live
 * reason service (POST :3006/api/agent/reason, provider llamacpp, each
 * vertical's own tool schemas + system prompt, two runs, identical results).
 * government is also the deterministic heuristic (\bbalance\b -> view_fees).
 *
 * Not listed, deliberately:
 *   airlines  -> get_loyalty_status, healthcare -> view_billing: neither tool is
 *     in that vertical's read-only list, so they are not granted here.
 *   manufacturing: no balance tool; the model declines.
 */

const { permittedToolsForIntent, mintIntentToken } = require('../services/intentTokenService');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const topology = require('../../scope-topology.json');

const TOOL_BY_VERTICAL = {
  banking: 'get_my_accounts',
  'sporting-goods': 'loyalty_balance',
  retail: 'rewards_balance',
  walbuy: 'rewards_balance',
  workforce: 'pto_balance',
  university: 'view_billing',
  investment: 'view_portfolio_value',
  government: 'view_fees',
};

describe('view_balance permits the vertical balance tool the agent dispatches', () => {
  test.each(Object.entries(TOOL_BY_VERTICAL))('%s -> %s', (vertical, tool) => {
    const { payload } = mintIntentToken({
      userId: 'u1', sessionId: 's1', prompt: 'show my balance', intent: 'view_balance', confidence: 0.9, vertical,
    });
    expect(payload.permitted_tools).toContain(tool);
  });

  test('government heuristic really dispatches view_fees for the chip', () => {
    const p = parseHeuristic('show my balance', 'government', resolveVerticalCtx('government'), {});
    expect(p.action).toBe('view_fees');
  });

  test('banking is unchanged', () => {
    expect(permittedToolsForIntent('view_balance', 'banking')).toEqual(['get_account_balance', 'get_my_accounts']);
  });

  test.each(Object.keys(TOOL_BY_VERTICAL).filter((v) => v !== 'banking'))(
    '%s grant is only its own non-sensitive reads',
    (vertical) => {
      const readOnly = permittedToolsForIntent('__unclassified__', vertical);
      for (const tool of permittedToolsForIntent('view_balance', vertical)) {
        expect(readOnly).toContain(tool);
        expect(topology.tools[tool].challengeType).toBeUndefined();
        expect(topology.tools[tool].a2aDelegated).toBeUndefined();
      }
    },
  );
});
