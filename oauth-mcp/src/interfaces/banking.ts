/**
 * Banking Interfaces
 * Core interfaces for banking operations and API integration
 */

export interface Account {
  id: string;
  userId: string;
  accountType: string;
  name?: string;
  accountNumber: string;
  balance: number;
  currency?: string;
  status: string;
  accountHolderName?: string;
  swiftCode?: string;
  iban?: string;
  branchName?: string;
  branchCode?: string;
  openedDate?: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  fromAccountId?: string;
  toAccountId?: string;
  amount: number;
  type: 'deposit' | 'withdrawal' | 'transfer';
  description?: string;
  userId: string;
  createdAt: string;
  performedBy?: string;
  accountInfo?: string;
}

export interface TransactionRequest {
  fromAccountId?: string;
  toAccountId?: string;
  amount: number;
  type: 'deposit' | 'withdrawal' | 'transfer';
  description?: string;
}

export interface TransactionResponse {
  message: string;
  transaction?: Transaction;
  withdrawalTransaction?: Transaction;
  depositTransaction?: Transaction;
}

export interface BankingAPIConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  circuitBreakerThreshold: number;
}

export interface AccountBalanceResponse {
  balance: number;
}

export class BankingAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string,
    public originalError?: any
  ) {
    super(message);
    this.name = 'BankingAPIError';
  }
}

export interface BankingToolParams {
  // For get_account_balance
  account_id?: string;
  
  // For create_deposit
  to_account_id?: string;
  
  // For create_withdrawal
  from_account_id?: string;
  
  // For create_transfer
  // Uses both from_account_id and to_account_id
  
  // For query_user_by_email
  email?: string;
  
  // Common parameters
  amount?: number;
  description?: string;
}

export interface BankingOperationResult {
  success: boolean;
  data?: any;
  error?: string;
  requiresAuth?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  oauthProvider: string;
  oauthId: string;
}

export interface UserQueryResponse {
  user?: User;
  exists: boolean;
  email?: string;
  queriedBy?: string;
  queriedAt?: string;
  error?: string;
}