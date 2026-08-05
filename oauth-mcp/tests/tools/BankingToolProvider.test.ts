/**
 * Banking Tool Provider Tests
 */

import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { TokenExchangeService } from '../../src/auth/TokenExchangeService';
import { Session, UserTokens, AuthErrorCodes, AuthenticationError } from '../../src/interfaces/auth';
import { Account, Transaction, TransactionResponse, BankingAPIError } from '../../src/interfaces/banking';
import { tokenCache } from '../../src/services/tokenCacheService';

jest.mock('../../src/auth/TokenExchangeService');

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

// Mock dependencies
jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');

describe('BankingToolProvider', () => {
  let provider: BankingToolProvider;
  let mockApiClient: jest.Mocked<BankingAPIClient>;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockSession: Session;

  beforeEach(() => {
    mockApiClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
    mockAuthManager = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('test', 'test-key') as jest.Mocked<BankingSessionManager>;

    // Set up default mocks for AuthenticationManager
    mockAuthManager.generateAuthorizationRequest = jest.fn();
    mockAuthManager.isTokenExpired = jest.fn();
    mockAuthManager.validateBankingScopes = jest.fn();
    mockAuthManager.validateTokenScopes = jest.fn().mockResolvedValue(true);

    // Phase 226+: BankingAPIClient grew startTrace/stopTrace for HTTP debug capture.
    // Mock returns an empty trace array so attachTrace() in BankingToolProvider works.
    mockApiClient.startTrace = jest.fn();
    mockApiClient.stopTrace = jest.fn(() => []);

    provider = new BankingToolProvider(mockApiClient, mockAuthManager, mockSessionManager);

    // Create mock session with valid user tokens
    const mockUserTokens: UserTokens = {
      accessToken: 'valid_access_token',
      refreshToken: 'valid_refresh_token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      // Phase 210+: flat scope model (read, write, sensitive:read).
      scope: 'read write sensitive:read',
      issuedAt: new Date()
    };

    mockSession = {
      sessionId: 'session_123',
      agentTokenHash: 'agent_hash',
      userTokens: mockUserTokens,
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper function to mock successful authorization
  const mockSuccessfulAuthorization = () => {
    mockAuthManager.isTokenExpired.mockReturnValue(false);
    mockAuthManager.validateBankingScopes.mockReturnValue(true);
    mockAuthManager.generateAuthorizationRequest.mockReturnValue({
      authorizationUrl: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      state: 'test-state',
      scope: 'accounts:read',
      sessionId: 'session_123',
      expiresAt: new Date(Date.now() + 300000)
    });
  };

  describe('getAvailableTools', () => {
    it('should return all banking tools', () => {
      const tools = provider.getAvailableTools();

      // All tools from all verticals; includes banking, healthcare, mortgage, payroll, etc.
      expect(tools.length).toBeGreaterThan(40);
      expect(tools.map(t => t.name)).toEqual(expect.arrayContaining([
        'get_my_accounts',
        'get_account_balance',
        'get_sensitive_account_details',
        'get_my_transactions',
        'create_deposit',
        'create_withdrawal',
        'create_transfer',
        'query_user_by_email',
        'lookup_customer',
        'get_customer_profile',
        'get_customer_accounts',
        'get_customer_transactions',
        'freeze_account',
        'reset_customer_password',
        'adjust_balance',
        'delete_customer',
        'sequential_think',
      ]));
    });
  });

  describe('executeTool', () => {
    describe('parameter validation', () => {
      it('should reject unknown tool', async () => {
        const result = await provider.executeTool('unknown_tool', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown tool: unknown_tool');
        expect(result.text).toContain('Unknown tool: unknown_tool');
      });

      it('should reject invalid parameters', async () => {
        const result = await provider.executeTool('get_account_balance', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid parameters');
        expect(result.text).toContain('Missing required parameter: account_id');
      });

      it('should accept valid parameters', async () => {
        const mockAccounts: Account[] = [
          {
            id: 'acc_123',
            userId: 'user_123',
            accountType: 'checking',
            accountNumber: '1234567890',
            balance: 1000.50,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          }
        ];

        mockSuccessfulAuthorization();
        mockApiClient.getMyAccounts.mockResolvedValue(mockAccounts);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.count).toBe(1);
        expect(mockApiClient.getMyAccounts).toHaveBeenCalledWith('valid_access_token');
      });
    });

    describe('authorization handling', () => {
      it('should require user authorization when no user tokens', async () => {
        const sessionWithoutTokens = { ...mockSession, userTokens: undefined };
        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithoutTokens);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
        expect(result.text).toContain('To complete this banking operation');
      });

      it('should refresh expired tokens', async () => {
        // Create session with expired tokens
        const expiredTokens: UserTokens = {
          ...(mockSession.userTokens as UserTokens),
          issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
        };
        const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

        const refreshedTokens: UserTokens = {
          ...expiredTokens,
          accessToken: 'new_access_token',
          issuedAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockImplementation((token: UserTokens) =>
          token.accessToken !== 'new_access_token'
        );
        mockAuthManager.refreshUserToken.mockResolvedValue(refreshedTokens);
        mockAuthManager.validateBankingScopes.mockReturnValue(true);
        mockSessionManager.associateUserTokens.mockResolvedValue();
        mockSessionManager.getSession.mockResolvedValue({ ...sessionWithExpiredTokens, userTokens: [refreshedTokens] });
        mockApiClient.getMyAccounts.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithExpiredTokens);
        
        expect(result.success).toBe(true);
        expect(mockAuthManager.refreshUserToken).toHaveBeenCalledWith('valid_refresh_token');
        expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('session_123', refreshedTokens);
        expect(mockApiClient.getMyAccounts).toHaveBeenCalledWith('new_access_token');
      });

      it('should request new authorization when token refresh fails', async () => {
        const expiredTokens: UserTokens = {
          ...(mockSession.userTokens as UserTokens),
          issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
        };
        const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockReturnValue(true);
        mockAuthManager.refreshUserToken.mockRejectedValue(new Error('Refresh failed'));
        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithExpiredTokens);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
      });

      it('should reject insufficient scopes', async () => {
        const limitedScopeTokens: UserTokens = {
          ...(mockSession.userTokens as UserTokens),
          scope: 'transactions:read' // Missing accounts:read
        };
        const sessionWithLimitedScopes = { ...mockSession, userTokens: limitedScopeTokens };

        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockReturnValue(false);
        mockAuthManager.validateBankingScopes.mockReturnValue(false);
        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithLimitedScopes);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
      });
    });

    describe('get_my_accounts', () => {
      it('should return formatted account list', async () => {
        mockSuccessfulAuthorization();
        
        const mockAccounts: Account[] = [
          {
            id: 'acc_123',
            userId: 'user_123',
            accountType: 'checking',
            accountNumber: '1234567890',
            balance: 1000.50,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          },
          {
            id: 'acc_456',
            userId: 'user_123',
            accountType: 'savings',
            accountNumber: '0987654321',
            balance: 5000.00,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          }
        ];

        mockApiClient.getMyAccounts.mockResolvedValue(mockAccounts);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.count).toBe(2);
        // Source returns full Account shape with `accountType` (not the abbreviated `type`).
        expect(data.accounts[0].id).toBe('acc_123');
        expect(data.accounts[0].accountType).toBe('checking');
        expect(data.accounts[0].balance).toBe(1000.50);
        expect(data.accounts[1].id).toBe('acc_456');
        expect(data.accounts[1].accountType).toBe('savings');
        expect(data.accounts[1].balance).toBe(5000.00);
      });

      it('should handle empty account list', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getMyAccounts.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.count).toBe(0);
        expect(data.accounts).toHaveLength(0);
      });
    });

    describe('get_account_balance', () => {
      it('should return account balance', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getAccountBalance.mockResolvedValue({ balance: 1500.75 });

        const result = await provider.executeTool('get_account_balance', { account_id: 'acc_123' }, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.accountId).toBe('acc_123');
        expect(data.balance).toBe(1500.75);
        expect(mockApiClient.getAccountBalance).toHaveBeenCalledWith('valid_access_token', 'acc_123');
      });
    });

    describe('get_my_transactions', () => {
      it('should return formatted transaction list', async () => {
        const mockTransactions: Transaction[] = [
          {
            id: 'txn_123',
            fromAccountId: 'acc_123',
            toAccountId: 'acc_456',
            amount: 100.00,
            type: 'transfer',
            description: 'Monthly transfer',
            userId: 'user_123',
            createdAt: '2023-01-01T12:00:00Z'
          },
          {
            id: 'txn_456',
            toAccountId: 'acc_123',
            amount: 500.00,
            type: 'deposit',
            description: 'Salary deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T10:00:00Z'
          }
        ];

        mockSuccessfulAuthorization();
        mockApiClient.getMyTransactions.mockResolvedValue(mockTransactions);

        const result = await provider.executeTool('get_my_transactions', {}, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.count).toBe(2);
        expect(data.transactions[0].id).toBe('txn_123');
        expect(data.transactions[0].type).toBe('transfer');
        expect(data.transactions[0].amount).toBe(100.00);
        expect(data.transactions[0].fromAccountId).toBe('acc_123');
        expect(data.transactions[0].toAccountId).toBe('acc_456');
        expect(data.transactions[0].description).toBe('Monthly transfer');
      });

      it('should handle empty transaction list', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getMyTransactions.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_transactions', {}, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.count).toBe(0);
        expect(data.transactions).toHaveLength(0);
      });
    });

    describe('create_deposit', () => {
      it('should create deposit successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Deposit created successfully',
          transaction: {
            id: 'txn_789',
            toAccountId: 'acc_123',
            amount: 250.00,
            type: 'deposit',
            description: 'Test deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T15:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createDeposit.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_deposit', {
          to_account_id: 'acc_123',
          amount: 250.00,
          description: 'Test deposit'
        }, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.operation).toBe('deposit');
        expect(data.message).toBe('Deposit created successfully');
        expect(data.transaction.id).toBe('txn_789');
        expect(data.amount).toBe(250.00);
        expect(data.accountId).toBe('acc_123');
        expect(mockApiClient.createDeposit).toHaveBeenCalledWith(
          'valid_access_token',
          'acc_123',
          250.00,
          'Test deposit'
        );
      });
    });

    describe('create_withdrawal', () => {
      it('should create withdrawal successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Withdrawal created successfully',
          transaction: {
            id: 'txn_890',
            fromAccountId: 'acc_123',
            amount: 150.00,
            type: 'withdrawal',
            userId: 'user_123',
            createdAt: '2023-01-01T16:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createWithdrawal.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_withdrawal', {
          from_account_id: 'acc_123',
          amount: 150.00
        }, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.operation).toBe('withdrawal');
        expect(data.message).toBe('Withdrawal created successfully');
        expect(data.transaction.id).toBe('txn_890');
        expect(data.amount).toBe(150.00);
        expect(data.accountId).toBe('acc_123');
      });
    });

    describe('create_transfer', () => {
      it('should create transfer successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Transfer completed successfully',
          withdrawalTransaction: {
            id: 'txn_901',
            fromAccountId: 'acc_123',
            amount: 300.00,
            type: 'withdrawal',
            userId: 'user_123',
            createdAt: '2023-01-01T17:00:00Z'
          },
          depositTransaction: {
            id: 'txn_902',
            toAccountId: 'acc_456',
            amount: 300.00,
            type: 'deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T17:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createTransfer.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_transfer', {
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 300.00,
          description: 'Transfer to savings'
        }, mockSession);
        
        expect(result.success).toBe(true);
        const data = JSON.parse(result.text);
        expect(data.operation).toBe('transfer');
        expect(data.message).toBe('Transfer completed successfully');
        expect(data.withdrawalTransaction.id).toBe('txn_901');
        expect(data.depositTransaction.id).toBe('txn_902');
        expect(data.amount).toBe(300.00);
        expect(data.fromAccountId).toBe('acc_123');
        expect(data.toAccountId).toBe('acc_456');
      });

      // Regression: UC14b PAR-permit path — the MCP server's own Step 9 resource
      // exchange (TokenResolver) deliberately re-audiences the agent token to
      // BANKING_API_RESOURCE_URI before calling a banking data/write tool. The
      // sensitive-handler aud check (JwtClaimVerifier) must validate the token that
      // *arrived* at this MCP server (agentToken), not that re-audienced token, or
      // every sensitive write (create_transfer/withdrawal/deposit,
      // get_sensitive_account_details) fails with a false aud-mismatch whenever
      // Step 9 is enabled.
      it('succeeds when Step 9 resource exchange narrows the token to BANKING_API_RESOURCE_URI', async () => {
        const originalEnv = { ...process.env };
        process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
        process.env.BANKING_API_RESOURCE_URI = 'enduser.ping.demo';
        delete process.env.PINGONE_JWKS_URI;

        try {
          const mockTokenExchangeService = new TokenExchangeService({} as any) as jest.Mocked<TokenExchangeService>;
          mockTokenExchangeService.exchangeToken = jest.fn().mockResolvedValue({
            access_token: makeJwt({ aud: 'enduser.ping.demo', scope: 'write', exp: Math.floor(Date.now() / 1000) + 3600 }),
            token_type: 'Bearer',
            expires_in: 3600,
          });
          const step9Provider = new BankingToolProvider(mockApiClient, mockAuthManager, mockSessionManager);
          step9Provider.setTokenExchangeService(mockTokenExchangeService);

          const agentToken = makeJwt({ aud: 'mcpserver.ping.demo', scope: 'gateway:mcp:invoke', exp: Math.floor(Date.now() / 1000) + 3600 });

          mockSuccessfulAuthorization();
          mockApiClient.createTransfer.mockResolvedValue({
            message: 'Transfer completed successfully',
            withdrawalTransaction: { id: 'txn_901', fromAccountId: 'acc_123', amount: 80, type: 'withdrawal', userId: 'user_123', createdAt: '2023-01-01T17:00:00Z' },
            depositTransaction: { id: 'txn_902', toAccountId: 'acc_456', amount: 80, type: 'deposit', userId: 'user_123', createdAt: '2023-01-01T17:00:00Z' },
          });

          const result = await step9Provider.executeTool('create_transfer', {
            from_account_id: 'acc_123',
            to_account_id: 'acc_456',
            amount: 80,
            description: 'UC14b PAR-permit'
          }, mockSession, agentToken);

          expect(mockTokenExchangeService.exchangeToken).toHaveBeenCalled();
          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();
        } finally {
          process.env = originalEnv;
        }
      });
    });

    describe('query_user_by_email', () => {
      it('should return user information when user exists', async () => {
        const mockUserResponse = {
          user: {
            id: 'user_123',
            username: 'john.doe@example.com',
            email: 'john.doe@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'customer',
            isActive: true,
            createdAt: '2023-01-01T00:00:00Z',
            oauthProvider: 'pingone_ai_core',
            oauthId: 'oauth_123'
          },
          exists: true,
          queriedBy: 'ai_agent_test',
          queriedAt: '2023-01-01T12:00:00Z'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        // Phase 198+: query_user_by_email runs on the agent-delegated token, not the
        // user token. Pass agentToken as the 4th arg to executeTool.
        const result = await provider.executeTool('query_user_by_email', {
          email: 'john.doe@example.com'
        }, mockSession, 'agent-delegated-token');

        expect(result.success).toBe(true);

        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(true);
        expect(responseData.user.id).toBe('user_123');
        expect(responseData.user.email).toBe('john.doe@example.com');
        expect(responseData.user.firstName).toBe('John');
        expect(responseData.user.lastName).toBe('Doe');
        expect(responseData.user.username).toBe('john.doe@example.com');
        expect(responseData.user.role).toBe('customer');
        expect(responseData.user.isActive).toBe(true);
        expect(responseData.user.createdAt).toBe('2023-01-01T00:00:00Z');
        expect(responseData.user.oauthProvider).toBe('pingone_ai_core');
        expect(responseData.queriedBy).toBe('ai_agent_test');
        expect(responseData.queriedAt).toBe('2023-01-01T12:00:00Z');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith('agent-delegated-token', 'john.doe@example.com');
      });

      it('should handle user not found', async () => {
        const mockUserResponse = {
          exists: false,
          email: 'nonexistent@example.com'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'nonexistent@example.com'
        }, mockSession, 'agent-delegated-token');

        expect(result.success).toBe(true);

        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(false);
        expect(responseData.email).toBe('nonexistent@example.com');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith('agent-delegated-token', 'nonexistent@example.com');
      });

      it('should handle 404 API error as user not found', async () => {
        mockSuccessfulAuthorization();

        const apiError = new BankingAPIError('User not found', 404, 'USER_NOT_FOUND');
        mockApiClient.queryUserByEmail.mockRejectedValue(apiError);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'notfound@example.com'
        }, mockSession, 'agent-delegated-token');

        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(false);
        expect(responseData.email).toBe('notfound@example.com');
        expect(responseData.error).toBe('User not found');
      });

      it('should validate email parameter', async () => {
        const result = await provider.executeTool('query_user_by_email', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid parameters');
        expect(result.text).toContain('Missing required parameter: email');
      });

      it('should use agent token when no user tokens available', async () => {
        const sessionWithoutUserTokens = { ...mockSession, userTokens: undefined };
        const mockAgentToken = 'agent_token_123';
        const mockUserResponse = {
          user: {
            id: 'user_456',
            username: 'agent.user@example.com',
            email: 'agent.user@example.com',
            firstName: 'Agent',
            lastName: 'User',
            role: 'customer',
            isActive: true,
            createdAt: '2023-01-01T00:00:00Z',
            oauthProvider: 'pingone_ai_core',
            oauthId: 'oauth_456'
          },
          exists: true,
          queriedBy: 'ai_agent_test',
          queriedAt: '2023-01-01T12:00:00Z'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'agent.user@example.com'
        }, sessionWithoutUserTokens, mockAgentToken);
        
        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(true);
        expect(responseData.user.id).toBe('user_456');
        expect(responseData.user.email).toBe('agent.user@example.com');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith(mockAgentToken, 'agent.user@example.com');
      });
    });

    describe('error handling', () => {
      it('should handle BankingAPIError', async () => {
        mockSuccessfulAuthorization();
        
        const apiError = new BankingAPIError('Insufficient funds', 400, 'INSUFFICIENT_FUNDS');
        mockApiClient.getMyAccounts.mockRejectedValue(apiError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Banking API error: Insufficient funds');
        expect(result.text).toContain('Banking API error: Insufficient funds');
      });

      it('should handle AuthenticationError with auth challenge', async () => {
        mockSuccessfulAuthorization();
        
        const authError = new AuthenticationError(
          'User authorization required',
          AuthErrorCodes.USER_AUTHORIZATION_REQUIRED,
          'https://auth.example.com/authorize',
          ['accounts:read']
        );
        mockApiClient.getMyAccounts.mockRejectedValue(authError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
        expect(result.authChallenge?.authorizationUrl).toBe('https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize');
      });

      it('should handle generic errors', async () => {
        mockSuccessfulAuthorization();
        
        const genericError = new Error('Network timeout');
        mockApiClient.getMyAccounts.mockRejectedValue(genericError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected error: Network timeout');
        expect(result.text).toContain('Unexpected error: Network timeout');
      });

      it('should handle unknown errors', async () => {
        mockSuccessfulAuthorization();

        mockApiClient.getMyAccounts.mockRejectedValue('string error');

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected error: Unknown error');
      });
    });
  });

  // ─── Token Exchange: D-01, D-02, D-04 ────────────────────────────────────────

  describe('token exchange (D-01, D-02, D-04)', () => {
    /** Produce a minimal unsigned JWT string with the given payload. */
    function makeJwt(payload: object): string {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${header}.${body}.`;
    }

    let providerWithExchange: BankingToolProvider;
    let mockExchangeService: { exchangeToken: jest.Mock };

    beforeEach(() => {
      mockExchangeService = { exchangeToken: jest.fn() };
      providerWithExchange = new BankingToolProvider(
        mockApiClient,
        mockAuthManager,
        mockSessionManager,
        mockExchangeService as any,
      );
      mockSuccessfulAuthorization();
      // Clear the module-level token cache singleton so tests don't share cached entries.
      tokenCache.clear();
    });

    afterEach(() => {
      tokenCache.clear();
    });

    it('D-04: hard fails when exchange throws; raw user token never forwarded', async () => {
      mockExchangeService.exchangeToken.mockRejectedValue(new Error('PingOne unavailable'));

      const result = await providerWithExchange.executeTool('get_my_accounts', {}, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Token exchange failed for tool 'get_my_accounts'");
      expect(result.error).toContain('PingOne unavailable');
      expect(mockApiClient.getMyAccounts).not.toHaveBeenCalled();
    });

    // D-02 was reformulated in Phase 198+: the provider no longer decodes unsigned JWT
    // payloads to inspect the `act` claim (that was deemed unsafe — see the comment in
    // BankingToolProvider around line 473-481). Instead D-02 now verifies the
    // TLS-secured exchange response *shape*: `token_type === 'Bearer'` AND `expires_in > 0`.
    // Per-claim validation lives in TokenExchangeService.validateDelegationChain() and is
    // exercised when the real exchange service is wired (not the test's mock).
    it('D-02: hard fails when exchange returns wrong token_type (not Bearer)', async () => {
      const noActToken = makeJwt({ sub: 'user123', aud: 'mcp', exp: Math.floor(Date.now() / 1000) + 3600 });
      mockExchangeService.exchangeToken.mockResolvedValue({
        access_token: noActToken,
        expires_in: 3600,
        token_type: 'opaque',
      });

      const result = await providerWithExchange.executeTool('get_my_accounts', {}, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Token exchange for 'get_my_accounts' returned unexpected response");
      expect(result.error).toContain('token_type: opaque');
      expect(mockApiClient.getMyAccounts).not.toHaveBeenCalled();
    });

    it('D-02: hard fails when exchange returns non-positive expires_in', async () => {
      const emptyActToken = makeJwt({ sub: 'user123', act: {} });
      mockExchangeService.exchangeToken.mockResolvedValue({
        access_token: emptyActToken,
        expires_in: 0,
        token_type: 'Bearer',
      });

      const result = await providerWithExchange.executeTool('get_my_accounts', {}, mockSession);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Token exchange for 'get_my_accounts' returned unexpected response");
      expect(result.error).toContain('expires_in: 0');
      expect(mockApiClient.getMyAccounts).not.toHaveBeenCalled();
    });

    it('D-01: uses delegated exchange token instead of raw user token for API call', async () => {
      const delegationToken = makeJwt({
        sub: 'user123',
        act: { sub: 'mcp-server', client_id: 'mcp-client-id' },
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockExchangeService.exchangeToken.mockResolvedValue({
        access_token: delegationToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });
      mockApiClient.getMyAccounts.mockResolvedValue([]);

      const result = await providerWithExchange.executeTool('get_my_accounts', {}, mockSession);

      expect(result.success).toBe(true);
      // Must use the exchanged delegation token, never the raw session token
      expect(mockApiClient.getMyAccounts).toHaveBeenCalledWith(delegationToken);
      expect(mockApiClient.getMyAccounts).not.toHaveBeenCalledWith('valid_access_token');
    });

    it('D-01: caches exchanged token; PingOne called only once across two tool calls', async () => {
      // Use a distinct session ID so this test's cache entry is isolated from others
      const cacheSession = { ...mockSession, sessionId: 'session_cache_isolation_test' };
      const delegationToken = makeJwt({
        sub: 'user123',
        act: { sub: 'mcp-server', client_id: 'mcp-client-id' },
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockExchangeService.exchangeToken.mockResolvedValue({
        access_token: delegationToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });
      mockApiClient.getMyAccounts.mockResolvedValue([]);

      await providerWithExchange.executeTool('get_my_accounts', {}, cacheSession);
      await providerWithExchange.executeTool('get_my_accounts', {}, cacheSession);

      // Exchange called once; second call served from cache
      expect(mockExchangeService.exchangeToken).toHaveBeenCalledTimes(1);
      expect(mockApiClient.getMyAccounts).toHaveBeenCalledTimes(2);
      expect(mockApiClient.getMyAccounts).toHaveBeenNthCalledWith(1, delegationToken);
      expect(mockApiClient.getMyAccounts).toHaveBeenNthCalledWith(2, delegationToken);
    });
  });
});