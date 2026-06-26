import { executeSearchTransactions, executeGetTransactionDetail } from '../../src/tools/handlers/searchHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const deps = { apiClient: mockClient, logger: Logger.getInstance({} as any) };

const TX = [
  { id: 'tx-1', type: 'deposit' as const, amount: 100, createdAt: '2025-01-15', userId: 'u1', description: 'pay' },
  { id: 'tx-2', type: 'withdrawal' as const, amount: 50, createdAt: '2025-02-10', userId: 'u1' },
  { id: 'tx-3', type: 'deposit' as const, amount: 200, createdAt: '2025-03-01', userId: 'u1' },
];

beforeEach(() => {
  mockClient.getMyTransactions = jest.fn().mockResolvedValue(TX);
});

describe('executeSearchTransactions', () => {
  it('returns all when no filters', async () => {
    const r = await executeSearchTransactions(deps, 'tok', {});
    expect(r.structuredContent!.count).toBe(3);
    expect(r.structuredContent!.success).toBe(true);
  });

  it('filters by type', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { type: 'deposit' });
    expect(r.structuredContent!.count).toBe(2);
    expect(r.structuredContent!.transactions.every((t: any) => t.type === 'deposit')).toBe(true);
  });

  it('filters by min_amount', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { min_amount: 100 });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by max_amount', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { max_amount: 100 });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by from_date', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { from_date: '2025-02-01' });
    expect(r.structuredContent!.count).toBe(2);
  });

  it('filters by to_date', async () => {
    const r = await executeSearchTransactions(deps, 'tok', { to_date: '2025-02-01' });
    expect(r.structuredContent!.count).toBe(1);
  });
});

describe('executeGetTransactionDetail', () => {
  it('returns found:true for known id', async () => {
    const r = await executeGetTransactionDetail(deps, 'tok', { transaction_id: 'tx-2' });
    expect(r.structuredContent!.found).toBe(true);
    expect(r.structuredContent!.transaction.id).toBe('tx-2');
  });

  it('returns found:false for unknown id', async () => {
    const r = await executeGetTransactionDetail(deps, 'tok', { transaction_id: 'no-such' });
    expect(r.structuredContent!.found).toBe(false);
    expect(r.structuredContent!.transaction).toBeNull();
  });
});
