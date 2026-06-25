'use strict';

/**
 * Investment tool execution handlers.
 * All handlers call banking_api_server BFF endpoints using the delegated token.
 */

import axios from 'axios';

const BANKING_API_BASE = process.env.BANKING_API_BASE_URL || 'http://localhost:3001';

async function callBff(path: string, token: string): Promise<unknown> {
  const response = await axios.get(`${BANKING_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
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
    `/api/investment/accounts/${encodeURIComponent(accountId)}/portfolio?period=${period}`,
    token,
  );
}

export async function handleGetInvestmentTransactions(
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const accountId = args.account_id as string;
  const limit = args.limit || 20;
  return callBff(
    `/api/investment/accounts/${encodeURIComponent(accountId)}/transactions?limit=${limit}`,
    token,
  );
}

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  switch (toolName) {
    case 'get_investment_accounts': return handleGetInvestmentAccounts(args, token);
    case 'get_investment_balance': return handleGetInvestmentBalance(args, token);
    case 'get_portfolio_summary': return handleGetPortfolioSummary(args, token);
    case 'get_investment_transactions': return handleGetInvestmentTransactions(args, token);
    default: throw new Error(`Unknown investment tool: ${toolName}`);
  }
}
