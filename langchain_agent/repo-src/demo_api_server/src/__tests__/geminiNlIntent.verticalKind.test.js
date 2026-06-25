jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(() => ({ kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} })),
  EDU: {},
  resolveVerticalRouting: jest.fn(() => ({ verticalId: 'healthcare', verticalCtx: null })),
}));
jest.mock('../../services/nlIntentSanitize', () => ({
  sanitizeNlResult: jest.fn((r) => ({ result: r, rejected: false }))
}));
jest.mock('../../services/configStore', () => ({
  get: () => null,
  getEffective: (k) => (k === 'ff_heuristic_enabled' ? 'true' : null)
}));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: { resolver: { activeId: () => 'healthcare' } }
}));

const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

describe('geminiNlIntent.verticalKind', () => {
  it('passes a kind:vertical heuristic straight through as source:heuristic', async () => {
    const r = await parseNaturalLanguage('check my coverage', {}, 'auto', {});
    expect(r.source).toBe('heuristic');
    expect(r.result).toEqual({ kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} });
  });
});
