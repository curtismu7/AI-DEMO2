import fs from 'node:fs';
import path from 'node:path';
import { NAV_STRUCTURE_CATALOG } from '../navStructureCatalog';
import { NAV_ITEM_CATALOG } from '../navItemsCatalog';

// NAV_STRUCTURE_CATALOG is the presentation contract for the composed
// allNavItems in AdminSideNav.jsx. DemoConfigPage builds its show/hide +
// reorder picker from the catalog, so anything the catalog is missing can
// never be hidden or reordered.
function readSideNavSource() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/AdminSideNav.jsx'),
    'utf8',
  );
  return src;
}

describe('NAV_STRUCTURE_CATALOG covers composed AdminSideNav groups', () => {
  const source = readSideNavSource();

  it('keeps the composed allNavItems registry', () => {
    expect(source).toContain('const legacyNavItems = [');
    expect(source).toContain('const allNavItems = [');
  });

  it('contains the product groups and renamed product vocabulary', () => {
    expect(NAV_STRUCTURE_CATALOG.map((g) => g.label)).toEqual([
      'Home', 'Security Dashboard', 'Skin Studio', 'AI Gateway', 'DaVinci', 'PingOne Products',
      'Identity Journeys', 'Authorize', 'Delegation & Consent', 'Utilities',
      'AI Experiences', 'MCP & Integrations', 'PingFederate ID-JAG', 'Developer Tools',
      'Observability', 'Architecture & Learning', 'Administration',
    ]);
    expect(source).toContain('productGroup("AI Gateway"');
    expect(source).toContain('productGroup("DaVinci"');
    expect(source).not.toContain('productGroup("Privilege');
  });

  it('keeps every catalog group usable by the Demo Config picker', () => {
    for (const group of NAV_STRUCTURE_CATALOG) {
      expect(group.label).toEqual(expect.any(String));
      if (group.children) expect(group.children.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The OTHER catalog, and the other direction.
 *
 * NAV_ITEM_CATALOG (config/navItemsCatalog.js) is the flat top-level list the
 * Demo Config picker and the built-in preset seeds use. Its own sync test in
 * components/__tests__/adminSideNav.test.jsx asserts that every catalog label
 * RENDERS in the nav — which stays green when the catalog is MISSING entries,
 * because a missing label is never asserted about.
 *
 * That is exactly how it drifted: "AI Agent Gateway", "Inspectors", "PingOne
 * Sample Apps" and "Platform Admin" were added to the nav and never added to
 * the catalog, so the Demo Config picker could not show or hide any of them and
 * nothing failed. This closes the reverse direction.
 */
describe('NAV_ITEM_CATALOG mirrors AdminSideNav top-level labels', () => {
  it('covers every top-level label, in nav order', () => {
    expect(NAV_ITEM_CATALOG).toEqual(NAV_STRUCTURE_CATALOG.map((i) => i.label));
  });
});
