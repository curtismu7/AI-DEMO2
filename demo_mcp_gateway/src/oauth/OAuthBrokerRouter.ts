import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import * as crypto from 'crypto';
import axios from 'axios';
import { ClientRegistry, InvalidRedirectUriError } from './ClientRegistry';
import { BrokerTokenStore } from './BrokerTokenStore';
import { selfBaseUrl } from '../selfBaseUrl';
import { resolveAuthorizeParams } from './brokerPrompt';
import { emitHop } from '../transactionHop';

/** Identity claims worth putting on an audit record. Deliberately a small
 *  allowlist: the ledger is a readable surface, so nothing beyond these — and
 *  never the token itself — leaves this function. */
const IDENTITY_CLAIMS = ['sub', 'preferred_username', 'email', 'auth_time', 'amr', 'acr'] as const;

/**
 * Pull display claims out of an ID token WITHOUT verifying it.
 *
 * Safe here and only here: this token came straight back from PingOne over TLS
 * in an exchange we initiated moments ago, and the result is used purely to
 * label an audit hop — never to authorize anything. Returns {} on any problem,
 * because a malformed token must degrade the trace, not fail the login.
 */
function readIdentityClaims(idToken?: string): Record<string, unknown> {
  if (!idToken) return {};
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return {};
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of IDENTITY_CLAIMS) {
      if (claims[key] !== undefined) out[key] = claims[key];
    }
    return out;
  } catch {
    return {};
  }
}

/** Façade Privilege door paths: /mcp-facade/privilege-gateway[/<app>]/mcp. */
const PRIVILEGE_DOOR_PATH = /^\/mcp-facade\/privilege-gateway(?:\/([A-Za-z0-9._-]{1,64}))?\/mcp$/;

/** Cookie carrying the Privilege link's browser-bound nonce. Path-scoped to
 *  /oauth so it rides the resume redirect and nothing else. No `Secure`: the
 *  broker is served over plain HTTP on localhost:3005 in this demo, and a
 *  Secure cookie would simply never be sent. */
const LINK_NONCE_COOKIE = 'pgw_link';

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * The Agentic App a client's `resource` names when it is the façade's Privilege
 * door: the app segment, '' for the bare door (the BFF then uses its default
 * app), or null for any other resource.
 */
export function privilegeLinkApp(resource?: string): string | null {
  if (!resource) return null;
  let path: string;
  try { path = new URL(resource).pathname; } catch { return null; }
  const match = PRIVILEGE_DOOR_PATH.exec(path);
  return match ? (match[1] || '') : null;
}

/** Both legs of the Privilege link, or none. The redirect leg on its own sends a
 *  browser through a gateway sign-in whose commit leg then refuses it, so every
 *  connect fails instead of degrading. The metadata, the authorize cookie and the
 *  callback chain must all give the same answer or they drift apart again. */
