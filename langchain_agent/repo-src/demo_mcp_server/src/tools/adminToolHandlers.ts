import type { HandlerDeps } from './handlers/types';
import type { BankingToolResult } from './BankingToolProvider';
import { createSuccessResult, createErrorResult } from './handlers/results';

export async function executeLookupCustomer(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const q = encodeURIComponent(params.query || '');
    const data = await deps.apiClient.get(`/api/admin/agent/lookup?q=${q}`, token);
    if (!data.users?.length) return createSuccessResult('No customers found matching that query.');
    const lines = data.users.map((u: any) =>
      `- ${u.firstName} ${u.lastName} (${u.email}) — ID: ${u.id} — role: ${u.role}`
    );
    const count = data.count ?? (data.users?.length ?? 0);
    return createSuccessResult(`Found ${count} customer(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return createErrorResult(`Lookup failed: ${e.message}`);
  }
}

export async function executeGetCustomerProfile(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.get(`/api/admin/agent/users/${params.userId}`, token);
    if (!data?.user) {
      return createErrorResult(`User ${params.userId} not found`);
    }
    const u = data.user;
    return createSuccessResult(
      `Profile for ${u.firstName} ${u.lastName}:\n` +
      `  Email: ${u.email}\n` +
      `  Username: ${u.username}\n` +
      `  Role: ${u.role}\n` +
      `  Active: ${u.isActive}\n` +
      `  Password reset required: ${u.passwordResetRequired || false}\n` +
      `  Created: ${u.createdAt}`
    );
  } catch (e: any) {
    return createErrorResult(`Get profile failed: ${e.message}`);
  }
}

export async function executeGetCustomerAccounts(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.get(`/api/admin/agent/users/${params.userId}/accounts`, token);
    if (!data.accounts?.length) return createSuccessResult('No accounts found for this user.');
    const lines = data.accounts.map((a: any) =>
      `- ${a.name} (${a.accountType}) — Balance: ${a.currency} ${a.balance?.toFixed(2)} — Active: ${a.isActive} — ID: ${a.id}`
    );
    const count = data.count ?? (data.accounts?.length ?? 0);
    return createSuccessResult(`${count} account(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return createErrorResult(`Get accounts failed: ${e.message}`);
  }
}

export async function executeGetCustomerTransactions(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const limit = params.limit || 5;
    const data = await deps.apiClient.get(
      `/api/admin/agent/users/${params.userId}/transactions?limit=${limit}`, token
    );
    if (!data.transactions?.length) return createSuccessResult('No transactions found for this user.');
    const lines = data.transactions.map((t: any) =>
      `- [${t.createdAt?.slice(0, 10)}] ${t.type} $${t.amount?.toFixed(2)} — ${t.description} (${t.status})`
    );
    const count = data.count ?? (data.transactions?.length ?? 0);
    return createSuccessResult(`Last ${count} transaction(s):\n${lines.join('\n')}`);
  } catch (e: any) {
    return createErrorResult(`Get transactions failed: ${e.message}`);
  }
}

export async function executeFreezeAccount(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.patch(
      `/api/admin/agent/accounts/${params.accountId}/freeze`,
      { freeze: params.freeze },
      token
    );
    const action = params.freeze ? 'frozen' : 'unfrozen';
    return createSuccessResult(`Account ${data.accountId} has been ${action}. isActive: ${data.isActive}`);
  } catch (e: any) {
    return createErrorResult(`Freeze account failed: ${e.message}`);
  }
}

export async function executeResetCustomerPassword(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    await deps.apiClient.post(`/api/admin/agent/users/${params.userId}/reset-password`, {}, token);
    return createSuccessResult(`Password reset flag set for user ${params.userId}. They will be prompted to reset on next login.`);
  } catch (e: any) {
    return createErrorResult(`Reset password failed: ${e.message}`);
  }
}

export async function executeAdjustBalance(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    const data = await deps.apiClient.post(
      `/api/admin/agent/accounts/${params.accountId}/adjust`,
      { amount: params.amount, description: params.description },
      token
    );
    return createSuccessResult(
      `Balance adjusted for account ${data.accountId}.\n` +
      `New balance: $${data.newBalance?.toFixed(2)}`
    );
  } catch (e: any) {
    return createErrorResult(`Adjust balance failed: ${e.message}`);
  }
}

export async function executeDeleteCustomer(
  deps: HandlerDeps, token: string, params: Record<string, any>
): Promise<BankingToolResult> {
  try {
    if (params.confirm !== true) {
      return createErrorResult('confirm must be true to delete a customer. Please confirm this destructive action.');
    }
    await deps.apiClient.delete(`/api/admin/agent/users/${params.userId}`, { confirm: true }, token);
    return createSuccessResult(`Customer ${params.userId} and all associated data have been deleted.`);
  } catch (e: any) {
    return createErrorResult(`Delete customer failed: ${e.message}`);
  }
}
