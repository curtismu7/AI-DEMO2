// "Identity for AI General Availability" (ID4AI deck page 45): per product step, the request on the wire, the MOCK
// token in play and the standards behind it. Keyed by STEPS[i].key in identityForAiDiagram.js.
// Teaching values only: no real secrets. Request shapes follow what this repo calls (PingOne Protect riskEvaluations,
// PingOne Authorize decisionEndpoints, PingOne /as/token exchange and /as/bc-authorize); vocabulary comes from pingStyleStandards.js.
// Governance has no form on purpose: it has no standard wire call we can state with confidence.
import { RFC, SPEC, MCP, EXCHANGE, CREDS, INTROSPECT, STEPUP } from './pingStyleStandards';

export const IDENTITY_FOR_AI_DETAIL = {
  protect: {
    form: 'POST https://api.pingone.com/v1/environments/{envId}/riskEvaluations   (PingOne Protect)\n  Authorization: Bearer <worker token>\n  { "event": { "ip": "203.0.113.24", "browser": { "userAgent": "ExampleAgent/1.0" },\n               "user": { "id": "<user id>", "type": "EXTERNAL" },\n               "flow": { "type": "AUTHENTICATION" }, "targetResource": { "name": "agent sign-in" } } }\n-> a risk evaluation with a risk level (for example HIGH); the policy decides what a level means',
    refs: [STEPUP[3], STEPUP[1]],
  },
  authorize: {
    form: 'POST https://api.pingone.com/v1/environments/{envId}/decisionEndpoints/{endpointId}   (PingOne Authorize)\n  Authorization: Bearer <worker token>\n  { "parameters": { "UserId": "user1", "TransactionType": "transfer", "Amount": 5000 } }\n-> { "decision": "DENY" }   (policy: agent limit is below this amount; a PERMIT with a step-up obligation is the other outcome)',
    refs: [RFC(9396, 'Rich Authorization Requests (carry the transaction details such as the amount)'), STEPUP[1], SPEC('OpenID AuthZEN', 'Standard PEP-to-PDP API shape (PingOne Authorize exposes its own decision endpoint)')],
  },
  privilege: {
    form: 'POST https://mcpgw.example.com/<app>/mcp   (PingOne Privilege MCP developer gateway)\n  Authorization: Bearer <agent credential>\n  { "jsonrpc": "2.0", "method": "tools/list" }\n-> only the tools the agent\'s policy grants; the gateway adds the backend credential (Auth Mode: Static Token) itself, so the agent never holds it',
    refs: [...MCP.slice(0, 4)],
  },
  core: {
    form: 'POST https://auth.pingone.com/{envId}/as/token   (Agent IAM Core on PingOne; AIC, PingFederate and AIS use their own token endpoints)\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<agent token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=https://mcp.example.com&scope=transfer:read\nHuman in the loop: POST https://auth.pingone.com/{envId}/as/bc-authorize\n  login_hint=user1&scope=openid&binding_message=Pay $500   (PingOne limits binding_message to 8 characters)',
    tokens: [{
      note: 'Delegated agent token · user and agent both named',
      header: { alg: 'RS256', typ: 'at+jwt', kid: 'key-1' },
      claims: { iss: 'https://auth.pingone.com/<envId>/as', sub: 'user1', aud: 'https://mcp.example.com', scope: 'transfer:read', act: { client_id: 'agent1' }, iat: 1760000000, exp: 1760000300 },
    }],
    refs: [...CREDS.slice(0, 3), ...EXCHANGE.slice(0, 2), STEPUP[0], STEPUP[1]],
  },
  gateway: {
    form: 'POST https://mcp.example.com/mcp   (Agent Gateway)\n  Authorization: Bearer <delegated agent token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_balance" } }\ngateway: verify the signature against the JWKS (or POST https://auth.pingone.com/{envId}/as/introspect), check aud and scope, write the audit record, then forward',
    tokens: [{
      note: 'Introspection result · what the gateway validates',
      claims: { active: true, iss: 'https://auth.pingone.com/<envId>/as', sub: 'user1', aud: 'https://mcp.example.com', scope: 'transfer:read', act: { client_id: 'agent1' }, exp: 1760000300 },
    }],
    refs: [...MCP, ...INTROSPECT],
  },
  governance: {
    refs: [SPEC('MCP authorization 2025-11-25', 'Which MCP servers exist and which authorization server protects them'), RFC(9728, 'Protected Resource Metadata (lets a server say who protects it)'), SPEC('A2A Agent Card', 'Agent capability description a review can read')],
  },
};
