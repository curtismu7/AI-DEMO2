import { executeGetMyTransactions } from '../../src/tools/handlers/transactionHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const deps = { apiClient: mockClient, logger: Logger.getInstance({} as any) };

const makeTx = (i: number) => ({
  id: `tx-${i}`, type: 'deposit' as const, amount: i * 10,
  createdAt: '2025-01-01', userId: 'u1'
});

beforeEach(() => {
  mockClient.getMyTransactions = jest.fn().mockResolvedValue(
    Array.from({ length: 25 }, (_, i) => makeTx(i))
  );
});

describe('get_my_transactions pagination', () => {
  it('returns all 25 with no params', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', {});
    expect(r.structuredContent!.total).toBe(25);
    expect(r.structuredContent!.count).toBe(25);
    expect(r.structuredContent!.hasMore).toBe(false);
    expect(r.structuredContent!.offset).toBe(0);
  });

  it('returns first page of 10', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10 });
    expect(r.structuredContent!.count).toBe(10);
    expect(r.structuredContent!.total).toBe(25);
    expect(r.structuredContent!.hasMore).toBe(true);
    expect(r.structuredContent!.nextOffset).toBe(10);
  });

  it('returns second page with offset', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10, offset: 10 });
    expect(r.structuredContent!.count).toBe(10);
    expect(r.structuredContent!.offset).toBe(10);
    expect(r.structuredContent!.nextOffset).toBe(20);
    expect(r.structuredContent!.hasMore).toBe(true);
  });

  it('last partial page shows hasMore false', async () => {
    const r = await executeGetMyTransactions(deps, 'tok', { limit: 10, offset: 20 });
    expect(r.structuredContent!.count).toBe(5);
    expect(r.structuredContent!.hasMore).toBe(false);
    expect(r.structuredContent!.nextOffset).toBeUndefined();
  });
});
