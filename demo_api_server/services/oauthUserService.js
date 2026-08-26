const axios = require('axios');
const crypto = require('crypto');
const { sanitizeAxiosCause } = require('../utils/sanitizeAxiosCause');
const config = require('../config/oauthUser');
const nrSegments = require('./nrSegments');
const { isOAuthVerboseDebug } = require('../utils/oauthDebugFlags');
const { verboseOAuthLog } = require('../utils/oauthVerboseLogger');

// Utility function to decode and log OAuth token information
const logTokenInfo = (token, context = '') => {
  if (!isOAuthVerboseDebug()) return;

  try {
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
 * Should this request carry client authentication at all?
 *
 * A PingOne app with tokenEndpointAuthMethod NONE (PKCE-only public client)
 * rejects ANY client authentication with
 *   invalid_client — Request denied: Unsupported authentication method
 * and it rejects an EMPTY `client_secret=` exactly the same way as a wrong one
 * (verified against the live token endpoint). So the presence of a stored
 * secret is not sufficient reason to send it — the app's configured method is.
 *
 * This bit us for real: the "Demo AI App - User Login" app was migrated to
 * PKCE-only on 2026-08-24 while the BFF kept a now-obsolete user_client_secret,
 * and every customer sign-in failed from that moment on. The old guard
 * (`if (this.config.clientSecret)`) could not see the difference.
 *
 * Unset/empty method keeps the previous behaviour, so a confidential
 * deployment is unaffected.
 */
function shouldSendClientSecret(config) {
  if (!config.clientSecret) return false;
  return String(config.tokenEndpointAuthMethod || '').trim().toLowerCase() !== 'none';
}

class OAuthUserService {
  constructor() {
    this.config = config;
  }

  /**
   * Generate PKCE code verifier (random 64-byte hex string)
   */
  generateCodeVerifier() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate PKCE code challenge (S256 = base64url(sha256(verifier)))
   */
  generateCodeChallenge(codeVerifier) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  /**
   * Generate authorization URL for end user OAuth flow.
   * @param {Object} config
   * @param {string} config.state - CSRF protection state
   * @param {string} config.codeVerifier - PKCE verifier
   * @param {string} [config.redirectUri] - OAuth redirect URI (defaults to configured URI)
   * @param {string} [config.nonce] - OIDC nonce for ID token replay protection
   * @param {string} [config.acr_values] - Step-up MFA trigger (e.g. 'Multi_Factor')
   * @param {string} [config.prompt] - OIDC prompt (e.g. 'none' for silent reauth)
   * @param {number} [config.max_age] - Max age for session reauth (0 = force)
   * @param {string} [config.login_hint] - OIDC login hint (defaults to 'demoUser')
   * @param {boolean} [config.forcePiFlow] - Force pi.flow response type instead of code
   */
  generateAuthorizationUrl({ state, codeVerifier, redirectUri, nonce, acr_values, prompt, max_age, login_hint = 'demoUser', forcePiFlow } = {}) {
    console.log('[oauth-auth-url] authorizationEndpoint:', this.config.authorizationEndpoint);
    console.log('[oauth-auth-url] Generated with:', { redirectUri, nonce, acr_values, prompt, max_age });
    const usePiFlow = Boolean(forcePiFlow) || Boolean(this.config.authorizeUsesPiFlow);
    const responseType = usePiFlow ? 'pi.flow' : 'code';
    const finalRedirectUri = redirectUri || this.config.redirectUri;
    console.log('[oauth-auth-url] Final redirect_uri:', finalRedirectUri);
    const params = new URLSearchParams({
      response_type: responseType,
      client_id: this.config.clientId,
      redirect_uri: finalRedirectUri,
      scope: this.config.scopes.join(' '),
      state: state,
      code_challenge: this.generateCodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      login_hint
    });

    if (usePiFlow) {
      params.set('response_mode', 'pi.flow');
    }

    if (acr_values) {
      params.set('acr_values', acr_values);
    }
    if (nonce) {
      params.set('nonce', nonce);
    }
    if (max_age !== undefined) {
      params.set('max_age', String(max_age));
    }
    if (prompt) {
      params.set('prompt', prompt);
    }

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token (Authorization Code + PKCE S256).
   * client_secret is optional: PingOne public clients can use PKCE without a secret;
   * confidential clients should keep the secret only on this server (never in the browser).
   */
  async exchangeCodeForToken(code, codeVerifier, redirectUri) {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri || this.config.redirectUri,
        client_id: this.config.clientId,
      });
      if (shouldSendClientSecret(this.config)) {
        params.set('client_secret', this.config.clientSecret);
      }
      if (codeVerifier) {
        params.set('code_verifier', codeVerifier);
      }
      const response = await nrSegments.pingOneAuthenticate(() =>
        axios.post(this.config.tokenEndpoint, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );

      if (response.data.access_token) {
        logTokenInfo(response.data.access_token, 'User OAuth Token Exchange');
      }

      return response.data;
    } catch (error) {
      const pingoneError = error.response?.data?.error;
      const pingoneDesc  = error.response?.data?.error_description;
      console.error('[exchangeCodeForToken] Failed:', error.response?.data || error.message);
      const msg = pingoneError
        ? `Token exchange failed: ${pingoneError}${pingoneDesc ? ' — ' + pingoneDesc : ''}`
        : 'Failed to exchange code for token';
      const err = new Error(msg);
      err.pingoneError = pingoneError || 'token_exchange_failed';
      throw err;
    }
  }

  /**
   * Resource Owner Password grant — only if enabled on the PingOne application.
   * Used to re-validate credentials when binding an agent identity to a human user.
   */
  async exchangeResourceOwnerPassword(username, password) {
    const body = new URLSearchParams({
      grant_type: 'password',
      username: String(username).trim(),
      password: String(password),
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
    });
    if (shouldSendClientSecret(this.config)) {
      body.set('client_secret', this.config.clientSecret);
    }
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return response.data;
    } catch (error) {
      console.error('[ROPC] Failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error_description || error.message || 'ROPC failed', { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * Get user information from PingOne Core
   */
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(this.config.userInfoEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data;
    } catch (error) {
      const pingoneError = error.response?.data?.error;
      console.error('[getUserInfo] Failed:', error.response?.data || error.message);
      const err = new Error('Failed to get user information', { cause: sanitizeAxiosCause(error) });
      err.pingoneError = pingoneError || 'userinfo_failed';
      throw err;
    }
  }

  /**
   * RFC 6749 §6 — Refresh an access token using a stored refresh token.
   * Returns the updated token data or throws on failure.
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) throw new Error('No refresh token provided');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });
    if (shouldSendClientSecret(this.config)) body.set('client_secret', this.config.clientSecret);
    try {
      const response = await axios.post(this.config.tokenEndpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      console.log('[TokenRefresh] End-user access token refreshed successfully');
      return response.data;
    } catch (error) {
      console.error('[TokenRefresh] Failed:', error.response?.data || error.message);
      throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`, { cause: sanitizeAxiosCause(error) });
    }
  }

  /**
   * RFC 7009 — Revoke a token at the PingOne revocation endpoint.
   * Best-effort: logs errors but does not throw, so logout always completes.
   */
  async revokeToken(token, tokenType) {
    if (!token) return;
    const revocationEndpoint = this.config.revocationEndpoint || null;
    if (!revocationEndpoint) {
      console.warn('[RFC7009] Cannot revoke token: revocationEndpoint not configured');
      return;
    }
    const body = new URLSearchParams({ token, client_id: this.config.clientId });
    if (shouldSendClientSecret(this.config)) body.set('client_secret', this.config.clientSecret);
    if (tokenType) body.set('token_type_hint', tokenType);
    try {
      await axios.post(revocationEndpoint, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      });
      console.log(`[RFC7009] User token revoked (hint: ${tokenType || 'none'})`);
    } catch (err) {
      console.warn('[RFC7009] User token revocation failed (non-fatal):', err.response?.data || err.message);
    }
  }

  /**
   * Create a user object from PingOne Core user info (end users get customer role)
   */
  createUserFromOAuth(userInfo) {
    return {
      id: userInfo.sub || userInfo.id,
      username: userInfo.preferred_username || userInfo.username || userInfo.email,
      email: userInfo.email,
      firstName: userInfo.given_name || userInfo.first_name || userInfo.name?.split(' ')[0] || '',
      lastName: userInfo.family_name || userInfo.last_name || userInfo.name?.split(' ').slice(1).join(' ') || '',
      role: this.config.userRole, // End users get customer role
      isActive: true,
      createdAt: new Date(),
      oauthProvider: 'pingone_sso',
      oauthId: userInfo.sub || userInfo.id
    };
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

}

module.exports = new OAuthUserService();
