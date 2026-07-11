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

  it('repairs trailing commas and truncated JSON from small models', () => {
    expect(tryParseIntentJson('{"kind":"banking","banking":{"action":"accounts",}}'))
      .toEqual({ kind: 'banking', banking: { action: 'accounts' } });
    expect(tryParseIntentJson('{"kind":"vertical","vertical":"retail","action":"checkout","params":{}'))
      .toEqual({ kind: 'vertical', vertical: 'retail', action: 'checkout', params: {} });
  });

  it('rejects structurally invalid shapes instead of passing them to dispatch', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tryParseIntentJson('{"kind":"banking"}')).toBeNull();
    expect(tryParseIntentJson('{"kind":"made_up_kind","data":{}}')).toBeNull();
    expect(spy).toHaveBeenCalledWith('[llmContract]', expect.stringContaining('intent_shape_rejected'));
    spy.mockRestore();
  });
});
