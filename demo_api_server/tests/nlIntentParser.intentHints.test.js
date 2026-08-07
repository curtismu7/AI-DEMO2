'use strict';
const { parseHeuristic } = require('../services/nlIntentParser');

const mockTools = [
  {
    name: 'list_patient_records',
    // phrases that do NOT match any healthcare heuristic regex — fall through to intentHints
    intentHints: ['show immunization history', 'list my immunizations'],
  },
  {
    name: 'get_patient_record',
    intentHints: ['get my allergy list', 'show allergy profile'],
  },
];

const verticalCtx = {
  verticalId: 'healthcare',
  tools: mockTools,
};

describe('parseHeuristic intentHints fallback', () => {
  it('matches via intentHints when heuristic has no match', () => {
    // "show immunization history" matches no healthcare plugin heuristic, falls through to intentHints
    const result = parseHeuristic('show immunization history', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('list_patient_records');
    expect(result.source).toBe('intentHints');
  });

  it('matches partial phrase contained in intentHint', () => {
    // "get my allergy list" matches no healthcare plugin heuristic, falls through to intentHints
    const result = parseHeuristic('get my allergy list', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('get_patient_record');
  });

  it('does NOT use intentHints when heuristic already matched', () => {
    // "transfer money" triggers the high-confidence banking heuristic and exits before
    // intentHints runs, even when a hint phrase would match.
    const bankingCtxWithHint = {
      verticalId: 'banking',
      tools: [{ name: 'fake_tool', intentHints: ['transfer money'] }],
    };
    const result = parseHeuristic('transfer money', 'banking', bankingCtxWithHint);
    expect(result.source).toBeUndefined();
  });

  it('returns unknown when no intentHint matches', () => {
    const result = parseHeuristic('completely unrelated phrase xyz', 'healthcare', verticalCtx);
    expect(result.kind).not.toBe('healthcare');
  });
});
