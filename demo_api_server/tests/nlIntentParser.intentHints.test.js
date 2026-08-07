'use strict';
const { parseHeuristic } = require('../services/nlIntentParser');

const mockTools = [
  {
    name: 'list_patient_records',
    intentHints: ['show my health records', 'list my patient records', 'what are my medical records'],
  },
  {
    name: 'get_patient_record',
    intentHints: ['show my health record', 'get patient record details', 'view my insurance coverage'],
  },
];

const verticalCtx = {
  verticalId: 'healthcare',
  tools: mockTools,
};

describe('parseHeuristic intentHints fallback', () => {
  it('matches "show my health records" via intentHints when heuristic is unknown', () => {
    const result = parseHeuristic('show my health records', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('list_patient_records');
    expect(result.source).toBe('intentHints');
  });

  it('matches partial phrase contained in intentHint', () => {
    const result = parseHeuristic('view my insurance coverage', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('get_patient_record');
  });

  it('does NOT use intentHints when heuristic already matched', () => {
    // "transfer" is a high-confidence banking heuristic — should NOT fall through to intentHints
    const result = parseHeuristic('transfer money', 'banking', { verticalId: 'banking', tools: mockTools });
    expect(result.source).toBeUndefined();
  });

  it('returns unknown when no intentHint matches', () => {
    const result = parseHeuristic('completely unrelated phrase xyz', 'healthcare', verticalCtx);
    expect(result.kind).not.toBe('healthcare');
  });
});
