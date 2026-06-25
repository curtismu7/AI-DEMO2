'use strict';

// Guard for F2: a conversational LLM can return a whitespace-only answer that is
// truthy (so it passes the `if (answer)` checks) but renders as a BLANK agent
// bubble in the chip UI. ensureRenderableAnswer substitutes a friendly fallback.
const { __test } = require('../../services/geminiNlIntent');
const { ensureRenderableAnswer } = __test;

describe('ensureRenderableAnswer (F2 empty-bubble guard)', () => {
  const EDU = (message) => ({ kind: 'education', education: { panel: 'general-knowledge' }, message });

  it('substitutes a fallback for an empty education message', () => {
    const out = ensureRenderableAnswer(EDU(''));
    expect(out.kind).toBe('education');
    expect(out.message.trim().length).toBeGreaterThan(0);
  });

  it('substitutes a fallback for a whitespace-only education message', () => {
    const out = ensureRenderableAnswer(EDU('   \n\t '));
    expect(out.message.trim().length).toBeGreaterThan(0);
  });

  it('substitutes a fallback when message is missing entirely', () => {
    const out = ensureRenderableAnswer({ kind: 'education', education: { panel: 'general-knowledge' } });
    expect(typeof out.message).toBe('string');
    expect(out.message.trim().length).toBeGreaterThan(0);
  });

  it('passes a non-empty education answer through unchanged', () => {
    const real = EDU('Here is a real, helpful answer.');
    expect(ensureRenderableAnswer(real)).toBe(real);
  });

  it('never touches actionable (non-education) results', () => {
    const banking = { kind: 'banking', banking: { action: 'balance' } };
    expect(ensureRenderableAnswer(banking)).toBe(banking);
    const vertical = { kind: 'vertical', vertical: 'retail', action: 'web_search' };
    expect(ensureRenderableAnswer(vertical)).toBe(vertical);
  });

  it('returns null untouched (caller falls back to heuristic)', () => {
    expect(ensureRenderableAnswer(null)).toBeNull();
  });
});
