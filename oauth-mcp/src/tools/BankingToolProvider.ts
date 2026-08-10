/**
 * Banking Tool Provider
 * Implements banking-specific tools that call the banking API server with proper authorization
 */

import { BankingAPIClient } from '../banking/BankingAPIClient';
import type { HttpTraceEntry } from '../banking/BankingAPIClient';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../storage/BankingSessionManager';
import { BankingToolRegistry, BankingToolDefinition } from './BankingToolRegistry';
import { BankingToolValidator } from './BankingToolValidator';
import { AuthorizationChallengeHandler, AuthorizationChallenge } from './AuthorizationChallengeHandler';
import { ToolResult, AuthorizationRequest } from '../interfaces/mcp';
import { Session, AuthErrorCodes, AuthenticationError } from '../interfaces/auth';
import { BankingAPIError } from '../interfaces/banking';
import { TokenExchangeService } from '../auth/TokenExchangeService';
import { AuditLogger } from '../utils/AuditLogger';
import { TokenChainAuditor } from './TokenChainAuditor';
import { Logger, createDefaultLoggerConfig } from '../utils/Logger';
import { filterToolsByScope } from './toolScopeMap';
import { TokenResolver } from './TokenResolver';
import { JwtClaimVerifier } from './JwtClaimVerifier';
import { handlerMap, HandlerDeps } from './handlers';

export interface ToolExecutionContext {
  session: Session;
  toolName: string;
  params: Record<string, any>;
}

export interface BankingToolResult extends ToolResult {
  type: 'text';
  text: string;
  success?: boolean;
  error?: string;
  authChallenge?: AuthorizationRequest;
  originalRequest?: Record<string, any>;  // DEPRECATED — no longer populated; use httpTrace for debugging
  httpTrace?: HttpTraceEntry[];           // Actual HTTP calls made to the banking API
  structuredContent?: Record<string, any>;
}

export class BankingToolProvider {
  private authChallengeHandler: AuthorizationChallengeHandler;
  private auditor: TokenChainAuditor;
  private logger: Logger;
  private tokenResolver: TokenResolver;
  private jwtVerifier: JwtClaimVerifier;
  private handlerDeps: HandlerDeps;

  constructor(
    private apiClient: BankingAPIClient,
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager,
    private tokenExchangeService?: TokenExchangeService
  ) {
    this.logger = Logger.getInstance(createDefaultLoggerConfig());
    this.authChallengeHandler = new AuthorizationChallengeHandler(authManager, sessionManager);
    this.tokenResolver = new TokenResolver({ authManager: this.authManager, tokenExchangeService: this.tokenExchangeService, logger: this.logger });
    this.jwtVerifier = new JwtClaimVerifier(this.logger);
    this.auditor = new TokenChainAuditor(AuditLogger.getInstance(this.logger), this.jwtVerifier, this.logger);
    this.handlerDeps = { apiClient: this.apiClient, logger: this.logger };
  }

  /**
   * Wire in a TokenExchangeService after construction.
   * Called from index.ts after the Logger singleton is initialized (which happens
   * inside this constructor) so TokenExchangeService can safely call Logger.getInstance().
   */
  setTokenExchangeService(svc: TokenExchangeService): void {
    this.tokenExchangeService = svc;
    this.tokenResolver = new TokenResolver({ authManager: this.authManager, tokenExchangeService: svc, logger: this.logger });
  }

  /**
   * Remove the chain-index entry for a session when it ends.
   * Callers (e.g. BankingSessionManager) should invoke this on session teardown.
   */
  clearSessionChainIndex(sessionId: string): void {
    this.auditor.clearSession(sessionId);
  }

