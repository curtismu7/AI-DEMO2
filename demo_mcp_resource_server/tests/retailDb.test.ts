'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-db-'));
process.env.RETAIL_DB_PATH = path.join(tmpDir, 'retail.db');
process.env.RETAIL_SEED_PATH = path.join(__dirname, '..', 'seed', 'retail.seed.json');

import { getOrder, listOrders, withDb } from '../src/db/retailDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('retailDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.RETAIL_DB_PATH as string)).toBe(true);
    expect(listOrders()).toHaveLength(6);
  });

  it('lists all orders ordered by date descending', () => {
    const orders = listOrders();
    expect(orders).toHaveLength(6);
    expect(orders[0].id).toBe('1006');
    expect(orders[0].date).toBe('2026-05-01');
    expect(orders[5].date).toBe('2026-04-20');
  });

  it('retrieves a single order by ID', () => {
    const order = getOrder('1002');
    expect(order).not.toBeNull();
    expect(order!.product).toBe('MacBook Pro 14"');
    expect(order!.status).toBe('Shipped');
    expect(order!.amount).toBe(1999);
  });

  it('returns null for a nonexistent order', () => {
    expect(getOrder('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE orders SET status = 'Returned' WHERE id = ?").run('1001'),
    );

    const updated = getOrder('1001');
    expect(updated!.status).toBe('Returned');
  });
});
