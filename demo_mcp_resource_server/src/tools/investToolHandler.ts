'use strict';

/**
 * Investment tool execution handlers.
 *
 * Two backends, chosen at call time (see dispatchTool):
 *  - BANKING_API_BASE_URL / DEMO_API_BASE_URL set: proxy to the banking_api_server
 *    BFF using the caller's delegated token (live AI-DEMO2 deployment — real
 *    per-user session data).
 *  - Neither set: read from this server's own bundled SQLite database
 *    (investDb.ts), same as every other vertical. This is what makes the
 *    standalone/handoff deployment work with no banking API at all.
 */

import axios from 'axios';
import https from 'node:https';
import { getHoldings, getPortfolios, listTrades, ownsAccount, resolveInvestor } from '../db/investDb';

// Whether a banking API is configured at all — the switch dispatchTool uses to
// pick BFF-proxy vs. bundled-SQLite. Checked separately from BANKING_API_BASE's
// own (pre-existing) localhost fallback below, so that fallback still applies
// once the BFF path is actually chosen.
const BFF_CONFIGURED = Boolean(process.env.BANKING_API_BASE_URL || process.env.DEMO_API_BASE_URL);

// BANKING_API_BASE_URL is used in native mode (.env.example); Docker Compose sets
// DEMO_API_BASE_URL instead — fall through to it before the localhost default.
const BANKING_API_BASE = process.env.BANKING_API_BASE_URL || process.env.DEMO_API_BASE_URL || 'http://localhost:3001';
// Dev/staging uses a self-signed mkcert cert (api.ping.demo) that is trusted on the
// host but not inside Docker containers. Disable TLS verification for the internal hop.
const devHttpsAgent = BANKING_API_BASE.startsWith('https')
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

// Investment transaction pages are small; cap the caller-supplied limit so a
// malformed or oversized value can't distort the BFF query.
const MAX_TRANSACTION_LIMIT = 100;
const DEFAULT_TRANSACTION_LIMIT = 20;

// Resolve `limit` to a bounded positive integer. Absent/garbage values fall back
// to the default; 0 or negatives clamp to 1 (never silently the default, as the
// old `args.limit || 20` did); anything above the cap clamps down.
function resolveTransactionLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TRANSACTION_LIMIT;
  const int = Math.trunc(n);
  if (int < 1) return 1;
  return Math.min(int, MAX_TRANSACTION_LIMIT);
}

