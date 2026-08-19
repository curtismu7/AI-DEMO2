'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-db-'));
process.env.WORKFORCE_DB_PATH = path.join(tmpDir, 'workforce.db');
process.env.WORKFORCE_SEED_PATH = path.join(__dirname, '..', 'seed', 'workforce.seed.json');

import { getExpense, listExpenses, withDb, insertExpense } from '../src/db/workforceDb';

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

  // The divergence this closes: before submit_expense was routed here it wrote
  // the BFF's in-memory store, so a filed expense was invisible to the very
  // next list_expenses.
  it('a submitted expense is visible to listExpenses immediately and sorts to the top', () => {
    const before = listExpenses().length;
    const filed = insertExpense({ category: 'Travel', amount: 100 });

    expect(filed.status).toBe('Submitted');
    expect(filed.description).toBe('Travel');
    expect(listExpenses()).toHaveLength(before + 1);
    expect(listExpenses()[0].id).toBe(filed.id);
    expect(getExpense(filed.id)).not.toBeNull();
  });

  it('a deleted middle row cannot make a later insert reuse a live id', () => {
    const a = insertExpense({ category: 'Meals', amount: 20 });
    const b = insertExpense({ category: 'Lodging', amount: 300 });
    withDb((db) => db.prepare('DELETE FROM expenses WHERE id = ?').run(a.id));

    const c = insertExpense({ category: 'Transit', amount: 15 });
    expect(c.id).not.toBe(b.id);
    expect(getExpense(c.id)).not.toBeNull();
    expect(getExpense(b.id)).not.toBeNull();
  });
});
