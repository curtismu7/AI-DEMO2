'use strict';
/**
 * Canary: investment deposit/withdraw must honour the named portfolioType.
 *
 * resolvePortfolio used to fall back to portfolios[0] (Brokerage) whenever the
 * named type missed — so "withdraw $500 from my IRA" (or any typo / unknown
 * type the LLM invents) silently mutated Brokerage and reported success with
 * portfolioType: 'Brokerage'.
 *
 * Same class of bug as manufacturing releaseWorkOrder / government payFee
 * (#1489): honour the named key only; chips that omit portfolioType may still
 * default to the first portfolio.
 */
const { createInvestmentStore } = require('../config/verticals/investment/data');
const { buildInvestmentTools } = require('../config/verticals/investment/tools');

describe('investment resolvePortfolio type honour', () => {
  it('does not deposit into Brokerage when portfolioType is unknown', () => {
    const store = createInvestmentStore();
    const before = structuredClone(store.get('u1').portfolios);

    const result = store.deposit('u1', { portfolioType: 'IRA', amount: 500 });
    expect(result.error).toBe('portfolio not found');
    expect(result.status).toBe('not_found');
    expect(store.get('u1').portfolios).toEqual(before);
  });

  it('does not withdraw from Brokerage when portfolioType is unknown', () => {
    const store = createInvestmentStore();
    const before = structuredClone(store.get('u1').portfolios);

    const result = store.withdraw('u1', { portfolioType: 'Roth', amount: 250 });
    expect(result.error).toBe('portfolio not found');
    expect(store.get('u1').portfolios).toEqual(before);
  });

  it('deposits into the named Retirement portfolio (case-insensitive)', () => {
    const store = createInvestmentStore();
    const beforeRetirement = store.get('u1').portfolios.find((p) => p.portfolioType === 'Retirement').value;
    const beforeBrokerage = store.get('u1').portfolios.find((p) => p.portfolioType === 'Brokerage').value;

    const result = store.deposit('u1', { portfolioType: 'retirement', amount: 1000 });
    expect(result.error).toBeUndefined();
    expect(result.portfolioType).toBe('Retirement');
    expect(result.amount).toBe(1000);

    const after = store.get('u1').portfolios;
    expect(after.find((p) => p.portfolioType === 'Retirement').value).toBe(beforeRetirement + 1000);
    expect(after.find((p) => p.portfolioType === 'Brokerage').value).toBe(beforeBrokerage);
  });

  it('omitted portfolioType still defaults to first portfolio (chip path)', () => {
    const store = createInvestmentStore();
    const result = store.largeTrade('u1', { symbol: 'VTI', amount: 100 });
    expect(result.error).toBeUndefined();
    expect(result.portfolioType).toBe('Brokerage');
  });

  it('agent tool path with a bad portfolioType does not mutate another portfolio', async () => {
    const store = createInvestmentStore();
    const { execute } = buildInvestmentTools(store);
    const before = structuredClone(store.get('u1').portfolios);

    const out = await execute('withdraw', { portfolioType: 'IRA', amount: 500 }, { userId: 'u1' });
    expect(out.result.error).toBe('portfolio not found');
    expect(out.render).toBe('text');
    expect(store.get('u1').portfolios).toEqual(before);
  });
});
