/**
 * Authentication Integration
 * Integrates agent token validation and authorization challenge responses into MCP message processing
 */

import axios, { AxiosError } from 'axios';
import { MCPResponse, ToolCallResponse, AuthorizationRequest } from '../interfaces/mcp';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager, BankingSession, UserTokens, CIBAPendingRequest } from '../storage/BankingSessionManager';
import { AuthenticationError } from '../interfaces/auth';

export interface AuthenticationResult {
  success: boolean;
  session?: BankingSession;
  error?: string;
  authChallenge?: AuthorizationRequest;
  insufficientScope?: boolean;   // true = valid token present but lacks required scope
  missingScopes?: string[];       // scopes required but not in token
  availableScopes?: string[];     // scopes the token actually holds
}

export interface AuthorizationChallengeResponse {
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  instructions: string;
}

/** Returned by initiateCIBAAuth — caller uses auth_req_id to poll. */
export interface CIBAChallenge {
  type: 'ciba';
  auth_req_id: string;
  expires_in: number;
  poll_interval: number;
  /** Human-readable message to show in the chat UI. */
  message: string;
}

export class AuthenticationIntegration {
  constructor(
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager
  ) {}

  /**
   * Validate agent token and create/retrieve session
   */
  async validateAgentAuthentication(agentToken: string): Promise<AuthenticationResult> {
    try {
      // Validate agent token with PingOne
      const agentTokenInfo = await this.authManager.validateAgentToken(agentToken);
      
      if (!agentTokenInfo.isValid) {
        return {
          success: false,
          error: 'Invalid agent token'
        };
      }

      // Get or create session — pass token mode metadata from dual-mode validation
      let session = await this.sessionManager.getSessionByAgentToken(agentToken);
      if (!session) {
        session = await this.sessionManager.createSession(
          agentToken,
          24,
          agentTokenInfo.tokenMode,
          agentTokenInfo.transactionId,
          agentTokenInfo.transactionScope
        );
        console.log(
          `[AuthenticationIntegration] Created session ${session.sessionId} for agent token`,
          `tokenMode=${agentTokenInfo.tokenMode || 'rfc_8693'}`,
          agentTokenInfo.transactionId ? `txn_id=${agentTokenInfo.transactionId}` : ''
        );
      }

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Agent authentication failed:', error);
      
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          error: error.message,
          authChallenge: error.authorizationUrl ? {
            authorizationUrl: error.authorizationUrl,
            state: 'agent-auth-required',
            scope: 'agent',
            sessionId: 'pending',
            expiresAt: new Date(Date.now() + 300000) // 5 minutes
          } : undefined
        };
      }

