'use strict';

/**
 * SQLite backing store for the university vertical.
 *
 * Mirrors the airlines pattern: owns real data instead of proxying to the BFF.
 * Every university tool result is a row read out of this file, so editing
 * the .db out-of-band changes what the demo shows.
 *
 * Path:  UNIVERSITY_DB_PATH  (default <cwd>/data/university.db)
 * Seed:  UNIVERSITY_SEED_PATH (default <pkg>/seed/university.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Course {
  id: string;
  title: string;
  courseType: string;
  credits: number;
  term: string;
  grade: string;
  status: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  courseType TEXT NOT NULL,
  credits    INTEGER NOT NULL,
  term       TEXT NOT NULL,
  grade      TEXT NOT NULL,
  status     TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.UNIVERSITY_DB_PATH || path.join(process.cwd(), 'data', 'university.db');
}

export function universityDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.UNIVERSITY_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'university.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[university-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insCourse = conn.prepare(
    'INSERT INTO courses (id, title, courseType, credits, term, grade, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const c of seed.courses || []) {
      insCourse.run(c.id, c.title, c.courseType, c.credits, c.term, c.grade, c.status);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[university-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. Opening per call makes external
 * edits to university.db unconditionally visible on the next tool call,
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

export function listCourses(): Course[] {
  return withDb((conn) => conn.prepare('SELECT * FROM courses ORDER BY term DESC').all() as unknown as Course[]);
}

export function getCourse(id: string): Course | null {
  const row = withDb((conn) => conn.prepare('SELECT * FROM courses WHERE id = ?').get(id) as Course | undefined);
  return row ?? null;
}
