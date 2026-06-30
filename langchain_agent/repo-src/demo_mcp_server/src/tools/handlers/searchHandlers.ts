import type { Transaction } from '../../interfaces/banking';
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

export const executeSearchTransactions: HandlerFn = async (deps, token, params) => {
  const {
    type,
    min_amount,
    max_amount,
    from_date,
    to_date,
  } = params as {
    type?: 'deposit' | 'withdrawal' | 'transfer';
    min_amount?: number;
    max_amount?: number;
    from_date?: string;
    to_date?: string;
  };

  let transactions: Transaction[] = await deps.apiClient.getMyTransactions(token);

  if (!Array.isArray(transactions)) {
    return createErrorResult(`Invalid response format from banking API (received: ${typeof transactions})`);
  }

  if (type) {
    transactions = transactions.filter(t => t.type === type);
  }
  if (min_amount !== undefined) {
    transactions = transactions.filter(t => t.amount >= min_amount);
  }
  if (max_amount !== undefined) {
    transactions = transactions.filter(t => t.amount <= max_amount);
  }
  if (from_date) {
    transactions = transactions.filter(t => t.createdAt >= from_date);
  }
  if (to_date) {
    transactions = transactions.filter(t => t.createdAt <= to_date);
  }

  const data = {
    success: true,
    count: transactions.length,
    transactions: transactions.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: t.createdAt,
      fromAccountId: t.fromAccountId || null,
      toAccountId: t.toAccountId || null,
      description: t.description || null,
    })),
  };

  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

export const executeGetTransactionDetail: HandlerFn = async (deps, token, params) => {
  const { transaction_id } = params as { transaction_id: string };

  const transactions: Transaction[] = await deps.apiClient.getMyTransactions(token);

  if (!Array.isArray(transactions)) {
    return createErrorResult(`Invalid response format from banking API`);
  }

  const tx = transactions.find(t => t.id === transaction_id) || null;

  const data = {
    success: true,
    found: tx !== null,
    transaction: tx ? {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      date: tx.createdAt,
      fromAccountId: tx.fromAccountId || null,
      toAccountId: tx.toAccountId || null,
      description: tx.description || null,
    } : null,
  };

  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
