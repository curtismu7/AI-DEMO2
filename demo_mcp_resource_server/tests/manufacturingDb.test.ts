'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manufacturing-db-'));
process.env.MANUFACTURING_DB_PATH = path.join(tmpDir, 'manufacturing.db');
process.env.MANUFACTURING_SEED_PATH = path.join(__dirname, '..', 'seed', 'manufacturing.seed.json');

import { getWorkOrder, listWorkOrders, withDb } from '../src/db/manufacturingDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('manufacturingDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.MANUFACTURING_DB_PATH as string)).toBe(true);
    expect(listWorkOrders()).toHaveLength(4);
  });

  it('lists all work orders ordered by due date ascending', () => {
    const workOrders = listWorkOrders();
    expect(workOrders).toHaveLength(4);
    expect(workOrders[0].id).toBe('WO-4004');
    expect(workOrders[0].dueDate).toBe('2026-06-20');
    expect(workOrders[3].dueDate).toBe('2026-07-12');
  });

  it('retrieves a single work order by ID', () => {
    const workOrder = getWorkOrder('WO-4001');
    expect(workOrder).not.toBeNull();
    expect(workOrder!.product).toBe('Bracket Assembly A12');
    expect(workOrder!.type).toBe('Assembly');
    expect(workOrder!.status).toBe('In Production');
  });

  it('returns null for a nonexistent work order', () => {
    expect(getWorkOrder('NOPE')).toBeNull();
  });

  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) =>
      db.prepare("UPDATE workOrders SET status = 'Completed' WHERE id = ?").run('WO-4002'),
    );

    const updated = getWorkOrder('WO-4002');
    expect(updated!.status).toBe('Completed');
  });
});
