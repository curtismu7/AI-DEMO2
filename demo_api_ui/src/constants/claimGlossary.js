// demo_api_ui/src/constants/claimGlossary.js

/**
 * Human-readable descriptions for common JWT/OAuth claims.
 * Used by TokenCard and other token display components.
 * Keys are claim names; values are tooltip strings with RFC references.
 */
export const CLAIM_GLOSSARY = {
  sub: 'Subject (RFC 8693 §2.1) — unique identifier of the principal this token was issued for (user, client, or service)',
  iss: 'Issuer — the PingOne authorization server that issued this token (URL)',
  aud: 'Audience (RFC 8693 §2.3) — the intended recipient(s). The resource server MUST verify this matches its own identifier',
  exp: 'Expiration — Unix epoch time after which the token MUST be rejected',
  iat: 'Issued At — Unix epoch time when the token was created',
  nbf: 'Not Before — token must not be accepted before this time',
  jti: 'JWT ID — unique identifier to prevent token replay attacks',
  scope: 'Scopes — space-separated list of permissions granted to the bearer',
  client_id: 'Client ID — the OAuth 2.0 application that requested this token',
  env: 'PingOne Environment ID — the tenant/environment this token belongs to',
  org: 'PingOne Organization ID — the parent organization for this environment',
  act: 'Actor claim (RFC 8693 §2.2) — identifies the party acting on behalf of the subject in a delegated flow',
  may_act: 'May Act (RFC 8693 §4.1) — allows the named client_id to perform a Token Exchange with this token as subject_token',
  acr: 'Authentication Context Class Reference — level of authentication assurance (e.g. MFA step-up)',
  amr: 'Authentication Methods References — how the user authenticated (e.g. pwd, otp, fido)',
  at_hash: 'Access Token Hash — used to bind the id_token to the access_token',
  nonce: 'Nonce — ties the id_token to a specific authentication request to prevent replay',
  azp: 'Authorized Party — the client_id of the OAuth client that received the token',
  sid: 'Session ID — PingOne session identifier',
  auth_time: 'Authentication Time — Unix epoch time when the user last authenticated',
};
