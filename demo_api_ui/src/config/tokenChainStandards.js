// Token Chain: for each arrow, the request form on the wire and the standards behind it (published RFCs,
// and emerging work that could shape the step). The vocabulary itself lives in pingStyleStandards.js.
import { AUTH, BEARER, CREDS, EXCHANGE, MCP, INTROSPECT, AUTHZ, STEPUP, META, RES } from './pingStyleStandards';

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
