// Gateway Enforcement Map: Ping-style palette plus per-arrow detail (request on the wire, MOCK token, standards).
// Arrow k of GATEWAY_ENFORCEMENT_JOURNEY_EDGES is STEPS[k] (one STEP per arrow, so each check keeps its own detail).
// All token values are teaching values, never real credentials. Draft names can change: verify before quoting.
import { RFC, SPEC, BEARER, INTROSPECT, MCP, AUTHZ } from './pingStyleStandards';

// Same group keys as the generated journey; only the colours change (Ping product red, app dark, safety grey).
export const PING_GROUPS = {
  entry: { label: 'Agent / app request', bg: '#151a24' },
  pdp: { label: 'PingOne Authorize: business policy', bg: '#b5231a' },
  checks: { label: 'PEP checks: enforced at the gateway', bg: '#5a5f69' },
  out: { label: 'PingGateway / MCP gateway decision', bg: '#b5231a' },
};

const HEADER = { alg: 'RS256', typ: 'at+jwt', kid: 'p1-signing-key-1' };
const UPSTREAM_AUD = 'https://banking-resource-server.ping.demo';
const BASE_CLAIMS = { iss: 'https://auth.pingone.com/<env-id>/as', sub: 'user1', client_id: 'agent1', aud: 'mcpgateway.ping.demo' };
const mock = (note, claims, header = HEADER) => ({ note, ...(header ? { header } : {}), claims: { ...BASE_CLAIMS, ...claims } });

const localCheck = (what, rule) => `(no network call: ${what})\n${rule}`;
const DENY_JSON = (error, message) => `HTTP 403  Content-Type: application/json\n  { "error": "${error}", "message": "${message}", "tool": "create_transfer" }`;
// Real shape: the IG groovy posts { parameters } to the P1AZ decision endpoint (PingOne: .../decisionEndpoints/{id}; mock: .../governance/pap/alpha/policy/{id}/decision). Not AuthZEN.
const DECISION = 'POST <P1AZ base>/decisionEndpoints/<decision-endpoint-id>   (PingOne Authorize Decision Endpoints API, not AuthZEN)\n  { "parameters": { "ToolName": "create_transfer", "McpMethod": "tools/call", "UserId": "user1", "ClientId": "user1",\n                    "TokenScopes": "write transfer", "Amount": "5000", "RarMaxAmount": "5000" } }';
const TO_GW = '(no HTTP exchange: internal verdict inside the PEP)\nverdict: pass | fail  (any fail short-circuits to a 403 deny)';

