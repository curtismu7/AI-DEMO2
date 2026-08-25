'use strict';

/**
 * Invest tools with NO banking API configured (the standalone/handoff
 * deployment): dispatchTool must answer from the bundled SQLite store with the
 * same shapes the BFF routes return, and never touch axios.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-db-'));
process.env.INVEST_DB_PATH = path.join(tmpDir, 'invest.db');
process.env.INVEST_SEED_PATH = path.join(__dirname, '..', 'seed', 'invest.seed.json');
// No banking API configured → SQLite backend.
delete process.env.BANKING_API_BASE_URL;
delete process.env.DEMO_API_BASE_URL;

import axios from 'axios';
jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

import { dispatchTool } from '../src/tools/investToolHandler';
import { resolveInvestor, withDb } from '../src/db/investDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('invest tools on bundled SQLite (no banking API)', () => {
  it('seeds on first open and serves the single demo investor', () => {
    const investor = resolveInvestor();
    expect(fs.existsSync(process.env.INVEST_DB_PATH as string)).toBe(true);
    expect(investor!.portfolio_id).toBe('INV-8842');
  });

  it('get_investment_accounts returns the one-element list the BFF route returns', async () => {
    const res = await dispatchTool('get_investment_accounts', {}, 'tok') as { accounts: unknown[] };
    expect(res.accounts).toEqual([
      { id: 'INV-8842', holder: 'Jordan A. Rivera', totalValue: 184320.55, riskProfile: 'Growth' },
    ]);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('get_investment_balance includes holdings in BFF camelCase shape', async () => {
    const res = await dispatchTool('get_investment_balance', { account_id: 'INV-8842' }, 'tok') as {
      accountId: string; cashSweep: number; holdings: Array<{ symbol: string; marketValue: number }>;
    };
    expect(res.accountId).toBe('INV-8842');
    expect(res.cashSweep).toBe(12580.10);
    expect(res.holdings).toHaveLength(4);
    expect(res.holdings[0]).toEqual({ symbol: 'VTI', name: 'Vanguard Total Market ETF', quantity: 220, marketValue: 62480 });
  });

  it('get_portfolio_summary accepts a sub-portfolio id as the account', async () => {
    const res = await dispatchTool('get_portfolio_summary', { account_id: 'PF-02', period: '1y' }, 'tok') as {
      portfolioId: string; portfolios: Array<{ id: string; portfolioType: string }>;
    };
    expect(res.portfolioId).toBe('INV-8842');
    expect(res.portfolios.map((p) => p.id)).toEqual(['PF-01', 'PF-02', 'PF-03']);
    expect(res.portfolios[1].portfolioType).toBe('Retirement');
  });

  it('get_investment_transactions is in store order (as the BFF returns it) and honours limit', async () => {
    const res = await dispatchTool('get_investment_transactions', { account_id: 'INV-8842', limit: 2 }, 'tok') as {
      transactions: Array<{ id: string }>;
    };
    expect(res.transactions.map((t) => t.id)).toEqual(['TRD-3001', 'TRD-3002']);
  });

  it('throws for an account the investor does not own, so the MCP result is isError:true', async () => {
    await expect(dispatchTool('get_investment_balance', { account_id: 'PF-99' }, 'tok'))
      .rejects.toThrow('account not found: PF-99');
  });

  it('does not re-seed over an out-of-band edit', async () => {
    withDb((db) => db.prepare("UPDATE trades SET status = 'Reversed' WHERE id = 'TRD-3001'").run());
    const res = await dispatchTool('get_investment_transactions', { account_id: 'INV-8842', limit: 1 }, 'tok') as {
      transactions: Array<{ status: string }>;
    };
    expect(res.transactions[0].status).toBe('Reversed');
  });
});
