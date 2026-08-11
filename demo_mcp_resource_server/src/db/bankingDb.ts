'use strict';

/**
 * SQLite backing store for the banking vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every banking tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  BANKING_DB_PATH  (default <cwd>/data/banking.db)
 * Seed:  BANKING_SEED_PATH (default <pkg>/seed/banking.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Account {
  id: string;
  userId: string;
  accountNumber: string;
  accountType: string;
  balance: number;
  currency: string;
  isActive: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  userId        TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  accountType   TEXT NOT NULL,
  balance       REAL NOT NULL,
  currency      TEXT NOT NULL,
  isActive      INTEGER NOT NULL
);
`;

function dbPath(): string {
  return process.env.BANKING_DB_PATH || path.join(process.cwd(), 'data', 'banking.db');
}

export function bankingDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.BANKING_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'banking.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[banking-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insAccount = conn.prepare(
    'INSERT INTO accounts (id, userId, accountNumber, accountType, balance, currency, isActive) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const a of seed.accounts || []) {
      insAccount.run(a.id, a.userId, a.accountNumber, a.accountType, a.balance, a.currency, a.isActive ? 1 : 0);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[banking-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to banking.db unconditionally visible on the next tool call,
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

export function listAccounts(): Account[] {
  return withDb((conn) => {
    const rows = conn.prepare('SELECT * FROM accounts ORDER BY id').all() as unknown as Array<{
      id: string;
      userId: string;
      accountNumber: string;
      accountType: string;
      balance: number;
      currency: string;
      isActive: number;
    }>;
    return rows.map((r) => ({ ...r, isActive: r.isActive === 1 }));
  });
}

export function getAccount(id: string): Account | null {
  return withDb((conn) => {
    const row = conn.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      | {
          id: string;
          userId: string;
          accountNumber: string;
          accountType: string;
          balance: number;
          currency: string;
          isActive: number;
        }
      | undefined;
    return row ? { ...row, isActive: row.isActive === 1 } : null;
  });
}