export const STEPS = [
  {
    key: 'arrive', title: 'Tool call arrives', what: 'The agent calls a tool through the gateway with its bearer token.', edges: [0],
    detail: {
      form: 'POST /mcp\n  Authorization: Bearer <access token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "create_transfer", "arguments": { "payee": "acme", "amount": 5000 } } }',
      tokens: [mock('Access token · PingOne', { scope: 'gateway:mcp:invoke', iat: 1790000000, nbf: 1790000000, exp: 1790000300 })],
      refs: [...MCP, ...BEARER.slice(2)],
    },
  },
  {
    key: 'temporal', title: 'Delegate: time window', what: 'P1AZ hands the iat max-age and nbf checks to the gateway; exp is already covered by introspection (active:false).', edges: [1],
    detail: {
      form: localCheck('iat / nbf read from the token, Node decodes it, IG reads the introspection result',
        'iat > now + 30s            -> 403 { "error": "invalid_iat" }\nnow - iat > IAT_MAX_AGE_SEC -> 403 { "error": "token_too_old" }   (default 7200s: exp alone misses a replayed old token)\nnow < nbf - 30s            -> 403 { "error": "token_not_yet_valid" }\nexp passed                 -> introspection active:false, rejected before this step'),
      tokens: [
        mock('Access token · fresh (passes)', { iat: 1790000000, nbf: 1790000000, exp: 1790000300 }),
        mock('Access token · stale iat (rejected: token_too_old)', { iat: 1789990000, nbf: 1789990000, exp: 1790000300 }),
      ],
      refs: [RFC(7519, 'JSON Web Token: exp, iat, nbf claims'), RFC(9068, 'JWT profile for access tokens'), ...INTROSPECT.slice(0, 1)],
    },
  },
  {
    key: 'scope', title: 'Delegate: per-tool scope', what: 'The gateway checks the token scope covers the tool being called.', edges: [2],
    detail: {
      form: localCheck('scope-topology.json requiredScopes at the PEP',
        `tools/call create_transfer requires scopes ["write", "transfer"]\nskipped when the token carries only the gateway-hop scope (gateway:mcp:invoke / pinggateway:invoke)\n${DENY_JSON('insufficient_scope', 'missing write')}`),
      tokens: [mock('Access token · per-tool scopes (rejected: missing write)', { scope: 'read transfer' })],
      refs: [RFC(6749, 'OAuth 2.0: scope parameter'), RFC(9068, 'JWT profile for access tokens: scope claim')],
    },
  },
  {
    key: 'rar', title: 'Delegate: payee allow-list (RAR)', what: 'The grant details ride in the BFF\'s trusted TraT azd envelope; P1AZ owns the amount and payee rule.', edges: [3],
    detail: {
      form: `POST /mcp\n  X-TraT-Context: { "purp": "payment", "azd": { "authorization_details": [ { "type": "payment_initiation", "amount": 5000, "payee": ["acme"] } ] } }\n\nThe IG groovy flattens the grant to scalar attributes (RarMaxAmount, Amount) for the PDP:\n${DECISION}\n(PG_LOCAL_RAR_PAYEE_ENFORCE is off by default, so P1AZ's RarMaxAmount rule decides.)`,
      tokens: [mock('TraT context envelope · azd (BFF-minted; PingOne SaaS never puts authorization_details in the access token, AIC and PingFederate 11.2+ can)', { purp: 'payment', azd: { authorization_details: [{ type: 'payment_initiation', amount: 5000, payee: ['acme'] }] } }, null)],
      refs: [RFC(9396, 'Rich Authorization Requests: authorization_details'), ...AUTHZ.slice(0, 1)],
    },
  },
  {
    key: 'd05', title: 'Delegate: audience anti-bypass', what: 'The gateway rejects tokens whose audience names an upstream resource instead of the gateway.', edges: [4],
    detail: {
      form: localCheck('multi-audience guard (D-05)',
        `reject if aud contains an upstream resource URI (PG_OLB_RESOURCE_URI, PG_MCP_RESOURCE_SERVER_URI, ${UPSTREAM_AUD})\nexempt: tokens from the external-door issuer (OAUTH_MCP_ISSUER_URI), already audienced upstream by design\n${DENY_JSON('bypass_attempt', 'token aud targets an upstream resource')}`),
      tokens: [mock('Access token · multi-aud (rejected: bypass_attempt)', { aud: ['mcpgateway.ping.demo', UPSTREAM_AUD] })],
      refs: [RFC(8707, 'Resource Indicators: audience-restricted tokens'), RFC(9700, 'OAuth 2.0 Security BCP: audience restriction'), RFC(9068, 'JWT profile for access tokens: aud claim')],
    },
  },
  {
    key: 'tier', title: 'Delegate: group to tier', what: 'The gateway compares the call to the tier the BFF already resolved from the user\'s group, sent as headers.', edges: [5],
    detail: {
      form: `POST /mcp\n  X-User-Tier: Standard\n  X-Tier-Max-Amount-Usd: 2000\n  X-Tier-Restricted-Tools: create_withdrawal\n\n${localCheck('tierEnforce.ts / groovy compare only, the BFF did the group lookup',
        'manifest: Banking_PremiumTier -> PrivateBanking (default Standard: ceiling 2000, create_withdrawal restricted; PrivateBanking: ceiling 50000)\nrestricted tool called       -> 403 { "error": "tier_tool_not_allowed" }\nwrite tool amount > ceiling  -> 403 { "error": "tier_amount_exceeded" }  (create_transfer amount 5000 > 2000)\nheaders absent               -> PERMIT, no-op')}`,
      refs: AUTHZ.slice(0, 1),
    },
  },
  ...['temporal exp / iat / nbf', 'per-tool scope', 'RAR payee allow-list', 'multi-aud anti-bypass', 'group-to-tier'].map((what, i) => ({
    key: `join${i}`, title: `Result: ${what}`, what: `The ${what} verdict returns to the gateway.`, edges: [6 + i],
    detail: {
      form: TO_GW,
      refs: i === 2 ? [...AUTHZ.slice(0, 1), RFC(9396, 'Rich Authorization Requests')] : AUTHZ.slice(0, 1),
    },
  })),
  {
    key: 'decision', title: 'Final decision', what: 'The gateway combines every verdict and forwards, denies, or answers 428 for step-up or human approval.', edges: [11],
    detail: {
      form: 'permit    -> forward POST /mcp to the tool server\ndeny      -> HTTP 403  X-Gw-Audit-Trail: <json>\n             { "error": "access_denied", "decision": "DENY", "tool": "create_transfer", "mcp_method": "tools/call" }\nstep-up   -> HTTP 428  X-Gw-Audit-Trail: <json>\n             { "error": "step_up_required", "message": "Step-up authentication required", "login_required": false }\n             (agent drives the MFA modal, retries with a stronger acr)\nhuman hold -> HTTP 428  X-Gw-Audit-Trail: <json>\n             { "error": "hitl_required", "challengeId": "<id>", "expiresAt": "<ts>", "instructions": "Approve at dashboard, then retry with _hitl_challenge_id in arguments" }\nNo WWW-Authenticate header is emitted.',
      refs: [
        ...MCP.slice(0, 2),
        RFC(6585, '428 Precondition Required status code'),
        RFC(9470, 'Standard analogue for step-up (insufficient_user_authentication); this gateway answers 428 step_up_required instead'),
        SPEC('OpenID CIBA Core 1.0', 'Standard analogue for out-of-band approval; the demo uses its own HITL challenge'),
      ],
    },
  },
];
