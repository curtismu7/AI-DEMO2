'use strict';

/**
 * Meridian Wealth (investment) tools — the vertical's OWN actions over its
 * OWN data store. No banking action names, no relabeling. Each handler
 * returns { result, render } where `render` is the manifest render-descriptor
 * key (the UI resolves the descriptor from the active manifest's `render`
 * block). Mirrors `../government/tools.js`'s `buildGovernmentTools(store)`
 * shape exactly, consuming `createInvestmentStore()`'s actual mutators
 * (`buySecurity`, `sellSecurity`, `deposit`, `withdraw`, `largeTrade`,
 * `rebalancePortfolio`) instead of government's.
 *
 * `large_trade` carries `authz: { stepUp: true, consent: true }`, mirroring
 * how government step-up-gates its own high-value action (`release_record`):
 * the investment manifest names "Large Trade" as this vertical's
 * `highValueAction` ("High-value trade or withdrawal from a managed
 * portfolio"), so it gets the same treatment here.
 */
function buildInvestmentTools(store) {
  const tools = [
    { name: 'view_portfolios', description: "List the client's investment portfolios (brokerage, retirement, trust).", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_holdings', description: 'List security holdings (symbol, quantity, market value) across the portfolios.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_trades', description: "List the client's recent trade history (buys, sells, dividends).", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_dividends', description: 'Show a summary of dividends received across the holdings.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_portfolio_value', description: "Show the client's total portfolio value across all accounts.", inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'buy_security', description: 'Buy shares of a security for the portfolio.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, shares: { type: 'number' }, price: { type: 'number' } }, required: ['symbol', 'shares'] }, scopes: ['write'], authz: {} },
    { name: 'sell_security', description: 'Sell shares of a security held in the portfolio.', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, shares: { type: 'number' }, price: { type: 'number' } }, required: ['symbol', 'shares'] }, scopes: ['write'], authz: {} },
    { name: 'deposit', description: 'Deposit funds into a managed portfolio.', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] }, scopes: ['write'], authz: {} },
    { name: 'withdraw', description: 'Withdraw funds from a managed portfolio.', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] }, scopes: ['write'], authz: {} },
    { name: 'large_trade', description: 'Execute a high-value trade or withdrawal from a managed portfolio (requires step-up + consent).', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, symbol: { type: 'string' }, amount: { type: 'number' } }, required: [] }, scopes: ['write'], authz: { stepUp: true, consent: true } },
    { name: 'rebalance_portfolio', description: "Rebalance a portfolio to its target allocation.", inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' } }, required: [] }, scopes: ['write'], authz: {} },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      case 'view_portfolios':
        return { result: { portfolios: store.get(userId).portfolios }, render: 'portfolios' };
      case 'view_holdings':
        return { result: { holdings: store.get(userId).holdings }, render: 'view_holdings' };
      case 'view_trades':
        return { result: { trades: store.get(userId).trades }, render: 'trades' };
      case 'view_dividends': {
        const dividends = store.get(userId).dividends || [];
        const totalDividends = Number(dividends.reduce((sum, d) => sum + (d.amount || 0), 0).toFixed(2));
        const period = (dividends[0] && dividends[0].period) || null;
        return { result: { totalDividends, period }, render: 'dividend_summary' };
      }
      case 'view_portfolio_value': {
        const portfolios = store.get(userId).portfolios || [];
        const value = Number(portfolios.reduce((sum, p) => sum + (p.value || 0), 0).toFixed(2));
        return { result: { portfolioType: 'Total', value }, render: 'portfolio_value' };
      }
      case 'buy_security':
        return { result: store.buySecurity(userId, params || {}), render: 'buy_security' };
      case 'sell_security':
        return { result: store.sellSecurity(userId, params || {}), render: 'sell_security' };
      case 'deposit':
        return { result: store.deposit(userId, params || {}), render: 'deposit' };
      case 'withdraw':
        return { result: store.withdraw(userId, params || {}), render: 'withdraw' };
      case 'large_trade': {
        // Consent/step-up showcase chips carry no symbol/amount — default the symbol to a
        // held security and a nominal amount so the security control runs against a real trade.
        // An amount-driven policy chip that DOES carry an amount keeps it (UC6/7/8 behavior).
        const _p = params || {};
        const _sym = _p.symbol || (store.get(userId).holdings[0] || {}).symbol || 'VTI';
        const _amt = _p.amount != null ? _p.amount : 100;
        return { result: store.largeTrade(userId, { ..._p, symbol: _sym, amount: _amt }), render: 'large_trade' };
      }
      case 'rebalance_portfolio':
        return { result: store.rebalancePortfolio(userId, params || {}), render: 'rebalance_portfolio' };
      case 'api_key_demo':
      case 'dual_token_demo':
        return { result: { data: {} }, render: 'text' };
      default:
        return { result: { error: `unknown tool: ${name}` }, render: 'text' };
    }
  }

  return { tools, execute };
}

module.exports = { buildInvestmentTools };
