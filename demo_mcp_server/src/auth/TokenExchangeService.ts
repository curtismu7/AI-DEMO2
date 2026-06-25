/**
 * Token Exchange Service for RFC 8693 Compliance
 * Implements OAuth 2.0 Token Exchange with proper may_act claim handling
 */

import axios, { AxiosInstance } from 'axios';
import { Logger } from '../utils/Logger';
import { AuditLogger } from '../utils/AuditLogger';
import { 
  TokenExchangeRequest, 
  TokenExchangeResponse, 
  TokenExchangeConfig,
  DelegationTokenInfo,
  TokenExchangeValidationResult,
  MayActClaim,
  ActClaim,
  TokenExchangeAudit
} from '../interfaces/tokenExchange';
import { AuthenticationError, AuthErrorCodes } from '../interfaces/auth';
import { sanitizeAxiosCause } from '../utils/sanitizeAxiosCause';

export class TokenExchangeService {
  private client: AxiosInstance;
  private config: TokenExchangeConfig;
  private logger: Logger;
  private auditLogger: AuditLogger;

  constructor(config: TokenExchangeConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger || Logger.getInstance();
    this.auditLogger = AuditLogger.getInstance(this.logger);
    // If an explicit tokenEndpoint is provided, use its base (everything up to /as).
    // This avoids the Management API base URL + empty environmentId producing a broken path.
    const authBase = config.tokenEndpoint
      ? config.tokenEndpoint.replace(/\/token$/, '')   // strip /token → .../as
      : `${config.pingoneBaseUrl}/${config.environmentId}/as`;
    this.client = axios.create({
      baseURL: authBase,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  /**
   * Exchange tokens according to RFC 8693
   */
  async exchangeToken(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    const auditLog: TokenExchangeAudit = {
      timestamp: new Date().toISOString(),
      operation: 'token_exchange',
      client_id: this.config.clientId,
      subject: 'unknown', // Will be updated after validation
      scopes: request.scope ? request.scope.split(' ') : [],
      resource: Array.isArray(request.resource) ? request.resource[0] : request.resource,
      audience: request.audience,
      success: false,
      request_id: this.generateRequestId()
    };

    try {
      // Validate request
      this.validateTokenExchangeRequest(request);
      
      // Prepare request parameters
      const params = this.buildTokenExchangeParams(request);
      
      // Debug: log exchange request params (excluding token values)
      this.logger.info(`[TokenExchangeService] Exchange request — client_id: ${this.config.clientId}, audience: ${params.get('audience')}, scope: ${params.get('scope')}, baseURL: ${String(this.client.defaults.baseURL ?? '')}`);

      // Make token exchange request.
      // ARCHITECTURE TRUTH (T-9): PingOne non-worker clients use client_secret_post —
      // credentials go in the request body, not the Authorization header.
      // The MCP Exchanger app (d3f8fead) is CLIENT_SECRET_POST; sending Basic Auth
      // causes PingOne to return 403 "Insufficient permissions for token exchange".
      const response = await this.client.post('/token', params.toString());

      const tokenResponse = response.data as TokenExchangeResponse;

      // Debug: log what PingOne returned so we can verify aud/scope
      try {
        const parts = tokenResponse.access_token?.split('.');
        if (parts?.length === 3) {
          const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          this.logger.info(`[TokenExchangeService] Step 9 token issued — aud: ${JSON.stringify(claims.aud)}, scope: ${claims.scope}, sub: ${claims.sub}`);
        }
      } catch { /* non-fatal */ }

      // Validate response
      this.validateTokenExchangeResponse(tokenResponse);

      // Update audit log
      auditLog.success = true;

      // Log to AuditLogger instead of console
      await this.auditLogger.logAuthentication(
        'token_exchange',  // operation
        'success',         // outcome
        {
          sessionId: 'unknown',  // Token exchange doesn't have session context
        },
        {
          tokenType: 'exchanged',             // This token is the result of exchange
          scopes: request.scope ? request.scope.split(' ') : [],
          grantType: 'urn:ietf:params:oauth:grant-type:token-exchange'  // RFC 8693
        }
      );

      this.logger.info(`[TokenExchangeService] Token exchange successful for request ${auditLog.request_id}`);
      
      return tokenResponse;
      
    } catch (error) {
      auditLog.success = false;
      auditLog.error = error instanceof Error ? error.message : 'Unknown error';

      // Log to AuditLogger instead of console
      await this.auditLogger.logAuthentication(
        'token_exchange',  // operation
        'failure',         // outcome — token exchange failed
        {
          sessionId: 'unknown',
          errorCode: error instanceof AuthenticationError ? String(error.code) : 'UNKNOWN',
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        {
          tokenType: 'exchanged',
          scopes: request.scope ? request.scope.split(' ') : [],
          grantType: 'urn:ietf:params:oauth:grant-type:token-exchange'
        }
      );

      this.logger.error(`[TokenExchangeService] Token exchange failed for request ${auditLog.request_id}:`, {
        error: error instanceof Error ? error.message : String(error)
      });
      
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        
        if (statusCode === 400) {
          throw new AuthenticationError(
            errorData?.error_description || 'Invalid token exchange request',
            AuthErrorCodes.INVALID_PARAMS
          );
        } else if (statusCode === 401) {
          throw new AuthenticationError(
            'Invalid client credentials for token exchange',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          );
        } else if (statusCode === 403) {
          // Log the full PingOne error body for debugging
          this.logger.error(`[TokenExchangeService] PingOne 403 response body:`, { errorData });
          throw new AuthenticationError(
            errorData?.error_description || errorData?.message || 'Insufficient permissions for token exchange',
            AuthErrorCodes.INSUFFICIENT_SCOPE
          );
        }
      }
      
      throw new AuthenticationError(
        'Token exchange failed',
        AuthErrorCodes.TOKEN_REFRESH_FAILED
      );
    }
  }

  /**
   * Validate delegated token according to RFC 8693 and may_act requirements
   */
  async validateDelegatedToken(token: string): Promise<TokenExchangeValidationResult> {
    const result: TokenExchangeValidationResult = {
      isValid: false,
      errors: [],
      warnings: [],
      tokenInfo: {} as DelegationTokenInfo
    };

    try {
      // Introspect token
      const tokenInfo = await this.introspectToken(token);
      result.tokenInfo = tokenInfo;

      // Validate basic token structure
      this.validateTokenStructure(tokenInfo, result);
      
      // Validate may_act claim if required
      if (this.config.requireMayAct) {
        this.validateMayActClaim(tokenInfo.may_act, result);
      }
      
      // Validate act claim for multi-hop delegation
      if (tokenInfo.act) {
        this.validateActClaim(tokenInfo.act, result);
      }
      
      // Validate resource indicators (RFC 8707)
      if (this.config.resourceUri) {
        this.validateResourceIndicators(tokenInfo, result);
      }
      
      // Validate scopes
      this.validateTokenScopes(tokenInfo.scope, result);
      
      // Set final validation result
      result.isValid = result.errors.length === 0;
      
      if (result.isValid) {
        this.logger.info(`[TokenExchangeService] Token validation successful for subject: ${tokenInfo.sub}`);
      } else {
        this.logger.warn(`[TokenExchangeService] Token validation failed: ${result.errors.join(', ')}`);
      }
      
      return result;
      
    } catch (error) {
      result.errors.push(`Token validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  /**
   * Introspect token to get claims
   */
  private async introspectToken(token: string): Promise<DelegationTokenInfo> {
    try {
      const response = await this.client.post('/introspect', 
        new URLSearchParams({
          token: token,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        }).toString()
      );

      return response.data as DelegationTokenInfo;
      
    } catch (error) {
      throw Object.assign(new AuthenticationError(
        'Token introspection failed',
        AuthErrorCodes.INVALID_TOKEN
      ), { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Validate token exchange request
   */
  private validateTokenExchangeRequest(request: TokenExchangeRequest): void {
    if (!request.subject_token) {
      throw new AuthenticationError(
        'subject_token is required',
        AuthErrorCodes.INVALID_PARAMS
      );
    }

    if (request.subject_token_type !== 'urn:ietf:params:oauth:token-type:access_token') {
      throw new AuthenticationError(
        'Only access_token subject_token_type is supported',
        AuthErrorCodes.INVALID_PARAMS
      );
    }

    if (request.actor_token && !request.actor_token_type) {
      throw new AuthenticationError(
        'actor_token_type is required when actor_token is provided',
        AuthErrorCodes.INVALID_PARAMS
      );
    }

    if (request.requested_token_type && 
        request.requested_token_type !== 'urn:ietf:params:oauth:token-type:access_token') {
      throw new AuthenticationError(
        'Only access_token requested_token_type is supported',
        AuthErrorCodes.INVALID_PARAMS
      );
    }
  }

  /**
   * Build token exchange request parameters
   */
  private buildTokenExchangeParams(request: TokenExchangeRequest): URLSearchParams {
    // client_secret_post: credentials in request body (T-9 architecture truth)
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      subject_token: request.subject_token,
      subject_token_type: request.subject_token_type
    });

    if (request.actor_token) {
      params.append('actor_token', request.actor_token);
      params.append('actor_token_type', request.actor_token_type || 'urn:ietf:params:oauth:token-type:access_token');
    }

    if (request.requested_token_type) {
      params.append('requested_token_type', request.requested_token_type);
    }

    if (request.resource) {
      const resources = Array.isArray(request.resource) ? request.resource : [request.resource];
      resources.forEach(resource => params.append('resource', resource));
    }

    if (request.audience) {
      const audiences = Array.isArray(request.audience) ? request.audience : [request.audience];
      audiences.forEach(audience => params.append('audience', audience));
    }

    if (request.scope) {
      params.append('scope', request.scope);
    }

    return params;
  }

  /**
   * Validate token exchange response
   */
  private validateTokenExchangeResponse(response: TokenExchangeResponse): void {
    if (!response.access_token) {
      throw new AuthenticationError(
        'Missing access_token in response',
        AuthErrorCodes.INVALID_TOKEN
      );
    }

    if (response.token_type !== 'Bearer') {
      throw new AuthenticationError(
        'Only Bearer token_type is supported',
        AuthErrorCodes.INVALID_TOKEN
      );
    }

    if (!response.expires_in || response.expires_in <= 0) {
      throw new AuthenticationError(
        'Invalid expires_in in response',
        AuthErrorCodes.INVALID_TOKEN
      );
    }
  }

  /**
   * Validate basic token structure
   */
  private validateTokenStructure(tokenInfo: DelegationTokenInfo, result: TokenExchangeValidationResult): void {
    if (!tokenInfo.sub) {
      result.errors.push('Token missing required sub claim');
    }

    if (!tokenInfo.aud) {
      result.errors.push('Token missing required aud claim');
    }

    if (!tokenInfo.iss) {
      result.errors.push('Token missing required iss claim');
    }

    if (!tokenInfo.exp) {
      result.errors.push('Token missing required exp claim');
    } else if (tokenInfo.exp <= Math.floor(Date.now() / 1000)) {
      result.errors.push('Token has expired');
    }

    if (!tokenInfo.scope) {
      result.warnings.push('Token has no scope claim');
    }
  }

  /**
   * Validate may_act claim
   */
  private validateMayActClaim(mayAct: MayActClaim | undefined, result: TokenExchangeValidationResult): void {
    if (!mayAct) {
      result.errors.push('Token missing required may_act claim');
      return;
    }

    if (!mayAct.client_id) {
      result.errors.push('may_act claim missing required client_id field');
      return;
    }

    // Validate against expected BFF client ID
    if (this.config.bffClientId && mayAct.client_id !== this.config.bffClientId) {
      result.errors.push(
        `may_act client_id mismatch. Expected: ${this.config.bffClientId}, Got: ${mayAct.client_id}`
      );
    }

    // Validate optional nested act claim
    if (mayAct.act) {
      this.validateNestedActClaim(mayAct.act, result);
    }
  }

  /**
   * Validate nested act claim for multi-hop delegation
   */
  private validateNestedActClaim(act: ActClaim['act'], result: TokenExchangeValidationResult): void {
    if (!act) return;
    if (this.config.expectedActClientId && act.client_id && act.client_id !== this.config.expectedActClientId) {
      result.errors.push(
        `Nested act.client_id mismatch. Expected: ${this.config.expectedActClientId}, Got: ${act.client_id}`
      );
    }

    if (this.config.expectedActSub && act.sub && act.sub !== this.config.expectedActSub) {
      result.errors.push(
        `Nested act.sub mismatch. Expected: ${this.config.expectedActSub}, Got: ${act.sub}`
      );
    }
  }

  /**
   * Validate act claim
   */
  private validateActClaim(act: ActClaim | undefined, result: TokenExchangeValidationResult): void {
    if (!act) {
      return; // Optional claim
    }

    if (this.config.expectedActClientId && act.client_id && act.client_id !== this.config.expectedActClientId) {
      result.errors.push(
        `act.client_id mismatch. Expected: ${this.config.expectedActClientId}, Got: ${act.client_id}`
      );
    }

    if (this.config.expectedActSub && act.sub && act.sub !== this.config.expectedActSub) {
      result.errors.push(
        `act.sub mismatch. Expected: ${this.config.expectedActSub}, Got: ${act.sub}`
      );
    }
  }

  /**
   * Validate resource indicators (RFC 8707)
   */
  private validateResourceIndicators(tokenInfo: DelegationTokenInfo, result: TokenExchangeValidationResult): void {
    if (!this.config.resourceUri) {
      return; // Skip validation if not configured
    }

    // Validate audience claim
    this.validateAudienceClaim(tokenInfo.aud, this.config.resourceUri, result);

    // Validate resource parameter if present
    if (tokenInfo.resource) {
      this.validateResourceParameter(tokenInfo.resource, this.config.resourceUri, result);
    }
  }

  /**
   * Validate audience claim
   */
  private validateAudienceClaim(aud: string | string[] | undefined, expectedResource: string, result: TokenExchangeValidationResult): void {
    if (!aud) {
      result.errors.push('Token missing required aud claim for resource validation');
      return;
    }

    const audiences = Array.isArray(aud) ? aud : [aud];

    if (!audiences.includes(expectedResource)) {
      result.errors.push(
        `Token audience does not include required resource. Expected: ${expectedResource}, Got: ${audiences.join(', ')}`
      );
    }
  }

  /**
   * Validate resource parameter
   */
  private validateResourceParameter(resource: string | string[] | undefined, expectedResource: string, result: TokenExchangeValidationResult): void {
    if (!resource) {
      return;
    }

    const resources = Array.isArray(resource) ? resource : [resource];

    for (const res of resources) {
      try {
        const resourceUrl = new URL(res);
        const expectedUrl = new URL(expectedResource);

        if (resourceUrl.origin !== expectedUrl.origin) {
          result.errors.push(
            `Resource parameter origin mismatch. Expected: ${expectedUrl.origin}, Got: ${resourceUrl.origin}`
          );
        }
      } catch (error) {
        result.errors.push(`Invalid resource parameter format: ${res}`);
      }
    }
  }

  /**
   * Validate token scopes
   */
  private validateTokenScopes(scope: string | undefined, result: TokenExchangeValidationResult): void {
    if (!scope) {
      result.warnings.push('Token has no scope claim');
      return;
    }

    const scopes = scope.split(' ');
    
    // Check for delegation scopes
    const delegationScopes = scopes.filter(s => s.startsWith('delegation:') || s.startsWith('act:'));
    
    if (delegationScopes.length > 0) {
      result.warnings.push(`Delegation scopes detected: ${delegationScopes.join(', ')}`);
      
      // Validate delegation scope format
      for (const delegationScope of delegationScopes) {
        if (!this.isValidDelegationScope(delegationScope)) {
          result.errors.push(`Invalid delegation scope format: ${delegationScope}`);
        }
      }
    }

    // Check for prohibited scopes
    const prohibitedScopes = ['admin', 'system:*', 'super_user'];
    const foundProhibited = scopes.filter(scope => 
      prohibitedScopes.some(prohibited => scope.includes(prohibited))
    );
    
    if (foundProhibited.length > 0) {
      result.errors.push(`Token contains prohibited scope(s): ${foundProhibited.join(', ')}`);
    }
  }

  /**
   * Check if delegation scope format is valid
   */
  private isValidDelegationScope(scope: string): boolean {
    const delegationPattern = /^(delegation|act):[a-zA-Z0-9_-]+$/;
    return delegationPattern.test(scope);
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
