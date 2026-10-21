'use strict';

const { dispatchBankingAction } = require('../../services/demoAgentLangGraphService');

describe('dispatchBankingAction unknown-action fallback', () => {
  it('keeps banking example prompts for the banking vertical', async () => {
    const r = await dispatchBankingAction('jwt_decode_demo', {}, 'u1', { vertical: 'banking' });
    expect(r.reply).toMatch(/show my accounts/);
  });

  it('uses the active vertical catalog instead of banking prompts elsewhere', async () => {
    const r = await dispatchBankingAction('jwt_decode_demo', {}, 'u1', {
      vertical: 'banking',
      catalogCtx: {
        terminology: { account: 'portfolio', accounts: 'portfolios' },
        chips: [{ label: 'Portfolio summary', message: 'show my portfolio', mode: 'both' }],
      },
    });
    expect(r.success).toBe(false);
    expect(r.reply).not.toMatch(/show my accounts/);
    expect(r.reply).toMatch(/show my portfolio/);
  });
});
