'use strict';

/**
 * Drift gate for TECH_DEBT.md → "Every migrated vertical now has two seed
 * stores and nothing keeps them agreeing" (2026-08-17).
 *
 * The SQLite migration moved one or two READ tools per vertical onto this
 * resource server, reading from `seed/<vertical>.seed.json`. Every write and
 * every other read still runs against the BFF's own store at
 * `demo_api_server/config/verticals/<vertical>/seed.json`.
 *
 * Since the seeds:gen single-sourcing, each resource-server seed is DERIVED
 * from the BFF seed (a pure extraction of the migrated entity), and this test
 * asserts full-record deep equality — not just matching ids, which let field
 * drift through (found live: abercrombie's resource seed had silently lost
 * sku/size/color). On failure, fix the BFF seed (the source) and run:
 *
 *   npm run seeds:gen   (scripts/gen-seeds-from-bff.mjs)
 *
 * The case list lives in seed/parity-cases.json, shared with the generator so
 * the mapping itself cannot drift between the two.
 *
 * Scope, stated honestly: this catches SEED-FILE divergence. It does NOT catch
 * runtime write-divergence — a "cancel" applied to the BFF store is invisible
 * to this server's SQLite copy regardless. That needs the real fix (finish the
 * migration); see TECH_DEBT.md.
 */

import fs from 'fs';
import path from 'path';

const RESOURCE_SEED_DIR = path.join(__dirname, '..', 'seed');
const BFF_VERTICALS_DIR = path.join(__dirname, '..', '..', 'demo_api_server', 'config', 'verticals');

interface ParityCase {
  label: string;
  resourceSeed: string;
  bffDir: string;
  entity: string;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(RESOURCE_SEED_DIR, 'parity-cases.json'), 'utf8'),
) as { cases: ParityCase[]; excluded: string[] };

function readRecords(file: string, entity: string): Array<{ id: unknown }> {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const records = raw[entity];
  if (!Array.isArray(records)) {
    throw new Error(`expected array at key "${entity}" in ${file}, got ${typeof records}`);
  }
  return [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

describe('seed parity: resource-server seed is derived from the BFF seed', () => {
  it.each(manifest.cases)(
    '$label — full records match between both seed files ($entity); on drift run npm run seeds:gen',
    ({ resourceSeed, bffDir, entity }) => {
      const resourceFile = path.join(RESOURCE_SEED_DIR, resourceSeed);
      const bffFile = path.join(BFF_VERTICALS_DIR, bffDir, 'seed.json');

      // A missing counterpart IS divergence — fail loudly rather than skip.
      expect(fs.existsSync(resourceFile)).toBe(true);
      expect(fs.existsSync(bffFile)).toBe(true);

      // Deep equality on full records: id-only matching let field drift
      // through (abercrombie lost sku/size/color unnoticed).
      expect(readRecords(resourceFile, entity)).toEqual(readRecords(bffFile, entity));
    },
  );

  it('documents the verticals with no comparable BFF seed.json', () => {
    // Not an assertion of behavior — a visible record of what this guard cannot
    // cover, so the exclusion is deliberate and shows up in the test output.
    expect(manifest.excluded.length).toBe(2);
  });
});
