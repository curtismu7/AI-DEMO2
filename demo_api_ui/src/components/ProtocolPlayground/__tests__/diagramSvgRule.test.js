import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, test, expect } from 'vitest';

// A max-width on `svg` inside the diagram wrapper squashes React Flow's edge layer (an absolutely
// positioned svg in a zero-width parent) to width 0, and the browser then paints no arrows at all.
describe('Protocol Playground diagram CSS', () => {
  test('does not size the svg elements inside the React Flow canvas', () => {
    const css = readFileSync(join(__dirname, '..', 'ProtocolPlayground.css'), 'utf8');
    expect(css).not.toMatch(/\.pp-mermaid__canvas\s+svg\b/);
  });
});
