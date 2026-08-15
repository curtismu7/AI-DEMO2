'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'government-db-'));
process.env.GOVERNMENT_DB_PATH = path.join(tmpDir, 'government.db');
process.env.GOVERNMENT_SEED_PATH = path.join(__dirname, '..', 'seed', 'government.seed.json');

import { getPermit, listPermits, withDb } from '../src/db/governmentDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('governmentDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.GOVERNMENT_DB_PATH as string)).toBe(true);
    expect(listPermits()).toHaveLength(4);
  });

  it('lists all permits ordered by issued date descending', () => {
    const permits = listPermits();
    expect(permits).toHaveLength(4);
    expect(permits[0].id).toBe('P-1001');
    expect(permits[0].issuedDate).toBe('2026-02-10');
    expect(permits[3].issuedDate).toBe('2024-07-01');
  });

  it('retrieves a single permit by ID', () => {
    const permit = getPermit('P-1001');
    expect(permit).not.toBeNull();
    expect(permit!.permitType).toBe('Building');
    expect(permit!.subject).toBe('1234 Maple Street, Springfield, IL');
    expect(permit!.status).toBe('Active');
  });

  it('returns null for a nonexistent permit', () => {
    expect(getPermit('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE permits SET status = 'Expired' WHERE id = ?").run('P-1003'),
    );

    const updated = getPermit('P-1003');
    expect(updated!.status).toBe('Expired');
  });
});
