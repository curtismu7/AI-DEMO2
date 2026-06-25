import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';
import { mapTransactionError, TransactionOperation } from '../TransactionErrorMapper';

export const executeGetMyTransactions: HandlerFn = async (deps, token, params) => {
  const { limit } = params as { limit?: number };
  let transactions = await deps.apiClient.getMyTransactions(token);
  if (limit && limit > 0) {
    transactions = transactions.slice(0, limit);
  }

  if (!Array.isArray(transactions)) {
    deps.logger.warn(`[BankingToolProvider] Expected transactions array, got: ${typeof transactions}`);

    return createErrorResult(`Invalid response format from banking API (received: ${typeof transactions})`);
  }

  const response = {
    success: true,
    count: transactions.length,
    transactions: transactions.map(transaction => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      date: transaction.createdAt,
      fromAccountId: transaction.fromAccountId || null,
      toAccountId: transaction.toAccountId || null,
      description: transaction.description || null
    }))
  };

  return createSuccessResult(JSON.stringify(response, null, 2));
};

export const executeCreateDeposit: HandlerFn = async (deps, token, params) => {
  const { to_account_id, amount, description } = params as { to_account_id: string; amount: number; description?: string };
  deps.logger.info(`[BankingToolProvider] Calling Banking API: createDeposit - Amount: ${amount}, Account: ${to_account_id}`);
  try {
    const response = await deps.apiClient.createDeposit(
      token,
      to_account_id,
      amount,
      description
    );
    deps.logger.info(`[BankingToolProvider] Banking API response: Deposit successful`);

    const result = {
      success: true,
      operation: 'deposit',
      message: response.message,
      transaction: response.transaction ? {
        id: response.transaction.id,
        amount: amount,
        toAccountId: to_account_id,
        description: description || null
      } : null,
      amount: amount,
      accountId: to_account_id
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'deposit' as TransactionOperation, amount);
    if (handled) return handled;
    throw error;
  }
};

export const executeCreateWithdrawal: HandlerFn = async (deps, token, params) => {
  const { from_account_id, amount, description } = params as { from_account_id: string; amount: number; description?: string };
  try {
    const response = await deps.apiClient.createWithdrawal(
      token,
      from_account_id,
      amount,
      description
    );

    const result = {
      success: true,
      operation: 'withdrawal',
      message: response.message,
      transaction: response.transaction ? {
        id: response.transaction.id,
        amount: amount,
        fromAccountId: from_account_id,
        description: description || null
      } : null,
      amount: amount,
      accountId: from_account_id
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'withdrawal' as TransactionOperation, amount);
    if (handled) return handled;
    throw error;
  }
};

export const executeCreateTransfer: HandlerFn = async (deps, token, params) => {
  const { from_account_id, to_account_id, amount, description } = params as { from_account_id: string; to_account_id: string; amount: number; description?: string };
  try {
    const response = await deps.apiClient.createTransfer(
      token,
      from_account_id,
      to_account_id,
      amount,
      description
    );

    const result = {
      success: true,
      operation: 'transfer',
      message: response.message,
      withdrawalTransaction: response.withdrawalTransaction ? {
        id: response.withdrawalTransaction.id,
        amount: amount,
        fromAccountId: from_account_id
      } : null,
      depositTransaction: response.depositTransaction ? {
        id: response.depositTransaction.id,
        amount: amount,
        toAccountId: to_account_id
      } : null,
      amount: amount,
      fromAccountId: from_account_id,
      toAccountId: to_account_id,
      description: description || null
    };

    return createSuccessResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const handled = mapTransactionError(error, 'transfer' as TransactionOperation, amount);
    if (handled) return handled;
    throw error;
  }
};
