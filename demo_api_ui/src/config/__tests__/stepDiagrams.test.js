import { describe, it, expect } from 'vitest';
import { STEP_DIAGRAMS, stepDiagramFor, stepDiagramPath } from '../stepDiagrams';

// One diagram per demo step, opened from Mission Control (mock 1) and the
// explain modal (mock 2). The config is the registry: a step has a diagram or
// it doesn't; nothing renders a placeholder.
describe('stepDiagrams config', () => {
  it('exposes at least the four transfer-story diagrams (steps 2, 3, 4, 5)', () => {
    for (const n of [2, 3, 4, 5]) {
      expect(stepDiagramFor(n), `step ${n}`).toBeDefined();
    }
  });

  it('keys diagrams by presenter step number and carries title + path', () => {
    const d = stepDiagramFor(5);
    expect(d.title).toBe('PAR + RAR intent verified (PERMIT)');
    expect(d.path).toBe('/step-diagrams/5');
    expect(typeof d.render).toBe('function');
  });

  it('returns undefined for a step without a diagram (no placeholders)', () => {
    expect(stepDiagramFor(1)).toBeUndefined();
    expect(stepDiagramFor(999)).toBeUndefined();
  });

  it('builds the same path shape from stepDiagramPath', () => {
    expect(stepDiagramPath(5)).toBe('/step-diagrams/5');
    expect(stepDiagramPath(12)).toBe('/step-diagrams/12');
  });

  it('every registered path is unique and matches its step number', () => {
    const paths = STEP_DIAGRAMS.map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const d of STEP_DIAGRAMS) {
      expect(d.path).toBe(`/step-diagrams/${d.step}`);
    }
  });
});