  /**
   * Execute a banking tool
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    session: Session,
    agentToken?: string
  ): Promise<BankingToolResult> {
    const startTime = Date.now();
    const sessionId = session.sessionId;

    this.logger.info(`[BankingToolProvider] Starting tool execution: ${toolName} (session: ${sessionId})`);
    this.logger.debug(`[BankingToolProvider] Tool parameters:`, { params: JSON.stringify(params, null, 2) });

    try {
      // Validate tool exists
      const tool = BankingToolRegistry.getTool(toolName);
      if (!tool) {
        this.logger.warn(`[BankingToolProvider] Unknown tool requested: ${toolName}`);
        return this.createErrorResult(`Unknown tool: ${toolName}`, params);
      }

      this.logger.info(`[BankingToolProvider] Tool found: ${tool.name}, required scopes: [${tool.requiredScopes.join(', ')}]`);

      // Validate parameters
      const paramValidation = BankingToolValidator.validateToolParams(toolName, params);
      if (!paramValidation.isValid) {
        this.logger.warn(`[BankingToolProvider] Parameter validation failed for ${toolName}:`, paramValidation.errors);
        return this.createErrorResult(`Invalid parameters: ${paramValidation.errors.join(', ')}`, params);
      }

      this.logger.debug(`[BankingToolProvider] Parameters validated successfully for ${toolName}`);

      // Authorization for tools that require user auth / scopes:
      // - agentToken path: enforce requiredScopes on the bearer (defense in depth for
      //   direct MCP access). Skip session-based OAuth challenge detection — the
      //   delegated token is the credential.
      // - session path: run the challenge handler against session user tokens.
      if (tool.requiresUserAuth && tool.requiredScopes.length > 0) {
        if (agentToken) {
          // Open-access hop (MCP_AUTH_DISABLED): a gateway in front of this
          // server owns authorization, so the per-tool banking scope check must
          // not fire. Two shapes reach here on that hop, and neither is a banking
          // OAuth token:
          //   1. The open-access PLACEHOLDER bearer 'disabled' — HttpMCPTransport
          //      hands it downstream when the forwarded bearer does not validate
          //      (the Privilege gateway case: it forwards a token this server
          //      cannot verify, so the placeholder flows as agentToken with no
          //      scopes). This is the exact bug the transport comment describes,
          //      already fixed in AuthenticationIntegration but not here.
          //   2. A Privilege-issued token (kid infra-root-jwt / aud procyon),
          //      should one ever be forwarded intact.
          // Real banking / A2A tokens are always signed JWTs with a banking aud
          // and their scope-chain (records:read, tax:read, …) stays fully
          // enforced below — they are never the placeholder and never aud procyon.
          const openAccessHop =
            process.env.MCP_AUTH_DISABLED === 'true' &&
            (agentToken === 'disabled' || this.isPrivilegeGatewayToken(agentToken));
          if (openAccessHop) {
            this.logger.info(
              `[BankingToolProvider] open-access hop (MCP_AUTH_DISABLED) — the gateway owns authorization; skipping banking scope check for ${toolName}`
            );
          } else {
          // A2A-delegated tools: PingOne scope-name uniqueness forces the
          // specialist's Exchange #2 bearer to carry the per-vertical scope
          // (scope-topology a2aDelegatedScope — records:read, tax:read, …)
          // INSTEAD of the coarse 'read'. Accept either; both absent fails closed.
          const delegatedScope = (tool as { a2aDelegatedScope?: string }).a2aDelegatedScope;
          const hasScopes =
            (await this.authManager.validateTokenScopes(agentToken, tool.requiredScopes)) ||
            (!!delegatedScope &&
              (await this.authManager.validateTokenScopes(agentToken, [delegatedScope])));
          if (!hasScopes) {
            this.logger.warn(
              `[BankingToolProvider] agentToken missing required scopes for ${toolName}: [${tool.requiredScopes.join(', ')}]${delegatedScope ? ` (a2aDelegatedScope alternative '${delegatedScope}' also absent)` : ''}`
            );
            return this.createErrorResult(
              `Insufficient scope. Required: ${tool.requiredScopes.join(', ')}`,
              params
            );
          }
          this.logger.debug(`[BankingToolProvider] agentToken scope check passed for ${toolName}`);
          }
        } else {
          this.logger.debug(`[BankingToolProvider] Checking authorization for scopes: [${tool.requiredScopes.join(', ')}]`);
          const challengeResult = await this.authChallengeHandler.detectAuthorizationChallenge(
            session,
            tool.requiredScopes
          );

          if (challengeResult.challengeNeeded) {
            this.logger.info(`[BankingToolProvider] Authorization challenge required for ${toolName}`);
            return this.createAuthChallengeResult(challengeResult.challenge!);
          }

          this.logger.debug(`[BankingToolProvider] Authorization check passed for ${toolName}`);

          // Re-fetch the session in case tokens were refreshed during the challenge check
          const refreshedSession = await this.sessionManager.getSession(session.sessionId);
          if (refreshedSession) {
            session = refreshedSession;
          }
        }
      } else {
        this.logger.debug(`[BankingToolProvider] Tool ${toolName} does not require user authorization, skipping auth check`);
      }

      // Extract act.sub from agent token for X-Agent-Sub header
      let agentSub: string | undefined;
      if (agentToken) {
        try {
          const parts = agentToken.split('.');
          if (parts.length === 3) {
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            agentSub = claims?.act?.sub || claims?.act?.client_id || undefined;
          }
        } catch {
          // Malformed token — proceed without agentSub
        }
      }

      if (!agentSub) {
        console.debug('[BankingToolProvider] act.sub absent from token — X-Agent-Sub not forwarded; agentRestrictions gate will not fire');
      }

      // Create call-scoped API client with agent identity headers when available.
      // This forwards X-Agent-Sub and X-MCP-Tool to the BFF for per-call policy enforcement.
      const callClient = agentSub
        ? new BankingAPIClient({ ...this.apiClient.getConfig(), agentSub, mcpTool: toolName })
        : this.apiClient;
      const callHandlerDeps = agentSub
        ? { ...this.handlerDeps, apiClient: callClient }
        : this.handlerDeps;

      // Execute the specific tool
      const sanitizedParams = paramValidation.sanitizedParams!;
      const context: ToolExecutionContext = {
        session,
        toolName,
        params: sanitizedParams
      };

      this.logger.debug(`[BankingToolProvider] Executing tool handler: ${tool.handler}`);
      this.apiClient.startTrace();  // keep started for error path in handleExecutionError
      callClient.startTrace();      // actual trace for this call
      const result = await this.executeSpecificTool(tool, context, agentToken, callHandlerDeps);
      result.httpTrace = callClient.stopTrace();
      this.apiClient.stopTrace();   // clean up the base client's empty trace when callClient !== apiClient

      const executionTime = Date.now() - startTime;
      this.logger.info(`[BankingToolProvider] Tool execution completed: ${toolName} (${executionTime}ms) - Success: ${result.success}`);

      // Log token chain audit event (D-03, D-04)
      await this.auditor.record({ toolName, tool, session, agentToken, result, executionTime, params: sanitizedParams });

      return result;

    } catch (error) {
      return this.handleExecutionError(error, toolName, params, session, startTime);
    }
  }

  /**
   * Handle errors thrown during tool execution.
   * Collects any partial HTTP trace, logs the failure, and maps known error
   * types (AuthenticationError, BankingAPIError) to structured results.
   */
  private async handleExecutionError(
    error: unknown,
    toolName: string,
    params: Record<string, any>,
    session: Session,
    startTime: number
  ): Promise<BankingToolResult> {
    // Collect any HTTP trace entries captured before the exception
    const errorTrace = this.apiClient.stopTrace();
    const executionTime = Date.now() - startTime;
    this.logger.error(`[BankingToolProvider] Error executing tool ${toolName} (${executionTime}ms):`, {}, error instanceof Error ? error : undefined);

    const attachTrace = (r: BankingToolResult): BankingToolResult => {
      if (errorTrace.length > 0) r.httpTrace = errorTrace;
      return r;
    };

    if (error instanceof AuthenticationError) {
      this.logger.warn(`[BankingToolProvider] Authentication error for ${toolName}: ${error.message}`);
      if (error.code === AuthErrorCodes.USER_AUTHORIZATION_REQUIRED && error.authorizationUrl) {
        // Generate a proper authorization challenge
        const challenge = await this.authChallengeHandler.generateAuthorizationChallenge(
          session.sessionId,
          error.requiredScopes || []
        );
        return this.createAuthChallengeResult(challenge);
      }
      return attachTrace(this.createErrorResult(`Authentication error: ${error.message}`, params));
    }

    if (error instanceof BankingAPIError) {
      this.logger.warn(`[BankingToolProvider] Banking API error for ${toolName}: ${error.message}`);
      return attachTrace(this.createErrorResult(`Banking API error: ${error.message}`, params));
    }

    this.logger.error(`[BankingToolProvider] Unexpected error for ${toolName}:`, {}, error instanceof Error ? error : undefined);
    return attachTrace(this.createErrorResult(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`, params));
  }

  /**
   * Get all available tools for MCP protocol (unfiltered).
   */
  getAvailableTools(): BankingToolDefinition[] {
    return BankingToolRegistry.getAllTools();
  }

  /**
   * Get tools permitted for the given token scopes (tools/list filtering).
   * Uses flat scope matching: read / write.
   * No authz server call — pure token introspection.
   */
  getAvailableToolsForToken(tokenScopes: string[]): BankingToolDefinition[] {
    return filterToolsByScope(BankingToolRegistry.getAllTools(), tokenScopes);
  }

  /**
   * Handle authorization code from user
   */
  async handleAuthorizationCode(
    sessionId: string,
    authorizationCode: string,
    state: string
  ): Promise<BankingToolResult> {
    try {
      const result = await this.authChallengeHandler.handleAuthorizationCode({
        sessionId,
        authorizationCode,
        state
      });

      if (result.success) {
        let expiresIn = 0;
        if (result.userTokens) {
          expiresIn = result.userTokens.expiresIn;
        }

        return this.createSuccessResult(
          `Authorization successful! You can now use banking tools.\n` +
          `Token expires in ${Math.floor(expiresIn / 60)} minutes.`
        );
      } else {
        return this.createErrorResult(`Authorization failed: ${result.error}`);
      }
    } catch (error) {
      this.logger.error('Error handling authorization code:', {}, error instanceof Error ? error : undefined);
      return this.createErrorResult(
        `Authorization processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if a session needs re-authorization for specific scopes
   */
  async checkReauthorizationNeeded(
    session: Session,
    requiredScopes: string[]
  ): Promise<boolean> {
    return await this.authChallengeHandler.checkReauthorizationNeeded(session, requiredScopes);
  }

  /**
   * Execute specific tool based on handler
   */
  private async executeSpecificTool(
    tool: BankingToolDefinition,
    context: ToolExecutionContext,
    agentToken?: string,
    deps?: HandlerDeps
  ): Promise<BankingToolResult> {
    const handlerDeps = deps ?? this.handlerDeps;

    // Tools that do not require user auth — dispatch directly without token resolution
    if (!tool.requiresUserAuth) {
      if (tool.handler === 'executeQueryUserByEmail') {
        // Identity lookup performed by the agent on behalf of the platform.
        // Uses the BFF-issued agent delegated token rather than a user's own token.
        // agentToken is always present in the normal BFF → MCP Gateway → MCP Server flow.
        if (!agentToken) {
          return this.createErrorResult(
            'query_user_by_email requires an agent-delegated token; no agentToken was provided in this request.'
          );
        }
        const handler = handlerMap[tool.handler];
        if (!handler) {
          return this.createErrorResult(`Unknown non-auth tool handler: ${tool.handler}`, context.params);
        }
        return await handler(handlerDeps, agentToken, context.params);
      }

      const handler = handlerMap[tool.handler];
      if (!handler) {
        return this.createErrorResult(`Unknown non-auth tool handler: ${tool.handler}`, context.params);
      }
      return await handler(handlerDeps, '', context.params);
    }

    // Token selection: prefer the BFF-issued delegated token (RFC 8693 agentToken) when
    // available — it carries the act claim proving the delegation chain and has the correct
    // audience for the BFF's data APIs. Fall back to the raw session user token only when
    // no delegated token was provided (e.g. ff_skip_token_exchange=true or direct MCP call).
    const { token } = await this.tokenResolver.resolve(context.session, tool, agentToken);

    // Item 8: structural exp/iss/aud pre-flight for sensitive operations.
    // Non-network local decode — verifies token has not expired before we hit the banking API.
    // Verify agentToken (the token that arrived at this MCP server from the gateway), not the
    // post-resolution `token`: when Step 9 resource-narrowing ran, `token` is deliberately
    // re-audienced to BANKING_API_RESOURCE_URI and will never carry the MCP server audience this
    // check expects. Falls back to `token` when there's no agentToken (matches its own audience).
    if (this.jwtVerifier.isSensitiveHandler(tool.handler)) {
      await this.jwtVerifier.assertClaims(agentToken ?? token, tool.name);
    }

    const handler = handlerMap[tool.handler];
    if (!handler) {
      return this.createErrorResult(`Unknown tool handler: ${tool.handler}`, context.params);
    }
    return await handler(handlerDeps, token, context.params);
  }

  /**
   * Create a successful tool result
   */
  private createSuccessResult(text: string): BankingToolResult {
    return {
      type: 'text',
      text,
      success: true
    };
  }

  /**
   * True when the bearer is a PingOne Privilege gateway token rather than a
   * banking OAuth token: it is signed with the gateway's infra key
   * (kid infra-root-jwt) and carries aud "procyon". Such a token never holds
   * banking scopes by design — the Privilege gateway does policy on that hop.
   * Used only to skip the banking scope check under MCP_AUTH_DISABLED; banking
   * and A2A tokens (aud != procyon) never match and stay fully enforced.
   */
  private isPrivilegeGatewayToken(token: string): boolean {
    try {
      const [rawHeader, rawPayload] = token.split('.');
      if (!rawHeader || !rawPayload) return false;
      const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString());
      const aud = payload.aud;
      const audMatches = aud === 'procyon' || (Array.isArray(aud) && aud.includes('procyon'));
      return header.kid === 'infra-root-jwt' || audMatches;
    } catch {
      return false;
    }
  }

  /**
   * Create an error tool result
   */
  private createErrorResult(error: string, _originalRequest?: Record<string, any>): BankingToolResult {
    // Note: originalRequest is intentionally not included in the error payload.
    // Tool params may contain account IDs or amounts that should not be echoed
    // back in error responses. Use httpTrace for debugging instead.
    return {
      type: 'text',
      text: `Error: ${error}`,
      success: false,
      error
    };
  }

  /**
   * Create an authorization challenge result
   */
  private createAuthChallengeResult(challenge: AuthorizationChallenge): BankingToolResult {
    const mcpChallenge = this.authChallengeHandler.formatMCPAuthorizationChallenge(challenge);

    return {
      type: 'text',
      text: mcpChallenge.text,
      success: false,
      error: 'User authorization required',
      authChallenge: mcpChallenge.authChallenge
    };
  }

}