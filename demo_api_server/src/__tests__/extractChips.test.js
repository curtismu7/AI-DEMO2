// banking_api_server/scripts/__tests__/extractChips.test.js
'use strict';
const { heuristicChips, llmChips, allChips } = require('../../scripts/extractChips');
const manifest = require('../../config/verticals/banking/manifest.json');

const chips10 = (manifest.dashboard && manifest.dashboard.chips10) || [];

describe('extractChips (banking manifest chips10 → heuristic/llm partition)', () => {
  test('llmChips are exactly the manifest llm-mode chips; everything else is heuristic', () => {
    const llmIds = chips10.filter((c) => c.mode === 'llm').map((c) => c.id);
    expect(new Set(llmChips.map((c) => c.id))).toEqual(new Set(llmIds));
    // The partition is total and disjoint — the extractor adds no chips and drops none.
    expect(heuristicChips.length + llmChips.length).toBe(chips10.length);
    const heuristicIds = new Set(heuristicChips.map((c) => c.id));
    expect(llmIds.some((id) => heuristicIds.has(id))).toBe(false);
    // Banking always defines a full chip set. Analysis chips (unusual/afford) are
    // mode=both so Heuristics-only still answers; llmChips may be empty.
    expect(heuristicChips.length).toBeGreaterThanOrEqual(7);
    expect(llmChips.length).toBeGreaterThanOrEqual(0);
  });

  test('every chip carries id/label/message', () => {
    for (const c of allChips) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.message).toBe('string');
      expect(c.message.trim().length).toBeGreaterThan(0);
    }
  });

  test('allChips is the flat union, kind-tagged, no duplicate ids, no empty messages', () => {
    expect(allChips.length).toBe(heuristicChips.length + llmChips.length);
    const ids = allChips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allChips.filter((c) => c.kind === 'heuristic-builtin')).toHaveLength(heuristicChips.length);
    expect(allChips.filter((c) => c.kind === 'llm-builtin')).toHaveLength(llmChips.length);
    expect(allChips.every((c) => c.message.trim().length > 0)).toBe(true);
  });
});
