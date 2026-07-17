'use strict';

const workforceCtx = {
  terminology: { account: 'benefits' },
  chips: [{ label: 'My benefits', message: 'my benefits' }],
};

jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(() => ({ kind: 'vertical', vertical: 'workforce', action: 'view_benefits', params: {} })),
  EDU: {},
  resolveVerticalRouting: jest.fn(() => ({ verticalId: 'workforce', verticalCtx: workforceCtx })),
}));

jest.mock('../../services/nlIntentSanitize', () => ({
  sanitizeNlResult: jest.fn((r) => ({ result: r, rejected: false })),
}));

jest.mock('../../services/configStore', () => ({
  get: () => null,
  getEffective: (k) => (k === 'ff_heuristic_enabled' ? 'true' : null),
}));

const { parseHeuristic, resolveVerticalRouting } = require('../../services/nlIntentParser');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

describe('parseNaturalLanguage — request vertical overrides global active', () => {
  it('routes heuristics with workforce when context.vertical is workforce', async () => {
    await parseNaturalLanguage('my benefits', { vertical: 'workforce' }, 'heuristic', {});

    // resolveVerticalRouting now also takes req (session-vertical fallback,
    // fix/session-vertical-heuristics) — this call site's context carries no
    // req, so the second arg is null.
    expect(resolveVerticalRouting).toHaveBeenCalledWith('workforce', null);
    expect(parseHeuristic).toHaveBeenCalledWith(
      'my benefits',
      'workforce',
      workforceCtx,
      { isAdmin: false, heuristicsOnly: true },
    );
  });
});
