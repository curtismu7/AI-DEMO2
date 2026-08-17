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
    expect(listAccounts('demo-user')).toHaveLength(3);
  });

  it('lists all accounts ordered by id', () => {
    const accounts = listAccounts('demo-user');
    expect(accounts).toHaveLength(3);
    expect(accounts[0].id).toBe('acct-001');
    expect(accounts[2].id).toBe('acct-003');
  });

  it('retrieves a single account by ID', () => {
    const account = getAccount('acct-002', 'demo-user');
    expect(account).not.toBeNull();
    expect(account!.accountType).toBe('savings');
    expect(account!.balance).toBe(18540.0);
    expect(account!.isActive).toBe(true);
  });

  it('returns null for a nonexistent account', () => {
    expect(getAccount('NOPE', 'demo-user')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE accounts SET balance = 5000.00 WHERE id = ?").run('acct-001'),
    );

    const updated = getAccount('acct-001', 'demo-user');
    expect(updated!.balance).toBe(5000.0);
  });

  describe('per-user scoping (IDOR fix — BUGS.md #45)', () => {
    beforeAll(() => {
      // Seed a second user's account directly, out-of-band, the same way an
      // out-of-band edit is simulated above — proves the fix scopes by row
      // ownership, not by which rows a particular seed run happened to insert.
      withDb((db) =>
        db
          .prepare(
            'INSERT INTO accounts (id, userId, accountNumber, accountType, balance, currency, isActive) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run('acct-999', 'other-user', '****0000', 'checking', 100, 'USD', 1),
      );
    });

    it('listAccounts only returns the calling user\'s own accounts', () => {
      const demoUserAccounts = listAccounts('demo-user');
      expect(demoUserAccounts.map((a) => a.id).sort()).toEqual(['acct-001', 'acct-002', 'acct-003']);

      const otherUserAccounts = listAccounts('other-user');
      expect(otherUserAccounts.map((a) => a.id)).toEqual(['acct-999']);
    });

    it('getAccount does not leak another user\'s account via a guessed id', () => {
      // User A cannot fetch user B's account by id, even though the id exists.
      expect(getAccount('acct-999', 'demo-user')).toBeNull();
      // User B cannot fetch user A's account by id either.
      expect(getAccount('acct-001', 'other-user')).toBeNull();
      // Each user's own accounts still work correctly.
      expect(getAccount('acct-999', 'other-user')?.id).toBe('acct-999');
      expect(getAccount('acct-001', 'demo-user')?.id).toBe('acct-001');
    });
  });
});
