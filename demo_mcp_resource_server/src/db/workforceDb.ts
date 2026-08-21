'use strict';

/**
 * SQLite backing store for the workforce vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every workforce tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  WORKFORCE_DB_PATH  (default <cwd>/data/workforce.db)
 * Seed:  WORKFORCE_SEED_PATH (default <pkg>/seed/workforce.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  status: string;
  submittedDate: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       REAL NOT NULL,
  status       TEXT NOT NULL,
  submittedDate TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.WORKFORCE_DB_PATH || path.join(process.cwd(), 'data', 'workforce.db');
}

export function workforceDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.WORKFORCE_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'workforce.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM expenses').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[workforce-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insExpense = conn.prepare(
    'INSERT INTO expenses (id, category, description, amount, status, submittedDate) VALUES (?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const e of seed.expenses || []) {
      insExpense.run(e.id, e.category, e.description, e.amount, e.status, e.submittedDate);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[workforce-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to workforce.db unconditionally visible on the next tool call,
 * and avoids WAL index drift across Docker bind mounts.
 */
export function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  try {
    conn.exec('PRAGMA foreign_keys = ON');
    conn.exec(SCHEMA);
    seedIfEmpty(conn);
    return fn(conn);
  } finally {
    conn.close();
  }
}

// rowid DESC breaks submittedDate ties by insertion order. Expenses filed
// through submit_expense all carry today's date, so on date alone SQLite
// returned same-day expenses arbitrarily and the one just submitted was not
// reliably first. Seeded rows have distinct dates, so their order is unchanged.
export function listExpenses(): Expense[] {
  return withDb((conn) => conn.prepare('SELECT * FROM expenses ORDER BY submittedDate DESC, rowid DESC').all() as unknown as Expense[]);
}

/**
 * File a new expense — the write half of the entity `list_expenses` reads.
 * Before this existed, submit_expense landed in the BFF's in-memory store while
 * the list came from this database, so a submitted expense was invisible to the
 * very next "show my expenses" (TECH_DEBT's seed-store divergence).
 *
 * Mirrors retailDb.insertOrder: mutating, ids derived from the highest existing
 * `exp-new-N` suffix so deleting a middle row cannot hand out an id that is
 * still live (expenses.id is the PRIMARY KEY).
 */
export function insertExpense(input: { category: string; amount: number; description?: string; submittedDate?: string }): Expense {
  return withDb((conn) => {
    const rows = conn
      .prepare("SELECT id FROM expenses WHERE id LIKE 'exp-new-%'")
      .all() as unknown as Array<{ id: string }>;
    const highest = rows.reduce((max, r) => {
      const n = Number.parseInt(String(r.id).slice('exp-new-'.length), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    const expense: Expense = {
      id: `exp-new-${highest + 1}`,
      category: input.category,
      // The BFF used the category as the description when a chip carried no
      // free text; kept identical so the rendered row reads the same.
      description: input.description ?? input.category,
      amount: input.amount,
      status: 'Submitted',
      submittedDate: input.submittedDate ?? new Date().toISOString().slice(0, 10),
    };

    conn.prepare(
      'INSERT INTO expenses (id, category, description, amount, status, submittedDate) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(expense.id, expense.category, expense.description, expense.amount, expense.status, expense.submittedDate);

    return expense;
  });
}

export function getExpense(id: string): Expense | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Expense | undefined);
  return row ?? null;
}
