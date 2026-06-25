import { executeRequestFeeWaiver } from '../../src/tools/handlers/commitmentHandlers';
import type { HandlerDeps } from '../../src/tools/handlers/types';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { Logger } from '../../src/utils/Logger';

const mockRequestFeeWaiver = jest.fn();

const deps: HandlerDeps = {
  apiClient: {
    requestFeeWaiver: mockRequestFeeWaiver,
  } as unknown as BankingAPIClient,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger,
};

const TOKEN = 'tok-abc';

describe('executeRequestFeeWaiver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls apiClient.requestFeeWaiver with token, account_id, and reason', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-1234',
      accountId: 'acc-001',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-001', reason: 'Overdraft charge dispute' });

    expect(mockRequestFeeWaiver).toHaveBeenCalledWith(TOKEN, 'acc-001', 'Overdraft charge dispute');
  });

  it('returns a success result containing the requestId', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-9999',
      accountId: 'acc-002',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    const result = await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-002', reason: 'Monthly fee' });

    expect(result.success).toBe(true);
    expect(result.text).toContain('fwr-9999');
  });

  it('falls back to "Customer request" when reason is omitted', async () => {
    mockRequestFeeWaiver.mockResolvedValue({
      submitted: true,
      requestId: 'fwr-0001',
      accountId: 'acc-003',
      note: 'Your fee waiver request has been logged for review. A human agent will respond within 2 business days.',
    });

    await executeRequestFeeWaiver(deps, TOKEN, { account_id: 'acc-003' });

    expect(mockRequestFeeWaiver).toHaveBeenCalledWith(TOKEN, 'acc-003', 'Customer request');
  });
});
