'use strict';

const plugin = require('../config/verticals/retail');
const seed = require('../config/verticals/retail/seed.json');

describe('retail cash_out_store_credit balance cap', () => {
  test('rejects a cash-out request that exceeds the available store credit', async () => {
    const userId = 'cash-out-over-limit';
    const seeded = seed.rewards[0].storeCredit;

    const response = await plugin.executeTool('cash_out_store_credit', { amount: 50000 }, { userId });

    expect(response.result.error).toBeDefined();
    expect(response.result.cashedOut).toBeUndefined();

    // Balance must be untouched by the rejected attempt.
    const rewards = await plugin.executeTool('rewards_balance', {}, { userId });
    expect(rewards.result.storeCredit).toBe(seeded);
  });

  test('cashes out an amount within balance and decrements the stored balance', async () => {
    const userId = 'cash-out-within-limit';
    const seeded = seed.rewards[0].storeCredit;

    const response = await plugin.executeTool('cash_out_store_credit', { amount: 50 }, { userId });

    expect(response.result).toMatchObject({
      cashedOut: 50,
      to: 'external bank ****1234',
      status: 'pending step-up',
    });

    const rewards = await plugin.executeTool('rewards_balance', {}, { userId });
    expect(rewards.result.storeCredit).toBe(seeded - 50);
  });

  test('repeated cash-outs cannot drain more than the seeded balance', async () => {
    const userId = 'cash-out-repeated-drain';
    const seeded = seed.rewards[0].storeCredit;

    // First cash-out succeeds and depletes most of the balance.
    await plugin.executeTool('cash_out_store_credit', { amount: seeded }, { userId });

    // A second attempt against the now-zero balance must be rejected, not
    // repeatable "pending step-up" success.
    const second = await plugin.executeTool('cash_out_store_credit', { amount: 1 }, { userId });
    expect(second.result.error).toBeDefined();
    expect(second.result.cashedOut).toBeUndefined();

    const rewards = await plugin.executeTool('rewards_balance', {}, { userId });
    expect(rewards.result.storeCredit).toBe(0);
  });
});
