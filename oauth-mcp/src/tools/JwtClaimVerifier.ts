/**
 * Verifies JWT claims on bearer tokens for sensitive banking tools.
 * Owns: SENSITIVE_HANDLERS set, the JWKS RemoteKeySet memo (instance-scoped),
 * decodePayload (unsigned JWT body decode), assertClaims (exp/iss/aud + JWKS sig, fail-open).
 *
 * SECURITY NOTE: decodePayload is intentionally an unsigned decode — the token was issued by
 * PingOne during RFC 8693 exchange and signature was validated upstream. Claim inspection only.
 *
 * Extracted verbatim from BankingToolProvider (module-level jwks memo + getJwksKeySet,
 * SENSITIVE_HANDLERS, decodeJwtPayload, assertTokenClaims). Behavior is identical.
 *
 * jose v6+ is ESM-only; loaded via dynamic import() to stay compatible with CJS compilation.
 */
import { Logger } from '../utils/Logger';
import { AuthenticationError, AuthErrorCodes } from '../interfaces/auth';
import { getJose, createJwksKeySet, JoseModule } from '../auth/jwks';

const SENSITIVE_HANDLERS = new Set<string>([
  'executeGetSensitiveAccountDetails',
  'executeCreateTransfer',
  'executeCreateWithdrawal',
  'executeCreateDeposit',
]);

export class JwtClaimVerifier {
  // Memoised JWKS keyset — recreated lazily per instance.
  private jwksKeySet: Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null = null;

  constructor(private logger: Logger) {}

  isSensitiveHandler(handlerName: string): boolean {
    return SENSITIVE_HANDLERS.has(handlerName);
  }

  decodePayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async assertClaims(token: string, toolName: string): Promise<void> {
    // ── Structural local check (exp/iss/aud) ───────────────────────────────────
    const payload = this.decodePayload(token);
    if (!payload) return; // opaque token — skip all checks

    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    const iss = typeof payload.iss === 'string' ? payload.iss : null;
    const aud = payload.aud;

    if (exp !== null && exp < now) {
      throw new AuthenticationError(
        `Token for '${toolName}' has expired (exp: ${new Date(exp * 1000).toISOString()})`,
        AuthErrorCodes.TOKEN_EXPIRED
      );
    }

    if (!iss) {
      this.logger.warn(`[BankingToolProvider] Token for sensitive tool '${toolName}' has no iss claim`);
    }

    // MCP server resource URI — tokens arriving here must be issued for this service.
    // Reads PINGONE_RESOURCE_MCP_SERVER_URI (set by bootstrapPingOne), MCP_SERVER_RESOURCE_URI
    // (docker-compose.yml's own name for this — see its comment there: RFC 8693 rollout,
    // comma-separated, "mcpserver.ping.demo,mcpgateway.ping.demo"), or the legacy
    // MCP_RESOURCE_URI alias, in that order. When configured the check is mandatory and
    // fail-hard: a mismatched or absent aud on a sensitive-tool token is an authentication
    // error, not just a warning, because it could indicate token replay from another service.
    //
    // docker-compose.yml's environment: block only sets MCP_SERVER_RESOURCE_URI for this
    // service, not MCP_RESOURCE_URI — so MCP_RESOURCE_URI comes solely from
    // oauth-mcp/.env, which still pins it to the old single value
    // ("mcpgateway.ping.demo"). Without checking MCP_SERVER_RESOURCE_URI first this fell
    // through to that stale single value — which never matches this server's real aud
    // (mcpserver.ping.demo) — and every
    // sensitive banking write (create_transfer, create_withdrawal, create_deposit) failed
    // with a false "aud mismatch" AuthenticationError before the transfer logic ever ran.
    // See UC22. The value can also be a comma-separated list, so split it either way.
    const expectedAudRaw =
      process.env.PINGONE_RESOURCE_MCP_SERVER_URI ||
      process.env.MCP_SERVER_RESOURCE_URI ||
      process.env.MCP_RESOURCE_URI ||
      process.env.BANKING_API_RESOURCE_URI || // legacy alias kept for backwards compat
      null;
    const expectedAudList = expectedAudRaw
      ? expectedAudRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (expectedAudRaw) {
      const audArray: string[] = aud
        ? (Array.isArray(aud) ? (aud as string[]) : [aud as string])
        : [];

      if (audArray.length === 0) {
        throw new AuthenticationError(
          `Token for sensitive tool '${toolName}' is missing the aud claim (expected one of '${expectedAudList.join(', ')}')`,
          AuthErrorCodes.INVALID_TOKEN
        );
      }

      if (!audArray.some((a) => expectedAudList.includes(a))) {
        throw new AuthenticationError(
          `Token aud [${audArray.join(', ')}] does not match MCP server audience (expected one of '${expectedAudList.join(', ')}') for '${toolName}'`,
          AuthErrorCodes.INVALID_TOKEN
        );
      }

      this.logger.debug(`[BankingToolProvider] Audience check passed for '${toolName}': aud includes one of '${expectedAudList.join(', ')}'`);
    }

    // ── JWKS Cryptographic Signature Verification (RFC 7515) ──────────────────
    // Verify the MCP token's RS256/ES256 signature using PingOne's published JWKS.
    // Fail-open: JWKS failures are logged but never block the tool call — the BFF
    // already performed JWKS verification before issuing this token to the MCP server.
    const jwks = await this.getJwksKeySet();
    if (jwks) {
      try {
        const { jwtVerify } = await getJose();
        const verifyOpts: Parameters<typeof jwtVerify>[2] = {};
        if (expectedAudList.length > 0) verifyOpts.audience = expectedAudList;
        if (iss) verifyOpts.issuer = iss;
        await jwtVerify(token, jwks, verifyOpts);
        this.logger.info(`[BankingToolProvider] JWKS sig ✅ verified for sensitive tool '${toolName}'`);
      } catch (jwksErr) {
        const msg = jwksErr instanceof Error ? jwksErr.message : String(jwksErr);
        // JWTExpired is already caught above — ignore it here to avoid double-log
        if (!msg.includes('expired')) {
          // STRICT_TOKEN_VERIFICATION=true promotes JWKS failures to hard errors.
          // Leave unset (default fail-open) when the BFF already verified the signature upstream.
          if (process.env.STRICT_TOKEN_VERIFICATION === 'true') {
            throw new Error(`Token signature verification failed for '${toolName}': ${msg}`);
          }
          this.logger.warn(`[BankingToolProvider] JWKS sig ⚠ warning for '${toolName}': ${msg} (fail-open)`);
        }
      }
    } else {
      this.logger.debug(`[BankingToolProvider] JWKS not configured — skipping sig verification for '${toolName}'`);
    }
  }

  private async getJwksKeySet(): Promise<Awaited<ReturnType<JoseModule['createRemoteJWKSet']>> | null> {
    if (this.jwksKeySet) return this.jwksKeySet;
    this.jwksKeySet = await createJwksKeySet();
    return this.jwksKeySet;
  }
}
