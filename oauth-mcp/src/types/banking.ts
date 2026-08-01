/**
 * Banking operation interfaces
 */

export interface BankAccount {
  accountId: string;
  accountNumber: string;
  accountType: 'checking' | 'savings' | 'credit' | 'investment';
  balance: number;
  currency: string;
  status: 'active' | 'inactive' | 'frozen';
  ownerId: string;
}

export interface Transaction {
  transactionId: string;
  accountId: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  category: string;
  description: string;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  metadata?: Record<string, unknown>;
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  description?: string;
  reference?: string;
}

export interface TransferResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  timestamp: Date;
}

export interface BalanceInquiry {
  accountId: string;
  includeAvailable?: boolean;
  includePending?: boolean;
}

export interface BalanceResult {
  accountId: string;
  currentBalance: number;
  availableBalance?: number;
  pendingBalance?: number;
  currency: string;
  lastUpdated: Date;
}

export interface BankingOperations {
  getAccount(accountId: string): Promise<BankAccount | null>;
  getBalance(inquiry: BalanceInquiry): Promise<BalanceResult>;
  getTransactions(accountId: string, limit?: number, offset?: number): Promise<Transaction[]>;
  transfer(request: TransferRequest): Promise<TransferResult>;
  getTransactionHistory(accountId: string, startDate?: Date, endDate?: Date): Promise<Transaction[]>;
}