import type { JSONSchema } from '../interfaces/mcp';

export const GET_MY_ACCOUNTS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          accountType: { type: 'string' },
          name: { type: 'string' },
          accountNumber: { type: 'string' },
          balance: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          accountHolderName: { type: 'string' },
          swiftCode: { type: 'string' },
          iban: { type: 'string' },
          branchName: { type: 'string' },
          branchCode: { type: 'string' },
          openedDate: { type: 'string' },
          notes: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['id', 'accountType', 'accountNumber', 'balance', 'currency', 'status', 'createdAt'],
      },
    },
  },
  required: ['success', 'count', 'accounts'],
};

export const GET_ACCOUNT_BALANCE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    accountId: { type: 'string' },
    balance: { type: 'number' },
  },
  required: ['success', 'accountId', 'balance'],
};

export const GET_SENSITIVE_ACCOUNT_DETAILS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    accounts: { type: 'array', items: { type: 'object' } },
    ok: { type: 'boolean' },
    step_up_required: { type: 'boolean' },
    consent_required: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const TRANSACTION_ITEM: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer'] },
    amount: { type: 'number' },
    date: { type: 'string' },
    fromAccountId: { type: 'string' },
    toAccountId: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['id', 'type', 'amount', 'date'],
};

export const GET_MY_TRANSACTIONS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    total: { type: 'integer', description: 'Total available before pagination' },
    offset: { type: 'integer' },
    hasMore: { type: 'boolean' },
    nextOffset: { type: 'integer' },
    transactions: { type: 'array', items: TRANSACTION_ITEM },
  },
  required: ['success', 'count', 'total', 'offset', 'hasMore', 'transactions'],
};

export const SEARCH_TRANSACTIONS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    transactions: { type: 'array', items: TRANSACTION_ITEM },
  },
  required: ['success', 'count', 'transactions'],
};

export const GET_TRANSACTION_DETAIL_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    found: { type: 'boolean' },
    transaction: TRANSACTION_ITEM,
  },
  required: ['success', 'found'],
};

export const WRITE_TRANSACTION_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    operation: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer'] },
    message: { type: 'string' },
    amount: { type: 'number' },
    accountId: { type: 'string' },
    fromAccountId: { type: 'string' },
    toAccountId: { type: 'string' },
    transaction: { type: 'object' },
    withdrawalTransaction: { type: 'object' },
    depositTransaction: { type: 'object' },
    description: { type: 'string' },
  },
  required: ['success', 'operation', 'amount'],
};

export const QUERY_USER_BY_EMAIL_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    exists: { type: 'boolean' },
    email: { type: 'string' },
    user: { type: 'object' },
    error: { type: 'string' },
  },
  required: ['exists'],
};

export const REQUEST_FEE_WAIVER_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    status: { type: 'string' },
  },
};

export const SEQUENTIAL_THINK_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    query: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
      },
    },
    conclusion: { type: 'string' },
  },
  required: ['success', 'query', 'steps', 'conclusion'],
};

export const ADMIN_LOOKUP_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['id', 'email'],
      },
    },
  },
  required: ['success', 'count', 'users'],
};

export const ADMIN_PROFILE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    user: { type: 'object' },
  },
};

export const ADMIN_ACCOUNTS_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    count: { type: 'integer' },
    accounts: { type: 'array', items: { type: 'object' } },
  },
  required: ['success'],
};

export const ADMIN_TRANSACTIONS_OUTPUT: JSONSchema = GET_MY_TRANSACTIONS_OUTPUT;

export const ADMIN_WRITE_OUTPUT: JSONSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
  },
  required: ['success'],
};