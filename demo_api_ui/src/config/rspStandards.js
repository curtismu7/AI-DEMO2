// Resource Server Placement: per-arrow request form, MOCK tokens and standards. STEPS is one step per EDGES
// entry (same order as RSP_EDGES in ResourceServerPlacementPage.jsx). Vocabulary: pingStyleStandards.js.
import { RFC, DRAFT, SPEC, BEARER, EXCHANGE, MCP, INTROSPECT, AUTHZ, RES } from './pingStyleStandards';

const SIDEBAND = SPEC('PingOne Authorize API gateway sideband', 'Gateway sends request and response context to the PDP');
const BFF_PATTERN = DRAFT('draft-ietf-oauth-browser-based-apps', 'OAuth 2.0 for browser-based apps (backend-for-frontend pattern)');

const mcpToken = {
  note: 'MCP token · minted by exchange #1/#2',
  header: { alg: 'RS256', typ: 'at+jwt', kid: 'p1-demo-2026' },
  claims: { iss: 'https://auth.pingone.com/ENV/as', sub: 'user1', aud: 'mcp resource', client_id: 'bff-demo', scope: 'banking:read', act: { sub: 'agent1' }, exp: 1790000900 },
};
const gatewayToken = {
  note: 'Gateway token · minted by exchange #3',
  header: { alg: 'RS256', typ: 'at+jwt', kid: 'p1-demo-2026' },
  claims: { iss: 'https://auth.pingone.com/ENV/as', sub: 'user1', aud: 'mcpserver.ping.demo', scope: 'banking:read', act: { sub: 'agent1', act: { sub: 'mcp-gateway' } }, exp: 1790000900 },
};
const step9Token = {
  note: 'Step-9 token · aud = banking resource server',
  header: { alg: 'RS256', typ: 'at+jwt', kid: 'p1-demo-2026' },
  claims: { iss: 'https://auth.pingone.com/ENV/as', sub: 'user1', aud: 'banking-rs', scope: 'accounts:read', act: { sub: 'oauth-mcp', act: { sub: 'agent1' } }, exp: 1790000900 },
};

const sidebandRequest = 'POST /sideband/request\n  {\n    "method": "GET", "url": "https://rs.demo/api/accounts",\n    "headers": { "authorization": "Bearer <step-9 token>", "x-agent-sub": "agent1", "x-mcp-tool": "get_accounts" },\n    "source_address": "10.0.4.12"\n  }';

export const RSP_STEP_DETAILS = [
  { form: 'POST /api/chat   (browser to BFF)\n  Cookie: session=<opaque id>; HttpOnly; Secure; SameSite=Lax\n  { "message": "What is my checking balance?" }', refs: [RFC(6265, 'HTTP cookies (session)'), SPEC('OIDC Core 1.0', 'Sign-in that created the session'), BFF_PATTERN] },
  { form: 'POST /mcp   (BFF to gateway)\n  Authorization: Bearer <MCP token>\n  { "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "get_accounts" } }', tokens: [mcpToken], refs: [...BEARER, ...EXCHANGE.slice(0, 2), ...MCP.slice(0, 2)] },
  { form: 'POST /as/token   (gateway exchange #3)\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<MCP token>&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n  &audience=mcpserver.ping.demo\n(then) POST /mcp  Authorization: Bearer <gateway token>', tokens: [gatewayToken], refs: [...INTROSPECT, ...EXCHANGE.slice(0, 2), ...MCP.slice(0, 1)] },
  { form: 'POST /as/token   (MCP server, step-9 exchange)\n  grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n  &subject_token=<gateway token>&audience=banking-rs&scope=accounts:read\n(then) GET /api/accounts\n  Authorization: Bearer <step-9 token>\n  X-Agent-Sub: agent1\n  X-MCP-Tool: get_accounts', tokens: [step9Token], refs: [...BEARER, ...EXCHANGE.slice(0, 3)] },
  { form: sidebandRequest, tokens: [step9Token], refs: [SIDEBAND, ...AUTHZ.slice(0, 2), RFC(7662, 'Token Introspection (active and audience check)')] },
  { form: 'HTTP/1.1 200 OK   (sideband decision)\n  { "decision": "DENY", "response": { "status": 403, "body": { "error": "access_denied" } } }\n  or { "decision": "PERMIT" } to let the call through', refs: [SIDEBAND, ...AUTHZ.slice(0, 2)] },
  { form: 'POST /sideband/response\n  { "status": 200, "headers": { "content-type": "application/json" },\n    "body": { "accounts": [ { "id": "chk-001", "balance": 4210.55 } ] } }', refs: [SIDEBAND, ...AUTHZ.slice(0, 1)] },
  { form: 'HTTP/1.1 200 OK   (sideband response decision)\n  { "body": { "accounts": [ { "id": "chk-***", "balance": null } ] } }\n  Fields removed or masked by policy before data leaves.', refs: [SIDEBAND, ...AUTHZ.slice(0, 2)] },
  { form: 'GET store.accounts(userId = "user1")   (in-process call after PERMIT)\n  returns the banking records; nothing runs on DENY.', refs: RES },
].map((detail, i) => ({ edges: [i], detail }));
