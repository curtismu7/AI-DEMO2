// Regression guard for the "database is locked" flake (see git history for
// this file's introduction): every vertical DB module opens a fresh
// connection per call and must set PRAGMA busy_timeout so concurrent access
// waits instead of throwing SQLITE_BUSY immediately. This doesn't reproduce
// the race itself (that needs two real OS processes, not a Jest unit test —
// see the isolated repro used to verify the fix) — it just pins that the
// pragma is actually set, so a future edit can't silently drop it from one
// module.
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'busy-timeout-test-'));

// Each module's DB path env var must be set BEFORE it's imported (the path is
// read at call time here, not at import time, but isolating to a fresh temp
// file still avoids colliding with any other suite using the shared default).
process.env.HEALTHCARE_DB_PATH = path.join(tmpDir, 'healthcare.db');
process.env.GOVERNMENT_DB_PATH = path.join(tmpDir, 'government.db');
process.env.MANUFACTURING_DB_PATH = path.join(tmpDir, 'manufacturing.db');
process.env.WORKFORCE_DB_PATH = path.join(tmpDir, 'workforce.db');
process.env.RETAIL_DB_PATH = path.join(tmpDir, 'retail.db');
process.env.SPORTING_GOODS_DB_PATH = path.join(tmpDir, 'sporting-goods.db');
process.env.UNIVERSITY_DB_PATH = path.join(tmpDir, 'university.db');
process.env.ABERCROMBIE_DB_PATH = path.join(tmpDir, 'abercrombie.db');
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.BANKING_DB_PATH = path.join(tmpDir, 'banking.db');
process.env.INVEST_DB_PATH = path.join(tmpDir, 'invest.db');

import { withDb as withHealthcareDb } from '../src/db/healthcareDb';
import { withDb as withGovernmentDb } from '../src/db/governmentDb';
import { withDb as withManufacturingDb } from '../src/db/manufacturingDb';
import { withDb as withWorkforceDb } from '../src/db/workforceDb';
import { withDb as withRetailDb } from '../src/db/retailDb';
import { withDb as withSportingGoodsDb } from '../src/db/sportingGoodsDb';
import { withDb as withUniversityDb } from '../src/db/universityDb';
import { withDb as withAbercrombieDb } from '../src/db/abercrombieDb';
import { withDb as withAirlinesDb } from '../src/db/airlinesDb';
import { withDb as withBankingDb } from '../src/db/bankingDb';
import { withDb as withInvestDb } from '../src/db/investDb';

const MODULES: Array<[string, <T>(fn: (db: any) => T) => T]> = [
  ['healthcareDb', withHealthcareDb],
  ['governmentDb', withGovernmentDb],
  ['manufacturingDb', withManufacturingDb],
  ['workforceDb', withWorkforceDb],
  ['retailDb', withRetailDb],
  ['sportingGoodsDb', withSportingGoodsDb],
  ['universityDb', withUniversityDb],
  ['abercrombieDb', withAbercrombieDb],
  ['airlinesDb', withAirlinesDb],
  ['bankingDb', withBankingDb],
  ['investDb', withInvestDb],
];

describe('busy_timeout pragma', () => {
  it.each(MODULES)('%s sets a non-zero busy_timeout on its connection', (_name, withDb) => {
    const { timeout } = withDb((conn) => conn.prepare('PRAGMA busy_timeout').get()) as { timeout: number };
    expect(timeout).toBeGreaterThan(0);
  });
});
