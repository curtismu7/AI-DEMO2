import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripUnsourcedScope } from '../src/main-agent/scopeFilter.js';

const RAW = '{"membershipTier":"Silver","renewsOn":"2027-02-14","lifetimeSpend":412.9}';

test('drops a time span the raw output does not state', () => {
  const reply = 'Your renewal is about three years away. Your tier is Silver.';
  assert.equal(stripUnsourcedScope(reply, RAW), 'Your tier is Silver.');
});

test('drops a status the raw output does not state', () => {
  const reply = 'Your membership is in good standing. It renews on 2027-02-14.';
  assert.equal(stripUnsourcedScope(reply, RAW), 'It renews on 2027-02-14.');
});

test('drops a date that is not in the raw output', () => {
  const reply = 'It renews on 2026-08-01.';
  assert.equal(stripUnsourcedScope(reply, RAW), '');
});

test('keeps a sentence whose date and words all come from the raw output', () => {
  const reply = 'Your membership renews on 2027-02-14 and your tier is Silver.';
  assert.equal(stripUnsourcedScope(reply, RAW), reply);
});

test('keeps a span word the raw output also contains', () => {
  const raw = '{"renewsIn":"4 months"}';
  const reply = 'It renews in 4 months.';
  assert.equal(stripUnsourcedScope(reply, raw), reply);
});

test('a model turn with no tool data has its unsourced status claims dropped', async () => {
  const { textOfTurn } = await import('../src/main-agent/scopeFilter.js');
  const turn = [{ type: 'text', text: 'Your membership is in good standing with an active tier. ' }, { type: 'tool_use' }, { type: 'text', text: 'Tier: Silver.' }];
  assert.equal(textOfTurn(turn), 'Your membership is in good standing with an active tier. Tier: Silver.');
  assert.equal(stripUnsourcedScope(textOfTurn(turn), ''), 'Tier: Silver.');
});
