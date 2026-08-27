/**
 * Resolves the bearer token to send to the banking API for a tool call.
 * Four resolution paths (TokenResolution.source):
 *   agent-passthrough        — agentToken present, no BANKING_API_RESOURCE_URI configured
 *   agent-step9-exchange     — agentToken present, exchange service + resource URI configured
 *   user-rfc8693-exchange     — no agentToken, exchange service configured
 *   user-passthrough-noexchange — no agentToken, no exchange service; unconditional passthrough
 *                                 in ALL environments (backward compat / ff_skip_token_exchange).
 *                                 NOTE: this path does NOT throw in production — the name describes
 *                                 the absence of a token-exchange service, not an env guard.
 *
 * Extracted verbatim from BankingToolProvider.executeSpecificTool token-selection block and
 * getUserTokenForScopes. Behavior is identical to the originals.
 */

import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { TokenExchangeService } from '../auth/TokenExchangeService';
import { Logger } from '../utils/Logger';
import { createHash } from 'crypto';
import { tokenCache } from '../services/tokenCacheService';
import { getScopesForTool } from './toolScopeMap';
import type { BankingToolDefinition } from './BankingToolRegistry';
import { Session, AuthErrorCodes, AuthenticationError, UserTokens } from '../interfaces/auth';
import { TokenExchangeRequest } from '../interfaces/tokenExchange';
import { resolveEmbeddedIssuer } from '../oauth/embeddedIssuer';
import { TokenStore } from '../oauth/TokenStore';

export interface TokenResolverDeps {
  authManager: BankingAuthenticationManager;
  tokenExchangeService?: TokenExchangeService;
  logger: Logger;
  /** Looks up the real PingOne access token stashed alongside a self-issued
   *  agentToken minted via authorization_code federation (external door).
   *  Absent in the internal-hop wiring, where every agentToken is already
   *  PingOne-issued and this lookup would never hit. */
  tokenStore?: TokenStore;
}

export interface TokenResolution {
  token: string;
  source: 'agent-passthrough' | 'agent-federated-passthrough' | 'agent-step9-exchange' | 'user-rfc8693-exchange' | 'user-passthrough-noexchange';
}

/**
 * Step 9 exists to re-exchange a PingOne-issued gateway token at PingOne for
 * a Banking-API-audienced one. A self-issued agentToken — minted by this
 * server's own embedded AS, whether via native ID-JAG redemption
 * (OAuthRouter.redeemIdJag) or its own native OAuth flow — was never issued
 * by PingOne, so PingOne always rejects the re-exchange with "Cannot parse
 * token claims for request param 'subject_token'". Signature verification
 * already happened upstream (AuthenticationIntegration.validateAgentAuthentication),
 * so this is an unverified decode for routing only — same trust model as the
 * gateway's own ID-JAG exemption (demo_mcp_gateway/src/tokenValidator.ts).
 */
function isSelfIssuedToken(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.iss === resolveEmbeddedIssuer();
  } catch {
    return false;
  }
}

/**
 * A self-issued token minted via a real PingOne authorization_code federation
 * (external door, browser login) has the real PingOne access token stashed
 * against its `jti` in the TokenStore (see OAuthRouter.handleAuthorizeCallback
 * + TokenIssuer.issueAuthorizationCode). client_credentials tokens never get
 * one — there's no real user to federate — so this correctly returns null for
 * those, same as before this existed.
 */
function resolveFederatedSubjectToken(token: string, tokenStore?: TokenStore): string | null {
  if (!tokenStore) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const jti = decoded.jti as string | undefined;
    if (!jti) return null;
    const issued = tokenStore.introspect(jti);
    if (!issued || issued.revoked || !issued.pingOneAccessToken) return null;
    // issued.expiresAt is seconds-since-epoch (TokenIssuer mirrors the JWT exp
    // claim convention); Date.now() is milliseconds. Comparing them directly
    // made every stash read as already-expired the instant it was created —
    // confirmed live via temporary diagnostic logging (jti always hit this
    // branch within ~100ms of being minted). Scale to the same unit.
    if (Date.now() >= issued.expiresAt * 1000) return null;
    return issued.pingOneAccessToken;
  } catch {
    return null;
  }
}

export class TokenResolver {
  constructor(private deps: TokenResolverDeps) {}

