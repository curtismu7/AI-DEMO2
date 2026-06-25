/**
 * BankingAPIClient Tests
 */

import axios from 'axios';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import {
  Account,
  Transaction,
  TransactionRequest,
  TransactionResponse,
  AccountBalanceResponse,
  BankingAPIError
} from '../../src/interfaces/banking';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BankingAPIClient', () => {
  let client: BankingAPIClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      },
      defaults: {
        baseURL: '',
        timeout: 0
      }
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    mockedAxios.isAxiosError.mockImplementation((error) => error.isAxiosError === true);

    client = new BankingAPIClient({
      baseUrl: 'http://test-banking-api:3001',
      timeout: 5000,
      maxRetries: 0, // Disable retries for faster testing
      circuitBreakerConfig: {
        failureThreshold: 999, // Very high threshold to prevent circuit breaker from opening
        resetTimeout: 1000,
        monitoringPeriod: 100
      },
      retryConfig: {
        maxRetries: 0, // Disable retries
        baseDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 1,
        jitter: false
      }
    });
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      const defaultClient = new BankingAPIClient();
      const config = defaultClient.getConfig();

      expect(config.baseUrl).toBe('http://localhost:3001');
      expect(config.timeout).toBe(30000);
      expect(config.maxRetries).toBe(3);
      expect(config.circuitBreakerThreshold).toBe(5);
    });

    it('should create client with custom config', () => {
      const customClient = new BankingAPIClient({
        baseUrl: 'http://custom-api:8080',
        timeout: 10000,
        maxRetries: 5
      });
      const config = customClient.getConfig();

      expect(config.baseUrl).toBe('http://custom-api:8080');
      expect(config.timeout).toBe(10000);
      expect(config.maxRetries).toBe(5);
    });

    it('should set up axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://test-banking-api:3001',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    });
  });

  describe('getMyAccounts', () => {
    const mockAccounts: Account[] = [
      {
        id: 'acc-1',
        userId: 'user-1',
        accountType: 'checking',
        accountNumber: '1234567890',
        balance: 1000.50,
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      {
        id: 'acc-2',
        userId: 'user-1',
        accountType: 'savings',
        accountNumber: '0987654321',
        balance: 5000.00,
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    ];

    it('should successfully get user accounts', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { accounts: mockAccounts },
        status: 200
      });

      const result = await client.getMyAccounts('valid-token');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'get',
        url: '/api/accounts/my',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      expect(result).toEqual(mockAccounts);
    });

    it('should handle authentication error', async () => {
      const errorResponse = {
        response: {
          status: 401,
          data: { error: 'Unauthorized', code: 'AUTH_FAILED' }
        },
        isAxiosError: true
      };
      mockAxiosInstance.request.mockRejectedValue(errorResponse);

      await expect(client.getMyAccounts('invalid-token'))
        .rejects.toThrow(BankingAPIError);

      try {
        await client.getMyAccounts('invalid-token');
      } catch (error) {
        expect(error).toBeInstanceOf(BankingAPIError);
        expect((error as BankingAPIError).statusCode).toBe(401);
        expect((error as BankingAPIError).errorCode).toBe('AUTH_FAILED');
      }
    });
  });

  describe('getAccountBalance', () => {
    const mockBalance: AccountBalanceResponse = {
      balance: 1500.75
    };

    it('should successfully get account balance', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockBalance,
        status: 200
      });

      const result = await client.getAccountBalance('valid-token', 'acc-1');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'get',
        url: '/api/accounts/acc-1/balance',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      expect(result).toEqual(mockBalance);
    });

    it('should handle account not found error', async () => {
      const errorResponse = {
        response: {
          status: 404,
          data: { error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' }
        },
        isAxiosError: true
      };
      mockAxiosInstance.request.mockRejectedValue(errorResponse);

      await expect(client.getAccountBalance('valid-token', 'invalid-acc'))
        .rejects.toThrow(BankingAPIError);
    });
  });

  describe('getMyTransactions', () => {
    const mockTransactions: Transaction[] = [
      {
        id: 'txn-1',
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 100.00,
        type: 'transfer',
        description: 'Test transfer',
        userId: 'user-1',
        createdAt: '2024-01-01T00:00:00Z'
      },
      {
        id: 'txn-2',
        toAccountId: 'acc-1',
        amount: 500.00,
        type: 'deposit',
        description: 'Salary deposit',
        userId: 'user-1',
        createdAt: '2024-01-02T00:00:00Z'
      }
    ];

    it('should successfully get user transactions', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: { transactions: mockTransactions },
        status: 200
      });

      const result = await client.getMyTransactions('valid-token');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'get',
        url: '/api/transactions/my',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      expect(result).toEqual(mockTransactions);
    });
  });

  describe('createTransaction', () => {
    const mockTransactionRequest: TransactionRequest = {
      fromAccountId: 'acc-1',
      toAccountId: 'acc-2',
      amount: 250.00,
      type: 'transfer',
      description: 'Test transfer'
    };

    const mockTransactionResponse: TransactionResponse = {
      message: 'Transaction created successfully',
      transaction: {
        id: 'txn-3',
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 250.00,
        type: 'transfer',
        description: 'Test transfer',
        userId: 'user-1',
        createdAt: '2024-01-03T00:00:00Z'
      }
    };

    it('should successfully create a transaction', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockTransactionResponse,
        status: 201
      });

      const result = await client.createTransaction('valid-token', mockTransactionRequest);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/transactions',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        data: mockTransactionRequest
      });
      expect(result).toEqual(mockTransactionResponse);
    });

    it('should handle insufficient funds error', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: { error: 'Insufficient funds', code: 'INSUFFICIENT_FUNDS' }
        },
        isAxiosError: true
      };
      mockAxiosInstance.request.mockRejectedValue(errorResponse);

      await expect(client.createTransaction('valid-token', mockTransactionRequest))
        .rejects.toThrow(BankingAPIError);
    });
  });

  describe('createDeposit', () => {
    const mockDepositResponse: TransactionResponse = {
      message: 'Deposit created successfully',
      transaction: {
        id: 'txn-deposit-1',
        toAccountId: 'acc-1',
        amount: 500.00,
        type: 'deposit',
        description: 'Salary deposit',
        userId: 'user-1',
        createdAt: '2024-01-03T00:00:00Z'
      }
    };

    it('should successfully create a deposit', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockDepositResponse,
        status: 201
      });

      const result = await client.createDeposit('valid-token', 'acc-1', 500.00, 'Salary deposit');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/transactions',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        data: {
          toAccountId: 'acc-1',
          amount: 500.00,
          type: 'deposit',
          description: 'Salary deposit'
        }
      });
      expect(result).toEqual(mockDepositResponse);
    });

    it('should create deposit without description', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockDepositResponse,
        status: 201
      });

      await client.createDeposit('valid-token', 'acc-1', 500.00);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/transactions',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        data: {
          toAccountId: 'acc-1',
          amount: 500.00,
          type: 'deposit',
          description: undefined
        }
      });
    });
  });

  describe('createWithdrawal', () => {
    const mockWithdrawalResponse: TransactionResponse = {
      message: 'Withdrawal created successfully',
      transaction: {
        id: 'txn-withdrawal-1',
        fromAccountId: 'acc-1',
        amount: 200.00,
        type: 'withdrawal',
        description: 'ATM withdrawal',
        userId: 'user-1',
        createdAt: '2024-01-03T00:00:00Z'
      }
    };

    it('should successfully create a withdrawal', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockWithdrawalResponse,
        status: 201
      });

      const result = await client.createWithdrawal('valid-token', 'acc-1', 200.00, 'ATM withdrawal');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/transactions',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        data: {
          fromAccountId: 'acc-1',
          amount: 200.00,
          type: 'withdrawal',
          description: 'ATM withdrawal'
        }
      });
      expect(result).toEqual(mockWithdrawalResponse);
    });
  });

  describe('createTransfer', () => {
    const mockTransferResponse: TransactionResponse = {
      message: 'Transfer created successfully',
      withdrawalTransaction: {
        id: 'txn-transfer-withdrawal-1',
        fromAccountId: 'acc-1',
        amount: 300.00,
        type: 'withdrawal',
        description: 'Transfer to savings',
        userId: 'user-1',
        createdAt: '2024-01-03T00:00:00Z'
      },
      depositTransaction: {
        id: 'txn-transfer-deposit-1',
        toAccountId: 'acc-2',
        amount: 300.00,
        type: 'deposit',
        description: 'Transfer from checking',
        userId: 'user-1',
        createdAt: '2024-01-03T00:00:00Z'
      }
    };

    it('should successfully create a transfer', async () => {
      mockAxiosInstance.request.mockResolvedValue({
        data: mockTransferResponse,
        status: 201
      });

      const result = await client.createTransfer('valid-token', 'acc-1', 'acc-2', 300.00, 'Transfer to savings');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/transactions',
        headers: {
          'Authorization': 'Bearer valid-token'
        },
        data: {
          fromAccountId: 'acc-1',
          toAccountId: 'acc-2',
          amount: 300.00,
          type: 'transfer',
          description: 'Transfer to savings'
        }
      });
      expect(result).toEqual(mockTransferResponse);
    });
  });

  describe('input validation', () => {
    describe('amount validation', () => {
      it('should reject negative amounts', async () => {
        await expect(client.createDeposit('valid-token', 'acc-1', -100))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject zero amounts', async () => {
        await expect(client.createWithdrawal('valid-token', 'acc-1', 0))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject non-numeric amounts', async () => {
        await expect(client.createDeposit('valid-token', 'acc-1', NaN))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject infinite amounts', async () => {
        await expect(client.createDeposit('valid-token', 'acc-1', Infinity))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject amounts with more than 2 decimal places', async () => {
        await expect(client.createDeposit('valid-token', 'acc-1', 100.123))
          .rejects.toThrow(BankingAPIError);
      });

      it('should accept valid amounts with 2 decimal places', async () => {
        mockAxiosInstance.request.mockResolvedValue({
          data: { message: 'Success' },
          status: 201
        });

        await expect(client.createDeposit('valid-token', 'acc-1', 100.50))
          .resolves.toBeDefined();
      });
    });

    describe('account ID validation', () => {
      it('should reject empty account IDs', async () => {
        await expect(client.createDeposit('valid-token', '', 100))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject whitespace-only account IDs', async () => {
        await expect(client.createWithdrawal('valid-token', '   ', 100))
          .rejects.toThrow(BankingAPIError);
      });

      it('should reject non-string account IDs', async () => {
        await expect(client.createDeposit('valid-token', null as any, 100))
          .rejects.toThrow(BankingAPIError);
      });
    });

    describe('transfer validation', () => {
      it('should reject transfers to the same account', async () => {
        await expect(client.createTransfer('valid-token', 'acc-1', 'acc-1', 100))
          .rejects.toThrow(BankingAPIError);

        try {
          await client.createTransfer('valid-token', 'acc-1', 'acc-1', 100);
        } catch (error) {
          expect(error).toBeInstanceOf(BankingAPIError);
          expect((error as BankingAPIError).errorCode).toBe('SAME_ACCOUNT_TRANSFER');
        }
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const networkError = {
        request: {},
        message: 'Network Error',
        isAxiosError: true
      };
      mockAxiosInstance.request.mockRejectedValue(networkError);

      await expect(client.getMyAccounts('valid-token'))
        .rejects.toThrow(BankingAPIError);

      try {
        await client.getMyAccounts('valid-token');
      } catch (error) {
        expect(error).toBeInstanceOf(BankingAPIError);
        expect((error as BankingAPIError).statusCode).toBe(0);
        expect((error as BankingAPIError).errorCode).toBe('NO_RESPONSE');
      }
    });

    it('should handle request setup errors', async () => {
      const setupError = {
        message: 'Request setup failed',
        isAxiosError: true
      };
      mockAxiosInstance.request.mockRejectedValue(setupError);

      await expect(client.getMyAccounts('valid-token'))
        .rejects.toThrow(BankingAPIError);

      try {
        await client.getMyAccounts('valid-token');
      } catch (error) {
        expect(error).toBeInstanceOf(BankingAPIError);
        expect((error as BankingAPIError).errorCode).toBe('REQUEST_SETUP_ERROR');
      }
    });

    it('should handle unknown errors', async () => {
      const unknownError = new Error('Unknown error');
      mockAxiosInstance.request.mockRejectedValue(unknownError);

      await expect(client.getMyAccounts('valid-token'))
        .rejects.toThrow(BankingAPIError);

      try {
        await client.getMyAccounts('valid-token');
      } catch (error) {
        expect(error).toBeInstanceOf(BankingAPIError);
        expect((error as BankingAPIError).errorCode).toBe('UNKNOWN_ERROR');
      }
    });

    it('should pass through existing BankingAPIError', async () => {
      const existingError = new BankingAPIError('Existing error', 500, 'EXISTING_ERROR');
      mockAxiosInstance.request.mockRejectedValue(existingError);

      await expect(client.getMyAccounts('valid-token'))
        .rejects.toThrow(existingError);
    });
  });

  describe('configuration management', () => {
    it('should return current configuration', () => {
      const config = client.getConfig();
      
      expect(config.baseUrl).toBe('http://test-banking-api:3001');
      expect(config.timeout).toBe(5000);
    });

    it('should update configuration', () => {
      client.updateConfig({
        baseUrl: 'http://new-api:9000',
        timeout: 15000
      });

      const config = client.getConfig();
      expect(config.baseUrl).toBe('http://new-api:9000');
      expect(config.timeout).toBe(15000);
      
      // Should update axios instance
      expect(mockAxiosInstance.defaults.baseURL).toBe('http://new-api:9000');
      expect(mockAxiosInstance.defaults.timeout).toBe(15000);
    });
  });

  describe('circuit breaker integration', () => {
    it('should provide circuit breaker statistics', () => {
      const stats = client.getCircuitBreakerStats();
      
      expect(stats).toBeDefined();
      expect(stats.state).toBeDefined();
      expect(stats.failureCount).toBeDefined();
      expect(stats.successCount).toBeDefined();
    });

    it('should allow manual circuit breaker reset', () => {
      expect(() => client.resetCircuitBreaker()).not.toThrow();
    });

    it('should handle circuit breaker open state', async () => {
      // Mock circuit breaker to throw CircuitBreakerError
      const CircuitBreakerError = require('../../src/utils/CircuitBreaker').CircuitBreakerError;
      const circuitBreaker = (client as any).circuitBreaker;
      jest.spyOn(circuitBreaker, 'execute').mockRejectedValue(
        new CircuitBreakerError(
          'Circuit breaker is open',
          { state: 'OPEN', failureCount: 5, successCount: 0, totalRequests: 5 }
        )
      );

      await expect(client.getMyAccounts('valid-token'))
        .rejects.toThrow('Banking API is currently unavailable');
    });
  });

  describe('retry configuration', () => {
    it('should provide retry configuration', () => {
      const config = client.getRetryConfig();
      
      expect(config).toBeDefined();
      expect(config.maxRetries).toBeDefined();
      expect(config.baseDelay).toBeDefined();
      expect(config.maxDelay).toBeDefined();
    });
  });
});