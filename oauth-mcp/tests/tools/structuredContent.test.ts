import { executeGetMyAccounts } from '../../src/tools/handlers/accountHandlers';
import { executeGetAccountBalance } from '../../src/tools/handlers/accountHandlers';
import { executeGetMyTransactions } from '../../src/tools/handlers/transactionHandlers';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/utils/Logger', () => ({
  Logger: { getInstance: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  createDefaultLoggerConfig: () => ({}),
}));

const mockClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
const mockLogger = Logger.getInstance({} as any);
const deps = { apiClient: mockClient, logger: mockLogger };

describe('handlers emit structuredContent', () => {
  it('executeGetMyAccounts returns structuredContent', async () => {
    mockClient.getMyAccounts = jest.fn().mockResolvedValue([
      { id: 'acc-1', accountType: 'checking', accountNumber: '****1234',
        balance: 1000, currency: 'USD', status: 'active', createdAt: '2025-01-01' }
    ]);
    const result = await executeGetMyAccounts(deps, 'token', {});
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.success).toBe(true);
    expect(result.structuredContent!.count).toBe(1);
    expect(Array.isArray(result.structuredContent!.accounts)).toBe(true);
  });

  it('executeGetAccountBalance returns structuredContent', async () => {
    mockClient.getAccountBalance = jest.fn().mockResolvedValue({ balance: 500 });
    const result = await executeGetAccountBalance(deps, 'token', { account_id: 'acc-1' });
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.balance).toBe(500);
  });

  it('executeGetMyTransactions returns structuredContent', async () => {
    mockClient.getMyTransactions = jest.fn().mockResolvedValue([
      { id: 'tx-1', type: 'deposit', amount: 100, createdAt: '2025-01-01' }
    ]);
    const result = await executeGetMyTransactions(deps, 'token', {});
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.success).toBe(true);
    expect(Array.isArray(result.structuredContent!.transactions)).toBe(true);
  });
});