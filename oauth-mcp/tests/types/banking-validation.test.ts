/**
 * Unit tests for banking model validation
 */

import {
  validateAccount,
  validateTransaction,
  validateTransactionRequest,
  validateBankingToolParams,
  validateAccountId,
  validateAmount
} from '../../src/types/validation';
import { Account, Transaction, TransactionRequest } from '../../src/interfaces/banking';

describe('Banking Model Validation', () => {
  describe('validateAccount', () => {
    const validAccount: Account = {
      id: 'acc-123',
      userId: 'user-456',
      accountType: 'checking',
      accountNumber: '1234567890',
      balance: 1000.50,
      status: 'active',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-02T00:00:00Z'
    };

    it('should validate a correct Account', () => {
      expect(validateAccount(validAccount)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateAccount(null)).toBe(false);
      expect(validateAccount(undefined)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(validateAccount('string')).toBe(false);
      expect(validateAccount(123)).toBe(false);
      expect(validateAccount([])).toBe(false);
    });

    it('should reject invalid id', () => {
      expect(validateAccount({ ...validAccount, id: '' })).toBe(false);
      expect(validateAccount({ ...validAccount, id: 123 })).toBe(false);
    });

    it('should reject invalid userId', () => {
      expect(validateAccount({ ...validAccount, userId: '' })).toBe(false);
      expect(validateAccount({ ...validAccount, userId: null })).toBe(false);
    });

    it('should reject invalid accountType', () => {
      expect(validateAccount({ ...validAccount, accountType: '' })).toBe(false);
      expect(validateAccount({ ...validAccount, accountType: 123 })).toBe(false);
    });

    it('should reject invalid accountNumber', () => {
      expect(validateAccount({ ...validAccount, accountNumber: '' })).toBe(false);
      expect(validateAccount({ ...validAccount, accountNumber: null })).toBe(false);
    });

    it('should reject invalid balance', () => {
      expect(validateAccount({ ...validAccount, balance: 'not-number' })).toBe(false);
      expect(validateAccount({ ...validAccount, balance: NaN })).toBe(false);
    });

    it('should reject invalid status', () => {
      expect(validateAccount({ ...validAccount, status: '' })).toBe(false);
      expect(validateAccount({ ...validAccount, status: 123 })).toBe(false);
    });

    it('should reject invalid date strings', () => {
      expect(validateAccount({ ...validAccount, createdAt: 'invalid-date' })).toBe(false);
      expect(validateAccount({ ...validAccount, updatedAt: '' })).toBe(false);
    });
  });

  describe('validateTransaction', () => {
    const validTransaction: Transaction = {
      id: 'txn-123',
      fromAccountId: 'acc-456',
      toAccountId: 'acc-789',
      amount: 100.50,
      type: 'transfer',
      description: 'Test transfer',
      userId: 'user-123',
      createdAt: '2023-01-01T00:00:00Z',
      performedBy: 'user-123',
      accountInfo: 'Account info'
    };

    it('should validate a correct Transaction', () => {
      expect(validateTransaction(validTransaction)).toBe(true);
    });

    it('should validate deposit transaction', () => {
      const deposit = {
        ...validTransaction,
        type: 'deposit',
        fromAccountId: undefined,
        toAccountId: 'acc-123'
      };
      expect(validateTransaction(deposit)).toBe(true);
    });

    it('should validate withdrawal transaction', () => {
      const withdrawal = {
        ...validTransaction,
        type: 'withdrawal',
        fromAccountId: 'acc-123',
        toAccountId: undefined
      };
      expect(validateTransaction(withdrawal)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateTransaction(null)).toBe(false);
      expect(validateTransaction(undefined)).toBe(false);
    });

    it('should reject invalid id', () => {
      expect(validateTransaction({ ...validTransaction, id: '' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, id: 123 })).toBe(false);
    });

    it('should reject invalid amount', () => {
      expect(validateTransaction({ ...validTransaction, amount: 0 })).toBe(false);
      expect(validateTransaction({ ...validTransaction, amount: -100 })).toBe(false);
      expect(validateTransaction({ ...validTransaction, amount: 'not-number' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, amount: NaN })).toBe(false);
    });

    it('should reject invalid type', () => {
      expect(validateTransaction({ ...validTransaction, type: 'invalid' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, type: '' })).toBe(false);
    });

    it('should reject invalid userId', () => {
      expect(validateTransaction({ ...validTransaction, userId: '' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, userId: null })).toBe(false);
    });

    it('should reject invalid createdAt', () => {
      expect(validateTransaction({ ...validTransaction, createdAt: 'invalid-date' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, createdAt: '' })).toBe(false);
    });

    it('should reject transfer without required accounts', () => {
      expect(validateTransaction({ ...validTransaction, type: 'transfer', fromAccountId: undefined })).toBe(false);
      expect(validateTransaction({ ...validTransaction, type: 'transfer', toAccountId: undefined })).toBe(false);
    });

    it('should reject transfer with same from and to accounts', () => {
      expect(validateTransaction({ 
        ...validTransaction, 
        type: 'transfer', 
        fromAccountId: 'acc-123', 
        toAccountId: 'acc-123' 
      })).toBe(false);
    });

    it('should reject withdrawal without fromAccountId', () => {
      expect(validateTransaction({ 
        ...validTransaction, 
        type: 'withdrawal', 
        fromAccountId: undefined 
      })).toBe(false);
    });

    it('should reject deposit without toAccountId', () => {
      expect(validateTransaction({ 
        ...validTransaction, 
        type: 'deposit', 
        toAccountId: undefined 
      })).toBe(false);
    });

    it('should reject empty optional string fields', () => {
      expect(validateTransaction({ ...validTransaction, description: '' })).toBe(false);
      expect(validateTransaction({ ...validTransaction, performedBy: '' })).toBe(false);
    });
  });

  describe('validateTransactionRequest', () => {
    const validTransferRequest: TransactionRequest = {
      fromAccountId: 'acc-456',
      toAccountId: 'acc-789',
      amount: 100.50,
      type: 'transfer',
      description: 'Test transfer'
    };

    it('should validate a correct TransactionRequest', () => {
      expect(validateTransactionRequest(validTransferRequest)).toBe(true);
    });

    it('should validate deposit request', () => {
      const deposit = {
        toAccountId: 'acc-123',
        amount: 100.50,
        type: 'deposit',
        description: 'Test deposit'
      };
      expect(validateTransactionRequest(deposit)).toBe(true);
    });

    it('should validate withdrawal request', () => {
      const withdrawal = {
        fromAccountId: 'acc-123',
        amount: 100.50,
        type: 'withdrawal',
        description: 'Test withdrawal'
      };
      expect(validateTransactionRequest(withdrawal)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateTransactionRequest(null)).toBe(false);
      expect(validateTransactionRequest(undefined)).toBe(false);
    });

    it('should reject invalid amount', () => {
      expect(validateTransactionRequest({ ...validTransferRequest, amount: 0 })).toBe(false);
      expect(validateTransactionRequest({ ...validTransferRequest, amount: -100 })).toBe(false);
      expect(validateTransactionRequest({ ...validTransferRequest, amount: NaN })).toBe(false);
    });

    it('should reject invalid type', () => {
      expect(validateTransactionRequest({ ...validTransferRequest, type: 'invalid' })).toBe(false);
    });

    it('should reject transfer without required accounts', () => {
      expect(validateTransactionRequest({ ...validTransferRequest, fromAccountId: undefined })).toBe(false);
      expect(validateTransactionRequest({ ...validTransferRequest, toAccountId: undefined })).toBe(false);
    });

    it('should reject transfer with same accounts', () => {
      expect(validateTransactionRequest({ 
        ...validTransferRequest, 
        fromAccountId: 'acc-123', 
        toAccountId: 'acc-123' 
      })).toBe(false);
    });
  });

  describe('validateBankingToolParams', () => {
    it('should validate get_my_accounts params', () => {
      expect(validateBankingToolParams('get_my_accounts', {})).toBe(true);
    });

    it('should validate get_account_balance params', () => {
      expect(validateBankingToolParams('get_account_balance', { account_id: 'acc-123' })).toBe(true);
      expect(validateBankingToolParams('get_account_balance', { account_id: '' })).toBe(false);
      expect(validateBankingToolParams('get_account_balance', {})).toBe(false);
    });

    it('should validate get_my_transactions params', () => {
      expect(validateBankingToolParams('get_my_transactions', {})).toBe(true);
    });

    it('should validate create_deposit params', () => {
      expect(validateBankingToolParams('create_deposit', {
        to_account_id: 'acc-123',
        amount: 100.50,
        description: 'Test deposit'
      })).toBe(true);

      expect(validateBankingToolParams('create_deposit', {
        to_account_id: 'acc-123',
        amount: 100.50
      })).toBe(true);

      expect(validateBankingToolParams('create_deposit', {
        to_account_id: '',
        amount: 100.50
      })).toBe(false);

      expect(validateBankingToolParams('create_deposit', {
        to_account_id: 'acc-123',
        amount: 0
      })).toBe(false);

      expect(validateBankingToolParams('create_deposit', {
        to_account_id: 'acc-123',
        amount: 100.50,
        description: 'a'.repeat(256) // Too long
      })).toBe(false);
    });

    it('should validate create_withdrawal params', () => {
      expect(validateBankingToolParams('create_withdrawal', {
        from_account_id: 'acc-123',
        amount: 100.50,
        description: 'Test withdrawal'
      })).toBe(true);

      expect(validateBankingToolParams('create_withdrawal', {
        from_account_id: '',
        amount: 100.50
      })).toBe(false);

      expect(validateBankingToolParams('create_withdrawal', {
        from_account_id: 'acc-123',
        amount: -100
      })).toBe(false);
    });

    it('should validate create_transfer params', () => {
      expect(validateBankingToolParams('create_transfer', {
        from_account_id: 'acc-123',
        to_account_id: 'acc-456',
        amount: 100.50,
        description: 'Test transfer'
      })).toBe(true);

      expect(validateBankingToolParams('create_transfer', {
        from_account_id: 'acc-123',
        to_account_id: 'acc-123', // Same account
        amount: 100.50
      })).toBe(false);

      expect(validateBankingToolParams('create_transfer', {
        from_account_id: 'acc-123',
        amount: 100.50
      })).toBe(false); // Missing to_account_id
    });

    it('should reject unknown tool names', () => {
      expect(validateBankingToolParams('unknown_tool', {})).toBe(false);
    });

    it('should reject null or undefined params', () => {
      expect(validateBankingToolParams('get_my_accounts', null)).toBe(false);
      expect(validateBankingToolParams('get_my_accounts', undefined)).toBe(false);
    });
  });

  describe('validateAccountId', () => {
    it('should validate correct account IDs', () => {
      expect(validateAccountId('acc-123')).toBe(true);
      expect(validateAccountId('account_456')).toBe(true);
      expect(validateAccountId('ABC123')).toBe(true);
      expect(validateAccountId('user-account-789')).toBe(true);
    });

    it('should reject invalid account IDs', () => {
      expect(validateAccountId('')).toBe(false);
      expect(validateAccountId('ab')).toBe(false); // Too short
      expect(validateAccountId('a'.repeat(51))).toBe(false); // Too long
      expect(validateAccountId('acc 123')).toBe(false); // Contains space
      expect(validateAccountId('acc@123')).toBe(false); // Invalid character
      expect(validateAccountId('acc.123')).toBe(false); // Invalid character
    });

    it('should reject non-string account IDs', () => {
      expect(validateAccountId(123 as any)).toBe(false);
      expect(validateAccountId(null as any)).toBe(false);
      expect(validateAccountId(undefined as any)).toBe(false);
    });
  });

  describe('validateAmount', () => {
    it('should validate correct amounts', () => {
      expect(validateAmount(100)).toBe(true);
      expect(validateAmount(100.50)).toBe(true);
      expect(validateAmount(0.01)).toBe(true);
      expect(validateAmount(999999.99)).toBe(true);
    });

    it('should reject invalid amounts', () => {
      expect(validateAmount(0)).toBe(false);
      expect(validateAmount(-100)).toBe(false);
      expect(validateAmount(NaN)).toBe(false);
      expect(validateAmount(100.123)).toBe(false); // Too many decimal places
    });

    it('should reject non-number amounts', () => {
      expect(validateAmount('100' as any)).toBe(false);
      expect(validateAmount(null as any)).toBe(false);
      expect(validateAmount(undefined as any)).toBe(false);
    });
  });
});