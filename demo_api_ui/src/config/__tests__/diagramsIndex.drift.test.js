import fs from 'node:fs';
import path from 'node:path';
import { DIAGRAMS_INDEX, DIAGRAMS_MORE } from '../diagramsIndex';

// The /diagrams page must link every route in the side nav's Diagrams group.
describe('diagramsIndex covers the Diagrams nav group', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../components/AdminSideNav.jsx'), 'utf8');
  const start = src.indexOf('label: "Diagrams",');
  const block = src.slice(start, src.indexOf('label: "Demo arch slides"', start));
  const navPaths = [...block.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '/diagrams');
  const indexed = new Set([...DIAGRAMS_INDEX.flatMap((s) => s.items), ...DIAGRAMS_MORE].map((d) => d.path));

  it('finds the Diagrams group', () => {
    expect(navPaths.length).toBeGreaterThan(15);
  });

  it('links every nav path', () => {
    expect(navPaths.filter((p) => !indexed.has(p))).toEqual([]);
  });
});
