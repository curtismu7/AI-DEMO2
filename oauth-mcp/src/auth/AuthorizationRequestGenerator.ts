/**
 * Authorization Request Generator for PingOne AI IAM Core
 * Handles authorization URL generation with CSRF protection
 */

import { randomBytes, createHash } from 'crypto';
import { PingOneConfig, AuthorizationRequest } from '../interfaces/auth';

export interface AuthorizationRequestOptions {
  scopes: string[];
  redirectUri?: string;
  state?: string;
  sessionId: string;
  expirationMinutes?: number;
}

export class AuthorizationRequestGenerator {
  private config: PingOneConfig;
  private pendingRequests: Map<string, AuthorizationRequest> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: PingOneConfig, enableAutoCleanup: boolean = true) {
    this.config = config;
    
    // Clean up expired requests every 10 minutes (only in production)
    if (enableAutoCleanup && process.env.NODE_ENV !== 'test') {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredRequests();
      }, 10 * 60 * 1000);
    }
  }

  /**
   * Cleanup resources and stop background tasks
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.pendingRequests.clear();
  }

  /**
   * Generate authorization request with secure state parameter
   */
  generateAuthorizationRequest(options: AuthorizationRequestOptions): AuthorizationRequest {
    const {
      scopes,
      redirectUri,
      state: customState,
      sessionId,
      expirationMinutes = 10
    } = options;

    // Generate secure state parameter for CSRF protection
    const state = customState || this.generateSecureState(sessionId);
    
    // Validate scopes
    this.validateScopes(scopes);

    // Generate PKCE parameters
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Build authorization URL
    const authorizationUrl = this.buildAuthorizationUrl({
      scopes,
      redirectUri,
      state,
      codeChallenge
    });

    const authRequest: AuthorizationRequest = {
      authorizationUrl,
      state,
      scope: scopes.join(' '),
      sessionId,
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
      codeVerifier // Store the code verifier for token exchange
    };

    // Store the request for validation
    this.pendingRequests.set(state, authRequest);

    return authRequest;
  }

  /**
   * Validate authorization state parameter and retrieve request
   */
  validateAuthorizationState(state: string): AuthorizationRequest | null {
    const request = this.pendingRequests.get(state);
    
    if (!request) {
      return null;
    }

    // Check if request has expired
    if (Date.now() > request.expiresAt.getTime()) {
      this.pendingRequests.delete(state);
      return null;
    }

    return request;
  }

  /**
   * Complete authorization request (remove from pending)
   */
  completeAuthorizationRequest(state: string): boolean {
    return this.pendingRequests.delete(state);
  }

  /**
   * Get all pending authorization requests for a session
   */
  getPendingRequestsForSession(sessionId: string): AuthorizationRequest[] {
    const requests: AuthorizationRequest[] = [];
    
    for (const request of this.pendingRequests.values()) {
      if (request.sessionId === sessionId && Date.now() <= request.expiresAt.getTime()) {
        requests.push(request);
      }
    }
    
    return requests;
  }

  /**
   * Clean up expired authorization requests
   */
  cleanupExpiredRequests(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [state, request] of this.pendingRequests.entries()) {
      if (now > request.expiresAt.getTime()) {
        this.pendingRequests.delete(state);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Generate secure state parameter with session correlation
   */
  private generateSecureState(sessionId: string): string {
    // Generate random bytes for entropy
    const randomPart = randomBytes(16).toString('hex');
    
    // Create hash of session ID for correlation (first 8 chars)
    const sessionHash = createHash('sha256')
      .update(sessionId)
      .digest('hex')
      .substring(0, 8);
    
    // Combine with timestamp for uniqueness
    const timestamp = Date.now().toString(36);
    
    return `${sessionHash}_${timestamp}_${randomPart}`;
  }

  /**
   * Build authorization URL with proper parameters
   */
  private buildAuthorizationUrl(params: {
    scopes: string[];
    redirectUri?: string;
    state: string;
    codeChallenge?: string;
  }): string {
    const { scopes, redirectUri, state, codeChallenge } = params;
    
    const urlParams = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: scopes.join(' '),
      state: state
    });

    if (redirectUri) {
      urlParams.set('redirect_uri', redirectUri);
    }

    // Add PKCE parameters for enhanced security (if provided)
    if (codeChallenge) {
      urlParams.set('code_challenge', codeChallenge);
      urlParams.set('code_challenge_method', 'S256');
    }

    // Handle both full URLs and relative paths for authorizationEndpoint
    let authUrl: string;
    if (this.config.authorizationEndpoint.startsWith('http://') || this.config.authorizationEndpoint.startsWith('https://')) {
      // Full URL provided
      authUrl = this.config.authorizationEndpoint;
    } else {
      // Relative path - combine with baseUrl
      const baseUrl = this.config.baseUrl.endsWith('/') 
        ? this.config.baseUrl.slice(0, -1) 
        : this.config.baseUrl;
      
      const endpoint = this.config.authorizationEndpoint.startsWith('/') 
        ? this.config.authorizationEndpoint 
        : `/${this.config.authorizationEndpoint}`;

      authUrl = `${baseUrl}${endpoint}`;
    }

    return `${authUrl}?${urlParams.toString()}`;
  }

  /**
   * Validate that scopes are appropriate for banking operations
   */
  private validateScopes(scopes: string[]): void {
    if (!scopes || scopes.length === 0) {
      throw new Error('At least one scope is required');
    }

    const validBankingScopes = [
      'accounts:read',
      'transactions:read',
      'transactions:write',
      'read',
      'write',
      'openid',
      'profile',
      'email'
    ];

    const invalidScopes = scopes.filter(scope => 
      !validBankingScopes.some(validScope => 
        scope === validScope || scope.startsWith(validScope + ':')
      )
    );

    if (invalidScopes.length > 0) {
      throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from verifier
   */
  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }

  /**
   * Get statistics about pending requests
   */
  getStatistics(): {
    totalPending: number;
    expiredCount: number;
    oldestRequestAge: number;
  } {
    const now = Date.now();
    let expiredCount = 0;
    let oldestAge = 0;

    for (const request of this.pendingRequests.values()) {
      const age = now - (request.expiresAt.getTime() - 10 * 60 * 1000); // Subtract expiration time to get creation time
      
      if (now > request.expiresAt.getTime()) {
        expiredCount++;
      }
      
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalPending: this.pendingRequests.size,
      expiredCount,
      oldestRequestAge: oldestAge
    };
  }
}