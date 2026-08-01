/**
 * Records token-chain audit events for tool executions. Owns the per-session chain index
 * counter (FIFO-evicted at MAX_SESSION_CHAIN_ENTRIES) and the AuditLogger.logTokenChain call.
 *
 * Extracted verbatim from BankingToolProvider — MAX_SESSION_CHAIN_ENTRIES, chainIndexBySession,
 * incrementChainIndex, clearSessionChainIndex body, and the inline audit block in executeTool.
 * The try/catch that previously wrapped the inline audit call now wraps the whole record()
 * body — audit failure never blocks tool result (same swallow + warn behavior).
 */
import { AuditLogger, UserTokenInfo, ExchangedTokenInfo } from '../utils/AuditLogger';
import { Logger } from '../utils/Logger';
import { JwtClaimVerifier } from './JwtClaimVerifier';
import type { Session } from '../interfaces/auth';
import type { BankingToolDefinition } from './BankingToolRegistry';
import type { BankingToolResult } from './BankingToolProvider';

/** Maximum number of distinct sessions tracked in chainIndexBySession before FIFO eviction. */
const MAX_SESSION_CHAIN_ENTRIES = 1_000;

export interface AuditRecordArgs {
  toolName: string;
  tool: BankingToolDefinition;
  session: Session;
  agentToken?: string;
  result: BankingToolResult;
  executionTime: number;
  params?: Record<string, any>;  // Tool request arguments (recorded for the token-chain request/response view)
}

export class TokenChainAuditor {
  private chainIndexBySession: Map<string, number> = new Map();

  constructor(
    private auditLogger: AuditLogger,
    private jwtVerifier: JwtClaimVerifier,
    private logger: Logger,
  ) {}

  async record(args: AuditRecordArgs): Promise<void> {
    const { toolName, tool, session, agentToken, result, executionTime, params } = args;
    try {
      const chainIndex = this.incrementChainIndex(session.sessionId);

      // Extract user token info from session
      let userToken = session.userTokens;
      if (Array.isArray(userToken)) {
        userToken = userToken[0];
      }

      // Decode real sub from the token payload; fall back to 'unknown' for opaque tokens.
      const userTokenClaims = userToken ? this.jwtVerifier.decodePayload(userToken.accessToken) : null;
      const userSub = typeof userTokenClaims?.sub === 'string' ? userTokenClaims.sub : 'unknown';

      const userTokenInfo: UserTokenInfo = userToken
        ? {
            sub: userSub,
            scope: userToken.scope?.split(' ') || [],
            issuedAt: new Date(userToken.issuedAt).toISOString(),
            expiresAt: new Date(new Date(userToken.issuedAt).getTime() + (userToken.expiresIn || 3600) * 1000).toISOString(),
            tokenId: userSub
          }
        : {
            sub: 'unknown',
            scope: [],
            issuedAt: new Date().toISOString(),
            expiresAt: undefined,
            tokenId: 'unknown'
          };

      // Extract exchanged token info if agent token was used (RFC 8693 delegation)
      const exchangedTokenInfo: ExchangedTokenInfo | null = agentToken
        ? {
            sub: 'mcp-agent',  // MCP server as delegated subject
            act: {
              iss: 'pingone',
              sub: userSub  // Original actor resolved from session token
            },
            scope: tool.requiredScopes || [],
            issuedAt: new Date().toISOString(),
            expiresAt: undefined,
            tokenId: 'exchange'
          }
        : null;

      // Construct tool result summary (non-sensitive, stable regardless of tool output shape)
      const toolResultSummary = result.success ? `${toolName} completed` : `${toolName} failed`;

      // Log to AuditLogger
      await this.auditLogger.logTokenChain(
        toolName,
        chainIndex,
        userTokenInfo,
        exchangedTokenInfo,
        {
          sessionId: session.sessionId,
          userId: undefined,  // Would need to be extracted from token claims
          ipAddress: undefined,  // Could be extracted from request context if available
          userAgent: undefined
        },
        'completed',  // toolExecutionStatus
        {
          success: result.success || false,
          errorCode: result.error ? 'TOOL_ERROR' : undefined,
          duration: executionTime,
          toolResultSummary,
          toolRequestJson: params,
          toolResultJson: result.success ? {
            text: result.text,
            isError: !!result.error
          } : undefined
        }
      );
    } catch (auditError) {
      // Don't let audit failure block tool result
      this.logger.warn(`[BankingToolProvider] Failed to log token chain: ${auditError instanceof Error ? auditError.message : String(auditError)}`);
    }
  }

  clearSession(sessionId: string): void {
    this.chainIndexBySession.delete(sessionId);
  }

  /**
   * Increment and return chain index for session (per-session call count).
   * Evicts the oldest session entry when the map reaches MAX_SESSION_CHAIN_ENTRIES
   * to prevent unbounded growth in long-running processes.
   */
  private incrementChainIndex(sessionId: string): number {
    const current = this.chainIndexBySession.get(sessionId) || 0;
    const next = current + 1;

    if (!this.chainIndexBySession.has(sessionId) && this.chainIndexBySession.size >= MAX_SESSION_CHAIN_ENTRIES) {
      const oldestKey = this.chainIndexBySession.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.chainIndexBySession.delete(oldestKey);
    }

    this.chainIndexBySession.set(sessionId, next);
    return next;
  }
}
