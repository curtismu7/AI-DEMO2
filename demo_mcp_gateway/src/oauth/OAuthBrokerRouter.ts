import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';
import axios from 'axios';
import { ClientRegistry, InvalidRedirectUriError } from './ClientRegistry';
import { BrokerTokenStore } from './BrokerTokenStore';
import { selfBaseUrl } from '../selfBaseUrl';

/**
 * OAuth 2.1 Authorization Server for external MCP clients (LM Studio,
 * Cursor, etc.) reaching this gateway over HTTP. Ported pattern from
 * oauth-mcp's OAuthRouter — see the design spec for what's deliberately NOT
 * ported (TokenIssuer, SigningKeyManager, IdJagGrantHandler, CIMD): this
 * broker relays PingOne's real access token instead of self-issuing one.
 */
export class OAuthBrokerRouter {
  constructor(
    private clientRegistry: ClientRegistry,
    private tokenStore: BrokerTokenStore,
    private gatewayResourceUri: string,
  ) {}

  /** Returns true if this router handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    switch (url.pathname) {
      case '/.well-known/oauth-authorization-server':
        return this.handleMetadata(req, res);
      case '/oauth/register':
        return this.handleRegister(req, res);
      case '/oauth/authorize':
        return this.handleAuthorize(req, res, url);
      case '/oauth/callback':
        return this.handleCallback(req, res, url);
      default:
        return false;
    }
  }

  private issuer(req: IncomingMessage): string {
    return selfBaseUrl(req, process.env.PORT || 3005);
  }

  // --- RFC 8414 ---
  private handleMetadata(req: IncomingMessage, res: ServerResponse): boolean {
    const issuer = this.issuer(req);
    this.json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ['mcp:invoke'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    });
    return true;
  }

  // --- RFC 7591 (open — see ClientRegistry.brokerRegistrationScope for why) ---
  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') return false;
    const body = await this.readBody(req);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(body || '{}');
    } catch {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Invalid JSON' });
      return true;
    }
    try {
      const client = this.clientRegistry.registerClient({
        client_name: meta.client_name as string | undefined,
        redirect_uris: (meta.redirect_uris as string[]) || [],
        grant_types: meta.grant_types as string[] | undefined,
      });
      this.json(res, 201, {
        client_id: client.client_id,
        client_name: client.client_name,
        grant_types: client.grant_types,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
      });
    } catch (err) {
      if (err instanceof InvalidRedirectUriError) {
        this.json(res, 400, { error: 'invalid_redirect_uri', error_description: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  // --- The two-hop PingOne redirect ---
  //
  // Two PKCE pairs and two `state` values are in flight here, and they must
  // never be confused with each other:
  //   - `codeChallenge`/`codeChallengeMethod` (+ the inbound `state` query
  //     param, stored as `clientState`) belong to the EXTERNAL client's own
  //     PKCE handshake against this broker.
  //   - `pingOneCodeVerifier`/`pingOneCodeChallenge` are a SEPARATE PKCE pair
  //     the broker generates for its own hop to PingOne.
  //   - `relayState` is the broker's own `state` param sent to PingOne (and
  //     the key under which the pending authorization is stored) — distinct
  //     from `clientState`, which is only ever relayed back to the external
  //     client's redirect_uri, never sent to PingOne.

  private async handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const responseType = url.searchParams.get('response_type');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
    const clientState = url.searchParams.get('state') || '';
    const scope = url.searchParams.get('scope') || 'mcp:invoke';

    if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge) {
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

    const pingOneClientId = process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID;
    const envId = process.env.PINGONE_ENVIRONMENT_ID;
    const region = process.env.PINGONE_REGION || 'com';
    if (!pingOneClientId || !envId) {
      this.json(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'PingOne federation is not configured (GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID / PINGONE_ENVIRONMENT_ID)',
      });
      return true;
    }

    // Broker's own PKCE for its hop to PingOne — independent of the external
    // client's PKCE (codeChallenge above). Two separate exchanges.
    const pingOneCodeVerifier = crypto.randomBytes(32).toString('base64url');
    const pingOneCodeChallenge = crypto.createHash('sha256').update(pingOneCodeVerifier).digest('base64url');

    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod,
      clientState, pingOneCodeVerifier,
    });

    const issuer = this.issuer(req);
    const pingOneAuthorize = new URL(`https://auth.pingone.${region}/${envId}/as/authorize`);
    pingOneAuthorize.searchParams.set('client_id', pingOneClientId);
    pingOneAuthorize.searchParams.set('redirect_uri', `${issuer}/oauth/callback`);
    pingOneAuthorize.searchParams.set('response_type', 'code');
    pingOneAuthorize.searchParams.set('state', relayState);
    pingOneAuthorize.searchParams.set('code_challenge', pingOneCodeChallenge);
    pingOneAuthorize.searchParams.set('code_challenge_method', 'S256');
    pingOneAuthorize.searchParams.set('resource', this.gatewayResourceUri);
    // `mcp:invoke` is the scope c8392dc4's grant on the Agent Gateway resource
    // actually owns (confirmed via mcp__pingone__listApplicationGrants) — the
    // `resource` param alone does not audience the token; the scope list must
    // include a scope that resource owns, or PingOne issues a token audienced
    // to its own default instead of gatewayResourceUri.
    pingOneAuthorize.searchParams.set('scope', 'openid profile email mcp:invoke');

    res.writeHead(302, { Location: pingOneAuthorize.toString() });
    res.end();
    return true;
  }

  private async handleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
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

    const pingOneClientId = process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID;
    const envId = process.env.PINGONE_ENVIRONMENT_ID;
    const region = process.env.PINGONE_REGION || 'com';
    if (!pingOneClientId || !envId) {
      this.json(res, 503, { error: 'temporarily_unavailable', error_description: 'PingOne federation is not configured' });
      return true;
    }

    let pingOneAccessToken: string;
    let expiresIn: number;
    try {
      const issuer = this.issuer(req);
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${issuer}/oauth/callback`,
        client_id: pingOneClientId,
        code_verifier: pending.pingOneCodeVerifier,
        resource: this.gatewayResourceUri,
      });
      const tokenResponse = await axios.post(
        `https://auth.pingone.${region}/${envId}/as/token`,
        tokenParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      pingOneAccessToken = tokenResponse.data.access_token as string;
      expiresIn = (tokenResponse.data.expires_in as number) || 3600;
      if (!pingOneAccessToken) throw new Error('PingOne token response had no access_token');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.json(res, 502, { error: 'server_error', error_description: `PingOne token exchange failed: ${msg}` });
      return true;
    }

    const ownCode = this.tokenStore.createCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      pingOneAccessToken,
      pingOneExpiresIn: expiresIn,
    });

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set('code', ownCode);
    if (pending.clientState) callback.searchParams.set('state', pending.clientState);
    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
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
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
}
