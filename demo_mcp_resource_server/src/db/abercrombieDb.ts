'use strict';

/**
 * SQLite backing store for the abercrombie-fitch vertical.
 *
 * Mirrors the workforce/retail pattern: owns real data instead of proxying to
 * the BFF or reading a flat mock JSON file. Every A&F tool result is a row
 * read out of this file, so editing the .db out-of-band changes what the
 * demo shows.
 *
 * Path:  ABERCROMBIE_DB_PATH  (default <cwd>/data/abercrombie.db)
 * Seed:  ABERCROMBIE_SEED_PATH (default <pkg>/seed/abercrombie.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface AnfOrder {
  id: string;
  product: string;
  amount: number;
  status: string;
  date: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id       TEXT PRIMARY KEY,
  product  TEXT NOT NULL,
  amount   REAL NOT NULL,
  status   TEXT NOT NULL,
  date     TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.ABERCROMBIE_DB_PATH || path.join(process.cwd(), 'data', 'abercrombie.db');
}

export function abercrombieDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.ABERCROMBIE_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'abercrombie.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[abercrombie-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insOrder = conn.prepare(
    'INSERT INTO orders (id, product, amount, status, date) VALUES (?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const o of seed.orders || []) {
      insOrder.run(o.id, o.product, o.amount, o.status, o.date);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[abercrombie-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to abercrombie.db unconditionally visible on the next tool call,
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

export function listAnfOrders(): AnfOrder[] {
  return withDb((conn) => conn.prepare('SELECT * FROM orders ORDER BY date DESC').all() as unknown as AnfOrder[]);
}

export function getAnfOrder(id: string): AnfOrder | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM orders WHERE id = ?').get(id) as AnfOrder | undefined);
  return row ?? null;
}
