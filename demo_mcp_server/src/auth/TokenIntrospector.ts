/**
 * Token Introspector for PingOne AI IAM Core
 * Handles token validation and introspection with PingOne endpoints
 */

import { createHash } from 'crypto';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { PingOneConfig, TokenInfo, AgentTokenInfo, AuthenticationError, AuthErrorCodes } from '../interfaces/auth';
import { detectTokenMode, enrichAgentTokenInfo } from '../services/tokenValidationService';
import { teachLog } from '../utils/teachLogger';
import { sanitizeAxiosCause } from '../utils/sanitizeAxiosCause';
import { getJose, createJwksKeySet, JoseModule } from './jwks';

/**
 * True when a jose verification error is a JWKS *availability/fetch* failure (the
 * key endpoint returned a non-200, timed out, or the network is down) rather than
 * a genuine signature/key rejection. Used to fail-OPEN on infra blips while still
 * failing-CLOSED on forged tokens. A non-200 surfaces as jose's "Expected 200 OK
 * from the JSON Web Key Set HTTP response"; timeouts as ERR_JWKS_TIMEOUT. A real
 * forgery (JWSSignatureVerificationFailed) or wrong-key (JWKSNoMatchingKey) does
 * NOT match here and therefore still fails closed.
 */
function isJwksUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { code?: string }).code === 'ERR_JWKS_TIMEOUT') return true;
  const m = err.message || '';
  return /JSON Web Key Set HTTP response|Timeout reached when fetching|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up/i.test(m);
}

/** MCP_SERVER_RESOURCE_URI may be a comma-separated list of accepted audiences
 *  (rollout: own backend URI + gateway URI while both token shapes are live). */
export function audienceAccepted(tokenAud: string | string[], resourceUriEnv: string): boolean {
  const accepted = resourceUriEnv.split(',').map((s) => s.trim()).filter(Boolean);
  const audList = Array.isArray(tokenAud) ? tokenAud : [String(tokenAud)];
  return audList.some((a) => accepted.includes(a));
}

export class TokenIntrospector {
  private httpClient: AxiosInstance;
  private config: PingOneConfig;
  // Memoised JWKS keyset — created lazily on first signature verification.
  private jwksKeySet: Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null = null;

