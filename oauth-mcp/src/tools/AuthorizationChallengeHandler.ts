/**
 * Authorization Challenge Handler
 * Handles OAuth challenge detection, response generation, and authorization code processing
 */

import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../storage/BankingSessionManager';
import { AuthorizationRequest, Session, UserTokens, AuthenticationError } from '../interfaces/auth';
import { Logger, createDefaultLoggerConfig } from '../utils/Logger';

export interface AuthorizationChallenge {
  type: 'oauth_authorization_required';
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  expiresAt: Date;
  instructions: string;
}

export interface AuthorizationCodeRequest {
  sessionId: string;
  authorizationCode: string;
  state: string;
}

export interface AuthorizationResult {
  success: boolean;
  userTokens?: UserTokens;
  error?: string;
  errorCode?: string;
}

export class AuthorizationChallengeHandler {
  private readonly logger: Logger;

  constructor(
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager
  ) {
    this.logger = Logger.getInstance(createDefaultLoggerConfig());
  }

  /**
   * Detect if an authorization challenge is needed for a tool execution
   */
  async detectAuthorizationChallenge(
    session: Session,
    requiredScopes: string[]
  ): Promise<{ challengeNeeded: boolean; challenge?: AuthorizationChallenge }> {
    // Check if user tokens exist
    if (!session.userTokens || (Array.isArray(session.userTokens) && session.userTokens.length === 0)) {
      const challenge = await this.generateAuthorizationChallenge(session.sessionId, requiredScopes);
      return { challengeNeeded: true, challenge };
    }

    // Handle both single token and token array
    const tokens = Array.isArray(session.userTokens) ? session.userTokens : [session.userTokens];
    
    // Check if we have valid tokens for the required scopes
    const validToken = this.findTokenForScopes(tokens, requiredScopes);
    
    if (validToken) {
      return { challengeNeeded: false };
    }

    // Try to refresh expired tokens that might have the required scopes
    for (const userToken of tokens) {
      if (this.authManager.isTokenExpired(userToken)) {
        const tokenScopes = userToken.scope.split(' ');
        const hasRequiredScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
        
        if (hasRequiredScopes) {
          try {
            // Try to refresh the token
            const refreshedTokens = await this.authManager.refreshUserToken(userToken.refreshToken);
            
            // Update session with new tokens
            await this.sessionManager.associateUserTokens(session.sessionId, refreshedTokens);
            
            // Check if refreshed tokens have required scopes
            if (this.authManager.validateBankingScopes(refreshedTokens, requiredScopes)) {
              return { challengeNeeded: false };
            }
          } catch (error) {
            // Refresh failed, continue to check other tokens or request new authorization
            this.logger.warn(`[AuthorizationChallengeHandler] Token refresh failed for expired token: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // No valid tokens found, need new authorization
    const challenge = await this.generateAuthorizationChallenge(session.sessionId, requiredScopes);
    return { challengeNeeded: true, challenge };
  }

  /**
   * Generate an authorization challenge for user authentication
   */
  async generateAuthorizationChallenge(
    sessionId: string,
    requiredScopes: string[]
  ): Promise<AuthorizationChallenge> {
    const authRequest = this.authManager.generateAuthorizationRequest({
      sessionId,
      scopes: requiredScopes,
      expirationMinutes: 10 // 10 minutes to complete authorization
    });

    return {
      type: 'oauth_authorization_required',
      authorizationUrl: authRequest.authorizationUrl,
      state: authRequest.state,
      scope: authRequest.scope,
      sessionId: authRequest.sessionId,
      expiresAt: authRequest.expiresAt,
      instructions: this.formatAuthorizationInstructions(authRequest, requiredScopes)
    };
  }

  /**
   * Handle authorization code from user and exchange for tokens
   */
  async handleAuthorizationCode(request: AuthorizationCodeRequest): Promise<AuthorizationResult> {
    try {
      // Validate the authorization state
      const authRequest = this.authManager.validateAuthorizationState(request.state);
      if (!authRequest) {
        return {
          success: false,
          error: 'Invalid or expired authorization state',
          errorCode: 'INVALID_STATE'
        };
      }

      // Verify session matches
      if (authRequest.sessionId !== request.sessionId) {
        return {
          success: false,
          error: 'Session mismatch in authorization request',
          errorCode: 'SESSION_MISMATCH'
        };
      }

      // Exchange authorization code for tokens
      const userTokens = await this.authManager.exchangeAuthorizationCode(
        request.authorizationCode
      );

      // Validate that tokens have the required scopes from the original request
      const requiredScopes = authRequest.scope.split(' ');
      if (!this.authManager.validateBankingScopes(userTokens, requiredScopes)) {
        return {
          success: false,
          error: 'Obtained tokens do not have required banking scopes',
          errorCode: 'INSUFFICIENT_SCOPE'
        };
      }

      // Associate tokens with the session
      await this.sessionManager.associateUserTokens(request.sessionId, userTokens);

      // Complete the authorization request (remove from pending)
      this.authManager.completeAuthorizationRequest(request.state);

      return {
        success: true,
        userTokens
      };

    } catch (error) {
      this.logger.error('[AuthorizationChallengeHandler] Authorization code exchange failed:', {}, error instanceof Error ? error : undefined);
      
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          error: error.message,
          errorCode: String(error.code)
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during authorization',
        errorCode: 'AUTHORIZATION_FAILED'
      };
    }
  }

  /**
   * Validate authorization challenge response
   */
  validateAuthorizationResponse(
    state: string,
    sessionId: string
  ): { valid: boolean; authRequest?: AuthorizationRequest; error?: string } {
    const authRequest = this.authManager.validateAuthorizationState(state);
    
    if (!authRequest) {
      return {
        valid: false,
        error: 'Invalid or expired authorization state'
      };
    }

    if (authRequest.sessionId !== sessionId) {
      return {
        valid: false,
        error: 'Session mismatch in authorization response'
      };
    }

    if (authRequest.expiresAt <= new Date()) {
      return {
        valid: false,
        error: 'Authorization request has expired'
      };
    }

    return {
      valid: true,
      authRequest
    };
  }

  /**
   * Check if a session needs re-authorization for specific scopes
   */
  async checkReauthorizationNeeded(
    session: Session,
    requiredScopes: string[]
  ): Promise<boolean> {
    const result = await this.detectAuthorizationChallenge(session, requiredScopes);
    return result.challengeNeeded;
  }

  /**
   * Format user-friendly authorization instructions
   */
  private formatAuthorizationInstructions(
    authRequest: AuthorizationRequest,
    requiredScopes: string[]
  ): string {
    const scopeDescriptions = this.getScopeDescriptions(requiredScopes);
    const expirationTime = authRequest.expiresAt.toLocaleTimeString();
    
    return `To complete this banking operation, you need to authorize access to your banking data.\n\n` +
           `Required permissions:\n${scopeDescriptions.map(desc => `• ${desc}`).join('\n')}\n\n` +
           `Please visit the following URL to authorize access:\n${authRequest.authorizationUrl}\n\n` +
           `This authorization request expires at ${expirationTime}.\n\n` +
           `After authorization, provide the authorization code to complete the operation.`;
  }

  /**
   * Get human-readable descriptions for banking scopes
   */
  private getScopeDescriptions(scopes: string[]): string[] {
    const scopeMap: Record<string, string> = {
      'accounts:read': 'View your bank accounts and balances',
      'transactions:read': 'View your transaction history',
      'transactions:write': 'Create deposits, withdrawals, and transfers'
    };

    return scopes.map(scope => scopeMap[scope] || scope);
  }

  /**
   * Create a formatted authorization challenge response for MCP protocol
   */
  formatMCPAuthorizationChallenge(challenge: AuthorizationChallenge): {
    type: 'text';
    text: string;
    authChallenge: {
      authorizationUrl: string;
      state: string;
      scope: string;
      sessionId: string;
      expiresAt: Date;
    };
  } {
    return {
      type: 'text',
      text: challenge.instructions,
      authChallenge: {
        authorizationUrl: challenge.authorizationUrl,
        state: challenge.state,
        scope: challenge.scope,
        sessionId: challenge.sessionId,
        expiresAt: challenge.expiresAt
      }
    };
  }

  /**
   * Handle authorization errors and generate appropriate responses
   */
  handleAuthorizationError(error: unknown): {
    type: 'text';
    text: string;
    error: string;
    errorCode?: string;
  } {
    let errorMessage = 'Authorization failed';
    let errorCode = 'AUTHORIZATION_ERROR';

    if (error instanceof AuthenticationError) {
      errorMessage = error.message;
      errorCode = String(error.code);
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    return {
      type: 'text',
      text: `Authorization Error: ${errorMessage}`,
      error: errorMessage,
      errorCode
    };
  }

  /**
   * Find user token that has the required scopes and is not expired
   */
  private findTokenForScopes(tokens: UserTokens[], requiredScopes: string[]): UserTokens | null {
    for (const token of tokens) {
      if (this.authManager.isTokenExpired(token)) {
        continue;
      }

      const tokenScopes = token.scope.split(' ');
      const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
      
      if (hasAllScopes) {
        return token;
      }
    }

    return null;
  }
}