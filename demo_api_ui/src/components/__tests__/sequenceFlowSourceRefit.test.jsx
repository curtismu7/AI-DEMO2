import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// The Protocol Playground swaps the diagram's source when the user picks another
// protocol; the canvas element never resizes, so the ResizeObserver refit in
// useFitOnResize never fires and the previous protocol's viewport clips the new
// drawing (observed live: the 3-participant CIBA-PF default rendered at the
// 2-participant viewport's ~2x zoom, third participant off-canvas). The refit
// must be wired to the source. This file pins that the wiring exists; the
// behavior itself is unit-pinned in hooks/__tests__/useFitOnSource.test.jsx.
describe('SequenceFlowDiagram refits when its source changes', () => {
  test('the component wires useFitOnSource', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'SequenceFlowDiagram.jsx'), 'utf8');
    expect(src).toMatch(/useFitOnSource\(/);
  });
});
