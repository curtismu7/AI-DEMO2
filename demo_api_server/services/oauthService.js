const axios = require('axios');
const crypto = require('crypto');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');
const oauthConfig = require('../config/oauth');
const appEventService = require('./appEventService');
const { isOAuthVerboseDebug } = require('../utils/oauthDebugFlags');
const { verboseOAuthLog } = require('../utils/oauthVerboseLogger');
const { trackTokenEvent } = require('./tokenChainService');
// configStore used to read runtime-saved worker token credentials (survives browser refresh)
const configStore = require('./configStore');
const { authMethodOrder, isInvalidClientError } = require('./pingOneTokenAuth');
const clientAssertionService = require('./clientAssertionService');

// Utility function to decode and log OAuth token information
const logTokenInfo = (token, context = '') => {
  if (!isOAuthVerboseDebug()) return;

  try {
    // Parse JWT without verification (just for reading claims)
    const parts = token.split('.');
    if (parts.length !== 3) {
      verboseOAuthLog(`🔐 [${context}] Invalid token format`);
      return;
    }

    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    if (!header || !payload) {
      verboseOAuthLog(`🔐 [${context}] Failed to decode token`);
      return;
    }

    verboseOAuthLog(`🔐 [${context}] Token Information:`);
    verboseOAuthLog(`   Algorithm: ${header.alg}`);
    verboseOAuthLog(`   Type: ${header.typ}`);
    if (header.kid) verboseOAuthLog(`   Key ID: ${header.kid}`);

    verboseOAuthLog(`   Subject: ${payload.sub || 'N/A'}`);
    verboseOAuthLog(`   Issuer: ${payload.iss || 'N/A'}`);
    verboseOAuthLog(`   Audience: ${Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud || 'N/A'}`);

    if (payload.exp) {
      const expDate = new Date(payload.exp * 1000);
      const now = new Date();
      const timeUntilExp = expDate.getTime() - now.getTime();
      verboseOAuthLog(`   Expires: ${expDate.toISOString()} (in ${Math.round(timeUntilExp / 1000 / 60)} minutes)`);
    }

    if (payload.iat) {
      const iatDate = new Date(payload.iat * 1000);
      verboseOAuthLog(`   Issued At: ${iatDate.toISOString()}`);
    }

    if (payload.preferred_username) verboseOAuthLog(`   Username: ${payload.preferred_username}`);
    if (payload.email) verboseOAuthLog(`   Email: ${payload.email}`);
    if (payload.given_name) verboseOAuthLog(`   First Name: ${payload.given_name}`);
    if (payload.family_name) verboseOAuthLog(`   Last Name: ${payload.family_name}`);

    if (payload.realm_access?.roles) {
      verboseOAuthLog(`   Realm Roles: ${payload.realm_access.roles.join(', ')}`);
    }
    if (payload.resource_access) {
      verboseOAuthLog(`   Resource Access: ${JSON.stringify(payload.resource_access)}`);
    }
    if (payload.scope) {
      verboseOAuthLog(`   Scopes: ${payload.scope}`);
    }
  } catch (error) {
    verboseOAuthLog(`🔐 [${context}] Error decoding token: ${error.message}`);
  }
};

/**
 * Apply client credentials for POST /token per the declared auth method.
 * method: 'basic' (default, CLIENT_SECRET_BASIC) → Authorization: Basic header
 *         'post'  (CLIENT_SECRET_POST)            → client_secret in request body
 * All PingOne apps in this project default to CLIENT_SECRET_BASIC — only override
 * via tokenEndpointAuthMethod / AGENT_TOKEN_ENDPOINT_AUTH_METHOD when your PingOne
 * app is explicitly configured for CLIENT_SECRET_POST.
 */
