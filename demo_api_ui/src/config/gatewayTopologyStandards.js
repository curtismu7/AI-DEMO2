// /privilege-gateway-topologies: per-arrow detail for the Ping-style diagrams (request on the wire, MOCK tokens, standards).
// STEPS[i].edges lists EDGES indexes (reel step k = EDGES[k]); each arrow here has its own STEP so the detail is specific.
// All values are teaching values: hostnames are the demo's, keys and tokens are fake. Message shapes marked "illustrative"
// show the idea, not Privilege's internal wire schema. Vocabulary comes from pingStyleStandards.js.
import { RFC, SPEC, AUTH, BEARER, MCP, META, AUTHZ } from './pingStyleStandards';

const TLS = RFC(8446, 'TLS 1.3: the encrypted hop');
const HTTP = RFC(9110, 'HTTP semantics (methods, 401/403/503)');
const H2 = RFC(9113, 'HTTP/2: one long-lived multiplexed connection');
const GRPC = SPEC('gRPC', 'Config push over HTTP/2');
const JSONRPC = SPEC('JSON-RPC 2.0', 'MCP and A2A message envelope');
const SSE = SPEC('WHATWG Server-Sent Events', 'The /sse stream MCP uses');
const FWD = RFC(7239, 'Forwarded HTTP extension (client address behind a proxy)');
const INGRESS = SPEC('Kubernetes Ingress', 'TLS termination and path routing in front of the gateway');
const DCR = RFC(7591, 'Dynamic Client Registration (the registry record shape)');
const POLICY = AUTHZ.slice(0, 2);
const A2A = SPEC('A2A Protocol', 'message/send over JSON-RPC 2.0');

const step = (edge, form, refs, tokens) => ({ edges: [edge], detail: { form, refs, ...(tokens ? { tokens } : {}) } });

const AGENT_KEY = (agent, scopes, extra = {}) => ({
  note: `Agent key · ${agent} (opaque key, not a JWT; this is what the gateway looks up)`,
  claims: { agent, scopes, key: 'pk_agent_••••3f9a', ...extra },
});
const BASE = 'https://mcpgw.ai-demo.ping-devops.com';

// Live load-balanced topology: LB_EDGES order.
export const LB_STEPS = [
  step(0, `POST /aggregate/mcp HTTP/2\nHost: mcpgw.ai-demo.ping-devops.com\nAuthorization: Bearer <access token the gateway issued at sign-in>\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "search_logs" } }`, [...MCP.slice(0, 2), TLS, HTTP, JSONRPC]),
  step(1, `nginx-public terminates TLS, then proxies to Service mcpgw-lb :8623\n  X-Forwarded-For: 203.0.113.24\n  X-Forwarded-Proto: https\n  Host: mcpgw.ai-demo.ping-devops.com`, [INGRESS, FWD, TLS]),
  step(2, `HAProxy (one of two pods)\n  balance hdr(X-Forwarded-For)   hash-type consistent\n  203.0.113.24  ->  server gateway-1\n\nResponse carries:  X-Served-By: gateway-1`, [FWD, HTTP]),
  step(3, `HAProxy (the other pod hashes identically)\n  198.51.100.9  ->  server gateway-2\n\nResponse carries:  X-Served-By: gateway-2\nHealth check: GET / every 10s; 401 counts as up (fall 2, rise 60)`, [FWD, HTTP]),
  step(4, `gateway-1 reads the client registry from privilege-redis (illustrative key)\n  GET client:2f1c9e84\nRegistrations are shared; access tokens are NOT, so a client moved to another node signs in again.`, [DCR, ...MCP.slice(0, 1)], [{
    note: 'Client registration record · shared in Redis (MOCK shape per RFC 7591)',
    claims: { client_id: '2f1c9e84', client_name: 'LM Studio', redirect_uris: ['http://localhost:1234/callback'], token_endpoint_auth_method: 'none' },
  }]),
  step(5, `gateway-2 reads the same registry\n  GET client:2f1c9e84   -> same record, so the client is known on every node\nThe token it presents was minted by gateway-1, so gateway-2 answers 401 and the client signs in again.`, [DCR, HTTP], [{
    note: 'Client registration record · same record, second node (MOCK)',
    claims: { client_id: '2f1c9e84', client_name: 'LM Studio', redirect_uris: ['http://localhost:1234/callback'], token_endpoint_auth_method: 'none' },
  }]),
  step(6, `POST /opensearch/mcp HTTP/1.1   (the known-deny door: no policy attached)\n\nHTTP/1.1 403 Forbidden\nX-Served-By: gateway-2\n\nAny node serves any app because both belong to mesh cluster ai-demo-cmuir.`, [HTTP, ...POLICY, MCP[0]]),
  step(7, `# reached only when the app's JIT policy permits the call\nPOST http://opensearch-mcp-server.curtismuir.svc.cluster.local/mcp\n{ "jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": { "name": "search" } }`, [MCP[0], JSONRPC, HTTP]),
  step(8, `POST /aggregate/mcp -> tools/list\n  merged answer = opensearch tools + banking tools (illustrative)\n  aggregate-limited filters tools; aggregate-none has no policy and denies all`, [MCP[0], JSONRPC, ...POLICY]),
  step(9, `# sidecar on the gateway pod's own localhost (grafana shown; path illustrative)\nPOST http://127.0.0.1:8081/mcp\n{ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "query" } }`, [MCP[0], JSONRPC, HTTP]),
  step(10, `POST http://hostile-mcp-server:8899/mcp\n{ "jsonrpc": "2.0", "id": 10, "method": "tools/call", "params": { "name": "run_shell" } }\n\nhostile-mcp-governed answers 403 when policy refuses; hostile-mcp passes everything through.`, [MCP[0], JSONRPC, ...POLICY]),
];

