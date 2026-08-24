'use strict';

/**
 * insertIdSqlMax.test.ts
 *
 * Finding #69 (round-6 audit): insertOrder()/insertExpense() derived their next
 * id's suffix by SELECTing every prior "<prefix>-new-%" row into Node and
 * reducing in JS to find the max — a per-call full-table scan whose cost grows
 * with every order/expense ever placed this session (O(N^2) cumulative across
 * N inserts). Both now use a single SQL MAX() aggregate instead, so SQLite
 * computes the max without shipping every row to Node.
 *
 * A pure query-shape optimization has no externally observable behavior
 * difference (retailDb.test.ts / workforceDb.test.ts already prove the
 * "highest existing suffix survives deletion" semantic is unchanged), so this
 * proves the fix via static source-text inspection — same technique as
 * configStore.envFallbackMapHoisted.test.js for finding #65.
 */

import fs from 'fs';
import path from 'path';

const retailSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'retailDb.ts'), 'utf8');
const workforceSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'workforceDb.ts'), 'utf8');

describe('insertOrder / insertExpense id generation uses SQL MAX(), not a JS reduce over every row', () => {
  it('retailDb.insertOrder computes the next id via a SQL MAX() aggregate', () => {
    expect(retailSrc).toMatch(/SELECT MAX\(CAST\(SUBSTR\(id, LENGTH\('ord-new-'\) \+ 1\) AS INTEGER\)\) AS maxN FROM orders WHERE id LIKE 'ord-new-%'/);
  });

  it('retailDb.insertOrder no longer reduces a full row set in JS to find the max', () => {
    expect(retailSrc).not.toMatch(/rows\.reduce\(\(max, r\) => \{\s*const n = Number\.parseInt\(String\(r\.id\)\.slice\('ord-new-'\.length\)/);
  });

  it('workforceDb.insertExpense computes the next id via a SQL MAX() aggregate', () => {
    expect(workforceSrc).toMatch(/SELECT MAX\(CAST\(SUBSTR\(id, LENGTH\('exp-new-'\) \+ 1\) AS INTEGER\)\) AS maxN FROM expenses WHERE id LIKE 'exp-new-%'/);
  });

  it('workforceDb.insertExpense no longer reduces a full row set in JS to find the max', () => {
    expect(workforceSrc).not.toMatch(/rows\.reduce\(\(max, r\) => \{\s*const n = Number\.parseInt\(String\(r\.id\)\.slice\('exp-new-'\.length\)/);
  });
});
