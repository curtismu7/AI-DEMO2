'use strict';

/**
 * SQLite backing store for the manufacturing vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every manufacturing tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  MANUFACTURING_DB_PATH  (default <cwd>/data/manufacturing.db)
 * Seed:  MANUFACTURING_SEED_PATH (default <pkg>/seed/manufacturing.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface WorkOrder {
  id: string;
  product: string;
  type: string;
  quantity: number;
  completedQty: number;
  status: string;
  dueDate: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workOrders (
  id           TEXT PRIMARY KEY,
  product      TEXT NOT NULL,
  type         TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  completedQty INTEGER NOT NULL,
  status       TEXT NOT NULL,
  dueDate      TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.MANUFACTURING_DB_PATH || path.join(process.cwd(), 'data', 'manufacturing.db');
}

export function manufacturingDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.MANUFACTURING_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'manufacturing.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM workOrders').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[manufacturing-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insWorkOrder = conn.prepare(
    'INSERT INTO workOrders (id, product, type, quantity, completedQty, status, dueDate) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const w of seed.workOrders || []) {
      insWorkOrder.run(w.id, w.product, w.type, w.quantity, w.completedQty, w.status, w.dueDate);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[manufacturing-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to manufacturing.db unconditionally visible on the next tool call,
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

export function listWorkOrders(): WorkOrder[] {
  return withDb((conn) => conn.prepare('SELECT * FROM workOrders ORDER BY dueDate ASC').all() as unknown as WorkOrder[]);
}

export function getWorkOrder(id: string): WorkOrder | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM workOrders WHERE id = ?').get(id) as WorkOrder | undefined);
  return row ?? null;
}