function applyTokenEndpointAuth(clientId, clientSecret, method, body, headers, tokenEndpoint) {
  // private_key_jwt (RFC 7521/7523): sign a short-lived assertion; no secret on the wire.
  if (method === clientAssertionService.PRIVATE_KEY_JWT) {
    body.set('client_id', clientId);
    body.set('client_assertion_type', clientAssertionService.CLIENT_ASSERTION_TYPE);
    body.set('client_assertion', clientAssertionService.buildClientAssertion(clientId, tokenEndpoint));
    return;
  }
  if (!clientSecret) return;
  if (method === 'post') {
    body.set('client_secret', clientSecret);
    return;
  }
  // Default: CLIENT_SECRET_BASIC (Authorization: Basic header)
  // Per RFC 7617, credentials are sent as base64(client_id:client_secret) with no URL encoding
  const credentials = `${clientId}:${clientSecret}`;
  headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/**
 * Apply admin client credentials for POST /token per PingOne app setting (basic vs post),
 * or private_key_jwt when ff_token_auth_private_key_jwt is ON and a key is configured.
 * Returns the effective auth method used (for token-chain attribution).
 */
function applyAdminTokenEndpointClientAuth(config, body, headers) {
  const effectiveMethod = clientAssertionService.resolveAuthMethod(config.tokenEndpointAuthMethod);
  applyTokenEndpointAuth(config.clientId, config.clientSecret, effectiveMethod, body, headers, config.tokenEndpoint);
  return effectiveMethod;
}

// RFC 8707: array → repeated `resource` params; string → single `audience` param
function applyAudienceParam(body, audience) {
  if (Array.isArray(audience)) {
    for (const r of audience) { body.append('resource', r); }
  } else {
    body.set('audience', audience);
  }
}

class OAuthService {
  constructor() {
    this.config = oauthConfig;
  }

  /**
   * Generate a PKCE code_verifier (random 64-byte hex string)
   */
  generateCodeVerifier() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Derive PKCE code_challenge (S256) from code_verifier
   */
  generateCodeChallenge(codeVerifier) {
    return crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  }

  /**
   * Build PingOne /authorize URL: default response_type=code + PKCE; if authorizeUsesPiFlow,
   * uses response_type=pi.flow and response_mode=pi.flow (PingOne apps that support it).
   */
  generateAuthorizationUrl(state, codeVerifier, redirectUri, nonce = null) {
    const usePiFlow = !!this.config.authorizeUsesPiFlow;
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const responseType = usePiFlow ? 'pi.flow' : 'code';
    const params = new URLSearchParams({
      response_type: responseType,
      client_id: this.config.clientId,
      redirect_uri: redirectUri || this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      login_hint: 'demoAdmin'
    });

    if (usePiFlow) {
      params.set('response_mode', 'pi.flow');
    }

    if (nonce) {
      params.set('nonce', nonce);
    }

    const authUrl = `${this.config.authorizationEndpoint}?${params.toString()}`;
    console.log('[oauthService.generateAuthorizationUrl] Generated URL with:', {
      redirect_uri: redirectUri || this.config.redirectUri,
      authorizationEndpoint: this.config.authorizationEndpoint,
      client_id: this.config.clientId?.slice(0, 8) + '...',
      state: state?.slice(0, 8) + '...',
    });
    return authUrl;
  }

  /**
   * Exchange authorization code for access token.
   * codeVerifier must match the code_challenge sent during /authorize (PKCE S256).
   * Enhanced to support RFC 8707 resource indicators.
   */
  async exchangeCodeForToken(code, codeVerifier, redirectUri, resources = null) {
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri || this.config.redirectUri,
        client_id: this.config.clientId,
      });
      
      // PKCE code_verifier goes in the body regardless of client type (RFC 7636).
      if (codeVerifier) {
        body.set('code_verifier', codeVerifier);
      }
      
      // Add RFC 8707 resource indicators if provided
      if (resources && Array.isArray(resources) && resources.length > 0) {
        // Validate resource format
        const resourceIndicatorService = require('./resourceIndicatorService');
        const validResources = resources.filter(resource => 
          resourceIndicatorService.validateResourceFormat(resource)
        );
        
        if (validResources.length > 0) {
          // Add each resource as a separate parameter (RFC 8707)
          validResources.forEach(resource => {
            body.append('resource', resource);
          });
          console.log('[exchangeCodeForToken] RFC 8707 resources:', validResources);
        }
      }
      
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const clientAuthMethod = applyAdminTokenEndpointClientAuth(this.config, body, headers);
      const bodyObj = Object.fromEntries(body);
      console.log('[oauthService.exchangeCodeForToken] Posting to PingOne:', {
        tokenEndpoint: this.config.tokenEndpoint,
        redirect_uri: redirectUri || this.config.redirectUri,
        code: code?.slice(0, 8) + '...',
        client_id: this.config.clientId?.slice(0, 8) + '...',
        clientAuthMethod,
        allBodyParams: bodyObj,
        headers,
      });
      const tokenResponse = await axios.post(this.config.tokenEndpoint, body.toString(), {
        headers,
      });

      // Log the received access token information
      if (tokenResponse.data.access_token) {
        logTokenInfo(tokenResponse.data.access_token, 'OAuth Token Exchange');

        // Record token exchange event for token chain tracking
        const jwt = require('jsonwebtoken');
        try {
          const claims = jwt.decode(tokenResponse.data.access_token);
          if (claims?.sub) {
            trackTokenEvent({
              eventType: 'auth',
              token: tokenResponse.data.access_token,
              userId: claims.sub,
              description: 'OAuth authorization code exchange for access token',
              clientAuthMethod,
            }).catch(err => {
              console.error('[oauthService] Failed to track token event:', err.message);
            });
          }
        } catch (decodeErr) {
          console.warn('[oauthService] Could not decode token for tracking');
        }
        
        // Add resource binding validation if resources were requested
        if (resources && resources.length > 0) {
          const resourceIndicatorService = require('./resourceIndicatorService');
          try {
            const decoded = JSON.parse(Buffer.from(tokenResponse.data.access_token.split('.')[1], 'base64').toString());
            const hasResourceBinding = decoded.resource || decoded.aud;
            console.log('[exchangeCodeForToken] Resource binding in token:', !!hasResourceBinding);
          } catch (decodeError) {
            console.warn('[exchangeCodeForToken] Could not decode token for resource binding validation');
          }
        }
      }

      return tokenResponse.data;
    } catch (error) {
      const pingoneError = error.response?.data?.error;
      const pingoneDesc  = error.response?.data?.error_description;
      console.error('[exchangeCodeForToken] Failed:', {
        status: error.response?.status,
        data: error.response?.data,
        fullError: error.message,
        tokenEndpoint: this.config.tokenEndpoint,
      });
      const msg = pingoneError
        ? `Token exchange failed: ${pingoneError}${pingoneDesc ? ' — ' + pingoneDesc : ''}`
        : 'Failed to exchange authorization code for token';
      const err = new Error(msg);
      err.pingoneError = pingoneError || 'token_exchange_failed';
      err.pingoneDesc  = pingoneDesc  || '';
      throw err;
    }
  }

  /**
   * RFC 8693 Token Exchange — exchange a subject token for a narrowly-scoped
   * delegated token targeted at a specific audience (e.g. the MCP server).
   *
   * The resulting token will contain an `act` claim identifying this client
   * as the actor, and its scope/audience will be restricted to what was requested.
   *
   * PingOne must be configured to:
   *   1. Issue `may_act` on user tokens (naming this client_id as permitted actor)
   *   2. Allow the token-exchange grant type on this client
   */
  async performTokenExchange(subjectToken, audience, scopes, exchangeOptions = {}) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: this.config.clientId,
    });
    if (exchangeOptions.tokenLifetime != null) {
      body.set('token_lifetime', String(exchangeOptions.tokenLifetime));
    }
    applyAudienceParam(body, audience);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyAdminTokenEndpointClientAuth(this.config, body, headers);
    console.log(
      '[TokenExchange:REQUEST] endpoint=%s client_id=%s audience=%s scope="%s"',
      this.config.tokenEndpoint,
      this.config.clientId,
      audience,
      scopeStr
    );
    appEventService.logEvent('token_exchange', 'info',
      `POST ${this.config.tokenEndpoint} (RFC 8693 token exchange → ${audience})`,
      { tag: 'token-exchange', metadata: { audience, scope: scopeStr } });
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('Token exchange response missing access_token');
      appEventService.logEvent('token_exchange', 'info',
        `Token exchange ← PingOne OK (audience=${audience})`,
        { tag: 'token-exchange', metadata: { audience } });
      console.log(`[TokenExchange] Issued delegated token for audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[TokenExchange:FAILED] httpStatus=%s error=%s description=%s detail=%s audience=%s scope="%s"',
        httpStatus,
        pingoneData.error ?? error.message,
        pingoneData.error_description ?? '(none)',
        pingoneData.error_detail ?? pingoneData.details ?? '(none)',
        audience,
        scopeStr
      );
      const richErr = new Error(
        `Token exchange failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, scope: scopeStr, client_id: this.config.clientId };
      throw richErr;
    }
  }

  /**
   * RFC 8693 Token Exchange using an ID token as the subject token.
   * Uses subject_token_type: urn:ietf:params:oauth:token-type:id_token.
   * This pattern ensures the agent never holds the user's access token — only the
   * ID token is passed, and the BFF exchanges it for a narrowly-scoped MCP token.
   *
   * @param {string} idToken - User's ID token (from session.oauthTokens.idToken)
   * @param {string} audience - Target resource server URI (e.g. mcpserver.ping.demo)
   * @param {string|string[]} scopes - Scopes to request on the output token
   */
  async performTokenExchangeFromIdToken(idToken, audience, scopes) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: this.config.clientId,
    });
    applyAudienceParam(body, audience);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyAdminTokenEndpointClientAuth(this.config, body, headers);
    console.log(
      '[TokenExchange:ID_TOKEN:REQUEST] endpoint=%s client_id=%s audience=%s scope="%s"',
      this.config.tokenEndpoint,
      this.config.clientId,
      audience,
      scopeStr
    );
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('ID token exchange response missing access_token');
      console.log(`[TokenExchange:ID_TOKEN] Issued delegated token for audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[TokenExchange:ID_TOKEN:FAILED] httpStatus=%s error=%s description=%s audience=%s scope="%s"',
        httpStatus,
        pingoneData.error ?? error.message,
        pingoneData.error_description ?? '(none)',
        audience,
        scopeStr
      );
      const richErr = new Error(
        `ID token exchange failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.requestContext          = { audience, scope: scopeStr };
      throw richErr;
    }
  }

  /**
   * RFC 8693 Token Exchange with both subject (end user) and actor (agent OAuth client) tokens.
   * The issued access token represents the user (subject) with the agent acting on their behalf.
   * Requires PingOne token-exchange grant on the Backend-for-Frontend (BFF) client and compatible may_act / actor policy.
   *
   * @param {string} subjectToken - User's access token (who is affected)
   * @param {string} actorToken   - Agent client-credentials token (who performs the action)
   */
  async performTokenExchangeWithActor(subjectToken, actorToken, audience, scopes, exchangeOptions = {}) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: actorToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: this.config.clientId,
    });
    if (exchangeOptions.tokenLifetime != null) {
      body.set('token_lifetime', String(exchangeOptions.tokenLifetime));
    }
    applyAudienceParam(body, audience);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyAdminTokenEndpointClientAuth(this.config, body, headers);
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('Token exchange response missing access_token');
      console.log(`[TokenExchange+Actor] Delegated token audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[TokenExchange+Actor] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message });
      const richErr = new Error(
        `Actor token exchange failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, scope: scopeStr, client_id: this.config.clientId };
      throw richErr;
    }
  }

  /**
   * RFC 8693 Token Exchange: ID token (subject) + agent CC token (actor) → MCP token.
   * Phase 186: Like performTokenExchangeWithActor but uses id_token as subject_token_type.
   * The issued access token represents the user (from ID token sub claim) with the agent
   * acting on their behalf (act claim from actor token).
   *
   * @param {string} idToken     - User's ID token (identity assertion, not capability grant)
   * @param {string} actorToken  - Agent client-credentials token (who performs the action)
   * @param {string} audience    - Target resource server URI (e.g. MCP Gateway)
   * @param {string|string[]} scopes - Scopes to request on the output token
   */
  async performTokenExchangeWithActorIdToken(idToken, actorToken, audience, scopes) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      actor_token: actorToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: this.config.clientId,
    });
    applyAudienceParam(body, audience);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyAdminTokenEndpointClientAuth(this.config, body, headers);
    console.log(
      '[TokenExchange:ID_TOKEN+Actor:REQUEST] endpoint=%s client_id=%s audience=%s scope="%s"',
      this.config.tokenEndpoint,
      this.config.clientId,
      audience,
      scopeStr
    );
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('ID token + actor exchange response missing access_token');
      console.log(`[TokenExchange:ID_TOKEN+Actor] Delegated token audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[TokenExchange:ID_TOKEN+Actor:FAILED] httpStatus=%s error=%s description=%s',
        httpStatus,
        pingoneData.error ?? error.message,
        pingoneData.error_description ?? '(none)'
      );
      const richErr = new Error(
        `ID token + actor exchange failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, scope: scopeStr, client_id: this.config.clientId };
      throw richErr;
    }
  }

  /**
   * Client-credentials token for the PingOne Worker Token app (Management API).
   * Used for verifying apps, resources, scopes, users in PingOne.
   * PingOne App: Super Banking Worker Token — configure via PINGONE_WORKER_TOKEN_CLIENT_ID / PINGONE_WORKER_TOKEN_CLIENT_SECRET.
   */
  async getAgentClientCredentialsToken() {
    const clientId = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID
      || configStore.getEffective('pingone_worker_token_client_id')
      || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID
      || process.env.AGENT_OAUTH_CLIENT_ID;
    const clientSecret = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET
      || configStore.getEffective('pingone_worker_token_client_secret')
      || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET
      || process.env.AGENT_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Agent client credentials not set. Set one of: PINGONE_WORKER_TOKEN_CLIENT_ID/SECRET, PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID/SECRET, or AGENT_OAUTH_CLIENT_ID/SECRET');
    }
    const agentAuthMethod = (process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD
      || configStore.getEffective('pingone_worker_token_auth_method')
      || process.env.MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD
      || process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD
      || 'basic').toLowerCase();
    
    // For Basic auth: only grant_type in body
    // For POST auth: include client_id and client_secret in body
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });
    // Request banking scopes so the actor token can be used in RFC 8693 token exchange.
    // These must also be configured on the MCP Token Exchanger app in PingOne.
    const agentScopes = (process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SCOPES || '').trim();
    if (agentScopes) {
      body.set('scope', agentScopes);
    }
    if (agentAuthMethod === 'post') {
      body.set('client_id', clientId);
    }
    
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyTokenEndpointAuth(clientId, clientSecret, agentAuthMethod, body, headers);
    
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const at = response.data.access_token;
      if (!at) throw new Error('Client credentials response missing access_token');
      console.log('[AgentClientCredentials] Token obtained, requested scopes:', agentScopes || '(none)');
      return at;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[AgentClientCredentials] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message });
      const richErr = new Error(
        `Agent client credentials failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { client_id: clientId };
      throw richErr;
    }
  }

  /**
   * Client-credentials token for the MCP Token Exchanger app (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID).
   * Used exclusively as actor_token in RFC 8693 token exchanges — distinct from
   * getAgentClientCredentialsToken which resolves to the management worker app first.
   *
   * Throws if PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID + SECRET are not configured.
   */
  async getMcpExchangerToken() {
    const clientId =
      configStore.getEffective('pingone_mcp_token_exchanger_client_id') ||
      process.env.AGENT_OAUTH_CLIENT_ID;
    const clientSecret =
      configStore.getEffective('pingone_mcp_token_exchanger_client_secret') ||
      process.env.AGENT_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        'MCP Token Exchanger credentials not configured. ' +
        'Set PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID + PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET.'
      );
    }
    // CC grant for the MCP Exchanger app — PingOne AI_AGENT apps use client_secret_post
    const method = (
      process.env.PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD ||
      process.env.PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD ||
      process.env.MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD ||
      process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD ||
      'post'
    ).toLowerCase();
    const scopeStr = (configStore.getEffective('pingone_mcp_token_exchanger_client_scopes') || '').trim();
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scopeStr) body.set('scope', scopeStr);
    if (method === 'post') body.set('client_id', clientId);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyTokenEndpointAuth(clientId, clientSecret, method, body, headers);
    console.log('[McpExchangerToken] Attempting client credentials:', {
      clientId: clientId.substring(0, 12) + '...',
      method,
      hasSecret: !!clientSecret,
      scopes: scopeStr,
      endpoint: this.config.tokenEndpoint
    });
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const at = response.data.access_token;
      if (!at) throw new Error('MCP Exchanger client credentials response missing access_token');
      console.log('[McpExchangerToken] Token obtained for client:', clientId.substring(0, 8) + '...');
      return at;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      const headers = error.response?.headers || {};
      
      console.error('[McpExchangerToken] FAILED!');
      console.error({
        httpStatus,
        pingoneError: pingoneData,
        errorMessage: error.message,
        errorCode: error.code,
        requestConfig: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : null,
        responseHeaders: headers
      });
      const richErr = new Error(
        `MCP Exchanger token failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { client_id: clientId };
      throw richErr;
    }
  }

  /**
   * Client-credentials token for the AI Agent app (PINGONE_AI_AGENT_CLIENT_ID, d21c5124…).
   * This is the actor the user's `may_act` authorizes (may_act.sub == AI Agent client_id),
   * so it is the correct actor_token for the Two-Exchange Step 1 (user → agentgateway) that
   * makes PingOne emit the `act` delegation claim. Tries the configured auth method, then the
   * alternate on invalid_client (the app may be client_secret_basic or _post).
   */
  async getAiAgentClientCredentialsToken() {
    const clientId =
      configStore.getEffective('pingone_ai_agent_client_id') ||
      process.env.PINGONE_AI_AGENT_CLIENT_ID;
    const clientSecret =
      configStore.getEffective('pingone_ai_agent_client_secret') ||
      process.env.PINGONE_AI_AGENT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('AI Agent credentials not configured. Set PINGONE_AI_AGENT_CLIENT_ID + PINGONE_AI_AGENT_CLIENT_SECRET.');
    }
    const configured = (
      configStore.getEffective('pingone_ai_agent_cc_auth_method') ||
      process.env.PINGONE_AI_AGENT_CC_AUTH_METHOD || 'post'
    ).toLowerCase();
    const order = authMethodOrder(configured);
    for (let i = 0; i < order.length; i++) {
      const method = order[i];
      const body = new URLSearchParams({ grant_type: 'client_credentials' });
      // Request a SINGLE-resource scope. The AI Agent is granted scopes on two resources
      // (Demo Agent Gateway: agent:invoke; Demo API: read/write/…), and PingOne rejects a
      // client_credentials request that would span both ("May not request scopes for
      // multiple resources"). agent:invoke pins the token to the Agent Gateway resource —
      // the correct actor audience for the Two-Exchange Step 1.
      const actorScope = (configStore.getEffective('pingone_ai_agent_actor_scope') || 'agent:invoke').trim();
      if (actorScope) body.set('scope', actorScope);
      if (method === 'post') body.set('client_id', clientId);
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      applyTokenEndpointAuth(clientId, clientSecret, method, body, headers);
      try {
        const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
        const at = response.data.access_token;
        if (!at) throw new Error('AI Agent client credentials response missing access_token');
        return at;
      } catch (error) {
        if (!(isInvalidClientError(error) && i < order.length - 1)) {
          const d = error.response?.data || {};
          throw new Error(`AI Agent client credentials failed: ${d.error_description || d.error || error.message}`);
        }
      }
    }
    throw new Error('AI Agent client credentials failed for all auth methods');
  }

  /**
   * Client-credentials token with expiry information for the PingOne Worker Token app.
   * Used for PingOne Management API calls (e.g., verifying apps, resources, scopes, users).
   * Returns token along with expiresAt timestamp and expiresIn seconds.
   * Per PingOne documentation, worker apps (client credentials) should NOT include scope in the request.
   */
  async getAgentClientCredentialsTokenWithExpiry() {
    const clientId = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID
      || configStore.getEffective('pingone_worker_token_client_id')
      || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID
      || process.env.AGENT_OAUTH_CLIENT_ID;
    const clientSecret = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET
      || configStore.getEffective('pingone_worker_token_client_secret')
      || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET
      || process.env.AGENT_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('PINGONE_WORKER_TOKEN_CLIENT_ID and PINGONE_WORKER_TOKEN_CLIENT_SECRET must be set for worker token (PingOne App: Super Banking Worker Token)');
    }
    const agentAuthMethod = (process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD
      || configStore.getEffective('pingone_worker_token_auth_method')
      || process.env.MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD
      || process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD
      || 'basic').toLowerCase();
    
    // Per PingOne documentation: client credentials grant should NOT include scope
    // https://developer.pingidentity.com/pingone-api/getting-started/create-a-test-environment/step-1-get-access-token.html
    // For Basic auth: only grant_type in body, credentials go in Authorization header
    // For POST auth: include client_id and client_secret in body
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });
    if (agentAuthMethod === 'post') {
      body.set('client_id', clientId);
    }
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyTokenEndpointAuth(clientId, clientSecret, agentAuthMethod, body, headers);
    
    console.log('[AgentClientCredentialsWithExpiry] Request body:', body.toString());
    console.log('[AgentClientCredentialsWithExpiry] Headers:', headers);
    
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const at = response.data.access_token;
      if (!at) throw new Error('Client credentials response missing access_token');
      const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided
      const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
      return { token: at, expiresAt, expiresIn };
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[AgentClientCredentialsWithExpiry] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message });
      const richErr = new Error(
        `Agent client credentials failed: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { client_id: clientId };
      throw richErr;
    }
  }

  /**
   * Generic Client Credentials token for any explicit clientId/clientSecret + audience.
   * Used in the 2-exchange delegation chain where each exchanger has its own identity.
   *
   * @param {string} clientId
   * @param {string} clientSecret
   * @param {string} audience  Resource server audience URI (returned token will have aud=[audience])
   * @param {string} method    Token endpoint auth method ('basic' | 'post')
   * @param {string} [scope]   Space-delimited scopes for THIS audience's resource only.
   *   PingOne rejects a CC request with `audience` but no `scope` when the client
   *   is granted scopes spanning more than one resource server
   *   (`invalid_scope: "May not request scopes for multiple resources"`).
   *   The 2-exchange AI Agent / MCP Exchanger apps are intentionally granted
   *   scopes on two resources each (gateway + intermediate/final), so the actor
   *   CC request MUST name the single-resource scope explicitly. Mirrors the
   *   working `getMcpExchangerToken()` pattern (scope, no audience there).
   */
  async getClientCredentialsTokenAs(clientId, clientSecret, audience, method = 'basic', scope) {
    console.log(`[CC-As] Request: client=${clientId} audience=${audience} scope=${scope || '(none)'} method=${method} endpoint=${this.config.tokenEndpoint} secret_len=${clientSecret?.length || 0}`);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      audience,
    });
    if (scope) body.set('scope', Array.isArray(scope) ? scope.join(' ') : scope);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyTokenEndpointAuth(clientId, clientSecret, method, body, headers);
    console.log(`[CC-As] Body params: ${[...body.keys()].join(', ')} | has_auth_header=${!!headers.Authorization}`);
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const at = response.data.access_token;
      if (!at) throw new Error('Client credentials response missing access_token');
      console.log(`[CC-As] Issued actor token for client=${clientId} audience=${audience}`);
      return at;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[CC-As] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message, method, audience });
      const richErr = new Error(
        `Client credentials failed for ${clientId}: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, client_id: clientId };
      throw richErr;
    }
  }

  /**
   * RFC 8693 Token Exchange performed by an explicit exchanger (clientId/clientSecret).
   * Used in the 2-exchange chain where AI Agent and MCP Service have distinct credentials.
   *
   * @param {string}          subjectToken   - Incoming subject token
   * @param {string}          actorToken     - Actor token (exchanger's CC token)
   * @param {string}          clientId       - Exchanger's client ID
   * @param {string}          clientSecret   - Exchanger's client secret
   * @param {string|string[]} audience       - Requested audience(s): string → `audience` param; array → RFC 8707 `resource` params
   * @param {string[]}        scopes         - Requested scopes
   */
  // Standard: token exchange always uses client_secret_basic (RFC 8693 + PingOne convention)
  async performTokenExchangeAs(subjectToken, actorToken, clientId, clientSecret, audience, scopes, method = 'basic', exchangeOptions = {}) {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: clientId,
    });
    if (exchangeOptions.tokenLifetime != null) {
      body.set('token_lifetime', String(exchangeOptions.tokenLifetime));
    }
    applyAudienceParam(body, audience);
    // Only include actor_token when provided (Exchange 1 is delegation-only, no actor)
    // NOTE: Even if actor_token is sent, PingOne may not include an `act` claim in the response
    // if the MCP resource's token policy isn't configured for delegation. This is expected behavior
    // when the PingOne resource policy doesn't enforce delegation claims.
    if (actorToken) {
      body.set('actor_token', actorToken);
      body.set('actor_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    }
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyTokenEndpointAuth(clientId, clientSecret, method, body, headers);
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('Token exchange response missing access_token');
      console.log(`[Exchange-As] client=${clientId} audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[Exchange-As] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message });
      const richErr = new Error(
        `Token exchange failed for ${clientId}: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, scope: scopeStr, client_id: clientId };
      throw richErr;
    }
  }

  /**
   * RFC 8693 Token Exchange using a dedicated private_key_jwt app (when enabled).
   * Falls back to performTokenExchange (via admin client) if the dedicated app is not configured.
   * Used by agentMcpTokenService for narrow delegation — subject token with optional actor token.
   */
  async performTokenExchangeWithDedicatedApp(subjectToken, audience, scopes, actorToken = null, exchangeOptions = {}) {
    // Check if dedicated exchanger is enabled and provisioned
    const isEnabled = clientAssertionService.isExchangerPrivateKeyJwtEnabled();
    if (!isEnabled) {
      // Fall back to standard admin-client exchange
      return actorToken
        ? this.performTokenExchangeWithActor(subjectToken, actorToken, audience, scopes, exchangeOptions)
        : this.performTokenExchange(subjectToken, audience, scopes, exchangeOptions);
    }

    // Use dedicated app with private_key_jwt
    const exchangerClientId = configStore.getEffective('pingone_private_key_jwt_exchanger_client_id');
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: scopeStr,
      client_id: exchangerClientId,
    });

    if (exchangeOptions.tokenLifetime != null) {
      body.set('token_lifetime', String(exchangeOptions.tokenLifetime));
    }
    applyAudienceParam(body, audience);
    if (actorToken) {
      body.set('actor_token', actorToken);
      body.set('actor_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    }

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    body.set('client_assertion_type', clientAssertionService.CLIENT_ASSERTION_TYPE);
    body.set('client_assertion', clientAssertionService.buildExchangerClientAssertion(exchangerClientId, this.config.tokenEndpoint));

    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), { headers });
      const exchanged = response.data.access_token;
      if (!exchanged) throw new Error('Token exchange response missing access_token');
      console.log(`[Exchange-With-DedicatedApp] client=${exchangerClientId} audience=${audience} scope="${scopeStr}"`);
      return exchanged;
    } catch (error) {
      const pingoneData = error.response?.data || {};
      const httpStatus  = error.response?.status;
      console.error('[Exchange-With-DedicatedApp] Failed:', { httpStatus, ...pingoneData, rawMessage: error.message });
      const richErr = new Error(
        `Token exchange failed with dedicated app ${exchangerClientId}: ${pingoneData.error_description || pingoneData.error || error.message}`
      );
      richErr.httpStatus              = httpStatus;
      richErr.pingoneError            = pingoneData.error;
      richErr.pingoneErrorDescription = pingoneData.error_description;
      richErr.pingoneErrorDetail      = pingoneData.error_detail || pingoneData.details;
      richErr.requestContext          = { audience, scope: scopeStr, client_id: exchangerClientId };
      throw richErr;
    }
  }

  /**
   * Get user information from PingOne Core
   */
  async getUserInfo(accessToken) {
    try {
      const userInfoResponse = await axios.get(this.config.userInfoEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return userInfoResponse.data;
    } catch (error) {
      console.error('User info error:', error.response?.data || error.message);
      throw new Error('Failed to get user information', { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * RFC 6749 §6 — Refresh an access token using a stored refresh token (admin OAuth client).
   * Client authentication matches exchangeCodeForToken (basic vs post).
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) throw new Error('No refresh token provided');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const clientAuthMethod = applyAdminTokenEndpointClientAuth(this.config, body, headers);
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), {
        headers,
        timeout: 10000,
      });
      console.log('[TokenRefresh] Admin access token refreshed successfully');

      // Record token refresh event for token chain tracking
      if (response.data.access_token) {
        const jwt = require('jsonwebtoken');
        try {
          const claims = jwt.decode(response.data.access_token);
          if (claims?.sub) {
            trackTokenEvent({
              eventType: 'refresh',
              token: response.data.access_token,
              userId: claims.sub,
              description: 'OAuth access token refreshed',
              clientAuthMethod,
            }).catch(err => {
              console.error('[oauthService] Failed to track token refresh event:', err.message);
            });
          }
        } catch (decodeErr) {
          console.warn('[oauthService] Could not decode refreshed token for tracking');
        }
      }
      
      return response.data;
    } catch (error) {
      console.error('[TokenRefresh] Admin refresh failed:', error.response?.data || error.message);
      throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Validate access token
   */
  async validateToken(accessToken) {
    try {
      // Validate token by making a request to userinfo endpoint
      const userInfo = await this.getUserInfo(accessToken);
      return {
        valid: true,
        userInfo: userInfo
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check if user has admin role (deprecated - now handled in local user management)
   */
  hasAdminRole(_userInfo) {
    // This method is kept for backward compatibility but is no longer used
    // Admin role checking is now handled in the local user management system
    console.log('hasAdminRole called but deprecated - using local user management instead');
    return false;
  }

  /**
   * RFC 7009 — Revoke a token (access or refresh) at the PingOne revocation endpoint.
   * Best-effort: logs errors but does not throw, so logout always completes.
   *
   * @param {string} token        - The token to revoke
   * @param {string} [tokenType]  - 'access_token' | 'refresh_token' (hint only, optional)
   */
  async revokeToken(token, tokenType) {
    if (!token) return;
    // PingOne revocation endpoint: replace /token with /token/revoke in the token endpoint URL
    // PingOne AI IAM Core exposes: POST /{envId}/as/revoke
    const revocationEndpoint = this.config.tokenEndpoint
      ? this.config.tokenEndpoint.replace(/\/as\/token$/, '/as/revoke')
      : null;
    if (!revocationEndpoint) {
      console.warn('[RFC7009] Cannot revoke token: tokenEndpoint not configured');
      return;
    }
    const body = new URLSearchParams({ token, client_id: this.config.clientId });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    if (tokenType) body.set('token_type_hint', tokenType);
    try {
      await axios.post(revocationEndpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      });
      console.log(`[RFC7009] Token revoked (hint: ${tokenType || 'none'})`);
    } catch (err) {
      // Log but don't block logout on revocation failure
      console.warn('[RFC7009] Token revocation failed (non-fatal):', err.response?.data || err.message);
    }
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a user object from PingOne Core user info
   */
  createUserFromOAuth(userInfo) {
    const email = userInfo.email || userInfo.email_address || null;
    const firstName = userInfo.given_name || userInfo.first_name || userInfo.name?.split(' ')[0] || '';
    const lastName = userInfo.family_name || userInfo.last_name || userInfo.name?.split(' ').slice(1).join(' ') || '';
    if (!email) {
      console.warn(
        '[createUserFromOAuth] No email in userinfo/ID token — check PingOne app attribute mappings ' +
        '(email scope must be authorized and the "email" attribute mapped). sub:', userInfo.sub || userInfo.id,
      );
    }
    return {
      id: userInfo.sub || userInfo.id,
      username: userInfo.preferred_username || userInfo.username || email || userInfo.sub,
      email,
      firstName,
      lastName,
      role: 'customer', // Default role, will be overridden in OAuth callback if needed
      isActive: true,
      createdAt: new Date(),
      oauthProvider: 'pingone_sso',
      oauthId: userInfo.sub || userInfo.id,
    };
  }
}

module.exports = new OAuthService();
