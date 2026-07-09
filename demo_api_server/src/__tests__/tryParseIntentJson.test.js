'use strict';

const { __test: { tryParseIntentJson } } = require('../../services/geminiNlIntent');

describe('tryParseIntentJson', () => {
  it('parses clean JSON intent', () => {
    const r = tryParseIntentJson('{"kind":"vertical","vertical":"retail","action":"order_status","params":{}}');
    expect(r.action).toBe('order_status');
  });

  it('extracts JSON embedded in prose from small local models', () => {
    const r = tryParseIntentJson(
      'Sure, here you go:\n{"kind":"vertical","vertical":"retail","action":"checkout","params":{"product":"headphones","amount":600}}\nHope that helps!',
    );
    expect(r).toEqual({
      kind: 'vertical',
      vertical: 'retail',
      action: 'checkout',
      params: { product: 'headphones', amount: 600 },
    });
  });

  it('rejects kind:none', () => {
    expect(tryParseIntentJson('{"kind":"none","message":"nope"}')).toBeNull();
  });

  it('returns null for empty/non-json', () => {
    expect(tryParseIntentJson('')).toBeNull();
    expect(tryParseIntentJson('not json at all')).toBeNull();
  });
});
