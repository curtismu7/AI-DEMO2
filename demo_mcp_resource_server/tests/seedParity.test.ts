'use strict';

/**
 * Interim guard for TECH_DEBT.md → "Every migrated vertical now has two seed
 * stores and nothing keeps them agreeing" (2026-08-17).
 *
 * The SQLite migration moved one or two READ tools per vertical onto this
 * resource server (list + get), reading from `seed/<vertical>.seed.json`.
 * Every write and every other read still runs against the BFF's own store at
 * `demo_api_server/config/verticals/<vertical>/seed.json`. The two seed files
 * were authored independently and were never derived from each other, so they
 * can silently describe different worlds.
 *
 * This test is the "worth having regardless" guard the tech-debt entry asks
 * for: it loads BOTH seeds for each migrated vertical and asserts the record
 * ids of the migrated entity match. It makes SEED-FILE divergence visible the
 * moment someone edits one seed and not the other.
 *
 * Scope, stated honestly:
 *   - This catches divergence at the seed-file level (the two checked-in
 *     files disagreeing on which records exist). It does NOT catch the runtime
 *     write-divergence that is the deeper problem — a "cancel" applied to the
 *     BFF store is invisible to this server's SQLite copy regardless of whether
 *     the seed files agree. That is what the real fix (finish the migration, or
 *     generate both seeds from one source) addresses; see TECH_DEBT.md.
 *
 * Coverage:
 *   - 8 "retail-pattern" verticals keep their BFF store in a comparable
 *     `seed.json` with the same entity key — those are asserted below.
 *   - `banking` and `airlines` each have a `seed/*.seed.json` here but NO
 *     comparable `config/verticals/<v>/seed.json` on the BFF side (banking's
 *     data plane is the original banking store; airlines' lives inside
 *     `config/verticals/airlines/index.js`). There is no parallel seed file to
 *     diff, so they are documented exclusions rather than a parity assertion —
 *     see the `EXCLUDED` note below.
 */

import fs from 'fs';
import path from 'path';

// __dirname === demo_mcp_resource_server/tests
const RESOURCE_SEED_DIR = path.join(__dirname, '..', 'seed');
const BFF_VERTICALS_DIR = path.join(__dirname, '..', '..', 'demo_api_server', 'config', 'verticals');

interface ParityCase {
  /** Human label used in the test name. */
  label: string;
  /** File under demo_mcp_resource_server/seed/ that seeds this server's SQLite table. */
  resourceSeed: string;
  /** Directory under demo_api_server/config/verticals/ holding the BFF's seed.json. */
  bffDir: string;
  /** Top-level array key of the migrated entity in BOTH seeds. */
  entity: string;
}

/**
 * The migrated entity per vertical is the one the resource server's `list`/`get`
 * tool now serves out of SQLite. Both seed files carry it under the same key.
 */
const PARITY_CASES: ParityCase[] = [
  { label: 'retail', resourceSeed: 'retail.seed.json', bffDir: 'retail', entity: 'orders' },
  { label: 'sporting-goods', resourceSeed: 'sportingGoods.seed.json', bffDir: 'sporting-goods', entity: 'orders' },
  { label: 'abercrombie-fitch', resourceSeed: 'abercrombie.seed.json', bffDir: 'abercrombie-fitch', entity: 'orders' },
  { label: 'government', resourceSeed: 'government.seed.json', bffDir: 'government', entity: 'permits' },
  { label: 'healthcare', resourceSeed: 'healthcare.seed.json', bffDir: 'healthcare', entity: 'patientRecords' },
  { label: 'manufacturing', resourceSeed: 'manufacturing.seed.json', bffDir: 'manufacturing', entity: 'workOrders' },
  { label: 'university', resourceSeed: 'university.seed.json', bffDir: 'university', entity: 'courses' },
  { label: 'workforce', resourceSeed: 'workforce.seed.json', bffDir: 'workforce', entity: 'expenses' },
];

/**
 * Verticals whose resource-server seed has NO comparable BFF seed.json to diff.
 * Listed here so the exclusion is explicit and reviewable, not silent. If a
 * `seed.json` is ever added for one of these on the BFF side, move it into
 * PARITY_CASES above so it gets guarded.
 */
const EXCLUDED = ['banking (BFF has no seed.json)', 'airlines (BFF data lives in index.js)'];

function readIds(file: string, entity: string): string[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const records = raw[entity];
  if (!Array.isArray(records)) {
    throw new Error(`expected array at key "${entity}" in ${file}, got ${typeof records}`);
  }
  return records.map((r: { id: unknown }) => String(r.id)).sort();
}

describe('seed parity: resource-server SQLite seed vs BFF store seed', () => {
  it.each(PARITY_CASES)(
    '$label — record ids match between both seed files ($entity)',
    ({ resourceSeed, bffDir, entity }) => {
      const resourceFile = path.join(RESOURCE_SEED_DIR, resourceSeed);
      const bffFile = path.join(BFF_VERTICALS_DIR, bffDir, 'seed.json');

      // A missing counterpart IS divergence — fail loudly rather than skip.
      expect(fs.existsSync(resourceFile)).toBe(true);
      expect(fs.existsSync(bffFile)).toBe(true);

      const resourceIds = readIds(resourceFile, entity);
      const bffIds = readIds(bffFile, entity);

      // toEqual on sorted arrays surfaces exactly which ids drifted.
      expect(resourceIds).toEqual(bffIds);
    },
  );

  it('documents the verticals with no comparable BFF seed.json', () => {
    // Not an assertion of behavior — a visible record of what this guard cannot
    // cover, so the exclusion is deliberate and shows up in the test output.
    expect(EXCLUDED.length).toBe(2);
  });
});
