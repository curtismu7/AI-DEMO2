'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-db-'));
process.env.BANKING_DB_PATH = path.join(tmpDir, 'banking.db');
process.env.BANKING_SEED_PATH = path.join(__dirname, '..', 'seed', 'banking.seed.json');

import { getAccount, listAccounts, withDb } from '../src/db/bankingDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bankingDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.BANKING_DB_PATH as string)).toBe(true);
    expect(listAccounts()).toHaveLength(3);
  });

  it('lists all accounts ordered by id', () => {
    const accounts = listAccounts();
    expect(accounts).toHaveLength(3);
    expect(accounts[0].id).toBe('acct-001');
    expect(accounts[2].id).toBe('acct-003');
  });

  it('retrieves a single account by ID', () => {
    const account = getAccount('acct-002');
    expect(account).not.toBeNull();
    expect(account!.accountType).toBe('savings');
    expect(account!.balance).toBe(18540.0);
    expect(account!.isActive).toBe(true);
  });

  it('returns null for a nonexistent account', () => {
    expect(getAccount('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE accounts SET balance = 5000.00 WHERE id = ?").run('acct-001'),
    );

    const updated = getAccount('acct-001');
    expect(updated!.balance).toBe(5000.0);
  });
});
