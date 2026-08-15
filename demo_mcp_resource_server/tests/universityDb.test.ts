'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'university-db-'));
process.env.UNIVERSITY_DB_PATH = path.join(tmpDir, 'university.db');
process.env.UNIVERSITY_SEED_PATH = path.join(__dirname, '..', 'seed', 'university.seed.json');

import { getCourse, listCourses, withDb } from '../src/db/universityDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('universityDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.UNIVERSITY_DB_PATH as string)).toBe(true);
    expect(listCourses()).toHaveLength(4);
  });

  it('lists all courses ordered by term descending', () => {
    const courses = listCourses();
    expect(courses).toHaveLength(4);
    expect(courses[0].term).toBe('Spring 2026');
    expect(courses[3].term).toBe('Fall 2025');
  });

  it('retrieves a single course by ID', () => {
    const course = getCourse('C-CS301');
    expect(course).not.toBeNull();
    expect(course!.title).toBe('Algorithms');
    expect(course!.courseType).toBe('Core');
    expect(course!.status).toBe('Enrolled');
  });

  it('returns null for a nonexistent course', () => {
    expect(getCourse('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE courses SET grade = 'A' WHERE id = ?").run('C-CS301'),
    );

    const updated = getCourse('C-CS301');
    expect(updated!.grade).toBe('A');
  });
});
