'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sporting-goods-db-'));
process.env.SPORTING_GOODS_DB_PATH = path.join(tmpDir, 'sporting-goods.db');
process.env.SPORTING_GOODS_SEED_PATH = path.join(__dirname, '..', 'seed', 'sportingGoods.seed.json');

import { getOrder, listOrders, withDb } from '../src/db/sportingGoodsDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sportingGoodsDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.SPORTING_GOODS_DB_PATH as string)).toBe(true);
    expect(listOrders()).toHaveLength(6);
  });

  it('lists all orders ordered by date descending', () => {
    const orders = listOrders();
    expect(orders).toHaveLength(6);
    expect(orders[0].id).toBe('2006');
    expect(orders[0].date).toBe('2026-05-01');
    expect(orders[5].date).toBe('2026-02-14');
  });

  it('retrieves a single order by ID', () => {
    const order = getOrder('2001');
    expect(order).not.toBeNull();
    expect(order!.product).toBe('Nike Pegasus 41');
    expect(order!.status).toBe('Delivered');
    expect(order!.amount).toBe(140);
  });

  it('returns null for a nonexistent order', () => {
    expect(getOrder('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE orders SET status = 'Returned' WHERE id = ?").run('2002'),
    );

    const updated = getOrder('2002');
    expect(updated!.status).toBe('Returned');
  });
});
