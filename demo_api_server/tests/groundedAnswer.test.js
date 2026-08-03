'use strict';

/**
 * Option C — grounded answers.
 *
 * The invariant under test: a rendered claim must trace to a tool call in the
 * ACTIVE vertical. A claim that cannot be attributed is dropped, never shown.
 * These tests exist to make the drop provable, because the failure they guard
 * against (plausible text with no grounded call) is invisible by inspection.
 */

const { buildGroundedAnswer } = require('../services/groundedAnswer');

/** Tool results arrive from runReasonLoop as { name, result } with result a JSON string. */
const balanceResult = {
  name: 'get_account_balance',
  result: JSON.stringify({ accountId: 'acct-4021', balance: 1234.5, currency: 'USD' }),
};

const txnResult = {
  name: 'list_transactions',
  result: JSON.stringify({
    transactions: [
      { id: 't1', amount: 42.75, merchant: 'Blue Bottle' },
      { id: 't2', amount: 310.0, merchant: 'Rent' },
      { id: 't3', amount: 9.99, merchant: 'Spotify' },
    ],
  }),
};

const inVertical = ['get_account_balance', 'list_transactions'];

describe('buildGroundedAnswer — attribution', () => {
  test('keeps a claim whose value came from a tool result, naming tool and scope', () => {
    const out = buildGroundedAnswer('Your checking balance is $1,234.50.', [balanceResult], {
      verticalToolNames: inVertical,
    });

    expect(out.grounded).toBe(true);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].text).toBe('Your checking balance is $1,234.50.');
    expect(out.claims[0].sources).toEqual([{ tool: 'get_account_balance', scope: 'read' }]);
  });

  test('grounds a count against an array length, not against a coincidental nested id', () => {
    const out = buildGroundedAnswer('You have 3 recent transactions.', [txnResult], {
      verticalToolNames: inVertical,
    });

    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].sources[0].tool).toBe('list_transactions');
  });

  test('a single-digit value that is only a nested field, never a count, does not ground', () => {
    // `9.99` is a real amount, but the bare token `9` is not a count of anything.
    const out = buildGroundedAnswer('You have 9 accounts open.', [txnResult], {
      verticalToolNames: inVertical,
    });

    expect(out.grounded).toBe(false);
    expect(out.claims).toHaveLength(0);
  });

  test('reports no scope rather than a fabricated one for a tool absent from the topology', () => {
    // scopeTopology.toolScopes() returns ['read'] for ANY unknown name. Showing
    // that would be a fabricated citation, which is worse than showing none.
    const out = buildGroundedAnswer('The widget count is 8817.', [
      { name: 'not_a_real_tool', result: JSON.stringify({ widgets: 8817 }) },
    ], { verticalToolNames: ['not_a_real_tool'] });

    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].sources).toEqual([{ tool: 'not_a_real_tool', scope: null }]);
  });
});

describe('buildGroundedAnswer — the drop (the deliverable that matters)', () => {
  test('DROPS a claim carrying a value no tool returned', () => {
    const reply = 'Your checking balance is $1,234.50. Your savings balance is $88,000.00.';
    const out = buildGroundedAnswer(reply, [balanceResult], { verticalToolNames: inVertical });

    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].text).toBe('Your checking balance is $1,234.50.');
    expect(out.droppedCount).toBe(1);
    expect(out.droppedReasons.unattributable_value).toBe(1);
  });

  test('the dropped text is absent from the entire result — it cannot leak to a renderer', () => {
    const reply = 'Your checking balance is $1,234.50. Your savings balance is $88,000.00.';
    const out = buildGroundedAnswer(reply, [balanceResult], { verticalToolNames: inVertical });

    expect(JSON.stringify(out)).not.toContain('88,000');
    expect(JSON.stringify(out)).not.toContain('savings');
  });

  test('DROPS qualitative prose that carries no verifiable value', () => {
    const out = buildGroundedAnswer('Your account is in excellent standing.', [balanceResult], {
      verticalToolNames: inVertical,
    });

    expect(out.grounded).toBe(false);
    expect(out.claims).toHaveLength(0);
    expect(out.droppedReasons.no_verifiable_value).toBe(1);
  });

  test('DROPS a claim grounded only by a tool outside the active vertical', () => {
    const foreign = { name: 'get_patient_record', result: JSON.stringify({ mrn: 'MRN-77301' }) };
    const out = buildGroundedAnswer('Patient record MRN-77301 is on file.', [balanceResult, foreign], {
      verticalToolNames: inVertical, // healthcare tool deliberately not listed
    });

    expect(out.grounded).toBe(false);
    expect(out.claims).toHaveLength(0);
  });

  test('DROPS every claim when no tool ran at all', () => {
    const out = buildGroundedAnswer('Your checking balance is $1,234.50.', [], {
      verticalToolNames: inVertical,
    });

    expect(out.grounded).toBe(false);
    expect(out.claims).toHaveLength(0);
  });

  test('a claim is kept only when EVERY value in it grounds, not merely one', () => {
    // The balance grounds; the interest rate does not. Partial credit would let
    // a fabricated number ride along inside an otherwise-true sentence.
    const out = buildGroundedAnswer(
      'Your balance is $1,234.50 earning 4.85% APY.',
      [balanceResult],
      { verticalToolNames: inVertical },
    );

    expect(out.claims).toHaveLength(0);
    expect(out.droppedReasons.unattributable_value).toBe(1);
  });
});

describe('buildGroundedAnswer — degrade signal', () => {
  test('grounded:false is the caller signal to render the Option A no-match card', () => {
    const out = buildGroundedAnswer('I think you have plenty of money.', [balanceResult], {
      verticalToolNames: inVertical,
    });

    expect(out.grounded).toBe(false);
    expect(out.claims).toEqual([]);
  });

  test('an empty or missing reply degrades rather than throwing', () => {
    expect(buildGroundedAnswer('', [balanceResult], { verticalToolNames: inVertical }).grounded).toBe(false);
    expect(buildGroundedAnswer(null, null, {}).grounded).toBe(false);
  });

  test('a malformed (non-JSON) tool result is skipped, not treated as grounding', () => {
    const out = buildGroundedAnswer('Your balance is $1,234.50.', [
      { name: 'get_account_balance', result: '<html>gateway error</html>' },
    ], { verticalToolNames: inVertical });

    expect(out.grounded).toBe(false);
  });

  test('splits multi-line replies so one bad bullet does not poison the good ones', () => {
    const reply = ['- Coffee: $42.75', '- Rent: $310.00', '- Yacht: $95,000.00'].join('\n');
    const out = buildGroundedAnswer(reply, [txnResult], { verticalToolNames: inVertical });

    expect(out.claims.map((c) => c.text)).toEqual(['- Coffee: $42.75', '- Rent: $310.00']);
    expect(out.droppedCount).toBe(1);
  });
});
