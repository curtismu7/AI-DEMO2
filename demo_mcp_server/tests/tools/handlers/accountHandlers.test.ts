import { executeGetSensitiveAccountDetails } from '../../../src/tools/handlers/accountHandlers';
import type { HandlerDeps } from '../../../src/tools/handlers/types';

function makeDeps(getSensitiveAccountDetails: jest.Mock): HandlerDeps {
  return {
    apiClient: { getSensitiveAccountDetails } as any,
    logger: { debug: jest.fn(), error: jest.fn() } as any,
  };
}

const ACCOUNTS_RESPONSE = {
  ok: true,
  accounts: [
    { id: 'acct-1', accountType: 'checking', accountNumberFull: '111122223333', routingNumber: '021000021' },
    { id: 'acct-2', accountType: 'savings', accountNumberFull: '444455556666', routingNumber: '021000021' },
  ],
};

describe('executeGetSensitiveAccountDetails', () => {
  it('returns every account when account_id is omitted', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', {});
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toHaveLength(2);
  });

  it('filters to the matching account when account_id is provided', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'acct-2' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toEqual([
      expect.objectContaining({ id: 'acct-2', accountType: 'savings' }),
    ]);
  });

  it('returns an empty accounts array for an unknown account_id', async () => {
    const deps = makeDeps(jest.fn().mockResolvedValue(ACCOUNTS_RESPONSE));
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'nope' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.accounts).toEqual([]);
  });

  it('still surfaces consent_required and ignores account_id on that path', async () => {
    const deps = makeDeps(
      jest.fn().mockResolvedValue({ ok: false, consent_required: true, reason: 'sensitive_data_access' })
    );
    const result = await executeGetSensitiveAccountDetails(deps, 'token', { account_id: 'acct-1' });
    expect(result.success).toBe(true);
    expect(result.structuredContent?.consent_required).toBe(true);
  });
});
