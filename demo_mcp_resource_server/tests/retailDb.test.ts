'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-db-'));
process.env.RETAIL_DB_PATH = path.join(tmpDir, 'retail.db');
process.env.RETAIL_SEED_PATH = path.join(__dirname, '..', 'seed', 'retail.seed.json');

import { getOrder, insertOrder, listOrders, withDb } from '../src/db/retailDb';

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

  // The divergence this whole change exists to close: before checkout was
  // routed here it wrote the BFF's in-memory store, so a placed order was
  // invisible to the very next list_orders. These assert the write and the read
  // now hit the same database.
  it('a placed order is visible to listOrders and getOrder immediately', () => {
    const before = listOrders().length;
    const order = insertOrder({ product: 'Headphones', amount: 100 });

    expect(order.status).toBe('Processing');
    expect(listOrders()).toHaveLength(before + 1);
    expect(getOrder(order.id)).not.toBeNull();
    expect(getOrder(order.id)!.product).toBe('Headphones');
  });

  it('a placed order sorts to the top of the list (today beats every seed date)', () => {
    const order = insertOrder({ product: 'Monitor', amount: 450 });
    expect(listOrders()[0].id).toBe(order.id);
  });

  it('a deleted middle row cannot make a later insert reuse a live id', () => {
    const a = insertOrder({ product: 'Keyboard', amount: 80 });
    const b = insertOrder({ product: 'Mouse', amount: 40 });

    // Remove a MIDDLE row. A count-based id would now compute a number that is
    // still taken by `b` and the INSERT would fail on the PRIMARY KEY; deriving
    // from the highest existing suffix cannot.
    withDb((db) => db.prepare('DELETE FROM orders WHERE id = ?').run(a.id));

    const c = insertOrder({ product: 'Webcam', amount: 60 });
    expect(c.id).not.toBe(b.id);
    expect(getOrder(c.id)).not.toBeNull();
    expect(getOrder(b.id)).not.toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE orders SET status = 'Returned' WHERE id = ?").run('1001'),
    );

    const updated = getOrder('1001');
    expect(updated!.status).toBe('Returned');
  });
});
