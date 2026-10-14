import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripUnsourcedScope } from '../src/main-agent/scopeFilter.js';

const ANALYST = 'ORD-9982 2025-12-01 249.99 delivered\nORD-8841 2025-10-14 89.00 returned';

test('drops a scope claim the analyst never made and keeps the rest', () => {
  const reply = 'Here are the orders for demoUser.\n\nThese are the only orders returned by the lookup. ORD-8841 was returned.';
  const out = stripUnsourcedScope(reply, ANALYST);
  assert.ok(!out.includes('only'));
  assert.ok(out.includes('ORD-8841 was returned.'));
  assert.ok(out.includes('Here are the orders'));
});

test('keeps a scope word the analyst used', () => {
  const analyst = 'These are the only two orders on file.';
  const reply = 'The analyst found only two orders.';
  assert.equal(stripUnsourcedScope(reply, analyst), reply);
});

test('drops "most recent" and "latest" claims', () => {
  const reply = 'These are the two most recent orders. The latest is ORD-9982.';
  const out = stripUnsourcedScope(reply, ANALYST);
  assert.ok(!out.includes('most recent'));
  assert.ok(!out.includes('latest'));
});

test('keeps decimals and table rows that contain no scope words', () => {
  const reply = 'ORD-9982 cost $249.99 and was delivered.';
  assert.equal(stripUnsourcedScope(reply, ANALYST), reply);
});