async function callBff(path: string, token: string): Promise<unknown> {
  const response = await axios.get(`${BANKING_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
    ...(devHttpsAgent && { httpsAgent: devHttpsAgent }),
  });
  return response.data;
}

export async function handleGetInvestmentAccounts(
  _args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  return callBff('/api/investment/accounts', token);
}

export async function handleGetInvestmentBalance(
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const accountId = args.account_id as string;
  return callBff(`/api/investment/accounts/${encodeURIComponent(accountId)}/balance`, token);
}

export async function handleGetPortfolioSummary(
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const accountId = args.account_id as string;
  const period = (args.period as string) || '1m';
  return callBff(
    `/api/investment/accounts/${encodeURIComponent(accountId)}/portfolio?period=${encodeURIComponent(String(period))}`,
    token,
  );
}

export async function handleGetInvestmentTransactions(
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const accountId = args.account_id as string;
  const limit = resolveTransactionLimit(args.limit);
  return callBff(
    `/api/investment/accounts/${encodeURIComponent(accountId)}/transactions?limit=${limit}`,
    token,
  );
}

// --- SQLite-backed handlers (no banking API configured) ------------------
// Same response shapes as the BFF routes above (demo_api_server/routes/investment.js)
// so a caller sees identical fields regardless of which backend answered.

function accountNotFound(accountId: string): { error: string; accountId: string; status: string } {
  return { error: 'account not found', accountId, status: 'not_found' };
}

function handleGetInvestmentAccountsSqlite(subject: string): unknown {
  const resolved = resolveInvestor(subject);
  if (!resolved) return { accounts: [] };
  const { investor } = resolved;
  return {
    accounts: [{
      id: investor.portfolio_id,
      holder: investor.holder,
      totalValue: investor.total_value,
      riskProfile: investor.risk_profile,
    }],
  };
}

function handleGetInvestmentBalanceSqlite(args: Record<string, unknown>, subject: string): unknown {
  const accountId = args.account_id as string;
  const resolved = resolveInvestor(subject);
  if (!resolved) return accountNotFound(accountId);
  const { investor } = resolved;
  const portfolios = getPortfolios(investor.investor_id);
  if (!ownsAccount(investor, portfolios, accountId)) return accountNotFound(accountId);
  return {
    accountId,
    totalValue: investor.total_value,
    cashSweep: investor.cash_sweep,
    ytdReturnPct: investor.ytd_return_pct,
    riskProfile: investor.risk_profile,
    holdings: getHoldings(investor.investor_id).map((h) => ({
      symbol: h.symbol, name: h.name, quantity: h.quantity, marketValue: h.market_value,
    })),
  };
}

// `period` is accepted (and validated) but not applied to the returned figures —
// same no-op as the BFF route this mirrors (demo_api_server/routes/investment.js).
function handleGetPortfolioSummarySqlite(args: Record<string, unknown>, subject: string): unknown {
  const accountId = args.account_id as string;
  const resolved = resolveInvestor(subject);
  if (!resolved) return accountNotFound(accountId);
  const { investor } = resolved;
  const portfolios = getPortfolios(investor.investor_id);
  if (!ownsAccount(investor, portfolios, accountId)) return accountNotFound(accountId);
  return {
    accountId,
    portfolioId: investor.portfolio_id,
    totalValue: investor.total_value,
    cashSweep: investor.cash_sweep,
    ytdReturnPct: investor.ytd_return_pct,
    riskProfile: investor.risk_profile,
    portfolios: portfolios.map((p) => ({
      id: p.id, portfolioType: p.portfolio_type, portfolioNumber: p.portfolio_number, value: p.value, currency: p.currency,
    })),
  };
}

function handleGetInvestmentTransactionsSqlite(args: Record<string, unknown>, subject: string): unknown {
  const accountId = args.account_id as string;
  const limit = resolveTransactionLimit(args.limit);
  const resolved = resolveInvestor(subject);
  if (!resolved) return accountNotFound(accountId);
  const { investor } = resolved;
  const portfolios = getPortfolios(investor.investor_id);
  if (!ownsAccount(investor, portfolios, accountId)) return accountNotFound(accountId);
  return {
    accountId,
    transactions: listTrades(investor.investor_id, limit).map((t) => ({
      id: t.id, type: t.type, symbol: t.symbol, amount: t.amount, date: t.date, status: t.status,
    })),
  };
}

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  subject: string,
): Promise<unknown> {
  if (!BFF_CONFIGURED) {
    switch (toolName) {
      case 'get_investment_accounts': return handleGetInvestmentAccountsSqlite(subject);
      case 'get_investment_balance': return handleGetInvestmentBalanceSqlite(args, subject);
      case 'get_portfolio_summary': return handleGetPortfolioSummarySqlite(args, subject);
      case 'get_investment_transactions': return handleGetInvestmentTransactionsSqlite(args, subject);
      default: throw new Error(`Unknown investment tool: ${toolName}`);
    }
  }
  switch (toolName) {
    case 'get_investment_accounts': return handleGetInvestmentAccounts(args, token);
    case 'get_investment_balance': return handleGetInvestmentBalance(args, token);
    case 'get_portfolio_summary': return handleGetPortfolioSummary(args, token);
    case 'get_investment_transactions': return handleGetInvestmentTransactions(args, token);
    default: throw new Error(`Unknown investment tool: ${toolName}`);
  }
}
