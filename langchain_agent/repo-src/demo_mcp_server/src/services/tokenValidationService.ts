/**
 * Token Validation Service — Dual-Mode Support
 *
 * Detects and validates both RFC 8693 token exchange (default) and
 * draft Transaction Tokens (draft-oauth-transaction-tokens-for-agents-06).
 *
 * Detection strategy:
 *   - RFC 8693: introspection response has `act` claim with client_id or sub
 *   - Transaction Tokens: introspection response has `txn_id` claim
 *
 * The MCP server validates tokens via PingOne introspection (not JWT decode),
 * so detection operates on the introspection response object (TokenInfo).
 */

import { TokenInfo, AgentTokenInfo } from '../interfaces/auth';

/** Token exchange mode — matches BFF tokenExchangeConfig modes */
export type TokenMode = 'rfc_8693' | 'transaction_tokens' | 'unknown';

/** Result of dual-mode token analysis */
export interface TokenModeResult {
  mode: TokenMode;
  transactionId?: string;
  transactionScope?: string;
  actorClientId?: string;
}

/**
 * Detect the token exchange mode from a PingOne introspection response.
 *
 * Priority: Transaction Tokens markers > RFC 8693 markers > unknown
 *
 * @param tokenInfo - Raw TokenInfo from PingOne introspection endpoint
 * @returns Detected mode and any extracted transaction metadata
 */
export function detectTokenMode(tokenInfo: TokenInfo): TokenModeResult {
  // Transaction Tokens (draft): identified by txn_id claim
  if (tokenInfo.txn_id) {
    const result: TokenModeResult = {
      mode: 'transaction_tokens',
      transactionId: tokenInfo.txn_id,
    };
    if (tokenInfo.txn_scope) {
      result.transactionScope = tokenInfo.txn_scope;
    }
    // Transaction tokens may also carry actor info in agent_id or act.sub
    if (tokenInfo.agent_id) {
      result.actorClientId = tokenInfo.agent_id;
    } else if (tokenInfo.act?.sub) {
      result.actorClientId = tokenInfo.act.sub;
    } else if (tokenInfo.act?.client_id) {
      result.actorClientId = tokenInfo.act.client_id;
    }
    console.log(
      `[TokenValidationService] Detected transaction_tokens mode — txn_id=${result.transactionId}`,
      result.transactionScope ? `txn_scope=${result.transactionScope}` : ''
    );
    return result;
  }

  // RFC 8693: identified by act claim (delegated token exchange)
  if (tokenInfo.act && (tokenInfo.act.sub || tokenInfo.act.client_id)) {
    const actorClientId = tokenInfo.act.client_id || tokenInfo.act.sub || undefined;
    console.log(
      `[TokenValidationService] Detected rfc_8693 mode — actor=${actorClientId || '(unspecified)'}`
    );
    return {
      mode: 'rfc_8693',
      actorClientId,
    };
  }

  // Unknown: token is active but has no recognized delegation marker
  // Could be a direct (non-exchanged) token — log and accept without mode-specific context
  console.warn(
    '[TokenValidationService] Token has no act or txn_id claim — treating as rfc_8693 (direct token)'
  );
  return { mode: 'unknown' };
}

/**
 * Merge token mode detection results into an AgentTokenInfo object.
 *
 * Called by TokenIntrospector after PingOne introspection and basic validation.
 *
 * @param base - AgentTokenInfo constructed from introspection result
 * @param modeResult - Result from detectTokenMode()
 * @returns Enhanced AgentTokenInfo with token mode metadata
 */
export function enrichAgentTokenInfo(
  base: AgentTokenInfo,
  modeResult: TokenModeResult
): AgentTokenInfo {
  const enriched: AgentTokenInfo = { ...base };

  if (modeResult.mode !== 'unknown') {
    enriched.tokenMode = modeResult.mode;
  } else {
    // Default unknown → rfc_8693 for backward compatibility
    enriched.tokenMode = 'rfc_8693';
  }

  if (modeResult.transactionId) {
    enriched.transactionId = modeResult.transactionId;
  }
  if (modeResult.transactionScope) {
    enriched.transactionScope = modeResult.transactionScope;
  }
  // Prefer existing actorClientId (already set by introspector from act claim)
  // but fall back to modeResult if not set
  if (!enriched.actorClientId && modeResult.actorClientId) {
    enriched.actorClientId = modeResult.actorClientId;
  }

  return enriched;
}
