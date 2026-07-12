'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireScopes } = require('../middleware/auth');
const verticalDispatch = require('../services/verticalDispatch');

/**
 * Portfolio summary — backs the A2A Investment Advisor specialist's
 * get_portfolio_summary tool (demo_mcp_invest). Reuses the investment
 * vertical's existing per-user data store (config/verticals/investment/data.js)
 * so the A2A path reflects the same portfolio state the chat/heuristic path
 * already shows via view_portfolios/view_portfolio_value — no new data model.
 */
router.get('/accounts/:accountId/portfolio', authenticateToken, requireScopes(['read']), (req, res) => {
  const plugin = verticalDispatch.resolvePlugin('investment');
  const store = plugin.getDataStore();
  const data = store.get(req.user.id);
  res.json({
    accountId: req.params.accountId,
    portfolioId: data.profile.portfolioId,
    totalValue: data.profile.totalValue,
    cashSweep: data.profile.cashSweep,
    ytdReturnPct: data.profile.ytdReturnPct,
    riskProfile: data.profile.riskProfile,
    portfolios: data.portfolios,
  });
});

module.exports = router;
