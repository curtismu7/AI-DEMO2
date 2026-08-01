/**
 * Banking Authentication Manager
 * Main authentication manager that combines all PingOne AI IAM Core components
 */

import { TokenIntrospector } from './TokenIntrospector';
import { AuthorizationManager } from './AuthorizationManager';
import { AuthorizationRequestGenerator, AuthorizationRequestOptions } from './AuthorizationRequestGenerator';
import {
  PingOneConfig,
  AgentTokenInfo,
  UserTokens,
  AuthorizationRequest,
} from '../interfaces/auth';

export class BankingAuthenticationManager {
  private tokenIntrospector: TokenIntrospector;
  private authorizationManager: AuthorizationManager;
  private authRequestGenerator: AuthorizationRequestGenerator;
  private config: PingOneConfig;

  constructor(config: PingOneConfig) {
    this.config = config;
    this.tokenIntrospector = new TokenIntrospector(config);
    this.authorizationManager = new AuthorizationManager(config);
    this.authRequestGenerator = new AuthorizationRequestGenerator(config);
  }

  /**
   * Validate AI agent token with PingOne AI IAM Core
   */
  async validateAgentToken(token: string): Promise<AgentTokenInfo> {
    return this.tokenIntrospector.validateAgentToken(token);
  }

  /**
   * Validate that agent token has required scopes
   */
  async validateTokenScopes(token: string, requiredScopes: string[]): Promise<boolean> {
    return this.tokenIntrospector.validateTokenScopes(token, requiredScopes);
  }

  /**
   * Exchange authorization code for user tokens
   */
  async exchangeAuthorizationCode(authCode: string, redirectUri?: string, codeVerifier?: string): Promise<UserTokens> {
    return this.authorizationManager.exchangeAuthorizationCode(authCode, redirectUri, codeVerifier);
  }

  /**
   * Refresh user access token
   */
  async refreshUserToken(refreshToken: string): Promise<UserTokens> {
    return this.authorizationManager.refreshUserToken(refreshToken);
  }

  /**
   * Generate authorization request for user authentication
   */
  generateAuthorizationRequest(options: AuthorizationRequestOptions): AuthorizationRequest {
    return this.authRequestGenerator.generateAuthorizationRequest(options);
  }

  /**
   * Validate authorization state parameter
   */
  validateAuthorizationState(state: string): AuthorizationRequest | null {
    return this.authRequestGenerator.validateAuthorizationState(state);
  }

  /**
   * Complete authorization request (remove from pending)
   */
  completeAuthorizationRequest(state: string): boolean {
    return this.authRequestGenerator.completeAuthorizationRequest(state);
  }

  /**
   * Validate that user tokens have required banking scopes
   */
  validateBankingScopes(userTokens: UserTokens, requiredScopes: string[]): boolean {
    return this.authorizationManager.validateBankingScopes(userTokens, requiredScopes);
  }

  /**
   * Check if user tokens are expired
   */
  isTokenExpired(userTokens: UserTokens): boolean {
    return this.authorizationManager.isTokenExpired(userTokens);
  }

  /**
   * Get remaining token lifetime in seconds
   */
  getTokenLifetime(userTokens: UserTokens): number {
    return this.authorizationManager.getTokenLifetime(userTokens);
  }

  /**
   * Get pending authorization requests for a session
   */
  getPendingRequestsForSession(sessionId: string): AuthorizationRequest[] {
    return this.authRequestGenerator.getPendingRequestsForSession(sessionId);
  }

  /**
   * Clean up expired authorization requests
   */
  cleanupExpiredRequests(): number {
    return this.authRequestGenerator.cleanupExpiredRequests();
  }

  /**
   * Health check for PingOne connectivity
   */
  async healthCheck(): Promise<boolean> {
    return this.tokenIntrospector.healthCheck();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.authRequestGenerator.destroy();
  }

  // ---------------------------------------------------------------------------
  // CIBA helpers (Client-Initiated Backchannel Authentication)
  // ---------------------------------------------------------------------------

  /**
   * Returns the PingOne bc-authorize endpoint derived from authorizationEndpoint.
   * e.g. https://auth.pingone.com/{envId}/as/bc-authorize
   */
  getCIBAEndpoint(): string {
    return this.config.authorizationEndpoint.replace('/authorize', '/bc-authorize');
  }

  /** Base-64 encoded client_id:client_secret for Basic auth. */
  getClientCredentials(): string {
    return Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
  }

  /** Token endpoint — used for CIBA poll requests. */
  getTokenEndpoint(): string {
    return this.config.tokenEndpoint;
  }
}