import { IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';
import { URL } from 'url';
import axios from 'axios';
import { SigningKeyManager } from './SigningKeyManager';
import { ClientRegistry, OAuthClient, openClientRegistrationEnabled, openRegistrationScope } from './ClientRegistry';
import { TokenStore } from './TokenStore';
import { TokenIssuer } from './TokenIssuer';
import { createJwksKeySet, getJose } from '../auth/jwks';
import {
  verifyIdJag, IdJagError, JWT_BEARER_GRANT, ID_JAG_GRANT_PROFILE, VerifyOpts,
} from './IdJagGrantHandler';
import { resolveAudience } from './TokenIssuer';

/**
 * Native ID-JAG (MCP Enterprise-Managed Authorization) engages only when BOTH
 * the enterprise IdP's issuer and its JWKS endpoint are configured. Both are
 * unset by default, so the demo's RFC 8693 stand-in path is unaffected.
 */
export function nativeIdJagEnabled(): boolean {
  return Boolean(process.env.ENTERPRISE_IDP_ISSUER && process.env.ENTERPRISE_IDP_JWKS_URL);
}

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
      case '/authorize/callback':
        return this.handleAuthorizeCallback(req, res, url);
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
      // jwt-bearer is advertised only when we would actually honour it — a
      // client that sees it here will present an ID-JAG instead of redirecting.
      grant_types_supported: nativeIdJagEnabled()
        ? ['authorization_code', 'client_credentials', JWT_BEARER_GRANT]
        : ['authorization_code', 'client_credentials'],
      ...(nativeIdJagEnabled()
        ? { authorization_grant_profiles_supported: [ID_JAG_GRANT_PROFILE] }
        : {}),
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: `${this.issuer}/.well-known/mcp-server`,
      // Advertised only when actually honoured — a client that sees this true
      // will skip registration and present a URL as its client_id.
      client_id_metadata_document_supported: openClientRegistrationEnabled(),
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
  private async handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
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

    const client = await this.clientRegistry.resolveClient(clientId);
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

    const pingOneClientId = process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const pingOneAuthEndpoint = process.env.PINGONE_AUTHORIZATION_ENDPOINT;
    if (!pingOneClientId || !pingOneAuthEndpoint) {
      this.json(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'PingOne federation is not configured (OAUTH_MCP_PINGONE_CLIENT_ID / PINGONE_AUTHORIZATION_ENDPOINT)',
      });
      return true;
    }

    // oauth-mcp is a PUBLIC-shaped RP on this outbound hop and the setup docs
    // tell the operator to create the PingOne app with PKCE enabled, so send a
    // fresh S256 challenge of our own. This is entirely separate from the
    // downstream client's PKCE (`codeChallenge` above) — two independent
    // exchanges, two independent verifiers.
    const pingOneCodeVerifier = crypto.randomBytes(32).toString('base64url');
    const pingOneCodeChallenge = crypto.createHash('sha256').update(pingOneCodeVerifier).digest('base64url');

    // Bind this pending request to a state WE generate. The client's own
    // `state` travels with it in TokenStore but is never sent to PingOne as
    // the outbound state — a malicious redirect_uri must not be able to
    // observe or replay it against PingOne.
    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod, clientState: state,
      pingOneCodeVerifier,
    });

    const callbackUri = `${this.issuer}/authorize/callback`;
    const pingOneAuthorize = new URL(pingOneAuthEndpoint);
    pingOneAuthorize.searchParams.set('client_id', pingOneClientId);
    pingOneAuthorize.searchParams.set('redirect_uri', callbackUri);
    pingOneAuthorize.searchParams.set('response_type', 'code');
    pingOneAuthorize.searchParams.set('scope', 'openid profile email');
    pingOneAuthorize.searchParams.set('state', relayState);
    pingOneAuthorize.searchParams.set('code_challenge', pingOneCodeChallenge);
    pingOneAuthorize.searchParams.set('code_challenge_method', 'S256');

    res.writeHead(302, { Location: pingOneAuthorize.toString() });
    res.end();
    return true;
  }

  // --- PingOne redirect-federation callback: exchanges PingOne's code, then
  // mints THIS AS's own code for the original DCR-registered client. ---
  private async handleAuthorizeCallback(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const code = url.searchParams.get('code');
    const relayState = url.searchParams.get('state');
    const pingOneError = url.searchParams.get('error');

    if (pingOneError) {
      this.json(res, 400, { error: 'access_denied', error_description: `PingOne login failed: ${pingOneError}` });
      return true;
    }
    if (!code || !relayState) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing code or state from PingOne callback' });
      return true;
    }

    const pending = this.tokenStore.consumePendingAuthorization(relayState);
    if (!pending) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Unknown or expired authorization request' });
      return true;
    }

    const pingOneClientId = process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const pingOneClientSecret = process.env.OAUTH_MCP_PINGONE_CLIENT_SECRET;
    const pingOneTokenEndpoint = process.env.PINGONE_TOKEN_ENDPOINT;
    if (!pingOneClientId || !pingOneClientSecret || !pingOneTokenEndpoint) {
      this.json(res, 503, { error: 'temporarily_unavailable', error_description: 'PingOne federation is not configured' });
      return true;
    }

    let subject: string;
    try {
      const callbackUri = `${this.issuer}/authorize/callback`;
      const tokenResponse = await axios.post(
        pingOneTokenEndpoint,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUri,
          client_id: pingOneClientId,
          client_secret: pingOneClientSecret,
          code_verifier: pending.pingOneCodeVerifier,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const pingOneAccessToken = tokenResponse.data.access_token as string;
      const jwks = await createJwksKeySet();
      if (!jwks) {
        throw new Error('PingOne JWKS not configured (PINGONE_JWKS_URI / PINGONE_ISSUER / PINGONE_BASE_URL)');
      }
      const { jwtVerify } = await getJose();
      // Bind the verification to the expected issuer when one is configured. A
      // valid signature alone only proves "some key in that JWKS signed this";
      // the `iss` check is what makes it "PingOne, the tenant we federate to".
      // Passing `{ issuer: undefined }` is NOT equivalent to omitting the
      // options object across jose versions, so branch rather than pass it in.
      const expectedIssuer = process.env.PINGONE_ISSUER;
      const { payload } = expectedIssuer
        ? await jwtVerify(pingOneAccessToken, jwks, { issuer: expectedIssuer })
        : await jwtVerify(pingOneAccessToken, jwks);
      if (!payload.sub) {
        throw new Error('PingOne access token has no sub claim');
      }
      subject = payload.sub as string;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.json(res, 502, { error: 'server_error', error_description: `PingOne login verification failed: ${msg}` });
      return true;
    }

    const ownCode = this.tokenStore.createCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      subject,
    });

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set('code', ownCode);
    if (pending.clientState) callback.searchParams.set('state', pending.clientState);

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

    await this.clientRegistry.resolveClient(clientId);
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
      case JWT_BEARER_GRANT: {
        if (!nativeIdJagEnabled()) {
          this.json(res, 400, { error: 'unsupported_grant_type' });
          return true;
        }
        const assertion = params.get('assertion');
        if (!assertion) {
          this.json(res, 400, { error: 'invalid_request', error_description: 'assertion is required' });
          return true;
        }
        const outcome = await this.redeemIdJag(assertion, client);
        this.json(res, outcome.status, outcome.body);
        return true;
      }
      default:
        this.json(res, 400, { error: 'unsupported_grant_type' });
        return true;
    }
  }

  /** Verification inputs for an inbound ID-JAG. */
  private idJagVerifyOpts(): VerifyOpts {
    return {
      idpIssuer: process.env.ENTERPRISE_IDP_ISSUER as string,
      ownIssuer: this.issuer,
      acceptedResources: resolveAudience(),
      getKey: (async (protectedHeader: unknown) => {
        const { createRemoteJWKSet } = await getJose();
        const keySet = createRemoteJWKSet(new URL(process.env.ENTERPRISE_IDP_JWKS_URL as string));
        return (keySet as unknown as (h: unknown) => Promise<never>)(protectedHeader);
      }) as VerifyOpts['getKey'],
    };
  }

  /**
   * Redeem a verified ID-JAG for an access token (MCP Enterprise-Managed
   * Authorization). No browser redirect is involved: the enterprise IdP has
   * already evaluated policy, and this endpoint only honours what it signed.
   *
   * issueAuthorizationCode is reused deliberately — it already sets an arbitrary
   * subject and clamps the requested scope to the client's registered scope via
   * resolveScope. Passing the assertion's scope through therefore yields exactly
   * the intersection the extension requires (assertion AND client), so no
   * separate issuer method is needed.
   */
  private async redeemIdJag(
    assertion: string,
    client: OAuthClient,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      const claims = await verifyIdJag(assertion, this.idJagVerifyOpts());
      // Account linking, per the extension: `sub` is the stable primary
      // identifier; `email` is only a fallback for accounts predating
      // enterprise-managed authorization.
      const subject = claims.sub || claims.email;
      if (!subject) {
        return {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'ID-JAG carries neither sub nor email' },
        };
      }
      const tokenResponse = await this.tokenIssuer.issueAuthorizationCode(client, subject, claims.scope);
      return { status: 200, body: tokenResponse as unknown as Record<string, unknown> };
    } catch (err) {
      const oauthError = err instanceof IdJagError ? err.oauthError : 'invalid_grant';
      return { status: 400, body: { error: oauthError, error_description: (err as Error).message } };
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

    // RFC 7591 §3.1 initial access token. Open registration would let any caller
    // mint a client and name its own `scope`, which /token then honours — so the
    // endpoint stays CLOSED until an operator provisions the secret, mirroring
    // how /authorize refuses to run without its PingOne federation env vars.
    //
    // MCP_OPEN_CLIENT_REGISTRATION is the deliberate exception: ChatGPT and
    // Claude cannot be pre-registered and offer no field for an initial access
    // token, so admitting them means opening this endpoint. The escalation the
    // gate protected against is closed a different way below — the granted
    // scope is pinned server-side instead of read from the request.
    const initialAccessToken = process.env.DCR_INITIAL_ACCESS_TOKEN;
    const openRegistration = openClientRegistrationEnabled();
    if (!initialAccessToken && !openRegistration) {
      this.json(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'Dynamic client registration is not configured (DCR_INITIAL_ACCESS_TOKEN)',
      });
      return true;
    }

    // A provisioned initial access token is still enforced when present: opening
    // registration is opt-in, and turning it on must not silently drop a check
    // an operator deliberately configured.
    if (initialAccessToken) {
      const authHeader = req.headers['authorization'] || '';
      const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!presented || !this.secretEquals(presented, initialAccessToken)) {
        this.json(res, 401, {
          error: 'invalid_token',
          error_description: 'Registration requires a valid initial access token (Authorization: Bearer <DCR_INITIAL_ACCESS_TOKEN>)',
        });
        return true;
      }
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
      // An operator-authorised registration may name its own scope; a caller
      // that walked in off the internet may not.
      scope: initialAccessToken ? ((meta.scope as string) || 'mcp:invoke') : openRegistrationScope(),
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

  /** Constant-time compare for a shared secret — length is compared first
   *  because timingSafeEqual throws on mismatched buffer lengths. */
  private secretEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

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
