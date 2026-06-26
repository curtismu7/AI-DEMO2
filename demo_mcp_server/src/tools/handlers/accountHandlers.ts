import type { Account } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

export const executeGetMyAccounts: HandlerFn = async (deps, token, params) => {
  const { account_type } = params as { account_type?: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getMyAccounts`);
  let accounts = await deps.apiClient.getMyAccounts(token);

  if (accounts && accounts.length !== undefined) {
    deps.logger.debug(`[BankingToolProvider] Banking API response: Found ${accounts.length} accounts`);
  }

  if (account_type) {
    accounts = accounts.filter((a: Account) => a.accountType === account_type);
  }

  const mappedAccounts = accounts.map((account: Account) => ({
    id: account.id,
    accountType: account.accountType,
    name: account.name || null,
    accountNumber: account.accountNumber,
    balance: account.balance,
    currency: account.currency || 'USD',
    status: account.status || 'active',
    accountHolderName: account.accountHolderName || null,
    swiftCode: account.swiftCode || null,
    iban: account.iban || null,
    branchName: account.branchName || null,
    branchCode: account.branchCode || null,
    openedDate: account.openedDate || null,
    notes: account.notes || null,
    createdAt: account.createdAt,
  }));

  const data = { success: true, count: accounts.length, accounts: mappedAccounts };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetAccountBalance: HandlerFn = async (deps, token, params) => {
  const { account_id } = params as { account_id: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getAccountBalance for account ${account_id}`);
  const balanceResponse = await deps.apiClient.getAccountBalance(token, account_id);
  deps.logger.debug(`[BankingToolProvider] Banking API response: Account balance retrieved`);

  const data = { success: true, accountId: account_id, balance: balanceResponse.balance };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeUpdateContactEmail: HandlerFn = async (deps, token, params) => {
  const { account_id, new_email } = params as { account_id: string; new_email: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: updateContactEmail for account ${account_id}`);
  const result = await deps.apiClient.updateContactEmail(token, account_id, new_email);
  const data = { success: true, accountId: account_id, email: new_email, ...result };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetSensitiveAccountDetails: HandlerFn = async (deps, token, _params) => {
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getSensitiveAccountDetails`);
  try {
    const response = await deps.apiClient.getSensitiveAccountDetails(token);

    if (response && (response as any).ok === false && (response as any).step_up_required === true) {
      const stepUpPayload = {
        ok: false,
        step_up_required: true,
        error: 'step_up_required',
        step_up_method: (response as any).step_up_method || 'email',
      };
      return createSuccessResult(JSON.stringify(stepUpPayload, null, 2), stepUpPayload);
    }

    if (response && (response as any).ok === false && (response as any).consent_required) {
      const consentPayload = {
        ok: false,
        consent_required: true,
        reason: (response as any).reason || 'sensitive_data_access',
      };
      return createSuccessResult(JSON.stringify(consentPayload, null, 2), consentPayload);
    }

    if (!response || (response as any).ok === false) {
      return createErrorResult(`Access denied: ${(response as any)?.reason || 'paz_denied'}`);
    }

    const data = { success: true, accounts: (response as any).accounts || [] };
    return createSuccessResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    deps.logger.error('[BankingToolProvider] getSensitiveAccountDetails error:', {}, error instanceof Error ? error : undefined);
    return createErrorResult(
      `Failed to retrieve sensitive account details: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};