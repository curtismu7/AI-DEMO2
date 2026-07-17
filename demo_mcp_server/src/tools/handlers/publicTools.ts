/**
 * Public tool handlers — static/computed data, no auth-dependent queries
 */
import type { HandlerFn } from './types';
import { createSuccessResult, createErrorResult } from './results';

// Account types
const ACCOUNT_TYPES = [
  { type: 'checking', description: 'Everyday checking account for deposits and withdrawals' },
  { type: 'savings', description: 'Interest-bearing savings account' },
  { type: 'loan', description: 'Loan account for mortgages and personal loans' },
  { type: 'credit', description: 'Credit card account' },
  { type: 'investment', description: 'Investment portfolio account' },
] as const;

// Transaction types
const TRANSACTION_TYPES = [
  { type: 'deposit', description: 'Money deposited into account' },
  { type: 'withdrawal', description: 'Money withdrawn from account' },
  { type: 'transfer', description: 'Money transferred between accounts' },
  { type: 'payment', description: 'Bill or loan payment' },
  { type: 'purchase', description: 'Purchase or debit transaction' },
] as const;

// Supported currencies
const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
] as const;

// Fee schedule
const FEE_SCHEDULE = {
  checking: [
    { name: 'Monthly maintenance fee', amount: 0, condition: 'Free with direct deposit' },
    { name: 'Overdraft fee', amount: 35, condition: 'Per occurrence' },
    { name: 'NSF fee', amount: 35, condition: 'Non-sufficient funds' },
  ],
  savings: [
    { name: 'Monthly maintenance fee', amount: 0, condition: 'Always free' },
    { name: 'Excess withdrawal fee', amount: 0, condition: 'No limit on withdrawals' },
  ],
  transfers: [
    { name: 'Wire transfer (domestic)', amount: 25, condition: 'Per transfer' },
    { name: 'Wire transfer (international)', amount: 50, condition: 'Per transfer' },
    { name: 'ACH transfer', amount: 0, condition: 'Free' },
  ],
  atm: [
    { name: 'In-network ATM withdrawal', amount: 0, condition: 'Free' },
    { name: 'Out-of-network ATM withdrawal', amount: 2.5, condition: 'Per withdrawal' },
  ],
} as const;

// Verticals / service areas
const VERTICALS = [
  { name: 'banking', description: 'Core banking services including accounts and transfers', available: true },
  { name: 'mortgage', description: 'Mortgage and home loan services', available: true },
  { name: 'healthcare', description: 'Healthcare payment and financing', available: true },
  { name: 'investments', description: 'Investment portfolio management', available: true },
  { name: 'retail', description: 'Retail payment processing', available: true },
  { name: 'workforce', description: 'Payroll and workforce management', available: true },
  { name: 'government', description: 'Government benefits and services', available: true },
  { name: 'education', description: 'Education financing and student services', available: true },
  { name: 'manufacturing', description: 'Supply chain and manufacturing finance', available: true },
] as const;

/** Return array of account types (no auth required). */
export const executeListAccountTypes: HandlerFn = async (_deps, _token, _params) => {
  const data = { accountTypes: [...ACCOUNT_TYPES] };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

/** Return array of transaction types (no auth required). */
export const executeListTransactionTypes: HandlerFn = async (_deps, _token, _params) => {
  const data = { transactionTypes: [...TRANSACTION_TYPES] };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

/** Return array of supported currencies (no auth required). */
export const executeShowSupportedCurrencies: HandlerFn = async (_deps, _token, _params) => {
  const data = { currencies: [...CURRENCIES] };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

/** Return fee schedule, optionally filtered by category (no auth required). */
export const executeGetFeeSchedule: HandlerFn = async (_deps, _token, params) => {
  const category = params?.category;

  // Validate category if provided
  const validCategories = ['checking', 'savings', 'transfers', 'atm'];
  if (category && !validCategories.includes(category)) {
    return createErrorResult(
      `Invalid category: ${category}. Valid categories are: ${validCategories.join(', ')}`
    );
  }

  // Build flat array of fees with category field
  const allFees: Array<{ category: string; name: string; amount: number; description: string }> = [];

  const categoriesToInclude = category ? [category] : validCategories;
  for (const cat of categoriesToInclude) {
    const categoryFees = FEE_SCHEDULE[cat as keyof typeof FEE_SCHEDULE];
    for (const fee of categoryFees) {
      allFees.push({
        category: cat,
        name: fee.name,
        amount: fee.amount,
        description: fee.condition,
      });
    }
  }

  const data = { fees: allFees };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};

/** Return array of available verticals (no auth required). */
export const executeListVerticals: HandlerFn = async (_deps, _token, _params) => {
  const data = { verticals: [...VERTICALS] };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
