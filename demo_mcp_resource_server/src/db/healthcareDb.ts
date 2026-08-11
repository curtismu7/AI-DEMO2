'use strict';

/**
 * SQLite backing store for the healthcare vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every healthcare tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  HEALTHCARE_DB_PATH  (default <cwd>/data/healthcare.db)
 * Seed:  HEALTHCARE_SEED_PATH (default <pkg>/seed/healthcare.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface PatientRecord {
  id: string;
  recordType: string;
  provider: string;
  facility: string;
  lastVisit: string;
  status: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patientRecords (
  id         TEXT PRIMARY KEY,
  recordType TEXT NOT NULL,
  provider   TEXT NOT NULL,
  facility   TEXT NOT NULL,
  lastVisit  TEXT NOT NULL,
  status     TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.HEALTHCARE_DB_PATH || path.join(process.cwd(), 'data', 'healthcare.db');
}

export function healthcareDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.HEALTHCARE_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'healthcare.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM patientRecords').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[healthcare-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insRecord = conn.prepare(
    'INSERT INTO patientRecords (id, recordType, provider, facility, lastVisit, status) VALUES (?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const r of seed.patientRecords || []) {
      insRecord.run(r.id, r.recordType, r.provider, r.facility, r.lastVisit, r.status);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[healthcare-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to healthcare.db unconditionally visible on the next tool call,
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

export function listPatientRecords(): PatientRecord[] {
  return withDb((conn) => conn.prepare('SELECT * FROM patientRecords ORDER BY lastVisit DESC').all() as unknown as PatientRecord[]);
}

export function getPatientRecord(id: string): PatientRecord | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM patientRecords WHERE id = ?').get(id) as PatientRecord | undefined);
  return row ?? null;
}