      return {
        success: false,
        error: 'Authentication service unavailable'
      };
    }
  }

  /**
   * Check if user authorization is required for banking operations
   */
  async checkUserAuthorization(session: BankingSession, requiredScopes: string[]): Promise<AuthenticationResult> {
    try {
      // Validate session
      const validation = await this.sessionManager.validateSession(session.sessionId);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || 'Session invalid'
        };
      }

      // First, check if user tokens exist and validate them
      if (session.userTokens && session.userTokens.length > 0) {
        console.log(`[AuthenticationIntegration] Session has user tokens, validating scopes and expiration`);
        
        // Clean up any expired tokens first
        await this.sessionManager.cleanupExpiredTokens(session.sessionId);
        
        // Refresh session data after cleanup
        const updatedSession = await this.sessionManager.getSession(session.sessionId);
        if (updatedSession) {
          session = updatedSession;
        }

        // Check if we have valid tokens for the required scopes
        const validTokens = this.sessionManager.findTokensForScopes(session, requiredScopes);
        
        if (validTokens) {
          console.log(`[AuthenticationIntegration] Found valid tokens with required scopes, proceeding`);
          return {
            success: true,
            session
          };
        }

        // Try to refresh expired tokens that might have the required scopes
        let refreshAttempted = false;
        for (const tokens of session.userTokens || []) {
          if (this.authManager.isTokenExpired(tokens)) {
            const tokenScopes = tokens.scope.split(' ');
            const hasRequiredScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
            
            if (hasRequiredScopes && !refreshAttempted) {
              console.log(`[AuthenticationIntegration] Found expired tokens with required scopes, attempting refresh`);
              try {
                const refreshedTokens = await this.authManager.refreshUserToken(tokens.refreshToken);
                await this.sessionManager.associateUserTokens(session.sessionId, refreshedTokens);
                
                // Get updated session
                const refreshedSession = await this.sessionManager.getSession(session.sessionId);
                if (refreshedSession) {
                  session = refreshedSession;
                  console.log(`[AuthenticationIntegration] Successfully refreshed user tokens`);
                  return {
                    success: true,
                    session
                  };
                }
              } catch (refreshError) {
                console.log(`[AuthenticationIntegration] Token refresh failed for expired tokens`);
                refreshAttempted = true; // Don't try to refresh other expired tokens
              }
            }
          }
        }

        // Check if we have any valid scopes at all
        const availableScopes = this.sessionManager.getValidScopes(session);
        console.log(`[AuthenticationIntegration] User tokens scope validation - required: [${requiredScopes.join(', ')}], available: [${availableScopes.join(', ')}], hasScopes: false`);
        
        const missingScopes = requiredScopes.filter(s => !availableScopes.includes(s));
        console.log(`[AuthenticationIntegration] Insufficient scope — tool requires [${requiredScopes.join(', ')}], token has [${availableScopes.join(', ')}], missing [${missingScopes.join(', ')}]`);
        return {
          success: false,
          error: 'Insufficient scope',
          insufficientScope: true,
          missingScopes,
          availableScopes,
        };
      }

      // No user tokens exist, check if user authorization is required
      if (validation.requiresUserAuth) {
        console.log(`[AuthenticationIntegration] No user tokens found, generating authorization challenge`);
        // Generate authorization challenge
        const authRequest = this.authManager.generateAuthorizationRequest({
          sessionId: session.sessionId,
          scopes: requiredScopes,
          redirectUri: process.env.OAUTH_REDIRECT_URI || `http://localhost:8080/auth/callback` // Point to our callback endpoint
        });

        return {
          success: false,
          error: 'User authorization required',
          authChallenge: authRequest
        };
      }

      // If we reach here, session is valid but has no user tokens and doesn't require user auth
      // This should only happen for tools that don't require user authentication
      console.log(`[AuthenticationIntegration] Session valid, no user tokens, but user auth not required`);
      return {
        success: true,
        session
      };

      return {
        success: true,
        session: validation.session || session
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] User authorization check failed:', error);
      return {
        success: false,
        error: 'Authorization check failed'
      };
    }
  }

  /**
   * Create authentication error response for MCP protocol
   */
  createAuthenticationErrorResponse(messageId: string, error: string, authChallenge?: AuthorizationRequest): MCPResponse {
    const errorData: any = {
      type: 'authentication_error',
      message: error,
      challenge_type: 'oauth_authorization_code',
      authorization_url: process.env.PINGONE_AUTHORIZATION_ENDPOINT ||
        `https://auth.pingone.${process.env.PINGONE_REGION || 'com'}/${process.env.PINGONE_ENVIRONMENT_ID || ''}/as/authorize`,
      scope: 'accounts:read transactions:read transactions:write'
    };

    if (authChallenge) {
      errorData.authorizationChallenge = this.formatAuthorizationChallenge(authChallenge);
      errorData.authorization_url = authChallenge.authorizationUrl;
      errorData.scope = authChallenge.scope;
    }

    return {
      id: messageId,
      error: {
        code: -32001, // Custom authentication error code
        message: 'Authentication required',
        data: errorData
      }
    };
  }

  /**
   * Create authorization challenge response for tool calls
   */
  createAuthorizationChallengeResponse(messageId: string, authChallenge: AuthorizationRequest): ToolCallResponse {
    const challengeResponse = this.formatAuthorizationChallenge(authChallenge);
    
    // The authorization-challenge payload, published under the MCP-spec
    // extension slot result._meta.authChallenge. content[] stays spec-clean
    // ({ type, text }) — consumers read the challenge from _meta.
    const authChallengeMeta = {
      method: "redirect_popup",
      authorizationUrl: authChallenge.authorizationUrl,
      state: authChallenge.state,
      scope: authChallenge.scope,
      sessionId: authChallenge.sessionId,
      expiresAt: authChallenge.expiresAt.toISOString(),
      postMessageOrigin: process.env.MCP_ALLOWED_ORIGIN || process.env.OAUTH_REDIRECT_URI?.replace(/\/auth\/callback.*/, '') || 'http://localhost:3001',
      statusEndpoint: `${process.env.MCP_SERVER_BASE_URL || 'http://localhost:8080'}/auth/status?sessionId=${authChallenge.sessionId}`,
      uiHints: {
        popupWidth: 500,
        popupHeight: 650,
        popupTitle: "Authenticate with PingOne"
      }
    };

    return {
      id: messageId,
      result: {
        content: [{ type: 'text', text: challengeResponse.instructions }],
        isError: false,
        _meta: { authChallenge: authChallengeMeta },
      }
    };
  }

  /**
   * Format authorization challenge for user-friendly display
   */
  private formatAuthorizationChallenge(authChallenge: AuthorizationRequest): AuthorizationChallengeResponse {
    const instructions = [
      'User authorization is required to access banking data.',
      '',
      'Please follow these steps:',
      '1. Open the following URL in your browser:',
      `   ${authChallenge.authorizationUrl}`,
      '',
      '2. Complete the login and authorization process',
      '',
      '3. Copy the authorization code from the response',
      '',
      '4. Provide the authorization code back to continue',
      '',
      `Session ID: ${authChallenge.sessionId}`,
      `State: ${authChallenge.state}`,
      `Required Scopes: ${authChallenge.scope}`,
      `Expires: ${authChallenge.expiresAt.toISOString()}`
    ].join('\n');

    return {
      authorizationUrl: authChallenge.authorizationUrl,
      state: authChallenge.state,
      scope: authChallenge.scope,
      sessionId: authChallenge.sessionId,
      instructions
    };
  }

  /**
   * Handle authorization code exchange
   */
  async handleAuthorizationCodeExchange(
    sessionId: string,
    authorizationCode: string,
    state: string
  ): Promise<AuthenticationResult> {
    try {
      // Validate authorization state
      const authRequest = this.authManager.validateAuthorizationState(state);
      if (!authRequest) {
        return {
          success: false,
          error: 'Invalid or expired authorization state'
        };
      }

      if (authRequest.sessionId !== sessionId) {
        return {
          success: false,
          error: 'Authorization state does not match session'
        };
      }

      // Exchange authorization code for tokens (must use same redirect URI and code verifier as authorization request)
      const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:8080/auth/callback`;
      const codeVerifier = authRequest.codeVerifier;
      console.log(`[AuthenticationIntegration] Exchanging code for tokens with verifier: ${codeVerifier ? 'present' : 'missing'}`);
      
      const userTokens = await this.authManager.exchangeAuthorizationCode(authorizationCode, redirectUri, codeVerifier);
      console.log(`[AuthenticationIntegration] Received user tokens for session ${sessionId}`);
      
      // Associate tokens with session
      await this.sessionManager.associateUserTokens(sessionId, userTokens);
      console.log(`[AuthenticationIntegration] Successfully associated user tokens with session ${sessionId}`);
      
      // Complete authorization request
      this.authManager.completeAuthorizationRequest(state);
      
      // Get updated session
      const session = await this.sessionManager.getSession(sessionId);
      
      console.log(`[AuthenticationIntegration] Authorization code exchange completed successfully`);
      console.log(`[AuthenticationIntegration] Session ${sessionId} now has user tokens: ${session?.userTokens ? 'YES' : 'NO'}`);
      
      return {
        success: true,
        session: session || undefined
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Authorization code exchange failed:', error);
      
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: false,
        error: 'Authorization code exchange failed'
      };
    }
  }

  /**
   * Validate authentication for specific tool execution
   */
  async validateToolAuthentication(
    session: BankingSession | undefined,
    agentToken: string | undefined,
    requiredScopes: string[],
    alternativeScopes?: string[]
  ): Promise<AuthenticationResult> {
    // First validate agent authentication
    if (!session && agentToken) {
      const agentAuth = await this.validateAgentAuthentication(agentToken);
      if (!agentAuth.success) {
        // Agent token is invalid - return error so agent can get a new token
        console.log(`[AuthenticationIntegration] Agent token validation failed - returning error`);
        return agentAuth;
      }
      session = agentAuth.session;
    }

    if (!session) {
      return {
        success: false,
        error: 'No valid session found'
      };
    }

    // If no scopes are required, skip user authorization check
    if (!requiredScopes || requiredScopes.length === 0) {
      console.log(`[AuthenticationIntegration] No scopes required - skipping user authorization check`);
      return {
        success: true,
        session
      };
    }

    // When an agentToken is present, JWKS/signature was already validated upstream
    // (HttpMCPTransport) and session.userTokens is empty in the gateway path —
    // but we still enforce requiredScopes against the bearer itself so an
    // under-scoped token cannot invoke privileged tools on direct MCP access.
    if (agentToken) {
      // alternativeScopes: an A2A-delegated tool's per-vertical scope
      // (scope-topology a2aDelegatedScope — records:read, tax:read, …). PingOne
      // enforces scope-name uniqueness across resource grants, so the
      // specialist's Exchange #2 bearer carries that scope INSTEAD of the
      // coarse 'read'. Either set satisfies the tool; both absent fails closed.
      const hasScopes =
        (await this.authManager.validateTokenScopes(agentToken, requiredScopes)) ||
        (!!alternativeScopes?.length &&
          (await this.authManager.validateTokenScopes(agentToken, alternativeScopes)));
      // NOTE: open-access mode does NOT get an escape hatch here any more.
      // Reading the env var at this point applied the bypass to whoever asked,
      // including a fully validated bearer that genuinely lacked the scope — so
      // enabling the mode for the Privilege gateway silently disarmed scope
      // enforcement for the banking path too. One env var, two gateways.
      // The bypass now lives at the only place that can tell them apart:
      // HttpMCPTransport marks the tokenless upstream-authorized hop as
      // openAccess, and MCPMessageHandler skips this call entirely for it.
      // Anything that reaches here presented a token and is enforced on it.
      if (!hasScopes) {
        console.log(
          `[AuthenticationIntegration] agentToken missing required scopes [${requiredScopes.join(', ')}]`
        );
        return {
          success: false,
          error: `Insufficient scope. Required: ${requiredScopes.join(', ')}`,
          insufficientScope: true,
          missingScopes: requiredScopes,
        };
      }
      console.log(
        `[AuthenticationIntegration] agentToken scope check passed for [${requiredScopes.join(', ')}]`
      );
      return { success: true, session };
    }

    // Then check user authorization for banking operations
    return await this.checkUserAuthorization(session, requiredScopes);
  }

  /**
   * Get authentication status for a session
   */
  async getAuthenticationStatus(sessionId: string): Promise<{
    hasValidSession: boolean;
    hasUserTokens: boolean;
    tokenExpired: boolean;
    availableScopes: string[];
    tokenExpiresIn?: number;
  }> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      
      if (!session) {
        return {
          hasValidSession: false,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      const validation = await this.sessionManager.validateSession(sessionId);
      
      if (!validation.isValid) {
        return {
          hasValidSession: false,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      if (!session.userTokens || session.userTokens.length === 0) {
        return {
          hasValidSession: true,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      // Check if any tokens are valid (not expired)
      const validTokens = session.userTokens.filter(tokens => !this.authManager.isTokenExpired(tokens));
      const tokenExpired = validTokens.length === 0;
      
      // Get the earliest expiration time from valid tokens
      let tokenExpiresIn = 0;
      if (validTokens.length > 0) {
        const earliestExpiry = Math.min(...validTokens.map(tokens => this.authManager.getTokenLifetime(tokens)));
        tokenExpiresIn = earliestExpiry;
      }
      
      // Get all available scopes from valid tokens
      const availableScopes = this.sessionManager.getValidScopes(session);

      return {
        hasValidSession: true,
        hasUserTokens: true,
        tokenExpired,
        availableScopes,
        tokenExpiresIn
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Error getting authentication status:', error);
      return {
        hasValidSession: false,
        hasUserTokens: false,
        tokenExpired: false,
        availableScopes: []
      };
    }
  }

  // ---------------------------------------------------------------------------
  // CIBA — Client-Initiated Backchannel Authentication
  // ---------------------------------------------------------------------------

  /**
   * Initiate a CIBA auth request.  Returns the challenge details so the caller
   * can record the auth_req_id and either poll or inform the user.
   */
  async initiateCIBAAuth(userEmail: string, requiredScope: string, sessionId: string): Promise<CIBAChallenge> {
    const bindingMessage =
      process.env.CIBA_BINDING_MESSAGE || `Banking App – AI Assistant access (${requiredScope})`;

    const cibaEndpoint = this.authManager.getCIBAEndpoint();
    const credentials = this.authManager.getClientCredentials();

    const params = new URLSearchParams({
      login_hint: userEmail,
      scope: `openid profile email ${requiredScope}`,
      binding_message: bindingMessage,
    });

    const response = await axios.post(cibaEndpoint, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      timeout: 10000,
    });

    const { auth_req_id, expires_in, interval } = response.data as any;
    const pollInterval: number = interval || 5;

    // Persist the request in session manager so MCPMessageHandler can poll it later
    const pending: CIBAPendingRequest = {
      authReqId: auth_req_id,
      initiatedAt: Date.now(),
      expiresAt: Date.now() + (expires_in || 300) * 1000,
      interval: pollInterval,
      userEmail,
      requiredScope,
    };
    this.sessionManager.storeCIBARequest(sessionId, pending);

    console.log(`[AuthenticationIntegration] CIBA initiated for ${userEmail.replace(/(.{2}).*@/, '$1***@')}, auth_req_id: ${auth_req_id}`);

    return {
      type: 'ciba',
      auth_req_id,
      expires_in: expires_in || 300,
      poll_interval: pollInterval,
      message:
        '📬 Complete CIBA approval where PingOne sent it — **email** or **device push** (your PingOne / DaVinci setup). Then this session can continue.',
    };
  }

  /**
   * Poll PingOne token endpoint until the user approves (or denies / request expires).
   * Non-blocking at the event-loop level — other requests continue while this awaits.
   */
  async waitForCIBAApproval(sessionId: string, authReqId: string): Promise<UserTokens> {
    const request = this.sessionManager.getCIBARequest(sessionId, authReqId);
    if (!request) {
      throw new Error('Unknown or expired CIBA request');
    }

    const tokenEndpoint = this.authManager.getTokenEndpoint();
    const credentials = this.authManager.getClientCredentials();
    const maxWait = parseInt(process.env.CIBA_MAX_WAIT_SECONDS || '300', 10) * 1000;
    const deadline = Math.min(request.expiresAt, Date.now() + maxWait);

    let intervalMs = (parseInt(process.env.CIBA_POLL_INTERVAL_MS || '5000', 10));

    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));

      try {
        const tokenParams = new URLSearchParams({
          grant_type: 'urn:openid:params:grant-type:ciba',
          auth_req_id: authReqId,
        });

        const tokenResponse = await axios.post(tokenEndpoint, tokenParams.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`,
          },
          timeout: 10000,
        });

        const data = tokenResponse.data as any;
        this.sessionManager.deleteCIBARequest(sessionId, authReqId);

        console.log(`[AuthenticationIntegration] CIBA approved for session ${sessionId}`);

        return {
          accessToken:  data.access_token,
          refreshToken: data.refresh_token || '',
          tokenType:    data.token_type || 'Bearer',
          expiresIn:    data.expires_in || 3600,
          scope:        data.scope || request.requiredScope,
          issuedAt:     new Date(),
        };

      } catch (err) {
        const axiosErr = err as AxiosError;
        const errorCode = (axiosErr.response?.data as any)?.error;

        if (errorCode === 'authorization_pending') continue;
        if (errorCode === 'slow_down') {
          intervalMs = Math.min(intervalMs + 5000, 30000);
          continue;
        }

        // access_denied, expired_token, invalid_grant — abort
        this.sessionManager.deleteCIBARequest(sessionId, authReqId);
        throw err;
      }
    }

    this.sessionManager.deleteCIBARequest(sessionId, authReqId);
    throw new Error('CIBA authentication timed out — user did not respond in time');
  }
}