// Agent-based variant: AGENT_EDGES order.
export const AGENT_STEPS = [
  step(0, `gRPC over HTTP/2 + TLS, :443 (illustrative shape)\n  metadata: authorization = <ENV_PROXY_TOKEN>\n  config:   app opensearch-mcp-server, allowed tools, users, start/end window`, [GRPC, H2, TLS]),
  step(1, `1. Admin opens the one-time onboarding magic link\n   (Directory > Users > admin user > Services > Privilege > Generate Onboarding Link)\n2. Console pushes proxy config to the Priv Agent over gRPC\n   exposes https://opensearch.default.applications.procyon.ai:8643/sse`, [GRPC, TLS, HTTP]),
  step(2, `TLS ClientHello  SNI = proxy-us-west-2.privilege.pingone.com  :443\nHTTP/2 stream stays open (standing outbound link)\n  authorization = <ENV_PROXY_TOKEN>\nThe gateway listens on 8680; the ingress only carries 443, so it dials out instead.`, [TLS, H2, RFC(6066, 'TLS extensions (SNI)')]),
  step(3, `GET https://opensearch.default.applications.procyon.ai:8643/sse\nAccept: text/event-stream\n\nPOST /messages?sessionId=a91c\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "search" } }`, [MCP[0], JSONRPC, SSE, TLS]),
  step(4, `TLS 1.3 to proxy-us-west-2.privilege.pingone.com:443\n  inner payload: the same MCP JSON-RPC message\n  plus the device identity and tenant binding (Secure Enclave key store)`, [TLS, H2, HTTP], [{
    note: 'Device identity assertion · from the Priv Agent (MOCK; the real assertion is Privilege-internal)',
    claims: { sub: 'user1@example.com', device_id: 'dev-8c21', tenant: 'tnt-demo', key_store: 'secure-enclave' },
  }]),
  step(5, `The proxy sends the request down the standing link from arrow 3\n  HTTP/2 stream  ->  gateway :8680\nThe gateway evaluates the JIT policy (allowed tools, users, start/end window) before anything proceeds.\nDenied: 403 stops here.`, [...POLICY, H2, HTTP], [{
    note: 'JIT policy · Agentic Apps > opensearch-mcp-server > Policy (MOCK)',
    claims: { app: 'opensearch-mcp-server', allowed_tools: ['search', 'list_indices'], users: ['user1@example.com'], not_before: '2026-10-18T08:00:00Z', not_after: '2026-10-18T18:00:00Z' },
  }]),
  step(6, `POST http://<release>-opensearch-mcp-server.<ns>.svc.cluster.local/sse   (cluster-local HTTP)\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "search" } }\n\nThe MCP server sees a normal MCP call; it contains no Privilege code.`, [MCP[0], JSONRPC, HTTP, SSE]),
];

