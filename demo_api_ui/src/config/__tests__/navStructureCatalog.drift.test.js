import fs from 'node:fs';
import path from 'node:path';
import { NAV_STRUCTURE_CATALOG } from '../navStructureCatalog';

// NAV_STRUCTURE_CATALOG is a hand-maintained mirror of allNavItems in
// AdminSideNav.jsx. DemoConfigPage builds its show/hide + reorder picker from
// the catalog, so anything the catalog is missing can never be hidden or
// reordered, and a stale label silently fails to match on reorder. It drifted
// badly once (2 whole groups + ~30 children); this test is the gate.
function parseLiveNav() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/AdminSideNav.jsx'),
    'utf8',
  );
  const start = src.indexOf('const allNavItems = [');
  if (start === -1) throw new Error('allNavItems not found in AdminSideNav.jsx');
  const open = src.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = src.slice(open, end + 1);

  return block
    .split(/\n(?=    \{)/)
    .map((entry) => {
      const labels = [...entry.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
      if (labels.length === 0) return null;
      return entry.includes('children:')
        ? { label: labels[0], children: labels.slice(1) }
        : { label: labels[0] };
    })
    .filter(Boolean);
}

describe('NAV_STRUCTURE_CATALOG mirrors AdminSideNav allNavItems', () => {
  const live = parseLiveNav();

  it('parses a plausible live nav (guards the parser itself)', () => {
    expect(live.length).toBeGreaterThan(20);
    expect(live.map((g) => g.label)).toContain('Home');
  });

  it('has exactly the same top-level groups, in the same order', () => {
    expect(NAV_STRUCTURE_CATALOG.map((g) => g.label)).toEqual(live.map((g) => g.label));
  });

  it('has exactly the same children for every group', () => {
    for (const liveGroup of live) {
      const catGroup = NAV_STRUCTURE_CATALOG.find((g) => g.label === liveGroup.label);
      expect(catGroup, `catalog is missing group "${liveGroup.label}"`).toBeDefined();
      expect(catGroup.children ?? null, `children drift in "${liveGroup.label}"`)
        .toEqual(liveGroup.children ?? null);
    }
  });
});
