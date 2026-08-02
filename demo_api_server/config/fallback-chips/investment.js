// Tools copied from config/verticals/investment/manifest.json (dashboard.chips10)
// — never from another vertical's manifest. That manifest tags no useCaseId on
// its chips, so these carry the vertical-agnostic 'delegated-access-with-proof'
// case (config/useCases.js) the other verticals use for delegated reads.
module.exports = [
  { id: 'inv1', label: 'My portfolios', message: 'show my portfolios', mode: 'both', tool: 'view_portfolios', useCaseId: 'delegated-access-with-proof' },
  { id: 'inv2', label: 'Trade history', message: 'show my trade history', mode: 'both', tool: 'view_trades', useCaseId: 'delegated-access-with-proof' },
  { id: 'inv3', label: 'My holdings', message: 'show my holdings', mode: 'both', tool: 'view_holdings', useCaseId: 'delegated-access-with-proof' },
  { id: 'inv4', label: 'Portfolio status', message: 'show portfolio status', mode: 'both', tool: 'show_investment', useCaseId: 'delegated-access-with-proof' },
  { id: 'inv-direct', label: 'Direct MCP', message: 'show my portfolios', mode: 'direct', tool: 'view_portfolios', useCaseId: 'delegated-access-with-proof' },
];