// Agentless variant: AGENTLESS_EDGES order.
const ID = 'https://auth.pingone.com/<env-id>/as';
export const AGENTLESS_STEPS = [
  step(0, `gRPC over HTTP/2 + TLS (illustrative shape)\n  metadata: authorization = <proxyToken from the agentless-mcpgw Helm values>\n  config:   app opensearch-mcp-server, allowed tools, users, start/end window\nAlongside it the Helm chart carries oidc.clientId / clientSecret / authUrl / tokenUrl / userUrl.`, [GRPC, H2, TLS]),
  step(1, `POST /opensearch-mcp-server/mcp HTTP/2\nHost: <you>-agentless-mcpgw.ping-devops.com\nContent-Type: application/json\n(no token yet)\n\nHTTP/2 401 Unauthorized  -> the client starts the sign-in`, [...MCP.slice(0, 2), RFC(6750, 'Bearer token usage (401 challenge)'), TLS]),
  step(2, `GET ${ID}/authorize?response_type=code\n  &client_id=<MCP Gateway app>&scope=openid profile email\n  &redirect_uri=https://<you>-agentless-mcpgw.ping-devops.com/callback&state=<nonce>\n\nPOST ${ID}/token\n  Authorization: Basic <client_id:client_secret>   (Client Secret Basic)\n  grant_type=authorization_code&code=<one-time code>&redirect_uri=...`, AUTH.slice(0, 4)),
  step(3, `GET ${ID}/userinfo\nAuthorization: Bearer <access token>\n\n200 OK  { "sub": "...", "email": "user1@example.com" }`, [...BEARER.slice(0, 1), BEARER[2], AUTH[3], RFC(7519, 'JSON Web Token')], [{
    note: 'Access token · PingOne, for the MCP Gateway web app (MOCK)',
    header: { alg: 'RS256', kid: 'p1-signing-key-1' },
    claims: { iss: 'https://auth.pingone.com/<env-id>/as', aud: 'https://<you>-agentless-mcpgw.ping-devops.com', sub: 'a1b2c3d4-user1', scope: 'openid profile email', client_id: '<MCP Gateway app>', iat: 1792310400, exp: 1792314000 },
  }, {
    note: 'Userinfo response · identity the policy is checked against (MOCK)',
    claims: { sub: 'a1b2c3d4-user1', email: 'user1@example.com', name: 'User One' },
  }]),
  step(4, `Ingress -> Service :8680\n  X-Forwarded-For: 203.0.113.24\n  X-Forwarded-Proto: https\n  Authorization: Bearer <session token>\nThe gateway evaluates the JIT policy against the signed-in PingOne user. Denied: 403 stops here.`, [INGRESS, FWD, ...POLICY], [{
    note: 'JIT policy · Agentic Apps > opensearch-mcp-server > Policy (MOCK)',
    claims: { app: 'opensearch-mcp-server', allowed_tools: ['search', 'list_indices'], users: ['user1@example.com'], not_before: '2026-10-18T08:00:00Z', not_after: '2026-10-18T18:00:00Z' },
  }]),
  step(5, `POST http://opensearch-mcp-server.<ns>.svc.cluster.local/sse   (cluster-local HTTP)\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "search" } }\n\nDenied calls never get here (arrow 5).`, [MCP[0], JSONRPC, HTTP, SSE]),
];

