'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { A2A_SPECIALISTS, specialistForVertical, verticalsWithSpecialist } = require('../config/a2aSpecialists');
const { VERTICALS, listUseCases, resolveUseCase } = require('../config/useCases');
const seed = require('../config/verticals/abercrombie-fitch/seed.json');
const plugin = require('../config/verticals/abercrombie-fitch');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { verticalManifest } = require('../services/verticalManifest');

const VERTICAL = 'abercrombie-fitch';

function actionFor(message) {
  const parsed = parseHeuristic(message, VERTICAL, resolveVerticalCtx(VERTICAL), {});
  return parsed?.banking?.action ?? parsed?.action ?? null;
}

describe('Abercrombie & Fitch vertical clone', () => {
  beforeAll(() => {
    verticalManifest.init();
  });

  test('is independently discoverable with A&F branding and a local logo', () => {
    const manifest = verticalManifest.resolver.resolve(VERTICAL);
    expect(manifest.identity).toMatchObject({
      displayName: 'Abercrombie & Fitch',
      logoPath: '/branding/abercrombie-fitch-logo.svg',
    });
    expect(
      fs.existsSync(path.join(__dirname, '..', '..', 'demo_api_ui', 'public', manifest.identity.logoPath)),
    ).toBe(true);
    expect(verticalManifest.list().map((entry) => entry.id)).toContain(VERTICAL);
    expect(verticalManifest.resolver.resolve('retail').identity.displayName).toBe('Great Buy');
  });

  test.each([
    ['show my A&F orders', 'list_anf_orders'],
    ['track my order at A&F', 'order_status'],
    ['show my reward points at A&F', 'rewards_balance'],
    ['show my saved items at A&F', 'view_wishlist'],
    ['show my A&F returns', 'view_returns'],
    ['show my sensitive A&F order history', 'sensitive_order_history'],
  ])('routes the A&F request "%s" to %s', (message, expectedAction) => {
    expect(actionFor(message)).toBe(expectedAction);
  });

  test('returns A&F order and rewards values from its own seed', async () => {
    const orders = await plugin.executeTool('list_anf_orders', {}, { userId: 'anf-ground-truth' });
    const rewards = await plugin.executeTool('rewards_balance', {}, { userId: 'anf-ground-truth' });

    expect(orders.result.orders).toEqual(seed.orders);
    expect(rewards.result).toEqual(seed.rewards[0]);
    expect(JSON.stringify(orders.result)).toMatch(/Essential Popover Hoodie/);
    expect(JSON.stringify(orders.result)).not.toMatch(/AirPods|MacBook|Great Buy/i);
  });

  test('returns an A&F-specific sensitive response grounded in the same seed', async () => {
    const response = await plugin.executeTool(
      'sensitive_order_history',
      {},
      { userId: 'anf-sensitive-ground-truth' },
    );

    expect(response.result.data.orders[0]).toMatchObject({
      orderId: seed.orders[0].id,
      item: seed.orders[0].product,
      size: seed.orders[0].size,
      total: seed.orders[0].amount,
      paymentLast4: seed.payment_methods[0].last4,
    });
  });

  test('owns complete A&F catalog bindings without leaking Great Buy requests', () => {
    expect(VERTICALS).toContain(VERTICAL);
    expect(resolveUseCase('UC1', VERTICAL)).toMatchObject({
      primaryTool: 'list_anf_orders',
      trigger: { text: 'show my A&F orders' },
    });
    expect(resolveUseCase('UC6', VERTICAL)).toMatchObject({
      primaryTool: 'checkout',
      trigger: { text: 'checkout A&F outerwear for $2500' },
    });
    expect(resolveUseCase('UC28', VERTICAL)).toMatchObject({
      primaryTool: 'request_price_adjustment',
      trigger: { text: 'can you request a price adjustment on my A&F order?' },
    });
    const chipText = listUseCases(VERTICAL)
      .filter((useCase) => useCase.trigger?.type === 'chip')
      .map((useCase) => useCase.trigger.text)
      .join(' ');
    expect(chipText).not.toMatch(/Great Buy|headphones/i);
  });

  test('reuses the provisioned purchase specialist through an explicit alias', () => {
    expect(verticalsWithSpecialist()).toContain(VERTICAL);
    expect(specialistForVertical(VERTICAL)).toBe(A2A_SPECIALISTS.retail);
    expect(resolveUseCase('UC2', VERTICAL).primaryTool).toBe('sensitive_order_history');
  });
});
