'use strict';

/**
 * Investment tool execution handlers.
 *
 * Two backends, chosen per call (see dispatchTool):
 *  - BANKING_API_BASE_URL (or DEMO_API_BASE_URL, which the AI-DEMO2 Compose
 *    stack sets) configured: proxy to the banking_api_server BFF using the
 *    caller's delegated token — real per-user session data.
 *  - Neither set: read this server's own bundled SQLite database (investDb.ts),
 *    same as every other vertical. This is what lets the standalone/handoff
 *    deployment run with no banking API at all.
 */

import axios from 'axios';
import https from 'node:https';
import {
  Investor, Portfolio, getHoldings, getPortfolios, listTrades, ownsAccount, resolveInvestor,
} from '../db/investDb';

// Read per call, not at module load, so the backend choice always reflects the
// current env — the rest of this repo reads process.env the same way.
function bffBase(): string | undefined {
  return process.env.BANKING_API_BASE_URL || process.env.DEMO_API_BASE_URL;
}

// Dev/staging uses a self-signed mkcert cert (api.ping.demo) that is trusted on the
// host but not inside Docker containers. Disable TLS verification for the internal hop.
const devHttpsAgent = new https.Agent({ rejectUnauthorized: false });

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
  const base = bffBase();
  const response = await axios.get(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
    ...(base?.startsWith('https') && { httpsAgent: devHttpsAgent }),
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
// Transactions come back in store order (seed order), as the BFF returns them.
// One deliberate difference: the BFF's transactions route does not check that
// account_id belongs to the investor; this path does, like balance and summary.

// Thrown, not returned, so index.ts reports it as isError:true — the same
// MCP-level signal the BFF path gives when its 404 makes axios throw.
function accountNotFound(accountId: string): never {
  throw new Error(`account not found: ${accountId}`);
}

// The investor and their portfolios, provided accountId is one of theirs
// (the top-level portfolio id or a sub-portfolio id).
function ownedAccount(accountId: string): { investor: Investor; portfolios: Portfolio[] } {
  const investor = resolveInvestor();
  if (!investor) return accountNotFound(accountId);
  const portfolios = getPortfolios(investor.investor_id);
  if (!ownsAccount(investor, portfolios, accountId)) return accountNotFound(accountId);
  return { investor, portfolios };
}

function accountsSqlite(): unknown {
  const investor = resolveInvestor();
  if (!investor) return { accounts: [] };
  return {
    accounts: [{
      id: investor.portfolio_id,
      holder: investor.holder,
      totalValue: investor.total_value,
      riskProfile: investor.risk_profile,
    }],
  };
}

function balanceSqlite(args: Record<string, unknown>): unknown {
  const accountId = args.account_id as string;
  const { investor } = ownedAccount(accountId);
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

// `period` is accepted but not applied to the returned figures — the same
// no-op as the BFF route this mirrors.
function summarySqlite(args: Record<string, unknown>): unknown {
  const accountId = args.account_id as string;
  const { investor, portfolios } = ownedAccount(accountId);
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

function transactionsSqlite(args: Record<string, unknown>): unknown {
  const accountId = args.account_id as string;
  const limit = resolveTransactionLimit(args.limit);
  const { investor } = ownedAccount(accountId);
  return { accountId, transactions: listTrades(investor.investor_id, limit) };
}

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const sqlite = !bffBase();
  switch (toolName) {
    case 'get_investment_accounts': return sqlite ? accountsSqlite() : handleGetInvestmentAccounts(args, token);
    case 'get_investment_balance': return sqlite ? balanceSqlite(args) : handleGetInvestmentBalance(args, token);
    case 'get_portfolio_summary': return sqlite ? summarySqlite(args) : handleGetPortfolioSummary(args, token);
    case 'get_investment_transactions': return sqlite ? transactionsSqlite(args) : handleGetInvestmentTransactions(args, token);
    default: throw new Error(`Unknown investment tool: ${toolName}`);
  }
}