function privilegeLinkConfigured(): boolean {
  return Boolean(process.env.BFF_PRIVILEGE_LINK_URL && process.env.BFF_PRIVILEGE_LINK_COMMIT_URL);
}

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
    // Advertised in RFC 8414 scopes_supported; spec-following clients (MCP SDK,
    // LM Studio) request exactly this list when they have no scope of their own.
    private scopesSupported: string[] = ['mcp:invoke'],
    // Must match demo_api_server/utils/internalSecret.js DEFAULT_INTERNAL_SECRET.
    private bffInternalSecret: string = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me',
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
      case '/oauth/resume':
        return this.handleResume(req, res, url);
      case '/oauth/token':
        return this.handleToken(req, res);
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
      scopes_supported: this.scopesSupported,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      // Non-standard, on purpose: the BFF façade cannot see this service's env,
      // and a 401 that assumes the chain exists would loop a client through
      // sign-ins that cannot restore the gateway leg.
      privilege_link_supported: privilegeLinkConfigured(),
    });
    return true;
  }

  // --- RFC 7591 (open — see ClientRegistry.resolveRequestedScope for the
  // loopback-only, bounded-scope trust model this implies) ---
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
        scope: meta.scope as string | undefined,
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
    const resource = url.searchParams.get('resource') || undefined;

    if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing required parameters' });
      return true;
    }
    let client = this.clientRegistry.getClient(clientId);
    if (!client) {
      // Unknown id + loopback redirect = a client that registered before the
      // gateway restarted (in-memory registry). Adopt it; see ClientRegistry.
      try {
        client = this.clientRegistry.adoptClient({ client_id: clientId, redirect_uris: [redirectUri], scope });
      } catch (err) {
        if (!(err instanceof InvalidRedirectUriError)) throw err;
        this.json(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
        return true;
      }
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

    // One ledger record spans the whole login: this id is minted here, carried
    // on the pending record across the PingOne round trip, and reused by the
    // callback so "who asked" and "who came back" sit on one trace.
    const correlationId = crypto.randomUUID();
    // Only a chained Privilege door needs the binding; every other authorize is
    // untouched.
    const willChainLink = privilegeLinkApp(resource) !== null && privilegeLinkConfigured();
    const linkNonce = willChainLink ? crypto.randomBytes(32).toString('base64url') : undefined;
    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod,
      clientState, pingOneCodeVerifier, correlationId, resource, linkNonce,
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
    // Forward what the client asked for: the gateway's tool policy gates on
    // these (get_my_accounts needs `read`; a token with only mcp:invoke is
    // refused with insufficient_scope — seen live 2026-08-24). `mcp:invoke`
    // is always included because it is the scope c8392dc4's grant on the
    // Agent Gateway resource owns — the `resource` param alone does not
    // audience the token. PingOne silently drops scopes the app is not
    // granted (profile/email were), so an over-ask is harmless.
    const pingOneScopes = new Set(['openid', ...scope.split(/\s+/).filter(Boolean), 'mcp:invoke']);
    pingOneAuthorize.searchParams.set('scope', [...pingOneScopes].join(' '));

    // Send nothing and PingOne silently re-authenticates against whatever SSO
    // session the browser already holds, so an MCP client adopts the current user
    // with no login screen and nothing reveals whose identity is on the token.
    // The BFF decides how strict to be (default: max_age, so the first door
    // prompts and the rest ride that login).
    const reauthParams = await resolveAuthorizeParams();
    for (const [k, v] of Object.entries(reauthParams)) {
      pingOneAuthorize.searchParams.set(k, v);
    }

    // The login leg, on the record. Until this existed the ledger only saw a
    // transaction once the client was ALREADY authenticated, so the moment that
    // decides whose identity the rest of the chain runs as had no trace at all.
    emitHop({
      phase: 'oauth.authorize',
      correlationId,
      op: 'authorize',
      status: 'ok',
      identity: { clientId },
      // What we asked PingOne for, so a silent SSO reuse is distinguishable from
      // a real login after the fact — that is the whole point of mcp_broker_prompt.
      params: { scope, reauth: reauthParams },
    });

    const authorizeHeaders: Record<string, string> = { Location: pingOneAuthorize.toString() };
    if (linkNonce) {
      authorizeHeaders['Set-Cookie'] = `${LINK_NONCE_COOKIE}=${linkNonce}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600`;
    }
    res.writeHead(302, authorizeHeaders);
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
    let idTokenClaims: Record<string, unknown> = {};
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
      idTokenClaims = readIdentityClaims(tokenResponse.data.id_token as string | undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitHop({
        phase: 'oauth.callback',
        correlationId: pending.correlationId,
        op: 'token-exchange',
        status: 'error',
        details: { error: msg },
      });
      this.json(res, 502, { error: 'server_error', error_description: `PingOne token exchange failed: ${msg}` });
      return true;
    }

    // Who actually came back. `auth_time` is the one that answers "did I just
    // reuse a session?" — an auth_time far older than this hop means PingOne
    // honoured an existing SSO session rather than authenticating anybody, which
    // is invisible everywhere else in the flow.
    emitHop({
      phase: 'oauth.callback',
      correlationId: pending.correlationId,
      op: 'authorize-callback',
      status: 'ok',
      identity: { clientId: pending.clientId, ...idTokenClaims },
    });

    // The façade's Privilege door needs a second leg the client cannot see: a
    // sign-in to the Privilege AI Gateway, held server-side by the BFF. Park
    // this authorization, let the BFF do that sign-in while the browser is
    // here, and finish at /oauth/resume. See
    // docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.
    const linkApp = privilegeLinkApp(pending.resource);
    const linkUrl = process.env.BFF_PRIVILEGE_LINK_URL;
    if (linkApp !== null && linkUrl && privilegeLinkConfigured()) {
      const resumeId = this.tokenStore.createResume({
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        scope: pending.scope,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        clientState: pending.clientState,
        pingOneAccessToken,
        pingOneExpiresIn: expiresIn,
        correlationId: pending.correlationId,
        linkNonce: pending.linkNonce,
      });
      const link = new URL(linkUrl);
      if (linkApp) link.searchParams.set('app', linkApp);
      link.searchParams.set('resume', `${this.issuer(req)}/oauth/resume?rs=${encodeURIComponent(resumeId)}`);
      // The BFF cannot tell a link we issued from one a caller typed, and it is
      // unauthenticated by design. Sign the two fields that decide where the
      // token lands: which app it is minted for, and which parked slot it fills.
      // Signed over the RAW app (empty for the bare door) so both sides agree
      // before the BFF resolves its default.
      link.searchParams.set('sig', crypto
        .createHmac('sha256', this.linkSigningKey())
        .update(`${linkApp}|${resumeId}`)
        .digest('base64url'));
      res.writeHead(302, { Location: link.toString() });
      res.end();
      return true;
    }

    const ownCode = this.tokenStore.createCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
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

  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get('grant_type');

    if (grantType !== 'authorization_code') {
      this.json(res, 400, { error: 'unsupported_grant_type' });
      return true;
    }

    const code = params.get('code');
    const redirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');
    const codeVerifier = params.get('code_verifier');
    if (!code || !redirectUri || !clientId) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing code, redirect_uri, or client_id' });
      return true;
    }

    const issued = this.tokenStore.consumeCode(code);
    if (!issued) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
      return true;
    }
    if (issued.clientId !== clientId || issued.redirectUri !== redirectUri) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Code was issued to a different client/redirect' });
      return true;
    }

    // PKCE verification — this is what makes the broker's own authorization
    // code safe to hand back over a loopback redirect: without it, any other
    // local process that observed the code (e.g. via the redirect_uri) could
    // redeem it. Mirrors oauth-mcp's OAuthRouter.verifyPKCE (S256 only).
    if (!codeVerifier || !this.verifyPKCE(codeVerifier, issued.codeChallenge, issued.codeChallengeMethod)) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return true;
    }

    // This IS the pass-through: the exact token PingOne issued, unmodified.
    this.json(res, 200, {
      access_token: issued.pingOneAccessToken,
      token_type: 'Bearer',
      expires_in: issued.pingOneExpiresIn,
      scope: issued.scope,
    });
    return true;
  }

  private verifyPKCE(verifier: string, challenge: string, method: string): boolean {
    if (method !== 'S256') return false;
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return computed === challenge;
  }

  // --- Back from the BFF's Privilege gateway sign-in (see handleCallback) ---
  private async handleResume(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const resumeId = url.searchParams.get('rs');
    const parked = resumeId ? this.tokenStore.consumeResume(resumeId) : null;
    if (!parked) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Unknown or expired authorization request' });
      return true;
    }
    // redirectUri was checked against the client's registration at /oauth/authorize.
    const callback = new URL(parked.redirectUri);
    // Clear the binding cookie however this ends — it is single-use.
    const headers: Record<string, string> = {
      'Set-Cookie': `${LINK_NONCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0`,
    };

    const deny = (description: string) => {
      // The parked token is nobody's now. Fire-and-forget: the browser must not
      // wait on this, and a failed discard still expires on the BFF's TTL.
      void this.discardPrivilegeLink(resumeId as string);
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', description.slice(0, 300));
      if (parked.clientState) callback.searchParams.set('state', parked.clientState);
      res.writeHead(302, { ...headers, Location: callback.toString() });
      res.end();
      return true;
    };

    if (url.searchParams.get('link') !== 'ok') {
      // Tell the client, instead of handing it a token for a door that would
      // only 401 again — that loops it through sign-in after sign-in.
      const reason = (url.searchParams.get('reason') || 'no reason given');
      return deny(`Privilege gateway sign-in failed: ${reason}`);
    }
    // The browser that finishes the sign-in must be the one that started the
    // authorize, or a link mailed to a signed-in victim would put THEIR gateway
    // identity into the app-wide session (Greptile P1, PR #3140).
    // Unconditional: a parked record with no nonce is not a link we can vouch
    // for, and the one place this feature must not fail open is identity.
    if (readCookie(req.headers.cookie, LINK_NONCE_COOKIE) !== parked.linkNonce) {
      return deny('Privilege gateway sign-in was not completed in the browser that started it');
    }
    if (!(await this.commitPrivilegeLink(resumeId as string))) {
      return deny('Privilege gateway sign-in could not be committed');
    }

    callback.searchParams.set('code', this.tokenStore.createCode({
      clientId: parked.clientId,
      redirectUri: parked.redirectUri,
      scope: parked.scope,
      codeChallenge: parked.codeChallenge,
      codeChallengeMethod: parked.codeChallengeMethod,
      pingOneAccessToken: parked.pingOneAccessToken,
      pingOneExpiresIn: parked.pingOneExpiresIn,
    }));
    if (parked.clientState) callback.searchParams.set('state', parked.clientState);
    res.writeHead(302, { ...headers, Location: callback.toString() });
    res.end();
    return true;
  }

  /** Ask the BFF to promote the parked gateway token into the app's session.
   *  Server-to-server with the shared internal secret, same posture as
   *  dualTokenDispatch's BFF calls. No commit URL configured = nothing to
   *  commit, which is how a deployment without the BFF side behaves. */
  private async commitPrivilegeLink(resumeId: string): Promise<boolean> {
    const commitUrl = process.env.BFF_PRIVILEGE_LINK_COMMIT_URL;
    if (!commitUrl) return false;
    try {
      const resp = await axios.post(commitUrl, { rs: resumeId }, {
        headers: { 'x-internal-gateway-secret': this.bffInternalSecret },
        timeout: 3000,
        validateStatus: (s) => s < 500,
      });
      return resp.status >= 200 && resp.status < 300;
    } catch {
      return false;
    }
  }

  /** A purpose-bound key, so a signature that travels in a browser-visible URL is
   *  never an oracle against the shared internal secret itself. */
  private linkSigningKey(): Buffer {
    return crypto.createHmac('sha256', this.bffInternalSecret).update('privilege-link-v1').digest();
  }

  /** Tell the BFF to drop a parked token we refused to commit. */
  private async discardPrivilegeLink(resumeId: string): Promise<void> {
    const commitUrl = process.env.BFF_PRIVILEGE_LINK_COMMIT_URL;
    if (!commitUrl) return;
    try {
      await axios.post(commitUrl, { rs: resumeId, action: 'discard' }, {
        headers: { 'x-internal-gateway-secret': this.bffInternalSecret },
        timeout: 3000,
        validateStatus: (s) => s < 500,
      });
    } catch { /* best effort — the park expires anyway */ }
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
