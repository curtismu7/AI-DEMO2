'use strict';

/**
 * Invest tool handlers interpolate `period`/`limit` into the BFF query string.
 * These tests pin the encoding/validation fix: `period` is percent-encoded so a
 * value containing `&`/`=` cannot inject extra query params, and `limit` is a
 * bounded positive integer (0 is not silently rebased to the default of 20).
 */

import axios from 'axios';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

import {
  handleGetPortfolioSummary,
  handleGetInvestmentTransactions,
} from '../src/tools/investToolHandler';

// Return the query string of the last URL axios.get was called with.
function lastQuery(): URLSearchParams {
  const url: string = mockedGet.mock.calls.at(-1)![0];
  return new URL(url).searchParams;
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ data: {} });
});

describe('handleGetPortfolioSummary period encoding', () => {
  it('encodes a period so & / = cannot inject extra query params', async () => {
    await handleGetPortfolioSummary(
      { account_id: 'acct-1', period: '1m&admin=true' },
      'tok',
    );
    const q = lastQuery();
    expect(q.get('period')).toBe('1m&admin=true');
    expect(q.get('admin')).toBeNull(); // no injected param
    expect([...q.keys()]).toEqual(['period']);
  });

  it('defaults period to 1m when absent', async () => {
    await handleGetPortfolioSummary({ account_id: 'acct-1' }, 'tok');
    expect(lastQuery().get('period')).toBe('1m');
  });
});

describe('handleGetInvestmentTransactions limit validation', () => {
  it('does NOT rebase limit:0 to the default 20 (old `0 || 20` bug)', async () => {
    await handleGetInvestmentTransactions({ account_id: 'acct-1', limit: 0 }, 'tok');
    const limit = lastQuery().get('limit');
    expect(limit).not.toBe('20');
    expect(limit).toBe('1'); // clamped to the minimum positive integer
  });

  it('defaults to 20 only when limit is genuinely absent', async () => {
    await handleGetInvestmentTransactions({ account_id: 'acct-1' }, 'tok');
    expect(lastQuery().get('limit')).toBe('20');
  });

  it('clamps an oversized limit to the max', async () => {
    await handleGetInvestmentTransactions({ account_id: 'acct-1', limit: 100000 }, 'tok');
    expect(lastQuery().get('limit')).toBe('100');
  });

  it('coerces a non-integer / injection-style limit to a safe bounded integer', async () => {
    await handleGetInvestmentTransactions(
      { account_id: 'acct-1', limit: '5&admin=true' as unknown as number },
      'tok',
    );
    const q = lastQuery();
    expect(Number.isInteger(Number(q.get('limit')))).toBe(true);
    expect(q.get('admin')).toBeNull(); // no injected param
    expect([...q.keys()]).toEqual(['limit']);
  });

  it('coerces an array limit to a safe bounded integer (no bad coercion)', async () => {
    await handleGetInvestmentTransactions(
      { account_id: 'acct-1', limit: [1, 2, 3] as unknown as number },
      'tok',
    );
    const limit = Number(lastQuery().get('limit'));
    expect(Number.isInteger(limit)).toBe(true);
    expect(limit).toBeGreaterThanOrEqual(1);
    expect(limit).toBeLessThanOrEqual(100);
  });
});
