import type { Account } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

/** Pick account for nickname: explicit id, else first checking account. */
export function pickAccountForNickname(
  accounts: Account[],
  accountId?: string,
): Account | null {
  if (!accounts.length) return null;
  if (accountId) {
    const byId = accounts.find((a) => a.id === accountId);
    if (byId) return byId;
    const byType = accounts.find(
      (a) => a.accountType?.toLowerCase() === accountId.toLowerCase(),
    );
    if (byType) return byType;
    return null;
  }
  const checking = accounts.find(
    (a) => a.accountType?.toLowerCase() === 'checking',
  );
  return checking ?? null;
}

/** Display nickname from account name, or type + masked last four digits. */
export function formatAccountNickname(account: Account): {
  nickname: string;
  fallbackUsed: boolean;
} {
  const trimmed = account.name?.trim();
  if (trimmed) {
    return { nickname: trimmed, fallbackUsed: false };
  }
  const digits = (account.accountNumber || '').replace(/\D/g, '');
  const last4 = digits.slice(-4) || '????';
  const typeRaw = account.accountType || 'Account';
  const typeLabel = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
  return { nickname: `${typeLabel} …${last4}`, fallbackUsed: true };
}

export const executeGetMyAccounts: HandlerFn = async (deps, token, params) => {
  const { account_type } = params as { account_type?: string };
  deps.logger.debug(`[BankingToolProvider] Calling Banking API: getMyAccounts`);
  let accounts = await deps.apiClient.getMyAccounts(token);

  if (accounts && accounts.length !== undefined) {
    deps.logger.debug(`[BankingToolProvider] Banking API response: Found ${accounts.length} accounts`);
  }

  if (account_type) {
    // accountType is inconsistently cased/named across the seed data
    // ('CHECKING'/'SAVINGS' from the banking seed vs lowercase 'loan' and
    // 'credit_card' from the account-spec builder), same mismatch
    // pickAccountForNickname above already normalizes for. The tool's own
    // enum offers 'credit', not 'credit_card'.
    const wanted = account_type === 'credit' ? 'credit_card' : account_type;
    accounts = accounts.filter(
      (a: Account) => a.accountType?.toLowerCase() === wanted.toLowerCase(),
    );
  }

  // GET_MY_ACCOUNTS_OUTPUT (outputSchemas.ts) requires accountNumber and
  // types every optional field as plain `string` (no null) — accounts
  // seeded via the minimal path (checking/savings) never set several of
  // these upstream. '' is the established "no value" convention here (see
  // formatAccountNickname above), not null.
  const mappedAccounts = accounts.map((account: Account) => ({
    id: account.id,
    accountType: account.accountType,
    name: account.name || '',
    accountNumber: account.accountNumber || '',
    balance: account.balance,
    currency: account.currency || 'USD',
    status: account.status || 'active',
    accountHolderName: account.accountHolderName || '',
    swiftCode: account.swiftCode || '',
    iban: account.iban || '',
    branchName: account.branchName || '',
    branchCode: account.branchCode || '',
    openedDate: account.openedDate || '',
    notes: account.notes || '',
    createdAt: account.createdAt,
  }));

  const data = { success: true, count: accounts.length, accounts: mappedAccounts };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetAccountNickname: HandlerFn = async (deps, token, params) => {
  const { account_id } = params as { account_id?: string };
  deps.logger.debug('[BankingToolProvider] Calling Banking API: getAccountNickname');
  const accounts = await deps.apiClient.getMyAccounts(token);
  const account = pickAccountForNickname(accounts, account_id);
  if (!account) {
    const msg = account_id
      ? `Account not found: ${account_id}`
      : 'No checking account found for this user';
    return createErrorResult(msg);
  }
  const { nickname, fallbackUsed } = formatAccountNickname(account);
  const data = {
    success: true,
    accountId: account.id,
    nickname,
    fallbackUsed,
  };
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

export const executeGetSensitiveAccountDetails: HandlerFn = async (deps, token, params) => {
  const { account_id } = (params || {}) as { account_id?: string };
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

    let accounts = (response as any).accounts || [];
    if (account_id) {
      accounts = accounts.filter((a: any) => a.id === account_id);
    }
    const data = { success: true, accounts };
    return createSuccessResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    deps.logger.error('[BankingToolProvider] getSensitiveAccountDetails error:', {}, error instanceof Error ? error : undefined);
    return createErrorResult(
      `Failed to retrieve sensitive account details: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};