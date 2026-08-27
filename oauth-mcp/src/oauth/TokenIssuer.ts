import * as jose from 'jose';
import * as crypto from 'crypto';
import { SigningKeyManager } from './SigningKeyManager';
import { ClientRegistry, OAuthClient } from './ClientRegistry';
import { TokenStore } from './TokenStore';
import { resolveEmbeddedIssuer } from './embeddedIssuer';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

/** MCP_SERVER_RESOURCE_URI may be a comma-separated list (rollout: own backend
 *  URI + gateway URI while both token shapes are live) — jose needs an array
 *  to emit a multi-value `aud` claim, not the raw comma-joined string. */
export function resolveAudience(): string[] {
  const raw = process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** The ONLY audience this embedded AS is entitled to assert: its own resource
 *  URI — the first entry of MCP_SERVER_RESOURCE_URI. The remaining entries name
 *  OTHER resource servers (the gateway, PingOne's API); this AS has no authority
 *  to grant access to them, so a self-issued token must never claim them. The
 *  full list stays the *accepted* set on the inbound side (see
 *  TokenIntrospector.audienceAccepted), which is a different question. */
export function resolveOwnAudience(): string {
  // Prefer the dedicated var, matching the precedence every other "what is MY
  // resource URI" resolver in this service already uses (JwtClaimVerifier:
  // PINGONE_RESOURCE_MCP_SERVER_URI || MCP_SERVER_RESOURCE_URI || ...). Taking
  // MCP_SERVER_RESOURCE_URI[0] positionally is correct in every shipped config
  // today, but it silently becomes wrong the moment that list is reordered —
  // and the entries after the first name OTHER resource servers, so a
  // reordering would have this AS assert an audience it has no authority over.
  // Unset everywhere today, so this is inert until someone sets it.
  const dedicated = (process.env.PINGONE_RESOURCE_MCP_SERVER_URI || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return dedicated || resolveAudience()[0] || 'mcpserver.ping.demo';
}

export class TokenIssuer {
  private issuer: string;

  constructor(
    private keyManager: SigningKeyManager,
    private clientRegistry: ClientRegistry,
    private tokenStore: TokenStore,
  ) {
    this.issuer = resolveEmbeddedIssuer();
  }

  getIssuer(): string {
    return this.issuer;
  }

  async issueClientCredentials(client: OAuthClient, requestedScope: string): Promise<TokenResponse> {
    const scope = this.resolveScope(client, requestedScope);
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;

    const token = await new jose.SignJWT({
      scope,
      client_id: client.client_id,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.keyManager.getKid() })
      .setIssuer(this.issuer)
      .setSubject(client.client_id)
      .setAudience(resolveOwnAudience())
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(jti)
      .sign(this.keyManager.getPrivateKey());

    this.tokenStore.trackToken({
      jti,
      clientId: client.client_id,
      subject: client.client_id,
      scope,
      issuedAt: now,
      expiresAt: now + expiresIn,
      revoked: false,
    });

    return { access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope };
  }

  async issueAuthorizationCode(
    client: OAuthClient,
    subject: string,
    requestedScope: string,
    pingOneAccessToken?: string,
  ): Promise<TokenResponse> {
    // Same intersection issueClientCredentials does: the scope that travelled
    // through /authorize is CLIENT-CONTROLLED input, so it must be clamped to
    // what the client is actually registered for. Without this,
    // `/authorize?...&scope=admin:read` mints an admin-scoped token for a client
    // registered with only `mcp:invoke`.
    const scope = this.resolveScope(client, requestedScope);
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;

    const token = await new jose.SignJWT({
      scope,
      client_id: client.client_id,
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.keyManager.getKid() })
      .setIssuer(this.issuer)
      .setSubject(subject)
      .setAudience(resolveOwnAudience())
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(jti)
      .sign(this.keyManager.getPrivateKey());

    this.tokenStore.trackToken({
      jti,
      clientId: client.client_id,
      subject,
      scope,
      issuedAt: now,
      expiresAt: now + expiresIn,
      revoked: false,
      pingOneAccessToken,
    });

    return { access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope };
  }

  async introspect(token: string): Promise<Record<string, unknown>> {
    try {
      const { payload } = await jose.jwtVerify(token, this.keyManager.getPublicKey(), {
        issuer: this.issuer,
      });
      const jti = payload.jti as string;
      if (this.tokenStore.isRevoked(jti)) {
        return { active: false };
      }
      return {
        active: true,
        scope: payload.scope,
        client_id: payload.client_id,
        sub: payload.sub,
        aud: payload.aud,
        iss: payload.iss,
        exp: payload.exp,
        iat: payload.iat,
        jti,
        token_type: 'Bearer',
      };
    } catch {
      return { active: false };
    }
  }

  revoke(token: string): boolean {
    try {
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload.jti) {
        return this.tokenStore.revoke(payload.jti);
      }
    } catch { /* invalid token format */ }
    return false;
  }

  private resolveScope(client: OAuthClient, requested: string): string {
    const allowed = new Set(client.scope.split(' '));
    const requestedScopes = requested ? requested.split(' ') : [];
    if (requestedScopes.length === 0) return client.scope;
    return requestedScopes.filter(s => allowed.has(s)).join(' ') || client.scope;
  }
}