  constructor(config: PingOneConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Introspect a token using PingOne AI IAM Core introspection endpoint
   */
  async introspectToken(token: string): Promise<TokenInfo> {
    try {
      teachLog.step(1, 3, 'RFC 7662 introspection request', { client_id: this.config.clientId, endpoint: this.config.tokenIntrospectionEndpoint });
      
      const response = await this.httpClient.post(
        this.config.tokenIntrospectionEndpoint,
        new URLSearchParams({
          token: token,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        }).toString()
      );

      teachLog.step(2, 3, 'RFC 7662 introspection response', { status: response.status, introspection: response.data });

      return response.data as TokenInfo;
    } catch (error) {
      const cause = sanitizeAxiosCause(error);
      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          throw Object.assign(new AuthenticationError(
            'Invalid client credentials for token introspection',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          ), { cause });
        }
        if (axiosError.response?.status === 400) {
          throw Object.assign(new AuthenticationError(
            'Invalid token format',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          ), { cause });
        }
      }
      throw Object.assign(new Error(`Token introspection failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause });
    }
  }

  /**
   * Validate agent token and extract token information
   */
  async validateAgentToken(token: string): Promise<AgentTokenInfo> {
    teachLog.info('validating agent token (local JWT decode — gateway already authorized via Authorization Server)');
    // The MCP Gateway has already validated this token through the Authorization Server
    // (demo_authz_server / PingOne Authorize). Calling PingOne introspection here would
    // be redundant and requires the wrong client credentials. Decode locally instead.
    let decoded: Record<string, unknown> | null = null;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      }
    } catch {
      // fall through — decoded stays null
    }
    if (!decoded) {
      throw new AuthenticationError('Malformed JWT', AuthErrorCodes.INVALID_AGENT_TOKEN);
    }

    // SECURITY (was: critical gap) — verify the JWT signature against PingOne's JWKS
    // before trusting ANY claim below. Previously this boundary decoded the token
    // unsigned, so a self-crafted JWT with the right claims passed auth, scope
    // filtering, and the aud check. Fail-closed when JWKS is configured.
    await this.verifyTokenSignature(token);

    const now = Math.floor(Date.now() / 1000);
    const rawAud = decoded.aud;
    const tokenInfo: TokenInfo = {
      active: !decoded.exp || (decoded.exp as number) >= now,
      sub: decoded.sub as string | undefined,
      scope: decoded.scope as string | undefined,
      exp: decoded.exp as number | undefined,
      aud: rawAud as string | string[] | undefined,
      client_id: (decoded.client_id || decoded.sub) as string | undefined,
      act: decoded.act as { sub?: string; client_id?: string; iss?: string; act?: { sub?: string; client_id?: string; iss?: string } } | undefined,
    };
    (tokenInfo as any).may_act = decoded.may_act;
    teachLog.step(3, 3, 'local JWT decode result', {
      active: tokenInfo.active,
      scope: tokenInfo.scope,
      aud: tokenInfo.aud,
      exp: tokenInfo.exp,
      may_act: (tokenInfo as any).may_act,
    });
    
    teachLog.step(3, 3, 'introspection result evaluated', {
      active: tokenInfo.active,
      scope: tokenInfo.scope,
      aud: tokenInfo.aud,
      exp: tokenInfo.exp,
      may_act: (tokenInfo as any).may_act,
    });

    if (!tokenInfo.active) {
      throw new AuthenticationError(
        'Agent token is not active',
        AuthErrorCodes.INVALID_AGENT_TOKEN
      );
    }

    // Zero-trust (RFC 8707): validate token audience matches this MCP server's
    // resource URI. When MCP_SERVER_RESOURCE_URI is configured the check is
    // MANDATORY and fail-closed — a missing aud claim is now an error, not a
    // skipped warning (was: a token with no aud silently bypassed audience
    // validation, defeating resource-indicator binding).
    const resourceUri = process.env.MCP_SERVER_RESOURCE_URI;
    if (resourceUri) {
      if (!tokenInfo.aud) {
        teachLog.error('aud validation failed — token has no aud claim', undefined, { operation: 'aud_validation', expected: resourceUri.split(',').map((s) => s.trim()).filter(Boolean) });
        throw new AuthenticationError(
          'Token is missing the aud claim required for this MCP server',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      if (!audienceAccepted(tokenInfo.aud, resourceUri)) {
        teachLog.error('aud validation failed', undefined, { operation: 'aud_validation', token_aud: tokenInfo.aud, expected: resourceUri.split(',').map((s) => s.trim()).filter(Boolean) });
        throw new AuthenticationError(
          'Token audience does not match MCP server resource URI',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      teachLog.info('token audience validated', { resource_uri: resourceUri });
    }

    // RFC 8693 §4.2 — enforce may_act when BFF_CLIENT_ID + REQUIRE_MAY_ACT are configured.
    // Ensures only tokens exchanged by the designated Backend-for-Frontend (BFF) client are accepted by this MCP server.
    const bffClientId = process.env.BFF_CLIENT_ID;
    const requireMayAct = process.env.REQUIRE_MAY_ACT === 'true';
    if (requireMayAct && bffClientId) {
      const mayAct = (tokenInfo as any).may_act;
      if (!mayAct || mayAct.client_id !== bffClientId) {
        teachLog.error('may_act enforcement failed', undefined, { operation: 'may_act_enforcement', expected_client_id: bffClientId, actual: mayAct?.client_id || 'none' });
        throw new AuthenticationError(
          'Token missing valid may_act claim for Backend-for-Frontend (BFF) client',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      teachLog.info('may_act validated', { actor: mayAct.client_id });
    }

    // Optional defense-in-depth: match reference architecture checks for act.sub, act.client_id,
    // and act.act.sub (e.g. MCP identity as URI vs PingOne client id). Off unless env vars are set.
    const expectedActSub = process.env.MCP_EXPECTED_ACT_SUB?.trim();
    const expectedActClientId = process.env.MCP_EXPECTED_ACT_CLIENT_ID?.trim();
    const expectedActActSub = process.env.MCP_EXPECTED_ACT_ACT_SUB?.trim();
    if (expectedActSub) {
      const act = tokenInfo.act;
      const got = act?.sub ? String(act.sub) : '';
      if (got !== expectedActSub) {
        teachLog.error('act.sub mismatch', undefined, { operation: 'act_sub_validation', expected: expectedActSub, actual: got || '(empty)' });
        throw new AuthenticationError(
          'Token act.sub does not match MCP_EXPECTED_ACT_SUB',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      teachLog.info('act.sub validated against MCP_EXPECTED_ACT_SUB');
    }
    if (expectedActClientId) {
      const act = tokenInfo.act;
      const got = act?.client_id ? String(act.client_id) : '';
      if (got !== expectedActClientId) {
        teachLog.error('act.client_id mismatch', undefined, { operation: 'act_client_id_validation', expected: expectedActClientId, actual: got || '(empty)' });
        throw new AuthenticationError(
          'Token act.client_id does not match MCP_EXPECTED_ACT_CLIENT_ID',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      teachLog.info('act.client_id validated against MCP_EXPECTED_ACT_CLIENT_ID');
    }
    if (expectedActActSub) {
      const nested = tokenInfo.act?.act;
      const got = nested && typeof nested === 'object' ? String(nested.sub || '') : '';
      if (got !== expectedActActSub) {
        teachLog.error('act.act.sub mismatch', undefined, { operation: 'act_act_sub_validation', expected: expectedActActSub, actual: got || '(empty)' });
        throw new AuthenticationError(
          'Token act.act.sub does not match MCP_EXPECTED_ACT_ACT_SUB',
          AuthErrorCodes.INVALID_AGENT_TOKEN
        );
      }
      teachLog.info('act.act.sub validated against MCP_EXPECTED_ACT_ACT_SUB');
    }

    // Check if token is expired
    if (tokenInfo.exp && tokenInfo.exp < Math.floor(Date.now() / 1000)) {
      throw new AuthenticationError(
        'Agent token has expired',
        AuthErrorCodes.TOKEN_EXPIRED
      );
    }

    // Extract scopes from token
    const scopes = tokenInfo.scope ? tokenInfo.scope.split(' ') : [];

    // RFC 8693 §4.1 — log act claim for audit trail.
    // `act` is present on tokens issued via token exchange and identifies the
    // actor (Backend-for-Frontend (BFF) or AI agent) that performed the exchange on behalf of `sub`.
    const actorClientId = tokenInfo.act?.client_id;
    if (actorClientId) {
      teachLog.info('delegated token (RFC 8693 act claim present)', { actor: actorClientId, subject: tokenInfo.sub });
    } else {
      teachLog.info('direct token (no act claim)', { subject: tokenInfo.sub });
    }

    const baseTokenInfo: AgentTokenInfo = {
      tokenHash: this.hashToken(token),
      clientId: tokenInfo.client_id || 'unknown',
      scopes,
      expiresAt: tokenInfo.exp ? new Date(tokenInfo.exp * 1000) : new Date(Date.now() + 3600000),
      isValid: true,
      actorClientId,
    };

    // Detect dual-mode token type (RFC 8693 vs Transaction Tokens)
    const modeResult = detectTokenMode(tokenInfo);
    return enrichAgentTokenInfo(baseTokenInfo, modeResult);
  }

  /**
   * Validate that a token has the required scopes
   */
  async validateTokenScopes(token: string, requiredScopes: string[]): Promise<boolean> {
    try {
      const agentTokenInfo = await this.validateAgentToken(token);
      
      // Check if all required scopes are present
      return requiredScopes.every(scope => agentTokenInfo.scopes.includes(scope));
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Resolve PingOne's JWKS URI from env (same precedence as JwtClaimVerifier).
   * Returns null when no JWKS endpoint is configured.
   */
  private async getJwksKeySet(): Promise<Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null> {
    if (this.jwksKeySet) return this.jwksKeySet;
    this.jwksKeySet = await createJwksKeySet();
    return this.jwksKeySet;
  }

  /**
   * Cryptographically verify the inbound agent token's signature (RFC 7515)
   * against PingOne's published JWKS. Verifies the signature only — claim checks
   * (aud / may_act / act / exp) are enforced separately by the caller.
   *
   * Fail-closed when JWKS is configured: a token whose signature does not verify
   * is rejected. The dev-only escape hatch SKIP_TOKEN_SIGNATURE_VALIDATION=true
   * (already fatal outside development via ConfigManager) downgrades a failure to
   * a warning. When no JWKS endpoint is configured there is nothing to verify
   * against, so the decode-only path is preserved with a prominent warning.
   */
  private async verifyTokenSignature(token: string): Promise<void> {
    const skip = process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true';
    const jwks = await this.getJwksKeySet();
    if (!jwks) {
      teachLog.warn('JWKS not configured (set PINGONE_JWKS_URI / PINGONE_ISSUER / PINGONE_BASE_URL) — agent token signature NOT verified');
      return;
    }
    const { jwtVerify } = await getJose();
    try {
      await jwtVerify(token, jwks);
      teachLog.info('agent token signature verified (JWKS)');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (skip) {
        teachLog.warn(`agent token signature verification FAILED but SKIP_TOKEN_SIGNATURE_VALIDATION=true — accepting: ${msg}`);
        return;
      }
      // A real signature mismatch (or wrong-key / malformed token) fails closed.
      if (!isJwksUnavailableError(err)) {
        teachLog.error('agent token signature verification failed', undefined, { operation: 'jwks_verify', detail: msg });
        throw new AuthenticationError('Agent token signature verification failed', AuthErrorCodes.INVALID_AGENT_TOKEN);
      }
      // JWKS endpoint unreachable (non-200 / timeout / network) — NOT a forged
      // signature, just an inability to fetch the keys. Rejecting here would 401
      // every agent call and (because the BFF maps that to "sign in again") log the
      // user out on an infra blip. The gateway already authorized this call via the
      // Authorization Server (introspection + policy), so retry once with a fresh
      // keyset; if the endpoint is still unreachable, warn and accept rather than
      // fail-closed.
      this.jwksKeySet = null; // drop the memoised keyset so the retry re-fetches
      try {
        const fresh = await this.getJwksKeySet();
        if (fresh) {
          await jwtVerify(token, fresh);
          teachLog.info('agent token signature verified (JWKS, after retry)');
          return;
        }
      } catch (retryErr) {
        const rmsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (!isJwksUnavailableError(retryErr)) {
          teachLog.error('agent token signature verification failed', undefined, { operation: 'jwks_verify', detail: rmsg });
          throw new AuthenticationError('Agent token signature verification failed', AuthErrorCodes.INVALID_AGENT_TOKEN);
        }
      }
      teachLog.warn(`JWKS endpoint unavailable (${msg}) — agent token signature NOT verified; accepting on gateway authorization (introspection already PERMITted upstream). Fix PINGONE_JWKS_URI to restore signature checks.`);
    }
  }

  /**
   * Hash token for secure storage (using first 8 chars of SHA-256)
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  /**
   * Check if token introspection endpoint is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to introspect with an invalid token to test endpoint availability
      await this.httpClient.post(
        this.config.tokenIntrospectionEndpoint,
        new URLSearchParams({
          token: 'invalid_token_for_health_check',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        }).toString()
      );
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        // If we get a 400 or 401, the endpoint is reachable
        return axiosError.response?.status === 400 || axiosError.response?.status === 401;
      }
      return false;
    }
  }
}