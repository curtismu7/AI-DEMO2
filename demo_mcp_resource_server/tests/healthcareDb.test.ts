'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthcare-db-'));
process.env.HEALTHCARE_DB_PATH = path.join(tmpDir, 'healthcare.db');
process.env.HEALTHCARE_SEED_PATH = path.join(__dirname, '..', 'seed', 'healthcare.seed.json');

import { getPatientRecord, listPatientRecords, withDb } from '../src/db/healthcareDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('healthcareDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.HEALTHCARE_DB_PATH as string)).toBe(true);
    expect(listPatientRecords()).toHaveLength(6);
  });

  it('lists all patient records ordered by last visit descending', () => {
    const records = listPatientRecords();
    expect(records).toHaveLength(6);
    expect(records[0].id).toBe('106');
    expect(records[0].lastVisit).toBe('2026-05-07');
    expect(records[5].lastVisit).toBe('2025-11-20');
  });

  it('retrieves a single patient record by ID', () => {
    const record = getPatientRecord('101');
    expect(record).not.toBeNull();
    expect(record!.recordType).toBe('Primary Care');
    expect(record!.provider).toBe('Dr. Sarah Mitchell, MD');
    expect(record!.status).toBe('Active');
  });

  it('returns null for a nonexistent record', () => {
    expect(getPatientRecord('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE patientRecords SET status = 'Inactive' WHERE id = ?").run('102'),
    );

    const updated = getPatientRecord('102');
    expect(updated!.status).toBe('Inactive');
  });
});