  async resolve(session: Session, tool: BankingToolDefinition, agentToken?: string): Promise<TokenResolution> {
    const { tokenExchangeService, tokenStore, logger } = this.deps;

    let token: string;
    if (agentToken) {
      if (isSelfIssuedToken(agentToken)) {
        const federatedToken = resolveFederatedSubjectToken(agentToken, tokenStore);
        if (federatedToken) {
          logger.debug(`[BankingToolProvider] Self-issued agent token — using its federated PingOne subject token for ${tool.name}`);
          return { token: federatedToken, source: 'agent-federated-passthrough' };
        }
        logger.debug(`[BankingToolProvider] Self-issued agent token — skipping Step 9 resource exchange for ${tool.name}`);
        return { token: agentToken, source: 'agent-passthrough' };
      }
      // Step 9: Second RFC 8693 exchange — exchange gateway-scoped token for resource-scoped token.
      // Gated on BANKING_API_RESOURCE_URI: when absent, fall back to using gateway token directly
      // for backward compatibility (e.g. local dev without full resource server config).
      // Vertical action tools route to /api/path/vertical-tool, which accepts the
      // gateway-audience token directly. Step 9 exchange is for banking data APIs only.
      if (tokenExchangeService && process.env.BANKING_API_RESOURCE_URI && !tool.vertical) {
        const toolScopes = getScopesForTool(tool.name);
        // Bind the cache key to a fingerprint of THIS agent token, not just the
        // sessionId: a re-minted token (different subject/actor) sharing a sessionId
        // must not read a resource token minted for a different principal.
        const agentTokenFp = createHash('sha256').update(agentToken).digest('hex').slice(0, 16);
        const agentCacheKey = `agent:${session.sessionId}:${agentTokenFp}:${[...toolScopes].sort().join(',')}`;
        const cachedResourceToken = tokenCache.get(agentCacheKey, toolScopes);
        if (cachedResourceToken) {
          token = cachedResourceToken;
          logger.debug(`[BankingToolProvider] Step 9 resource cache hit for ${tool.name}`);
        } else {
          logger.info(`[BankingToolProvider] Step 9 resource exchange initiated for tool: ${tool.name}, scopes: ${toolScopes.join(',')}`);
          try {
            const exchangeRequest: TokenExchangeRequest = {
              grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
              subject_token: agentToken,
              subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
              scope: toolScopes.join(' '),
              // RFC 8707 `resource`, NOT `audience`. PingOne honors resource= and
              // SILENTLY IGNORES audience= (same trap documented at length in
              // demo_api_server/services/agentMcpTokenService.js ~L2330). With
              // audience= the exchange returned 200 with expires_in=3600 and the
              // token still carried aud=mcpserver.ping.demo — Step 9 "succeeded"
              // while narrowing nothing. Verified live before/after.
              resource: process.env.BANKING_API_RESOURCE_URI,
            };
            const exchangeResponse = await tokenExchangeService.exchangeToken(exchangeRequest);
            // Validate the response before caching (parity with the user path): a
            // missing/zero expires_in yields expiresAt = NaN, which tokenCache treats
            // as never-expired and would serve the token indefinitely.
            if (exchangeResponse.token_type !== 'Bearer' || !(exchangeResponse.expires_in > 0)) {
              throw new Error(
                `Step 9 token exchange for '${tool.name}' returned unexpected response — ` +
                `token_type: ${exchangeResponse.token_type}, expires_in: ${exchangeResponse.expires_in}`
              );
            }
            token = exchangeResponse.access_token;
            const expiresAt = Date.now() + (exchangeResponse.expires_in * 1000);
            tokenCache.set(agentCacheKey, toolScopes, token, expiresAt);
            logger.info(`[BankingToolProvider] Step 9 resource exchange succeeded for ${tool.name} (expires_in: ${exchangeResponse.expires_in}s)`);
          } catch (exchangeError) {
            logger.error(`[BankingToolProvider] Step 9 resource exchange FAILED for ${tool.name}:`, {}, exchangeError instanceof Error ? exchangeError : undefined);
            throw Object.assign(
              new Error(
                `Step 9 token exchange failed for tool '${tool.name}': ${exchangeError instanceof Error ? exchangeError.message : 'Unknown error'}`
              ),
              { cause: exchangeError }
            );
          }
        }
        return { token, source: 'agent-step9-exchange' };
      } else {
        // Backward compat: no resource URI configured — use gateway token directly.
        // For a banking DATA tool (!tool.vertical) this forwards an un-narrowed
        // gateway-audience token to the Banking API. Under STRICT_AUTH that is a
        // misconfiguration (Step 9 should narrow scopes + audience), so fail closed.
        // Gated on STRICT_AUTH (not NODE_ENV) because the local demo runs
        // NODE_ENV=production without BANKING_API_RESOURCE_URI and relies on passthrough.
        if (process.env.STRICT_AUTH === 'true' && tokenExchangeService && !tool.vertical) {
          throw new AuthenticationError(
            `Step 9 resource exchange required for banking data tool '${tool.name}' but BANKING_API_RESOURCE_URI is not set`,
            AuthErrorCodes.INVALID_AGENT_TOKEN,
          );
        }
        token = agentToken;
        // With STRICT_AUTH off — the local default — the throw above does not
        // fire and a banking DATA tool silently forwards an un-narrowed
        // gateway-audience token. The Banking API usually enforces its own
        // resource audience (enduser.ping.demo), so it answers 401
        // invalid_token, and from downstream that reads as a broken token rather
        // than an unset env var. debug-level hid the one clue at normal log
        // levels; warn names the cause and the fix at the point of origin.
        if (tokenExchangeService && !tool.vertical) {
          logger.warn(
            `[BankingToolProvider] Step 9 resource exchange DISABLED for banking data tool '${tool.name}' ` +
            `(BANKING_API_RESOURCE_URI unset) — forwarding the gateway-audience token to the Banking API. ` +
            `If the Banking API enforces a different audience it will reject this with 401 invalid_token. ` +
            `To enable: set BANKING_API_RESOURCE_URI to the Banking API audience and grant the ` +
            `token-exchanger app a scope on that resource.`,
          );
        } else {
          logger.debug(`[BankingToolProvider] Using BFF-exchanged delegated token for ${tool.name} (no Step 9 resource exchange)`);
        }
        return { token, source: 'agent-passthrough' };
      }
    } else {
      // Resolve user token from session
      const userToken = this.getUserTokenForScopes(session, tool.requiredScopes);
      if (!userToken) {
        throw new AuthenticationError(
          'No valid user tokens found for required scopes',
          AuthErrorCodes.USER_AUTHORIZATION_REQUIRED,
          undefined,
          tool.requiredScopes
        );
      }

      if (tokenExchangeService) {
        // D-01: Lazy token exchange with cache — exchange on first call, cache with TTL
        // D-03: Narrowed scopes per tool via getScopesForTool()
        const toolScopes = getScopesForTool(tool.name);
        const cacheKey = session.sessionId;

        // Check cache first
        const cachedToken = tokenCache.get(cacheKey, toolScopes);
        if (cachedToken) {
          token = cachedToken;
          logger.debug(`[BankingToolProvider] Cache hit for ${tool.name} (scopes: ${toolScopes.join(',')})`);
        } else {
          // Cache miss — perform RFC 8693 token exchange
          logger.info(`[BankingToolProvider] Token exchange initiated for tool: ${tool.name}, scopes: ${toolScopes.join(',')}`);
          try {
            // Item 7 (RFC 8693 §2.1): include audience so PingOne scopes the token to the
            // banking resource server. Only sent when the env var is configured.
            const exchangeRequest: TokenExchangeRequest = {
              grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
              subject_token: userToken.accessToken,
              subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
              scope: toolScopes.join(' '),
              ...(process.env.BANKING_API_RESOURCE_URI && { audience: process.env.BANKING_API_RESOURCE_URI }),
            };
            const exchangeResponse = await tokenExchangeService.exchangeToken(exchangeRequest);
            token = exchangeResponse.access_token;

            // Item 6 (D-02): Confirm PingOne issued a valid access token by verifying the
            // TLS-secured exchange response fields — token_type:'Bearer' + positive expires_in
            // establishes the delegation chain without unsafe unsigned JWT payload decoding.
            if (exchangeResponse.token_type !== 'Bearer' || !(exchangeResponse.expires_in > 0)) {
              throw new Error(
                `Token exchange for '${tool.name}' returned unexpected response — ` +
                `token_type: ${exchangeResponse.token_type}, expires_in: ${exchangeResponse.expires_in}`
              );
            }

            // Cache the exchanged token
            const expiresAt = Date.now() + (exchangeResponse.expires_in * 1000);
            tokenCache.set(cacheKey, toolScopes, token, expiresAt);

            logger.info(`[BankingToolProvider] Token exchange succeeded for ${tool.name} (expires_in: ${exchangeResponse.expires_in}s)`);
          } catch (exchangeError) {
            // D-04: Hard fail on exchange error — no pass-through fallback
            logger.error(`[BankingToolProvider] Token exchange FAILED for ${tool.name}:`, {}, exchangeError instanceof Error ? exchangeError : undefined);
            throw Object.assign(
              new Error(
                `Token exchange failed for tool '${tool.name}': ${exchangeError instanceof Error ? exchangeError.message : 'Unknown error'}`
              ),
              { cause: exchangeError }
            );
          }
        }
        return { token, source: 'user-rfc8693-exchange' };
      } else {
        // No token exchange service — direct pass-through (backward compat / ff_skip_token_exchange)
        token = userToken.accessToken;
        this.deps.logger.debug(`[BankingToolProvider] Using session user token for ${tool.name} (no token exchange service)`);
        return { token, source: 'user-passthrough-noexchange' };
      }
    }
  }

  private getUserTokenForScopes(session: Session, requiredScopes: string[]): UserTokens | null {
    if (!session.userTokens) {
      return null;
    }

    // Handle both single token and token array
    const tokens = Array.isArray(session.userTokens) ? session.userTokens : [session.userTokens];

    // Find tokens that have all required scopes and are not expired
    for (const userToken of tokens) {
      if (this.deps.authManager.isTokenExpired(userToken)) {
        continue;
      }

      const tokenScopes = userToken.scope.split(' ');
      const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));

      if (hasAllScopes) {
        return userToken;
      }
    }

    return null;
  }
}