// Agent-to-agent: A2A_EDGES order.
export const A2A_STEPS_DETAIL = [
  step(0, `Console config sync to the gateway (gRPC, illustrative shape)\n  Remote Agent app + MCP app (Agentic Apps)\n  one agent per caller (Agent Privilege > Agent Registry): scopes, worker, allowed model, AIGuard`, [GRPC, TLS, ...META.slice(1, 2)], [
    AGENT_KEY('main-agent', ['llm', 'a2a'], { worker: 'worker-app', provider: 'google', allowed_model: 'gemini-2.5-flash', aiguard: true }),
    AGENT_KEY('worker-agent', ['llm', 'mcp'], { provider: 'google', allowed_model: 'gemini-2.5-pro', tools_allowed: ['search'], aiguard: true }),
  ]),
  step(1, `POST ${BASE}/llm/google/v1beta/models/gemini-2.5-flash:generateContent\nAuthorization: Bearer <main agent key>\n{ "contents": [{ "role": "user", "parts": [{ "text": "Summarise the open incident" }] }] }\n\nThe gateway checks the key and the allowed model.`, [RFC(6750, 'Bearer token usage (the agent key)'), HTTP, TLS], [AGENT_KEY('main-agent', ['llm', 'a2a'], { allowed_model: 'gemini-2.5-flash' })]),
  step(2, `POST ${BASE}/<worker-app>/a2a\nAuthorization: Bearer <main agent key>\n{ "jsonrpc": "2.0", "id": "1", "method": "message/send",\n  "params": { "message": { "role": "user", "parts": [{ "kind": "text", "text": "Check the incident" }] } } }`, [A2A, JSONRPC, META[1], RFC(6750, 'Bearer token usage (the agent key)')], [AGENT_KEY('main-agent', ['llm', 'a2a'], { worker: 'worker-app' })]),
  step(3, `The gateway checks the key, the a2a scope, the Remote Agent's policy and the guardrail, then forwards.\nA refusal stops here. The main agent's key is not forwarded; the worker never sees it.\n\nPOST http://worker-agent.<ns>.svc.cluster.local/a2a   (message/send, illustrative forward)`, [A2A, JSONRPC, ...POLICY]),
  step(4, `POST ${BASE}/llm/google/v1beta/models/gemini-2.5-pro:generateContent\nAuthorization: Bearer <worker agent key>\n\nTwo agents, two keys, two policies, two model tiers.`, [RFC(6750, 'Bearer token usage (the agent key)'), HTTP, TLS], [AGENT_KEY('worker-agent', ['llm', 'mcp'], { allowed_model: 'gemini-2.5-pro' })]),
  step(5, `POST ${BASE}/<mcp-app>/mcp\nAuthorization: Bearer <worker agent key>\n{ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "search", "arguments": { "q": "incident 4821" } } }`, [...MCP.slice(0, 2), JSONRPC, RFC(6750, 'Bearer token usage (the agent key)')], [AGENT_KEY('worker-agent', ['llm', 'mcp'], { tools_allowed: ['search'] })]),
  step(6, `POST http://<mcp-server>.<ns>.svc.cluster.local/mcp   (permitted tool call, cluster-local)\n\nThe result is screened on the way back (AIGuard):\n  personal data   -> redacted   ("jane@example.com" becomes "[EMAIL]")\n  hidden instructions in the result -> blocked before the worker's model reads it`, [MCP[0], JSONRPC, ...POLICY]),
  step(7, `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent\nx-goog-api-key: <real provider key, injected by the gateway>\n\nThe agent key never leaves the gateway; the provider never sees it, and no agent ever holds the provider key.`, [RFC(6750, 'Bearer token usage (provider credential)'), RFC(8693, 'Exchange a caller credential for a downstream one, not an API key handed to agents'), HTTP, TLS]),
];

export const STEPS_BY_TAB = { lb: LB_STEPS, agent: AGENT_STEPS, agentless: AGENTLESS_STEPS, a2a: A2A_STEPS_DETAIL };
