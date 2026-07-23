// demo_api_server/src/__tests__/nlIntentParser.retailPurchase.test.js
// Retail "recent purchase" must list orders; "large/big purchase" is Path A feature demo.
'use strict';

const { parseHeuristic, extractIntentAndConfidence } = require('../../services/nlIntentParser');

describe('nlIntentParser — retail recent vs large purchase', () => {
  it('routes "show my recent purchase" → list_orders (not vertical_feature_demo)', () => {
    const r = parseHeuristic('show my recent purchase', 'retail');
    expect(r.kind).toBe('vertical');
    expect(r.vertical).toBe('retail');
    expect(r.action).toBe('list_orders');
  });

  it('routes "my recent purchases" → list_orders', () => {
    const r = parseHeuristic('my recent purchases', 'retail');
    expect(r.kind).toBe('vertical');
    expect(r.action).toBe('list_orders');
  });

  it('routes "show my large purchase" → vertical_feature_demo', () => {
    const r = parseHeuristic('show my large purchase', 'retail');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('vertical_feature_demo');
  });

  it('routes bare "large purchase" → vertical_feature_demo', () => {
    const r = parseHeuristic('large purchase', 'retail');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('vertical_feature_demo');
  });
});

describe('extractIntentAndConfidence — retail checkout (UC22 intent binding)', () => {
  it('maps "checkout headphones for $150" to checkout (not unknown)', () => {
    const r = extractIntentAndConfidence('checkout headphones for $150');
    expect(r.intent).toBe('checkout');
    expect(r.toolName).toBe('checkout');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('maps "buy headphones for $600" to checkout', () => {
    const r = extractIntentAndConfidence('buy headphones for $600');
    expect(r.intent).toBe('checkout');
    expect(r.toolName).toBe('checkout');
  });
});
