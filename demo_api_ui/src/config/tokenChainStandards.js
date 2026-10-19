// Token Chain: for each arrow, the request form on the wire and the standards behind it (published RFCs,
// and emerging work that could shape the step). Draft status changes: names are for orientation, verify before quoting.
const RFC = (id, title) => ({ id: `RFC ${id}`, title, kind: 'rfc' });
const DRAFT = (id, title) => ({ id, title, kind: 'emerging' });
const SPEC = (id, title) => ({ id, title, kind: 'spec' });

const AUTH = [
  RFC(6749, 'OAuth 2.0 Authorization Framework'), RFC(7636, 'PKCE'), RFC(9700, 'OAuth 2.0 Security BCP'),
  SPEC('OIDC Core 1.0', 'OpenID Connect sign-in'),
  RFC(9126, 'Pushed Authorization Requests (PAR)'), RFC(9396, 'Rich Authorization Requests (RAR)'),
  DRAFT('OAuth 2.1', 'draft-ietf-oauth-v2-1 consolidates PKCE and drops implicit flow'),
];
const BEARER = [RFC(6750, 'Bearer token usage'), RFC(9449, 'DPoP: sender-constrained tokens'), RFC(9068, 'JWT profile for access tokens')];
const CREDS = [
  RFC(6749, 'Client credentials grant (section 4.4)'), RFC(7523, 'JWT client authentication'), RFC(8705, 'mTLS client authentication'),
  SPEC('SPIFFE JWT-SVID', 'Workload identity document'),
  DRAFT('draft-ietf-wimse-arch', 'WIMSE: workload identity in multi-system environments'),
  DRAFT('draft-ietf-oauth-spiffe-client-auth', 'SPIFFE credentials as OAuth client authentication'),
];
const EXCHANGE = [
  RFC(8693, 'OAuth 2.0 Token Exchange (subject_token, actor_token, act claim)'), RFC(8707, 'Resource Indicators'),
  DRAFT('draft-ietf-oauth-transaction-tokens', 'Transaction Tokens: short-lived tokens carrying call context'),
  DRAFT('draft-ietf-oauth-identity-chaining', 'Identity chaining across trust domains'),
  DRAFT('draft-ietf-oauth-identity-assertion-authz-grant', 'ID-JAG: enterprise-managed cross-app access'),
];
const MCP = [
  SPEC('MCP authorization 2025-11-25', 'Model Context Protocol authorization'), RFC(9728, 'Protected Resource Metadata'),
  RFC(8707, 'Resource Indicators'), RFC(6750, 'Bearer token usage'),
  DRAFT('draft-ietf-oauth-client-id-metadata-document', 'Client ID Metadata Documents (no pre-registration)'),
];
const INTROSPECT = [RFC(7662, 'Token Introspection'), RFC(9701, 'JWT response for token introspection'), RFC(7519, 'JSON Web Token'), RFC(7517, 'JSON Web Key')];
const AUTHZ = [
  SPEC('OpenID AuthZEN', 'Standard authorization API between PEP and PDP'), SPEC('XACML 3.0', 'Policy decision model'),
  RFC(9396, 'Rich Authorization Requests (carry the transaction details)'), RFC(8693, 'act claim: who is acting for whom'),
];
const STEPUP = [
  SPEC('OpenID CIBA Core 1.0', 'Out-of-band user approval'), RFC(9470, 'Step-up authentication challenge'),
  SPEC('OpenID FAPI CIBA profile', 'High-assurance CIBA'), SPEC('OpenID CAEP / Shared Signals', 'Revoke or re-evaluate after approval'),
];
const META = [
  RFC(7591, 'Dynamic Client Registration'), SPEC('A2A Agent Card', 'Agent capability description'),
  DRAFT('draft-ietf-oauth-client-id-metadata-document', 'Client ID Metadata Documents'),
];
const RES = [RFC(6750, 'Bearer token usage'), SPEC('SPIFFE', 'Workload identity to the backend'), RFC(8693, 'Exchange for a downstream token instead of an API key')];

const REFS_BY_EDGE = {
  'olb>pingone': AUTH, 'pingone>humanToken': AUTH, 'user>olb': AUTH,
  'humanToken>agentSvc': BEARER, 'agentSvc>agentToken': CREDS,
  'agentSvc>txService': EXCHANGE, 'txService>txToken': EXCHANGE, 'txToken>gwService': [...BEARER, ...EXCHANGE.slice(0, 3)],
  'gwService>pingAuthz': INTROSPECT, 'pingAuthz>gwService': AUTHZ, 'gwService>authCall': INTROSPECT, 'authCall>pingAuthz': AUTHZ,
  'agentSvc>hitl': STEPUP, 'hitl>agentSvc': STEPUP,
  'agentSvc>metadata': META, 'pingAuthz>metadata': META,
};

export function refsFor(source, target) {
  const k = `${source}>${target}`;
  if (REFS_BY_EDGE[k]) return REFS_BY_EDGE[k];
  const touches = (...ids) => ids.includes(source) || ids.includes(target);
  if (touches('hitl')) return STEPUP;
  if (touches('txService', 'txToken')) return EXCHANGE;
  if (touches('authCall', 'pingAuthz')) return AUTHZ;
  if (touches('metadata')) return META;
  if (touches('mcpOlb', 'mcpInvest', 'gwService')) return MCP;
  if (touches('rsOlb', 'rsInvest')) return RES;
  if (touches('agentToken')) return CREDS;
  if (touches('pingone', 'olb', 'user')) return AUTH;
  return [];
}

// The request on the wire for the arrows that are an HTTP call (teaching values, not real credentials).
const FORMS = {
  'olb>pingone': 'GET /as/authorize?response_type=code\n  &client_id=olb-chatbot&redirect_uri=https://olb.bxf.com/cb\n  &scope=openid profile transfer:read\n  &code_challenge=<S256 hash>&code_challenge_method=S256&state=<nonce>',
  'pingone>humanToken': 'POST /as/token\n  grant_type=authorization_code&code=<one-time code>\n  &redirect_uri=https://olb.bxf.com/cb&code_verifier=<PKCE secret>',
  'agentSvc>agentToken': 'POST /as/token\n  grant_type=client_credentials&client_id=agent1\n  &client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n  &client_assertion=<JWT-SVID>&scope=agent:invoke',
  'agentSvc>txService': 'POST /as/token\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<human token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<agent token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=mcp&scope=transfer:read',
  'gwService>pingAuthz': 'POST /as/introspect\n  token=<TX token>&token_type_hint=access_token\n  (then) POST /decision  { subject: user1, actor: agent1, action: balance, resource: olb }',
  'agentSvc>hitl': 'POST /as/bc-authorize\n  login_hint=user1&scope=openid&acr_values=urn:ping:acr:mfa\n  &binding_message=Transfer $5,000',
  'txToken>gwService': 'POST /mcp\n  Authorization: Bearer <TX token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_balance" } }',
  'gwService>mcpOlb': 'POST /mcp\n  Authorization: Bearer <TX token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_balance" } }',
};
export const formFor = (source, target) => FORMS[`${source}>${target}`] || null;
