'use strict';

const endpointResolver = require('../services/oauthEndpointResolver');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');

const config = {
  get clientId() { return process.env.HOSTED_ACCESS_CLIENT_ID || ''; },
  get clientSecret() { return process.env.HOSTED_ACCESS_CLIENT_SECRET || ''; },
  get redirectUri() {
    return process.env.HOSTED_ACCESS_REDIRECT_URI
      || `${getFrontendOrigin()}/api/auth/hosted-access/callback`;
  },
  get authorizationEndpoint() { return endpointResolver.getAuthorizationEndpoint(); },
  get tokenEndpoint() { return endpointResolver.getTokenEndpoint(); },
  get userInfoEndpoint() { return endpointResolver.getUserInfoEndpoint(); },
  get issuer() { return endpointResolver.getIssuer(); },
  get jwksEndpoint() { return endpointResolver.getJwksUri(); },
  get scopes() { return ['openid', 'profile', 'email']; },
  get tokenEndpointAuthMethod() {
    return String(process.env.HOSTED_ACCESS_TOKEN_ENDPOINT_AUTH_METHOD || 'basic').toLowerCase();
  },
};

module.exports = config;
