'use strict';

const { createVerticalPlugin } = require('../shared/createVerticalPlugin');
const { createInvestmentStore } = require('./data');
const { buildInvestmentTools } = require('./tools');

const store = createInvestmentStore();
const { tools, execute } = buildInvestmentTools(store);

const HEURISTICS = [
  /* PACK:heuristics:start */
  { re: /\bbuy\b.*\b(security|securities|stock|shares?|etf)\b|\bpurchase\b.*\b(security|stock|shares?|etf)\b/i, action: 'buy_security', extractsAmount: true, paramHint: 'e.g. "buy 10 shares of VTI"' },
  { re: /\bsell\b.*\b(security|securities|stock|shares?|etf)\b/i, action: 'sell_security', extractsAmount: true, paramHint: 'e.g. "sell 5 shares of AAPL"' },
  { re: /\blarge\s+trade\b|\bhigh[-\s]?value\s+trade\b/i, action: 'large_trade', extractsAmount: true, paramHint: 'e.g. "execute a large trade of $50,000 in VTI"' },
  { re: /\brebalance\b.*\bportfolio\b|\bportfolio\b.*\brebalance\b/i, action: 'rebalance_portfolio' },
  { re: /\bdeposit\b/i, action: 'deposit', extractsAmount: true, paramHint: 'e.g. "deposit $1,000 into my brokerage portfolio"' },
  { re: /\bwithdraw\b/i, action: 'withdraw', extractsAmount: true, paramHint: 'e.g. "withdraw $500 from my retirement portfolio"' },
  { re: /\bdividends?\b/i, action: 'view_dividends' },
  { re: /\btrades?\b|\btrade\s+history\b/i, action: 'view_trades' },
  { re: /\bholdings?\b|\bsecurities\b/i, action: 'view_holdings' },
  { re: /\bportfolio\s+value\b|\btotal\s+value\b/i, action: 'view_portfolio_value' },
  { re: /\bportfolios?\b/i, action: 'view_portfolios' },
  /* PACK:heuristics:end */
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'client';
  return [
    'You are Meridian Wealth\'s Wealth Assistant (Meridian), an investment and portfolio-management helper.',
    'You help clients view portfolios, holdings, trade history, and dividends, and place trades, deposits,',
    'withdrawals, and rebalances — including large trades that require step-up verification and consent.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed investment actions; never reference banking-account or permit/licensing concepts.',
  ].join(' ');
}

module.exports = createVerticalPlugin({ id: 'investment', store, tools, execute, heuristics: HEURISTICS, systemPrompt });
