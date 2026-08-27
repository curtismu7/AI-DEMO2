'use strict';

/**
 * SQLite backing store for the retail vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every retail tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  RETAIL_DB_PATH  (default <cwd>/data/retail.db)
 * Seed:  RETAIL_SEED_PATH (default <pkg>/seed/retail.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Order {
  id: string;
  product: string;
  sku: string;
  amount: number;
  status: string;
  date: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id       TEXT PRIMARY KEY,
  product  TEXT NOT NULL,
  sku      TEXT NOT NULL,
  amount   INTEGER NOT NULL,
  status   TEXT NOT NULL,
  date     TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.RETAIL_DB_PATH || path.join(process.cwd(), 'data', 'retail.db');
}

export function retailDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.RETAIL_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'retail.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[retail-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insOrder = conn.prepare(
    'INSERT INTO orders (id, product, sku, amount, status, date) VALUES (?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const o of seed.orders || []) {
      insOrder.run(o.id, o.product, o.sku, o.amount, o.status, o.date);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[retail-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to retail.db unconditionally visible on the next tool call,
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

// rowid DESC breaks date ties by insertion order. Orders placed through
// checkout all carry today's date, so on date alone SQLite returned them in an
// arbitrary order and the one just placed was not reliably first — which is
// exactly what "show my orders" right after a checkout has to show. Seeded rows
// have distinct dates, so their order is unchanged.
export function listOrders(): Order[] {
  return withDb((conn) => conn.prepare('SELECT * FROM orders ORDER BY date DESC, rowid DESC').all() as unknown as Order[]);
}

export function getOrder(id: string): Order | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | undefined);
  return row ?? null;
}

/**
 * Place a new order. This is the write half of the same entity `list_orders`
 * reads: before this existed, `checkout` landed in the BFF's in-memory store
 * while `list_orders` came from this database, so a placed order was invisible
 * to the very next "show my orders" — the seed-store divergence in TECH_DEBT.
 *
 * Mutating (like upgradeCabinOnBooking in airlinesDb, unlike the deliberately
 * read-only cancelReservation): the point of the demo is that the order appears
 * in the list afterwards. seedIfEmpty only refills an EMPTY table, so the new
 * row survives restarts without clobbering the seeded ones.
 *
 * Ids follow the BFF's `ord-new-<n>` convention. n is derived from the highest
 * existing suffix rather than a count, so deleting a row can't hand out an id
 * that is already taken (orders.id is the PRIMARY KEY).
 */
export function insertOrder(input: { product: string; amount: number; sku?: string; date?: string }): Order {
  return withDb((conn) => {
    // SQL MAX() instead of shipping every prior row into JS to reduce — same
    // "highest existing suffix" semantics, without a per-call full-table scan
    // whose cost grows with every order ever placed this session.
    const row = conn
      .prepare("SELECT MAX(CAST(SUBSTR(id, LENGTH('ord-new-') + 1) AS INTEGER)) AS maxN FROM orders WHERE id LIKE 'ord-new-%'")
      .get() as { maxN: number | null } | undefined;
    const highest = row?.maxN ?? 0;

    const order: Order = {
      id: `ord-new-${highest + 1}`,
      product: input.product,
      // The seeds carry a real SKU per product; a newly placed order has none
      // yet. Empty would violate NOT NULL, so mark it explicitly rather than
      // inventing a catalog code that looks real.
      sku: input.sku ?? 'PENDING',
      amount: input.amount,
      status: 'Processing',
      // listOrders() is ORDER BY date DESC, so today's date puts the new order
      // at the top — which is where "I just bought this" belongs.
      date: input.date ?? new Date().toISOString().slice(0, 10),
    };

    conn.prepare(
      'INSERT INTO orders (id, product, sku, amount, status, date) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(order.id, order.product, order.sku, order.amount, order.status, order.date);

    return order;
  });
}
