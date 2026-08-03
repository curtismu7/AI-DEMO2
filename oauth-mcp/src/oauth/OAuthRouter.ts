import { IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';
import { URL } from 'url';
import { SigningKeyManager } from './SigningKeyManager';
import { ClientRegistry } from './ClientRegistry';
import { TokenStore } from './TokenStore';
import { TokenIssuer } from './TokenIssuer';

/**
 * OAuth 2.0 Authorization Server HTTP router.
 * Handles: metadata, jwks, authorize, token, introspect, revoke.
 */
export class OAuthRouter {
  private issuer: string;
  private tokenIssuer: TokenIssuer;

  constructor(
    private keyManager: SigningKeyManager,
    private clientRegistry: ClientRegistry,
    private tokenStore: TokenStore,
  ) {
    this.tokenIssuer = new TokenIssuer(keyManager, clientRegistry, tokenStore);
    this.issuer = this.tokenIssuer.getIssuer();
  }

  /** Returns true if this router handled the request */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    switch (path) {
      case '/.well-known/oauth-authorization-server':
        return this.handleMetadata(req, res);
      case '/jwks':
        return this.handleJWKS(req, res);
      case '/authorize':
        return this.handleAuthorize(req, res, url);
      case '/token':
        return this.handleToken(req, res);
      case '/introspect':
        return this.handleIntrospect(req, res);
      case '/revoke':
        return this.handleRevoke(req, res);
      case '/register':
        return this.handleRegister(req, res);
      default:
        return false;
    }
  }

  // --- RFC 8414: Authorization Server Metadata ---
  private handleMetadata(_req: IncomingMessage, res: ServerResponse): boolean {
    const metadata = {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      jwks_uri: `${this.issuer}/jwks`,
      introspection_endpoint: `${this.issuer}/introspect`,
      revocation_endpoint: `${this.issuer}/revoke`,
      registration_endpoint: `${this.issuer}/register`,
      scopes_supported: ['mcp:invoke', 'read', 'write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: `${this.issuer}/.well-known/mcp-server`,
    };
    this.json(res, 200, metadata);
    return true;
  }

  // --- RFC 7517: JSON Web Key Set ---
  private async handleJWKS(_req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const jwks = await this.keyManager.getJWKS();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    this.json(res, 200, jwks);
    return true;
  }

  // --- RFC 6749 §4.1: Authorization Endpoint ---
  private handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    if (req.method !== 'GET') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const responseType = url.searchParams.get('response_type');
    const scope = url.searchParams.get('scope') || 'mcp:invoke';
    const state = url.searchParams.get('state') || '';
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';

    if (!clientId || !redirectUri || responseType !== 'code') {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing required parameters' });
      return true;
    }

    const client = this.clientRegistry.getClient(clientId);
    if (!client) {
      this.json(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
      return true;
    }

    if (!client.redirect_uris.includes(redirectUri)) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'redirect_uri not registered' });
      return true;
    }

    if (!codeChallenge) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'PKCE code_challenge required' });
      return true;
    }

    // Auto-approve for demo — in production this would render a consent page
    const subject = url.searchParams.get('login_hint') || 'demo-user';
    const code = this.tokenStore.createCode({
      clientId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
      subject,
    });

    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (state) callback.searchParams.set('state', state);

    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
  }

  // --- RFC 6749 §5: Token Endpoint ---
  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get('grant_type');

    // Extract client credentials from Basic auth or body
    const { clientId, clientSecret } = this.extractClientAuth(req, params);

    if (!clientId) {
      this.json(res, 401, { error: 'invalid_client', error_description: 'Missing client authentication' });
      return true;
    }

    const client = this.clientRegistry.authenticateClient(clientId, clientSecret || undefined, 'token');
    if (!client) {
      this.json(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed' });
      return true;
    }

    if (!client.grant_types.includes(grantType || '')) {
      this.json(res, 400, { error: 'unauthorized_client', error_description: `Grant type '${grantType}' not allowed` });
      return true;
    }

    switch (grantType) {
      case 'client_credentials': {
        const scope = params.get('scope') || '';
        const tokenResponse = await this.tokenIssuer.issueClientCredentials(client, scope);
        this.json(res, 200, tokenResponse);
        return true;
      }
      case 'authorization_code': {
        const code = params.get('code');
        const redirectUri = params.get('redirect_uri');
        const codeVerifier = params.get('code_verifier');

        if (!code || !redirectUri) {
          this.json(res, 400, { error: 'invalid_request', error_description: 'Missing code or redirect_uri' });
          return true;
        }

        const authCode = this.tokenStore.consumeCode(code);
        if (!authCode) {
          this.json(res, 400, { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
          return true;
        }

        if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
          this.json(res, 400, { error: 'invalid_grant', error_description: 'Code was issued to a different client/redirect' });
          return true;
        }

        // PKCE verification
        if (!codeVerifier || !this.verifyPKCE(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          return true;
        }

        const tokenResponse = await this.tokenIssuer.issueAuthorizationCode(
          client, authCode.subject, authCode.scope,
        );
        this.json(res, 200, tokenResponse);
        return true;
      }
      default:
        this.json(res, 400, { error: 'unsupported_grant_type' });
        return true;
    }
  }

  // --- RFC 7662: Token Introspection ---
  private async handleIntrospect(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const token = params.get('token');

    if (!token) {
      this.json(res, 200, { active: false });
      return true;
    }

    const result = await this.tokenIssuer.introspect(token);
    this.json(res, 200, result);
    return true;
  }

  // --- RFC 7009: Token Revocation ---
  private async handleRevoke(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const token = params.get('token');

    if (token) {
      this.tokenIssuer.revoke(token);
    }
    // RFC 7009: always return 200
    res.writeHead(200);
    res.end();
    return true;
  }

  // --- RFC 7591: Dynamic Client Registration (simplified) ---
  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    const body = await this.readBody(req);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(body);
    } catch {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Invalid JSON' });
      return true;
    }

    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const grantTypes = (meta.grant_types as string[]) || ['authorization_code'];
    const redirectUris = (meta.redirect_uris as string[]) || [];

    const client = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: (meta.client_name as string) || 'Dynamic Client',
      grant_types: grantTypes,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: (meta.token_endpoint_auth_method as 'client_secret_basic') || 'client_secret_basic',
      scope: (meta.scope as string) || 'mcp:invoke',
    };

    this.clientRegistry.registerClient(client);

    this.json(res, 201, {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client.client_name,
      grant_types: client.grant_types,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope: client.scope,
    });
    return true;
  }

  // --- Helpers ---

  private verifyPKCE(verifier: string, challenge: string, method: string): boolean {
    if (method !== 'S256') return false;
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return computed === challenge;
  }

  private extractClientAuth(req: IncomingMessage, params: URLSearchParams): { clientId: string | null; clientSecret: string | null } {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [id, secret] = decoded.split(':');
      return { clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) };
    }
    return {
      clientId: params.get('client_id'),
      clientSecret: params.get('client_secret'),
    };
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  }
}
