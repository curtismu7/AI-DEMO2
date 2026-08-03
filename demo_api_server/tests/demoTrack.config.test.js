'use strict';
const { TRACK_STEPS, GAUNTLET_SIMS, getTrackDefinition } = require('../config/demoTrack');

describe('demoTrack config', () => {
  test('has 9 steps with unique ids in act order', () => {
    expect(TRACK_STEPS).toHaveLength(9);
    const ids = TRACK_STEPS.map(s => s.stepId);
    expect(new Set(ids).size).toBe(9);
    const acts = TRACK_STEPS.map(s => s.act);
    expect(acts).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 2]);
  });

  test('every step has slots with a valid source, match, and expected verdicts', () => {
    for (const step of TRACK_STEPS) {
      for (const key of ['green', 'red']) {
        const slot = step.slots[key];
        if (!slot) continue; // gauntlet step has no green slot
        expect(['tool', 'sim']).toContain(slot.source);
        if (slot.source === 'tool') expect(Array.isArray(slot.match.tools)).toBe(true);
        if (slot.source === 'sim') expect(Array.isArray(slot.match.sims)).toBe(true);
        expect(slot.expected.length).toBeGreaterThan(0);
      }
      expect(step.proved.sayThis).toBeTruthy();
    }
  });

  test('gauntlet has 6 sims and getTrackDefinition returns both', () => {
    expect(GAUNTLET_SIMS).toHaveLength(6);
    const def = getTrackDefinition();
    expect(def.steps).toHaveLength(9);
    expect(def.gauntletSims).toHaveLength(6);
  });
});
