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
      .setAudience(process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo')
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
    scope: string,
  ): Promise<TokenResponse> {
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
      .setAudience(process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo')
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
