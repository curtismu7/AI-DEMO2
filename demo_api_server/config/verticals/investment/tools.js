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
 * `large_trade` carries `authz: { consent: true }`, matching retail `checkout`
 * and every other vertical's UC6/7/8 amount tool. It previously also declared
 * `stepUp: true`, mirroring government's `release_record` — but release_record
 * is not an amount tool. gen-vertical-tools resolves stepUp before consent, so
 * that made challengeType 'step_up' and the live MCP policy answered step-up
 * for UC8's $300 where the catalog expects HITL (a ProofStrip Mismatch).
 * The MCP obligation is amount-independent, so UC7's $600 step-up comes from
 * the use-case catalog's declared stepUpMethod re-labelling the HITL.
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
    { name: 'deposit', description: 'Deposit funds into a managed portfolio.', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, amount: { type: 'number' } }, required: ['amount', 'portfolioType'] }, scopes: ['write'], authz: {} },
    { name: 'withdraw', description: 'Withdraw funds from a managed portfolio.', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, amount: { type: 'number' } }, required: ['amount', 'portfolioType'] }, scopes: ['write'], authz: {} },
    { name: 'large_trade', description: 'Execute a high-value trade or withdrawal from a managed portfolio (requires step-up + consent).', inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' }, symbol: { type: 'string' }, amount: { type: 'number' } }, required: [] }, scopes: ['write'], authz: { consent: true } },
    { name: 'rebalance_portfolio', description: "Rebalance a portfolio to its target allocation.", inputSchema: { type: 'object', properties: { portfolioType: { type: 'string' } }, required: [] }, scopes: ['write'], authz: {} },
    { name: 'sensitive_holdings', description: 'Access sensitive holdings detail including cost basis and tax lots. Requires explicit user consent.', inputSchema: { type: 'object', properties: {}, required: [] }, scopes: ['read'], authz: { consent: true } },
    {
      // The agent can only REQUEST a fee-tier review (logged for human review) —
      // no tool can change the tier. The tool set is the authorization boundary (UC28).
      name: 'request_fee_tier_review',
      description: 'Submit a fee-tier review request for human review. Cannot change the fee tier.',
      inputSchema: { type: 'object', properties: { portfolioId: { type: 'string' } } },
      scopes: ['write'],
      authz: {},
    },
    { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      case 'request_fee_tier_review': {
        // Request ONLY — deliberately changes no fee tier. The one-click chip carries
        // no id, so default to the client's first portfolio.
        const _rows = store.get(userId).portfolios || [];
        const _want = params && (params.portfolioId || params.recordId);
        const _rec = _want ? _rows.find((r) => r.id === _want) : _rows[0];
        if (!_rec) return { result: { error: 'portfolio not found' }, render: 'text' };
        return {
          result: {
            requestId: `REQ-${_rec.id}`,
            portfolioId: _rec.id,
            status: 'Submitted for human review',
            note: 'This request does not change the fee tier.',
          },
          render: 'request_fee_tier_review',
        };
      }
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
      case 'deposit': {
        const deposited = store.deposit(userId, params || {});
        if (deposited && deposited.error) return { result: deposited, render: 'text' };
        return { result: deposited, render: 'deposit' };
      }
      case 'withdraw': {
        const withdrawn = store.withdraw(userId, params || {});
        if (withdrawn && withdrawn.error) return { result: withdrawn, render: 'text' };
        return { result: withdrawn, render: 'withdraw' };
      }
      case 'large_trade': {
        // Consent/step-up showcase chips carry no symbol/amount — default the symbol to a
        // held security and a nominal amount so the security control runs against a real trade.
        // An amount-driven policy chip that DOES carry an amount keeps it (UC6/7/8 behavior).
        const _p = params || {};
        const _sym = _p.symbol || (store.get(userId).holdings[0] || {}).symbol || 'VTI';
        const _amt = _p.amount != null ? _p.amount : 100;
        const traded = store.largeTrade(userId, { ..._p, symbol: _sym, amount: _amt });
        if (traded && traded.error) return { result: traded, render: 'text' };
        return { result: traded, render: 'large_trade' };
      }
      case 'rebalance_portfolio': {
        const rebalanced = store.rebalancePortfolio(userId, params || {});
        if (rebalanced && rebalanced.error) return { result: rebalanced, render: 'text' };
        return { result: rebalanced, render: 'rebalance_portfolio' };
      }
      case 'sensitive_holdings':
        return { result: { holdings: store.get(userId).holdings, note: 'Sensitive cost-basis / tax-lot detail' }, render: 'text' };
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
