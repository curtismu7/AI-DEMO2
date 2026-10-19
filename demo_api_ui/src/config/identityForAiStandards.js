// "Identity for AI General Availability" (ID4AI deck page 45): for each product step, the request on the wire,
// the MOCK token in play and the standards behind it. Index i = walkthrough step i + 1 in id4aiSlides.js.
// Teaching values only: no real secrets. Vocabulary comes from pingStyleStandards.js.
import { RFC, DRAFT, SPEC, MCP, EXCHANGE, CREDS, INTROSPECT, AUTHZ, STEPUP, META } from './pingStyleStandards';

export const IDENTITY_FOR_AI_DETAIL = [
  { // 1 Protect
    form: 'POST /v1/environments/{envId}/riskEvaluations   (PingOne Protect)\n  { "event": { "ip": "203.0.113.24", "browser": { "userAgent": "ExampleAgent/1.0" },\n               "user": { "id": "<user id>", "type": "EXTERNAL" }, "flow": { "type": "AUTHENTICATION" } },\n    "riskPolicySet": { "id": "<risk policy id>" } }\n-> { "result": { "level": "HIGH" } }   (automated agent traffic detected)',
    refs: [
      RFC(9421, 'HTTP Message Signatures (a signed request identifies the caller)'),
      DRAFT('draft-meunier-web-bot-auth-architecture', 'Web Bot Auth: signed requests from automated agents'),
      RFC(9700, 'OAuth 2.0 Security BCP'),
    ],
  },
  { // 2 Authorize
    form: 'POST /access/v1/evaluation   (PingOne Authorize decision, AuthZEN shape)\n  { "subject": { "type": "user", "id": "user1" },\n    "action": { "name": "transfer" },\n    "resource": { "type": "account", "id": "acct-1001" },\n    "context": { "actor": "agent1", "amount": 5000 } }\n-> { "decision": false, "context": { "reason": "amount over agent limit; step-up required" } }',
    refs: AUTHZ,
  },
  { // 3 Privilege
    form: 'POST /mcp   (PingOne Privilege MCP developer gateway)\n  Authorization: Bearer <agent access token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "git_push" } }\n-> gateway injects a just-in-time credential for the repo and records the call; nothing long-lived is stored',
    tokens: [{
      note: 'JIT credential · issued per task, expires in minutes',
      claims: { iss: 'https://privilege.example.com', sub: 'dev1', act: { sub: 'coding-agent' }, aud: 'git.example.com', scope: 'repo:push', iat: 1760000000, exp: 1760000900 },
    }],
    refs: [...MCP.slice(0, 4), ...EXCHANGE.slice(0, 2)],
  },
  { // 4 Agent IAM Core
    form: 'POST /as/token   (Agent IAM Core on AIC, PingOne, PingFederate or AIS)\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<user token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &actor_token=<agent token>&actor_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=https://mcp.example.com&scope=transfer:read\nHuman in the loop: POST /as/bc-authorize  login_hint=user1&binding_message=Approve transfer',
    tokens: [{
      note: 'Delegated agent token · user and agent both named',
      header: { alg: 'RS256', typ: 'at+jwt', kid: 'key-1' },
      claims: { iss: 'https://auth.example.com', sub: 'user1', aud: 'https://mcp.example.com', client_id: 'agent1', scope: 'transfer:read', act: { sub: 'agent1' }, iat: 1760000000, exp: 1760000300 },
    }],
    refs: [...CREDS.slice(0, 3), ...EXCHANGE.slice(0, 3), ...STEPUP.slice(0, 2)],
  },
  { // 5 Agent Gateway
    form: 'POST /mcp   (Agent Gateway)\n  Authorization: Bearer <delegated agent token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_balance" } }\ngateway: verify signature via JWKS or POST /as/introspect, check aud and scope, audit the call, then forward',
    tokens: [{
      note: 'Introspection result · what the gateway validates',
      claims: { active: true, iss: 'https://auth.example.com', sub: 'user1', aud: 'https://mcp.example.com', client_id: 'agent1', scope: 'transfer:read', act: { sub: 'agent1' }, exp: 1760000300 },
    }],
    refs: [...MCP, ...INTROSPECT],
  },
  { // 6 Agent Governance
    form: 'Inventory and review feed (illustrative record, not a published API)\n  { "agent": "agent1", "discoveredVia": "gateway audit", "mcpServers": ["mcp.example.com"],\n    "grantedScopes": ["transfer:read"], "lastUsed": "2026-10-17", "certification": "pending-owner-review" }',
    refs: [...META, STEPUP[3], SPEC('OpenID Shared Signals', 'Share revocation and risk events between systems')],
  },
];
