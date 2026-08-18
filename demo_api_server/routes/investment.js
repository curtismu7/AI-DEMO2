'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireScopes } = require('../middleware/auth');
const verticalDispatch = require('../services/verticalDispatch');

// Ids the caller legitimately owns: the top-level investment account
// (profile.portfolioId, what GET /accounts returns) AND each of its sub-portfolio
// ids (data.portfolios[].id, e.g. PF-01). A :accountId matching none of these is
// foreign/unknown — 404 rather than silently serving the caller's own default
// portfolio under someone else's id.
function ownsAccount(data, accountId) {
  if (!data || !data.profile) return false;
  if (accountId === data.profile.portfolioId) return true;
  return Array.isArray(data.portfolios) && data.portfolios.some((p) => p.id === accountId);
}

/**
 * Portfolio summary — backs the A2A Investment Advisor specialist's
 * get_portfolio_summary tool (demo_mcp_resource_server). Reuses the investment
 * vertical's existing per-user data store (config/verticals/investment/data.js)
 * so the A2A path reflects the same portfolio state the chat/heuristic path
 * already shows via view_portfolios/view_portfolio_value — no new data model.
 */
// Accept 'read' (regular session tokens) OR 'invest:read' (A2A nested-act tokens from mcp-resource-server).
router.get('/accounts/:accountId/portfolio', authenticateToken, requireScopes(['read', 'invest:read']), (req, res) => {
  const plugin = verticalDispatch.resolvePlugin('investment');
  const store = plugin.getDataStore();
  const data = store.get(req.user.id);
  if (!ownsAccount(data, req.params.accountId)) {
    return res.status(404).json({ error: 'account not found', accountId: req.params.accountId, status: 'not_found' });
  }
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

// The other three demo_mcp_resource_server invest tools (get_investment_accounts,
// get_investment_balance, get_investment_transactions — investToolHandler.ts)
// called these three endpoints, but only /portfolio was ever implemented; every
// call to the other three 404'd. Same per-user store, same auth/scope pattern.
//
// This vertical has exactly one investment account per user (the seed's single
// portfolioId), so "accounts" is a one-element list — matches
// get_investment_accounts' "List all investment accounts" description without
// inventing a multi-account model the data store doesn't have.
router.get('/accounts', authenticateToken, requireScopes(['read', 'invest:read']), (req, res) => {
  const plugin = verticalDispatch.resolvePlugin('investment');
  const store = plugin.getDataStore();
  const data = store.get(req.user.id);
  res.json({
    accounts: [{
      id: data.profile.portfolioId,
      holder: data.profile.holder,
      totalValue: data.profile.totalValue,
      riskProfile: data.profile.riskProfile,
    }],
  });
});

router.get('/accounts/:accountId/balance', authenticateToken, requireScopes(['read', 'invest:read']), (req, res) => {
  const plugin = verticalDispatch.resolvePlugin('investment');
  const store = plugin.getDataStore();
  const data = store.get(req.user.id);
  if (!ownsAccount(data, req.params.accountId)) {
    return res.status(404).json({ error: 'account not found', accountId: req.params.accountId, status: 'not_found' });
  }
  res.json({
    accountId: req.params.accountId,
    totalValue: data.profile.totalValue,
    cashSweep: data.profile.cashSweep,
    ytdReturnPct: data.profile.ytdReturnPct,
    riskProfile: data.profile.riskProfile,
    holdings: data.holdings,
  });
});

// data.trades already covers buys/sells/dividends — the exact set
// get_investment_transactions describes. `limit` is re-validated here even
// though the MCP tool handler clamps it first, since this route is reachable
// on its own (not only via that one caller).
router.get('/accounts/:accountId/transactions', authenticateToken, requireScopes(['read', 'invest:read']), (req, res) => {
  const plugin = verticalDispatch.resolvePlugin('investment');
  const store = plugin.getDataStore();
  const data = store.get(req.user.id);
  const parsed = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
  res.json({
    accountId: req.params.accountId,
    transactions: data.trades.slice(0, limit),
  });
});

module.exports = router;
