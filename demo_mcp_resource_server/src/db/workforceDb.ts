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

export function listExpenses(): Expense[] {
  return withDb((conn) => conn.prepare('SELECT * FROM expenses ORDER BY submittedDate DESC').all() as unknown as Expense[]);
}

export function getExpense(id: string): Expense | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Expense | undefined);
  return row ?? null;
}
