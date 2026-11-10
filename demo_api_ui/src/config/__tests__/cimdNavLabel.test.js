import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_PAGE_PATHS } from '../navPagePaths';
import { NAV_STRUCTURE_CATALOG } from '../navStructureCatalog';

// /client-registration creates a real PingOne application and hosts its CIMD document. Its page title (and h1) is
// "CIMD Client Registration"; the nav used to say "CIMD Simulation", which is false (nothing is simulated).
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('nav label for /client-registration', () => {
  it('matches the page title in every nav surface', () => {
    const title = read('../../components/ClientRegistrationPage.js').match(/title="(CIMD Client Registration)"/)?.[1];
    expect(title).toBe('CIMD Client Registration');
    expect(Object.entries(NAV_PAGE_PATHS).filter(([, p]) => p === '/client-registration').map(([l]) => l)).toEqual([title]);
    expect(NAV_STRUCTURE_CATALOG.find((g) => g.label === 'Administration').children).toContain(title);
    expect(read('../../components/AdminSideNav.jsx')).toMatch(new RegExp(`label: "${title}",\\s+path: "/client-registration"`));
    expect(read('../missionControlCatalog.js')).toContain(`link('${title}', '/client-registration')`);
  });

  it('no nav surface still says "CIMD Simulation"', () => {
    for (const rel of ['../../components/AdminSideNav.jsx', '../missionControlCatalog.js', '../navPagePaths.js', '../navStructureCatalog.js', '../../data/pageCatalog.md']) {
      expect(read(rel), rel).not.toContain('CIMD Simulation');
    }
  });
});
