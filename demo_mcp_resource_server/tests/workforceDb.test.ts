'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-db-'));
process.env.WORKFORCE_DB_PATH = path.join(tmpDir, 'workforce.db');
process.env.WORKFORCE_SEED_PATH = path.join(__dirname, '..', 'seed', 'workforce.seed.json');

import { getExpense, listExpenses, withDb } from '../src/db/workforceDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('workforceDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.WORKFORCE_DB_PATH as string)).toBe(true);
    expect(listExpenses()).toHaveLength(6);
  });

  it('lists all expenses ordered by submitted date descending', () => {
    const expenses = listExpenses();
    expect(expenses).toHaveLength(6);
    expect(expenses[0].id).toBe('206');
    expect(expenses[0].submittedDate).toBe('2026-06-02');
    expect(expenses[5].submittedDate).toBe('2026-04-22');
  });

  it('retrieves a single expense by ID', () => {
    const expense = getExpense('201');
    expect(expense).not.toBeNull();
    expect(expense!.category).toBe('Travel');
    expect(expense!.description).toBe('Q2 Sales Summit');
    expect(expense!.status).toBe('Approved');
  });

  it('returns null for a nonexistent expense', () => {
    expect(getExpense('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE expenses SET status = 'Approved' WHERE id = ?").run('204'),
    );

    const updated = getExpense('204');
    expect(updated!.status).toBe('Approved');
  });
});
