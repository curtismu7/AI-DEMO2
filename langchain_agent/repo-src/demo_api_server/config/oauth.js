// PingOne OAuth Configuration — Admin client
// Authorization Code flow for admin/staff users
//
// All values are read lazily via configStore getters so that updates made
// through the Config UI take effect without a server restart.

'use strict';
const configStore = require('../services/configStore');
const { getScopesForUserType } = require('./scopes');
const endpointResolver = require('../services/oauthEndpointResolver');

const config = {
  get environmentId()          { return configStore.getEffective('pingone_environment_id'); },
  get _region()                { return configStore.getEffective('pingone_region') || 'com'; },
  // _base kept for backward compatibility (cibaEndpoint and any external callers)
  get _base()                  { return `https://auth.pingone.${this._region}/${this.environmentId}/as`; },

  // OAuth2 endpoints — resolved via endpointResolver (explicit config > PingOne fallback)
  get authorizationEndpoint()  { return endpointResolver.getAuthorizationEndpoint(); },
  get tokenEndpoint()          { return endpointResolver.getTokenEndpoint(); },
  get userInfoEndpoint()       { return endpointResolver.getUserInfoEndpoint(); },
  get jwksEndpoint()           { return endpointResolver.getJwksUri(); },
  get issuer()                 { return endpointResolver.getIssuer(); },

  // Admin OAuth2 client
  get clientId()               { return configStore.getEffective('admin_client_id'); },
  get clientSecret()           { return configStore.getEffective('admin_client_secret'); },
  get redirectUri()            { return configStore.getEffective('admin_redirect_uri'); },

  // CIBA — Client-Initiated Backchannel Authentication
  get cibaEndpoint()           { return `${this._base}/bc-authorize`; },

  /** OIDC + banking scopes — enough distinct scopes for RFC 8693 MCP token narrowing. */
  get scopes() {
    const banking = getScopesForUserType('admin');
    const base = ['openid', 'profile', 'email', 'offline_access'];
    return [...new Set([...base, ...banking])];
  },

  /**
   * When true, /authorize uses response_type=pi.flow and response_mode=pi.flow (PingOne non-redirect / DaVinci).
   * Requires a PingOne app configured for this mode; otherwise leave false (default authorization code + query).
   */
  get authorizeUsesPiFlow() {
    const v = configStore.getEffective('admin_pingone_authorize_pi_flow');
    return String(v).toLowerCase() === 'true' || v === '1';
  },

  /**
   * How admin client authenticates at POST /token: 'basic' (Authorization header) or 'post' (client_secret in body).
   * Must match PingOne application "Token endpoint authentication method".
   */
  get tokenEndpointAuthMethod() {
    const v = String(configStore.getEffective('admin_token_endpoint_auth_method') || 'basic').toLowerCase();
    return v === 'post' ? 'post' : 'basic';
  },

  get sessionSecret()          { return configStore.getEffective('session_secret'); },
  get adminRole()              { return configStore.getEffective('admin_role') || 'admin'; },
};

module.exports = config;

