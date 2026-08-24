'use strict';

/**
 * SQLite backing store for the invest vertical — used when no banking API is
 * configured (BANKING_API_BASE_URL / DEMO_API_BASE_URL unset). One seeded
 * demo investor, served to every caller — this vertical has a single persona,
 * not per-user rows.
 *
 * Path:  INVEST_DB_PATH  (default <cwd>/data/invest.db)
 * Seed:  INVEST_SEED_PATH (default <pkg>/seed/invest.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Investor {
  investor_id: string;
  holder: string;
  portfolio_id: string;
  total_value: number;
  cash_sweep: number;
  ytd_return_pct: number;
  risk_profile: string;
}

export interface Portfolio {
  id: string;
  portfolio_type: string;
  portfolio_number: string;
  value: number;
  currency: string;
}

export interface Holding {
  symbol: string;
  name: string;
  quantity: number | null;
  market_value: number;
}

export interface Trade {
  id: string;
  type: string;
  symbol: string;
  amount: number;
  date: string;
  status: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS investors (
  investor_id      TEXT PRIMARY KEY,
  holder           TEXT NOT NULL,
  portfolio_id     TEXT NOT NULL,
  total_value      REAL NOT NULL,
  cash_sweep       REAL NOT NULL,
  ytd_return_pct   REAL NOT NULL,
  risk_profile     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolios (
  id               TEXT PRIMARY KEY,
  investor_id      TEXT NOT NULL REFERENCES investors(investor_id),
  portfolio_type   TEXT NOT NULL,
  portfolio_number TEXT NOT NULL,
  value            REAL NOT NULL,
  currency         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holdings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id  TEXT NOT NULL REFERENCES investors(investor_id),
  symbol       TEXT NOT NULL,
  name         TEXT NOT NULL,
  quantity     REAL,
  market_value REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS trades (
  id          TEXT PRIMARY KEY,
  investor_id TEXT NOT NULL REFERENCES investors(investor_id),
  type        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  amount      REAL NOT NULL,
  date        TEXT NOT NULL,
  status      TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.INVEST_DB_PATH || path.join(process.cwd(), 'data', 'invest.db');
}

function seedPath(): string {
  return process.env.INVEST_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'invest.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM investors').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[invest-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insInvestor = conn.prepare(
    'INSERT INTO investors (investor_id, holder, portfolio_id, total_value, cash_sweep, ytd_return_pct, risk_profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insPortfolio = conn.prepare(
    'INSERT INTO portfolios (id, investor_id, portfolio_type, portfolio_number, value, currency) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insHolding = conn.prepare(
    'INSERT INTO holdings (investor_id, symbol, name, quantity, market_value) VALUES (?, ?, ?, ?, ?)',
  );
  const insTrade = conn.prepare(
    'INSERT INTO trades (id, investor_id, type, symbol, amount, date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const inv of seed.investors || []) {
      insInvestor.run(
        inv.investor_id, inv.holder, inv.portfolio_id,
        inv.total_value, inv.cash_sweep, inv.ytd_return_pct, inv.risk_profile,
      );
      for (const p of inv.portfolios || []) {
        insPortfolio.run(p.id, inv.investor_id, p.portfolio_type, p.portfolio_number, p.value, p.currency);
      }
      for (const h of inv.holdings || []) {
        insHolding.run(inv.investor_id, h.symbol, h.name, h.quantity ?? null, h.market_value);
      }
      for (const t of inv.trades || []) {
        insTrade.run(t.id, inv.investor_id, t.type, t.symbol, t.amount, t.date, t.status);
      }
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[invest-db] seeded ${dbPath()} from ${file}`);
}

/** Deliberately NOT a cached long-lived handle — see bankingDb.ts withDb for why. */
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

/** The single demo investor (null only if the seed file was missing). */
export function resolveInvestor(): Investor | null {
  return withDb((conn) => (conn.prepare('SELECT * FROM investors LIMIT 1').get() as Investor | undefined) ?? null);
}

export function getPortfolios(investorId: string): Portfolio[] {
  return withDb((conn) => conn
    .prepare('SELECT id, portfolio_type, portfolio_number, value, currency FROM portfolios WHERE investor_id = ? ORDER BY id')
    .all(investorId) as unknown as Portfolio[]);
}

export function getHoldings(investorId: string): Holding[] {
  return withDb((conn) => conn
    .prepare('SELECT symbol, name, quantity, market_value FROM holdings WHERE investor_id = ? ORDER BY id')
    .all(investorId) as unknown as Holding[]);
}

export function listTrades(investorId: string, limit: number): Trade[] {
  return withDb((conn) => conn
    .prepare('SELECT id, type, symbol, amount, date, status FROM trades WHERE investor_id = ? ORDER BY rowid LIMIT ?')
    .all(investorId, limit) as unknown as Trade[]);
}

/** An accountId is either the investor's top-level portfolioId or one of their sub-portfolio ids. */
export function ownsAccount(investor: Investor, portfolios: Portfolio[], accountId: string): boolean {
  return accountId === investor.portfolio_id || portfolios.some((p) => p.id === accountId);
}
