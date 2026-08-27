/**
 * Banking API Client
 * HTTP client for communicating with the banking API server
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import https from 'https';
import {
  Account,
  Transaction,
  TransactionRequest,
  TransactionResponse,
  AccountBalanceResponse,
  BankingAPIConfig,
  BankingAPIError,
  UserQueryResponse
} from '../interfaces/banking';
import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError } from '../utils/CircuitBreaker';
import { RetryManager, RetryConfig, RetryError } from '../utils/RetryManager';
import { getCorrelationId } from '../utils/correlationContext';

export interface BankingAPIClientOptions extends Partial<BankingAPIConfig> {
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  retryConfig?: Partial<RetryConfig>;
  agentSub?: string;  // act.sub from the MCP token — forwarded as X-Agent-Sub
  mcpTool?: string;   // current tool name — forwarded as X-MCP-Tool
}

/** One captured HTTP call made to the banking API */
export interface HttpTraceEntry {
  method: string;
  url: string;
  requestBody?: unknown;
  status?: number;
  responseBody?: unknown;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export class BankingAPIClient {
  private client: AxiosInstance;
  private config: BankingAPIConfig;
  // Process-wide demo-user token cache (open-access hop). Static so every
  // call-scoped client instance shares one ROPC round-trip.
  private static demoTokenCache: { token: string; expiresAt: number } | null = null;
  private circuitBreaker: CircuitBreaker;
  private retryManager: RetryManager;
  /** Trace entries collected during the current startTrace() window, or null if not tracing */
  private _traceEntries: HttpTraceEntry[] | null = null;

  constructor(options: BankingAPIClientOptions = {}) {
    this.config = {
      baseUrl: options.baseUrl || 'http://localhost:3001',
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5
    };

    // Initialize circuit breaker
    const circuitBreakerConfig: CircuitBreakerConfig = {
      failureThreshold: this.config.circuitBreakerThreshold,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 10000, // 10 seconds
      // A client error is not upstream sickness. Same predicate the retry manager
      // uses, so the two policies can no longer disagree about the same response.
      isFailure: (error: unknown) => !BankingAPIClient.isClientError(error),
      ...options.circuitBreakerConfig
    };
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);

    // Initialize retry manager
    const retryConfig: RetryConfig = {
      maxRetries: this.config.maxRetries,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      jitter: true,
      ...options.retryConfig
    };
    this.retryManager = new RetryManager(retryConfig);

    // Disable TLS certificate verification for HTTPS banking API calls.
    // In production, real certs are used and this agent is not needed — but for
    // dev/staging with self-signed certs (api.ping.demo) this is required.
    // NODE_TLS_REJECT_UNAUTHORIZED=0 is an alternative but affects the whole process.
    const devHttpsAgent = this.config.baseUrl.startsWith('https')
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.agentSub ? { 'X-Agent-Sub': options.agentSub } : {}),
        ...(options.mcpTool ? { 'X-MCP-Tool': options.mcpTool } : {}),
      },
      ...(devHttpsAgent && { httpsAgent: devHttpsAgent }),
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`Banking API Request: ${config.method?.toUpperCase()} ${config.url}`);
        // Stamp start time for duration tracking
        (config as any)._traceStart = Date.now();
        // Carry the turn's correlation id back to the BFF. These callbacks run
        // the active vertical's tool, so they are part of the same transaction
        // as the mcp.tool hop — but without this header the BFF minted a fresh
        // id for them and filed their ui.request/response hops as a separate
        // record, which is what split /transaction-trace into two clusters.
        // Read per request (not at axios.create) — one client instance serves
        // many turns, and a construction-time value would pin them all to the
        // first id.
        const correlationId = getCorrelationId();
        if (correlationId) config.headers.set('X-Correlation-ID', correlationId);
        return config;
      },
      (error) => {
        console.error('Banking API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        if (response != null) {
          console.log(`Banking API Response: ${response.status} ${response.config.url}`);
          if (this._traceEntries !== null) {
            const start = (response.config as any)._traceStart ?? Date.now();
            this._traceEntries.push({
              method: response.config.method?.toUpperCase() ?? 'GET',
              url: response.config.url ?? '',
              requestBody: response.config.data ? tryParseJson(response.config.data) : undefined,
              status: response.status,
              responseBody: response.data,
              durationMs: Date.now() - start,
              ok: true,
            });
          }
        }
        return response;
      },
      (error) => {
        const axErr = error as AxiosError;
        if (this._traceEntries !== null) {
          const start = (axErr.config as any)?._traceStart ?? Date.now();
          this._traceEntries.push({
            method: axErr.config?.method?.toUpperCase() ?? 'GET',
            url: axErr.config?.url ?? '',
            requestBody: axErr.config?.data ? tryParseJson(axErr.config.data) : undefined,
            status: axErr.response?.status,
            responseBody: (axErr.response?.data as any),
            durationMs: Date.now() - start,
            ok: false,
            error: axErr.message,
          });
        }
        const bankingError = this.mapError(error);
        console.error('Banking API Error:', bankingError);
        return Promise.reject(bankingError);
      }
    );
  }

  /** Start collecting HTTP trace entries. Call stopTrace() to retrieve them. */
  startTrace(): void {
    this._traceEntries = [];
  }

  /** Stop collecting and return all entries captured since startTrace(). */
  stopTrace(): HttpTraceEntry[] {
    const entries = this._traceEntries ?? [];
    this._traceEntries = null;
    return entries;
  }

  /**
   * Get user's accounts
   */
  async getMyAccounts(userToken: string): Promise<Account[]> {
    const response = await this.makeAuthenticatedRequest<{accounts: Account[]}>(
      'GET',
      '/api/accounts/my',
      userToken
    );
    
    console.log(`[BankingAPIClient] getMyAccounts raw response:`, {
      status: response.status,
      accountsLength: response.data.accounts?.length
    });
    
    // Extract the accounts array from the response object
    return response.data.accounts || [];
  }

  /**
   * Run a vertical action tool (view_benefits, list_orders, …) via the BFF
   * callback. The BFF executes the active vertical's tool logic and returns
   * { ok, result, render }. Mirrors getMyAccounts — same delegated Bearer.
   */
  async callVerticalTool(
    userToken: string,
    name: string,
    args: Record<string, unknown> = {},
    vertical?: string,
  ): Promise<{ ok: boolean; result: unknown; render?: string }> {
    // vertical: the tool's own vertical, forwarded as a hint so the BFF runs
    // that vertical's agent regardless of the caller's active/selected vertical
    // (resolveVertical honours it only when the vertical owns the tool).
    const response = await this.makeAuthenticatedRequest<{ ok: boolean; result: unknown; render?: string }>(
      'POST',
      '/api/path/vertical-tool',
      userToken,
      { name, args, ...(vertical ? { vertical } : {}) },
    );
    return response.data;
  }

  /**
   * Open-access hop only: fetch a real access token for the configured demo user
   * from the BFF (ROPC), to use as the RFC 8693 subject_token when the forwarded
   * Privilege bearer is the un-exchangeable 'disabled' placeholder. Cached in
   * process until ~1 min before expiry. The BFF endpoint 404s unless
   * MCP_AUTH_DISABLED, so this only ever succeeds in the open-access demo mode.
   */
  async fetchDemoSubjectToken(): Promise<string | null> {
    const now = Date.now();
    if (BankingAPIClient.demoTokenCache && BankingAPIClient.demoTokenCache.expiresAt - now > 60_000) {
      return BankingAPIClient.demoTokenCache.token;
    }
    try {
      const { data } = await this.client.post<{ access_token?: string; expires_in?: number }>(
        '/api/path/demo-subject-token',
        {},
      );
      if (!data?.access_token) return null;
      BankingAPIClient.demoTokenCache = {
        token: data.access_token,
        expiresAt: now + ((data.expires_in || 3600) * 1000),
      };
      return data.access_token;
    } catch {
      return null;
    }
  }

  /**
   * Get account balance for a specific account
   */
  async getAccountBalance(userToken: string, accountId: string): Promise<AccountBalanceResponse> {
    const response = await this.makeAuthenticatedRequest<AccountBalanceResponse>(
      'GET',
      `/api/accounts/${accountId}/balance`,
      userToken
    );
    return response.data;
  }

  /**
   * Get user's transactions
   */
  async getMyTransactions(userToken: string): Promise<Transaction[]> {
    const response = await this.makeAuthenticatedRequest<{transactions: Transaction[]}>(
      'GET',
      '/api/transactions/my',
      userToken
    );
    
    console.log(`[BankingAPIClient] getMyTransactions raw response:`, {
      status: response.status,
      transactionsLength: response.data.transactions?.length
    });
    
    // Extract the transactions array from the response object
    return response.data.transactions || [];
  }

  /**
   * Create a transaction (deposit, withdrawal, or transfer)
   */
  async createTransaction(userToken: string, transactionData: TransactionRequest): Promise<TransactionResponse> {
    const response = await this.makeAuthenticatedRequest<TransactionResponse>(
      'POST',
      '/api/transactions',
      userToken,
      transactionData
    );
    return response.data;
  }

  /**
   * Create a deposit transaction
   */
  async createDeposit(
    userToken: string, 
    toAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(toAccountId);

    const transactionData: TransactionRequest = {
      toAccountId,
      amount,
      type: 'deposit',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Create a withdrawal transaction
   */
  async createWithdrawal(
    userToken: string, 
    fromAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(fromAccountId);

    const transactionData: TransactionRequest = {
      fromAccountId,
      amount,
      type: 'withdrawal',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Create a transfer transaction
   */
  async createTransfer(
    userToken: string, 
    fromAccountId: string, 
    toAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(fromAccountId);
    this.validateAccountId(toAccountId);

    if (fromAccountId === toAccountId) {
      throw new BankingAPIError(
        'Cannot transfer to the same account',
        400,
        'SAME_ACCOUNT_TRANSFER'
      );
    }

    const transactionData: TransactionRequest = {
      fromAccountId,
      toAccountId,
      amount,
      type: 'transfer',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Query user by email address
   */
  async queryUserByEmail(userToken: string, email: string): Promise<UserQueryResponse> {
    this.validateEmail(email);

    const response = await this.makeAuthenticatedRequest<UserQueryResponse>(
      'GET',
      `/api/users/query/by-email/${encodeURIComponent(email)}`,
      userToken
    );
    return response.data;
  }

  async updateContactEmail(userToken: string, accountId: string, newEmail: string): Promise<Record<string, unknown>> {
    const response = await this.makeAuthenticatedRequest<Record<string, unknown>>(
      'PATCH',
      `/api/accounts/${encodeURIComponent(accountId)}/contact-email`,
      userToken,
      { new_email: newEmail }
    );
    return response.data;
  }

  async requestFeeWaiver(userToken: string, accountId: string, reason: string): Promise<Record<string, unknown>> {
    const response = await this.makeAuthenticatedRequest<Record<string, unknown>>(
      'POST',
      `/api/accounts/${encodeURIComponent(accountId)}/fee-waiver-request`,
      userToken,
      { reason }
    );
    return response.data;
  }

  /**
   * Get sensitive account details (full account number + routing number).
   * Returns the raw BFF response — caller handles consent_required / denied shapes.
   */
  async getSensitiveAccountDetails(userToken: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.makeAuthenticatedRequest<Record<string, unknown>>(
        'GET',
        '/api/accounts/sensitive-details',
        userToken
      );
      return response.data;
    } catch (error: any) {
      // 428 HITL/step-up required — extract body so BankingToolProvider can handle it gracefully
      const status = error?.statusCode ?? error?.response?.status;
      if (status === 428) {
        const body = error?.originalError?.response?.data;
        // If body is accessible, return it (contains error, hitl_required, step_up_required, etc.)
        if (body) {
          return body as Record<string, unknown>;
        }
        // Fallback if body not accessible via originalError
        return {
          ok: false,
          error: 'hitl_required',
          consentRequired: true,
          message: 'Human approval required for this transaction',
        };
      }
      throw error; // Re-throw all other errors
    }
  }

  /**
   * Validate transaction amount
   */
  private validateTransactionAmount(amount: number): void {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new BankingAPIError(
        'Amount must be a valid number',
        400,
        'INVALID_AMOUNT'
      );
    }

    if (amount <= 0) {
      throw new BankingAPIError(
        'Amount must be greater than zero',
        400,
        'INVALID_AMOUNT'
      );
    }

    if (!Number.isFinite(amount)) {
      throw new BankingAPIError(
        'Amount must be a finite number',
        400,
        'INVALID_AMOUNT'
      );
    }

    // Check for reasonable precision (2 decimal places for currency)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      throw new BankingAPIError(
        'Amount cannot have more than 2 decimal places',
        400,
        'INVALID_AMOUNT_PRECISION'
      );
    }
  }

  /**
   * Validate account ID
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new BankingAPIError(
        'Account ID must be a non-empty string',
        400,
        'INVALID_ACCOUNT_ID'
      );
    }

    if (accountId.trim().length === 0) {
      throw new BankingAPIError(
        'Account ID cannot be empty or whitespace',
        400,
        'INVALID_ACCOUNT_ID'
      );
    }
  }

  /**
   * Validate email address
   */
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new BankingAPIError(
        'Email must be a non-empty string',
        400,
        'INVALID_EMAIL'
      );
    }

    if (email.trim().length === 0) {
      throw new BankingAPIError(
        'Email cannot be empty or whitespace',
        400,
        'INVALID_EMAIL'
      );
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new BankingAPIError(
        'Invalid email format',
        400,
        'INVALID_EMAIL_FORMAT'
      );
    }
  }

  /**
   * Make an authenticated request to the banking API with circuit breaker and retry logic
   */
  private async makeAuthenticatedRequest<T>(
    method: string,
    endpoint: string,
    userToken: string,
    data?: any
  ): Promise<AxiosResponse<T>> {
    const config = {
      method: method.toLowerCase(),
      url: endpoint,
      headers: {
        'Authorization': `Bearer ${userToken}`
      },
      ...(data && { data })
    };

    try {
      return await this.circuitBreaker.execute(async () => {
        return await this.retryManager.execute(
          async () => {
            return await this.client.request<T>(config);
          },
          (error: Error) => {
            // Never retry non-idempotent POST/PUT/PATCH requests to prevent double-execution
            // (e.g., creating a transaction twice on timeout when the first request succeeded).
            if (['post', 'put', 'patch'].includes(config.method)) return false;
            return this.shouldRetryRequest(error);
          }
        );
      });
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        throw new BankingAPIError(
          'Banking API is currently unavailable (circuit breaker open)',
          503,
          'SERVICE_UNAVAILABLE',
          error
        );
      }
      
      if (error instanceof RetryError) {
        throw this.mapError(error.originalError);
      }

      throw this.mapError(error);
    }
  }

  /**
   * Determine if a request should be retried
   */
  /**
   * A 4xx (except 429) — the REQUEST was wrong, not the server.
   *
   * Two policies need exactly this distinction and they used to disagree, which
   * is the bug (TECH_DEBT 2026-08-26): the retry manager already refused to retry
   * a 403, while the circuit breaker counted that same 403 as evidence the
   * upstream was failing. Five cross-owner reads — precisely what UC10's attack
   * simulation does on purpose — opened the breaker and took banking down for
   * every user for a minute, while the API was healthy the whole time.
   *
   * ONE predicate, consumed by both, because this file has already been burned by
   * two copies joined only by a keep-in-sync comment (see actionToTool's header).
   */
  static isClientError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const statusCode = (error as any).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return true;
    }
    // Raw axios errors, before mapError wraps them.
    const status = (error as any).response?.status;
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
      return true;
    }
    return false;
  }

  private shouldRetryRequest(error: Error): boolean {
    // 4xx except 429 — the request was wrong, retrying cannot help.
    if (BankingAPIClient.isClientError(error)) {
      return false;
    }

    // Don't retry client validation errors
    if (error instanceof BankingAPIError) {
      const nonRetryableCodes = [
        'INVALID_AMOUNT',
        'INVALID_ACCOUNT_ID',
        'SAME_ACCOUNT_TRANSFER',
        'INVALID_AMOUNT_PRECISION',
        'hitl_required',
      ];
      if (nonRetryableCodes.includes(error.errorCode || '')) {
        return false;
      }
    }

    // Use default retry logic for other errors
    return true;
  }

  /**
   * Detect axios-shaped errors; jest's axios mock may omit `axios.isAxiosError`, so we also check `isAxiosError`.
   */
  private isAxiosLikeError(error: unknown): error is AxiosError {
    if (typeof axios.isAxiosError === 'function' && axios.isAxiosError(error)) {
      return true;
    }
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { isAxiosError?: boolean }).isAxiosError === true
    );
  }

  /**
   * Map axios errors to BankingAPIError
   */
  private mapError(error: any): BankingAPIError {
    if (error instanceof BankingAPIError) {
      return error;
    }

    if (this.isAxiosLikeError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        // Server responded with error status
        const { status, data } = axiosError.response;
        const errorData = data as any;
        const apiErr = typeof errorData?.error === 'string' ? errorData.error : '';
        const message =
          (typeof errorData?.message === 'string' && errorData.message.trim()) ||
          apiErr ||
          'Banking API error';
        /** Prefer explicit `code`; else `error` when it looks like a machine code (e.g. consent_challenge_required). */
        const code =
          errorData?.code ||
          errorData?.errorCode ||
          (apiErr && (apiErr.includes('_') || /^[a-z][a-z0-9_]*$/i.test(apiErr)) ? apiErr : undefined);

        return new BankingAPIError(message, status, code, axiosError);
      } else if (axiosError.request) {
        // Request was made but no response received
        return new BankingAPIError(
          'No response from banking API server',
          0,
          'NO_RESPONSE',
          axiosError
        );
      } else {
        // Error in request setup
        return new BankingAPIError(
          'Request setup error',
          0,
          'REQUEST_SETUP_ERROR',
          axiosError
        );
      }
    }

    // Unknown error type
    return new BankingAPIError(
      error.message || 'Unknown banking API error',
      500,
      'UNKNOWN_ERROR',
      error
    );
  }

  /**
   * Generic authenticated GET request — used by admin tool handlers
   */
  async get(path: string, token: string): Promise<any> {
    const response = await this.makeAuthenticatedRequest<any>('GET', path, token);
    return response.data;
  }

  /**
   * Generic authenticated POST request — used by admin tool handlers
   */
  async post(path: string, body: any, token: string): Promise<any> {
    const response = await this.makeAuthenticatedRequest<any>('POST', path, token, body);
    return response.data;
  }

  /**
   * Generic authenticated DELETE request — used by admin tool handlers
   */
  async delete(path: string, body: any, token: string): Promise<any> {
    const response = await this.makeAuthenticatedRequest<any>('DELETE', path, token, body);
    return response.data;
  }

  /**
   * Generic authenticated PATCH request — used by admin tool handlers
   */
  async patch(path: string, body: any, token: string): Promise<any> {
    const response = await this.makeAuthenticatedRequest<any>('PATCH', path, token, body);
    return response.data;
  }

  /**
   * Get client configuration
   */
  getConfig(): BankingAPIConfig {
    return { ...this.config };
  }

  /**
   * Update client configuration
   */
  updateConfig(newConfig: Partial<BankingAPIConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update axios instance with new config
    this.client.defaults.baseURL = this.config.baseUrl;
    this.client.defaults.timeout = this.config.timeout;
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Get retry manager configuration
   */
  getRetryConfig() {
    return this.retryManager.getConfig();
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.manualReset();
  }
}

/** Safe JSON parse — returns parsed object or the raw value if already an object. */
function tryParseJson(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try { return JSON.parse(data); } catch { return data; }
}