'use strict';

/**
 * Per-vertical Meridian Wealth data store. Genuine investment objects
 * (portfolios, holdings, trades, dividends) keyed by userId — NOT relabeled
 * banking accounts. Mirrors the government/university verticals' `data.js`
 * contract (per-user clone-on-first-access + bound mutators), but keeps the
 * seed inline here instead of a companion `seed.json` since this vertical's
 * data.js is a single self-contained file.
 *
 * Seed values (portfolioId INV-8842, holder Jordan A. Rivera, totalValue
 * 184320.55, VTI/UST-10Y/AAPL/VNQ holdings) match the `/invest` feature-page
 * mock in demo_api_resource_server/server.js so the API-key path and the agent
 * tool path show the same demo portfolio.
 */

const SEED = {
  profile: {
    portfolioId: 'INV-8842',
    holder: 'Jordan A. Rivera',
    totalValue: 184320.55,
    cashSweep: 12580.10,
    ytdReturnPct: 11.4,
    riskProfile: 'Growth',
  },
  portfolios: [
    { id: 'PF-01', portfolioType: 'Brokerage', portfolioNumber: '****4471', value: 102340.20, currency: 'USD' },
    { id: 'PF-02', portfolioType: 'Retirement', portfolioNumber: '****9902', value: 68540.90, currency: 'USD' },
    { id: 'PF-03', portfolioType: 'Trust', portfolioNumber: '****1187', value: 13439.45, currency: 'USD' },
  ],
  holdings: [
    { symbol: 'VTI', name: 'Vanguard Total Market ETF', quantity: 220, marketValue: 62480.00 },
    { symbol: 'UST-10Y', name: 'US Treasury Note', quantity: null, marketValue: 60010.35 },
    { symbol: 'AAPL', name: 'Apple Inc.', quantity: 90, marketValue: 19260.00 },
    { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', quantity: 340, marketValue: 29990.10 },
  ],
  trades: [
    { id: 'TRD-3001', type: 'Buy', symbol: 'VTI', amount: 12000.00, date: '2026-05-02', status: 'Settled' },
    { id: 'TRD-3002', type: 'Sell', symbol: 'AAPL', amount: 4300.00, date: '2026-05-14', status: 'Settled' },
    { id: 'TRD-3003', type: 'Buy', symbol: 'VNQ', amount: 6200.00, date: '2026-06-01', status: 'Settled' },
    { id: 'TRD-3004', type: 'Dividend', symbol: 'VTI', amount: 184.32, date: '2026-06-15', status: 'Posted' },
  ],
  dividends: [
    { id: 'DIV-501', symbol: 'VTI', amount: 184.32, date: '2026-06-15', period: 'Q2 2026' },
    { id: 'DIV-502', symbol: 'AAPL', amount: 62.10, date: '2026-05-28', period: 'Q2 2026' },
    { id: 'DIV-503', symbol: 'VNQ', amount: 98.75, date: '2026-03-20', period: 'Q1 2026' },
  ],
};

/**
 * Per-user data store, structuredClone-isolated per userId (same pattern as
 * `../shared/createSeedStore`, hand-rolled here since the seed is inline
 * rather than loaded from a file). Mutators are bound to the calling user's
 * cloned data, matching government's `store.<mutator>(userId, args)` shape.
 */
function createInvestmentStore() {
  const byUser = new Map(); // userId -> cloned seed object
  let seq = 0;

  function get(userId) {
    const key = userId || 'anon';
    if (!byUser.has(key)) byUser.set(key, structuredClone(SEED));
    return byUser.get(key);
  }

  function resolvePortfolio(data, portfolioType) {
    return data.portfolios.find((p) => p.portfolioType === portfolioType) || data.portfolios[0];
  }

  function buySecurity(data, { symbol, shares, price } = {}) {
    seq += 1;
    const sym = symbol || 'VTI';
    const qty = shares != null ? Number(shares) : null;
    const px = price != null ? Number(price) : null;
    const amount = qty != null && px != null ? Number((qty * px).toFixed(2)) : 0;
    data.trades.unshift({ id: `TRD-new-${seq}`, type: 'Buy', symbol: sym, amount, date: '2026-07-04', status: 'Settled' });
    return { symbol: sym, shares: qty, price: px };
  }

  function sellSecurity(data, { symbol, shares, price } = {}) {
    seq += 1;
    const sym = symbol || 'VTI';
    const qty = shares != null ? Number(shares) : null;
    const px = price != null ? Number(price) : null;
    const amount = qty != null && px != null ? Number((qty * px).toFixed(2)) : 0;
    data.trades.unshift({ id: `TRD-new-${seq}`, type: 'Sell', symbol: sym, amount, date: '2026-07-04', status: 'Settled' });
    return { symbol: sym, shares: qty, price: px };
  }

  function deposit(data, { portfolioType, amount } = {}) {
    const portfolio = resolvePortfolio(data, portfolioType);
    const amt = Number(amount) || 0;
    portfolio.value = Number((portfolio.value + amt).toFixed(2));
    return { portfolioType: portfolio.portfolioType, amount: amt };
  }

  function withdraw(data, { portfolioType, amount } = {}) {
    const portfolio = resolvePortfolio(data, portfolioType);
    const amt = Number(amount) || 0;
    portfolio.value = Math.max(0, Number((portfolio.value - amt).toFixed(2)));
    return { portfolioType: portfolio.portfolioType, amount: amt };
  }

  function largeTrade(data, { portfolioType, symbol, amount } = {}) {
    seq += 1;
    const portfolio = resolvePortfolio(data, portfolioType);
    const sym = symbol || 'VTI';
    const amt = Number(amount) || 0;
    data.trades.unshift({ id: `TRD-new-${seq}`, type: 'Large Trade', symbol: sym, amount: amt, date: '2026-07-04', status: 'Settled' });
    return { portfolioType: portfolio.portfolioType, symbol: sym, amount: amt };
  }

  function rebalancePortfolio(data, { portfolioType } = {}) {
    const portfolio = resolvePortfolio(data, portfolioType);
    return { portfolioType: portfolio.portfolioType, status: 'Rebalanced' };
  }

  const mutators = { buySecurity, sellSecurity, deposit, withdraw, largeTrade, rebalancePortfolio };
  const store = { get };
  for (const [name, fn] of Object.entries(mutators)) {
    store[name] = (userId, ...args) => fn(get(userId), ...args);
  }
  return store;
}

module.exports = { createInvestmentStore };
