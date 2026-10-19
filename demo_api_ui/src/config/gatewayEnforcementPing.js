// Gateway Enforcement Map: Ping-style palette plus per-arrow detail (request on the wire, MOCK token, standards).
// Arrow k of GATEWAY_ENFORCEMENT_JOURNEY_EDGES is STEPS[k] (one STEP per arrow, so each check keeps its own detail).
// All token values are teaching values, never real credentials. Draft names can change: verify before quoting.
import { RFC, SPEC, BEARER, EXCHANGE, MCP, AUTHZ, STEPUP } from './pingStyleStandards';

// Same group keys as the generated journey; only the colours change (Ping product red, app dark, safety grey).
export const PING_GROUPS = {
  entry: { label: 'Agent / app request', bg: '#151a24' },
  pdp: { label: 'PingOne Authorize: business policy', bg: '#b5231a' },
  checks: { label: 'PEP checks: enforced at the gateway', bg: '#5a5f69' },
  out: { label: 'PingGateway / MCP gateway decision', bg: '#b5231a' },
};

const HEADER = { alg: 'RS256', typ: 'at+jwt', kid: 'p1-signing-key-1' };
const BASE_CLAIMS = { iss: 'https://auth.pingone.com/<env-id>/as', sub: 'user1', client_id: 'agent1', aud: 'mcp' };
const mock = (note, claims) => ({ note, header: HEADER, claims: { ...BASE_CLAIMS, ...claims } });

const localCheck = (what, rule) => `(no network call: ${what})\n${rule}`;
const DECISION = 'POST /access/v1/evaluation   (AuthZEN-style PDP call, example)\n  { "subject": { "type": "user", "id": "user1" },\n    "action": { "name": "tools/call" },\n    "resource": { "type": "tool", "id": "transfer_funds" },\n    "context": { "amount": 5000, "tier": "gold" } }';
const TO_GW = 'verdict: pass | fail  (any fail short-circuits to deny)';

export const STEPS = [
  {
    key: 'arrive', title: 'Tool call arrives', what: 'The agent calls a tool through the gateway with its bearer token.', edges: [0],
    detail: {
      form: 'POST /mcp\n  Authorization: Bearer <access token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "transfer_funds", "arguments": { "payee": "acme", "amount": 5000 } } }',
      tokens: [mock('Access token · PingOne', { scope: 'transfer:write', iat: 1790000000, nbf: 1790000000, exp: 1790000300 })],
      refs: [...MCP, ...BEARER.slice(2)],
    },
  },
  {
    key: 'temporal', title: 'Delegate: time window', what: 'P1AZ hands the token lifetime check to the gateway, which holds the raw JWT.', edges: [1],
    detail: {
      form: localCheck('runs on the raw JWT at the PEP', 'reject unless nbf <= now < exp (with small clock skew)\nreject if iat is in the future'),
      tokens: [mock('Access token · temporal claims', { iat: 1790000000, nbf: 1790000000, exp: 1790000300 })],
      refs: [RFC(7519, 'JSON Web Token: exp, iat, nbf claims'), RFC(9068, 'JWT profile for access tokens'), RFC(6750, 'Bearer token usage: invalid_token error')],
    },
  },
  {
    key: 'scope', title: 'Delegate: per-tool scope', what: 'The gateway checks the token scope covers the tool being called.', edges: [2],
    detail: {
      form: localCheck('tool-to-scope map at the PEP', 'tools/call transfer_funds requires scope "transfer:write"\nreject with 403 insufficient_scope otherwise'),
      tokens: [mock('Access token · scope', { scope: 'transfer:write transfer:read' })],
      refs: [RFC(6749, 'OAuth 2.0: scope parameter'), RFC(6750, 'Bearer token usage: insufficient_scope'), RFC(9068, 'JWT profile for access tokens: scope claim')],
    },
  },
  {
    key: 'rar', title: 'Delegate: payee allow-list (RAR)', what: 'The grant details ride in the token; P1AZ owns the amount and payee rule.', edges: [3],
    detail: {
      form: `${DECISION}\n  (authorization_details forwarded as context; the groovy filter lets P1AZ RarMaxAmount decide)`,
      tokens: [mock('Access token · RAR envelope', { authorization_details: [{ type: 'payment_initiation', actions: ['initiate'], creditorAccount: { name: 'acme' }, instructedAmount: { currency: 'USD', amount: '5000.00' } }] })],
      refs: [RFC(9396, 'Rich Authorization Requests: authorization_details'), RFC(9126, 'PAR: where PingOne SaaS accepts authorization_details'), ...AUTHZ.slice(0, 2)],
    },
  },
  {
    key: 'd05', title: 'Delegate: audience anti-bypass', what: 'The gateway rejects tokens whose audience list also names another resource.', edges: [4],
    detail: {
      form: localCheck('multi-audience guard (D-05)', 'aud must be exactly this gateway resource\nreject if aud is an array naming any other resource'),
      tokens: [mock('Access token · multi-aud (rejected)', { aud: ['mcp', 'https://bank.example/api'] })],
      refs: [RFC(8707, 'Resource Indicators: audience-restricted tokens'), RFC(9700, 'OAuth 2.0 Security BCP: audience restriction'), RFC(9068, 'JWT profile for access tokens: aud claim')],
    },
  },
  {
    key: 'tier', title: 'Delegate: group to tier', what: 'The gateway maps token groups to a trust tier before P1AZ policy runs.', edges: [5],
    detail: {
      form: localCheck('tiers.groupToTier lookup at the PEP', 'groups: ["wealth-gold"] -> tier "gold"\nunknown group -> lowest tier'),
      tokens: [mock('Access token · groups', { groups: ['wealth-gold'] })],
      refs: [RFC(7519, 'JSON Web Token: claims set'), SPEC('OpenID AuthZEN', 'PEP passes subject attributes to the PDP'), SPEC('XACML 3.0', 'Attribute-based policy model')],
    },
  },
  ...['temporal exp / iat / nbf', 'per-tool scope', 'RAR payee allow-list', 'multi-aud anti-bypass', 'group-to-tier'].map((what, i) => ({
    key: `join${i}`, title: `Result: ${what}`, what: `The ${what} verdict returns to the gateway.`, edges: [6 + i],
    detail: {
      form: TO_GW,
      refs: i === 2 ? [...AUTHZ.slice(0, 2), RFC(9396, 'Rich Authorization Requests')] : [RFC(6750, 'Bearer token usage: error responses'), ...AUTHZ.slice(0, 1)],
    },
  })),
  {
    key: 'decision', title: 'Final decision', what: 'The gateway combines every verdict and forwards, denies, or asks for step-up.', edges: [11],
    detail: {
      form: 'allow  -> forward POST /mcp to the tool server\ndeny   -> HTTP 403  WWW-Authenticate: Bearer error="insufficient_scope", scope="transfer:write"\nhold   -> HTTP 401  WWW-Authenticate: Bearer error="insufficient_user_authentication"  (step-up / CIBA approval)',
      refs: [...MCP.slice(0, 2), ...STEPUP.slice(0, 2), ...EXCHANGE.slice(0, 1)],
    },
  },
];
