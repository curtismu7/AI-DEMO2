'use strict';
const a2aOverlay = require('../config/verticals/a2a/index');

describe('a2a overlay mismatch heuristic', () => {
  it('matches the mismatch-probe trigger phrase', () => {
    const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
    expect(mismatchHeuristic).toBeTruthy();
    expect(mismatchHeuristic.action).toBe('a2a_generalist_mismatch');
    expect(mismatchHeuristic.re.test('simulate an agent identity mismatch')).toBe(true);
  });

  it('does not match the plain delegate phrase', () => {
    const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
    expect(mismatchHeuristic.re.test('hand off to a specialist')).toBe(false);
  });

  it('exposes the mismatch tool', () => {
    const tools = a2aOverlay.getTools();
    expect(tools.some((t) => t.name === 'a2a_generalist_mismatch')).toBe(true);
  });
});
