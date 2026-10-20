// Shared standards vocabulary for the Ping-style diagrams (StaticFlowDiagram / EmbeddedFlowDiagram with pingStyle, Token Chain).
// A ref is { id, title, kind: 'rfc' | 'spec' | 'emerging' }; emerging = drafts or in-progress work.
// Draft status changes: names are for orientation, verify before quoting.
export const RFC = (id, title) => ({ id: `RFC ${id}`, title, kind: 'rfc' });
export const DRAFT = (id, title) => ({ id, title, kind: 'emerging' });
export const SPEC = (id, title) => ({ id, title, kind: 'spec' });

export const AUTH = [
  RFC(6749, 'OAuth 2.0 Authorization Framework'), RFC(7636, 'PKCE'), RFC(9700, 'OAuth 2.0 Security BCP'),
  SPEC('OIDC Core 1.0', 'OpenID Connect sign-in'),
  RFC(9126, 'Pushed Authorization Requests (PAR)'), RFC(9396, 'Rich Authorization Requests (RAR)'),
  DRAFT('OAuth 2.1', 'draft-ietf-oauth-v2-1 consolidates PKCE and drops implicit flow'),
];
export const BEARER = [RFC(6750, 'Bearer token usage'), RFC(9449, 'DPoP: sender-constrained tokens'), RFC(9068, 'JWT profile for access tokens')];
export const CREDS = [
  RFC(6749, 'Client credentials grant (section 4.4)'), RFC(7523, 'JWT client authentication'), RFC(8705, 'mTLS client authentication'),
  SPEC('SPIFFE JWT-SVID', 'Workload identity document'),
  DRAFT('draft-ietf-wimse-arch', 'WIMSE: workload identity in multi-system environments'),
  DRAFT('draft-ietf-oauth-spiffe-client-auth', 'SPIFFE credentials as OAuth client authentication'),
];
export const EXCHANGE = [
  RFC(8693, 'OAuth 2.0 Token Exchange (subject_token, actor_token, act claim)'), RFC(8707, 'Resource Indicators'),
  DRAFT('draft-ietf-oauth-transaction-tokens', 'Transaction Tokens: short-lived tokens carrying call context'),
  DRAFT('draft-ietf-oauth-identity-chaining', 'Identity chaining across trust domains'),
  DRAFT('draft-ietf-oauth-identity-assertion-authz-grant', 'ID-JAG: enterprise-managed cross-app access'),
];
export const MCP = [
  SPEC('MCP authorization 2025-11-25', 'Model Context Protocol authorization'), RFC(9728, 'Protected Resource Metadata'),
  RFC(8707, 'Resource Indicators'), RFC(6750, 'Bearer token usage'),
  DRAFT('draft-ietf-oauth-client-id-metadata-document', 'Client ID Metadata Documents (no pre-registration)'),
];
export const INTROSPECT = [RFC(7662, 'Token Introspection'), RFC(9701, 'JWT response for token introspection'), RFC(7519, 'JSON Web Token'), RFC(7517, 'JSON Web Key')];
export const AUTHZ = [
  SPEC('OpenID AuthZEN', 'Standard authorization API between PEP and PDP'), SPEC('XACML 3.0', 'Policy decision model'),
  RFC(9396, 'Rich Authorization Requests (carry the transaction details)'), RFC(8693, 'act claim: who is acting for whom'),
];
export const STEPUP = [
  SPEC('OpenID CIBA Core 1.0', 'Out-of-band user approval'), RFC(9470, 'Step-up authentication challenge'),
  SPEC('OpenID FAPI CIBA profile', 'High-assurance CIBA'), SPEC('OpenID CAEP / Shared Signals', 'Revoke or re-evaluate after approval'),
];
export const META = [
  RFC(7591, 'Dynamic Client Registration'), SPEC('A2A Agent Card', 'Agent capability description'),
  DRAFT('draft-ietf-oauth-client-id-metadata-document', 'Client ID Metadata Documents'),
];
export const RES = [RFC(6750, 'Bearer token usage'), SPEC('SPIFFE', 'Workload identity to the backend'), RFC(8693, 'Exchange for a downstream token instead of an API key')];
