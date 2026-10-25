// How ChatGPT accesses member benefits through an MCP gateway. Illustrative proposed architecture
// (generic wording, not a production claim). Consumed by EmbeddedFlowDiagram with pingStyle.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const TOKEN = { dashed: true }; // dashed blue = a response, token or decision handed back

export const CONNECTOR_FOOTNOTE = 'P1AZ = policy decision point; MCP gateway = enforcement point.';

export const CONNECTOR_GROUPS = {
  user: { label: 'Member', bg: '#151a24' },
  client: { label: 'AI client (outside)', bg: '#5a5f69' },
  gateway: { label: 'MCP gateway + API', bg: '#151a24' },
  ping: { label: 'Ping identity and policy', bg: '#b5231a' },
};

export const CONNECTOR_NODES = [
  N('user', 'user', 'User / Browser', ['signs in and', 'approves consent'], 0, 300),
  N('chatgpt', 'client', 'ChatGPT', ['MCP client'], 400, 300),
  N('gateway', 'gateway', 'Optum MCP Gateway', ['enforcement point'], 800, 300),
  N('idp', 'ping', 'Ping IdP / OAuth AS', ['authorize, token, JWKS', 'CIMD client lookup'], 400, 0),
  N('p1az', 'ping', 'PingOne Authorize (P1AZ)', ['policy decision point'], 1200, 0),
  N('api', 'gateway', 'Optum Benefits API', ['downstream resource'], 1200, 300),
  N('openai', 'client', 'OpenAI Metadata', ['hosts ChatGPT client.json', 'and jwks.json'], 0, 0),
];

export const CONNECTOR_EDGES = [
  E('chatgpt', 'gateway', '1a POST /mcp (no token)'), // 0
  E('gateway', 'chatgpt', '1b 401 + WWW-Authenticate', TOKEN), // 1
  E('chatgpt', 'gateway', '2a GET protected-resource metadata'), // 2
  E('gateway', 'chatgpt', '2b 200 resource, authorization_servers, scopes_supported benefits:read', TOKEN), // 3
  E('chatgpt', 'idp', '3a GET OAuth AS metadata'), // 4
  E('idp', 'chatgpt', '3b 200 endpoints, PKCE S256, CIMD true, private_key_jwt', TOKEN), // 5
  E('chatgpt', 'user', '4a Sign in to Optum'), // 6
  E('user', 'idp', '4b GET /oauth/authorize client_id=https://chatgpt.com/oauth/client.json, redirect_uri, scope benefits:read, resource, PKCE S256, state'), // 7
  E('idp', 'openai', '5a GET /oauth/client.json (CIMD lookup)'), // 8
  E('openai', 'idp', '5b 200 redirect_uris, token_endpoint_auth_method private_key_jwt, jwks_uri', TOKEN), // 9
  E('idp', 'user', '6a login + resource-specific consent prompt'), // 10
  E('user', 'idp', '6b member approves or denies', TOKEN), // 11
  E('idp', 'user', '6c 302 redirect'), // 12
  E('user', 'chatgpt', '6d OAuth callback (code, state)'), // 13
  E('chatgpt', 'idp', '7a POST /oauth/token code, PKCE verifier, client_assertion jwt-bearer signed by ChatGPT'), // 14
  E('idp', 'openai', '8a GET /oauth/jwks.json'), // 15
  E('openai', 'idp', '8b public JWKS', TOKEN), // 16
  E('idp', 'chatgpt', '8c 200 access token (audience-bound)', TOKEN), // 17
  E('chatgpt', 'gateway', '9a POST /mcp with bearer token'), // 18
  E('gateway', 'p1az', '10a evaluate: member, client=ChatGPT, tool, action benefits.read, resource member/{me}/benefits, context consent_id/scope/risk'), // 19
  E('p1az', 'gateway', '10b Permit / Deny', TOKEN), // 20
  E('gateway', 'api', '11a call benefits API'), // 21
  E('api', 'gateway', '11b permitted benefits', TOKEN), // 22
  E('gateway', 'chatgpt', '12a tool result', TOKEN), // 23
  E('chatgpt', 'user', '12b explain benefits'), // 24
];

export const CONNECTOR_STEPS = [
  { key: 'tool-request', edges: [0, 1], title: 'Protected tool request', what: 'ChatGPT calls the MCP endpoint with no token; the gateway answers 401 with a WWW-Authenticate challenge.', evidence: 'The challenge points at the protected-resource metadata.' },
  { key: 'resource-discovery', edges: [2, 3], title: 'Discover protected resource', what: 'ChatGPT reads the protected-resource metadata: the resource, its authorization servers and scopes_supported (benefits:read).', evidence: '200 with resource, authorization_servers, scopes_supported.' },
  { key: 'as-discovery', edges: [4, 5], title: 'Discover OAuth configuration', what: 'ChatGPT reads the authorization server metadata: endpoints, PKCE S256, CIMD support and private_key_jwt client authentication.', evidence: '200 with endpoints, code_challenge_methods S256, client_id_metadata_document_supported true.' },
  { key: 'authorize', edges: [6, 7], title: 'Begin browser authorization', what: 'ChatGPT asks the member to sign in; the browser requests /oauth/authorize with a URL client_id, redirect_uri, scope, resource, PKCE S256 challenge and state.', evidence: 'client_id=https://chatgpt.com/oauth/client.json.' },
  { key: 'cimd', edges: [8, 9], title: 'Retrieve ChatGPT CIMD', what: 'The IdP fetches the client metadata document named by client_id and learns the allowed redirect_uris, the auth method and the jwks_uri.', evidence: '200 with redirect_uris, token_endpoint_auth_method private_key_jwt, jwks_uri.' },
  { key: 'consent', edges: [10, 11, 12, 13], title: 'IdP sign-in and consent', what: 'The member signs in and sees a resource-specific consent prompt, approves or denies, and the IdP redirects back so the browser delivers the code to ChatGPT.', evidence: 'Consent is recorded as a consent_id for later policy input.' },
  { key: 'code-exchange', edges: [14], title: 'Authorization-code exchange', what: 'ChatGPT posts the code, the PKCE verifier and a client_assertion (jwt-bearer) signed with its private key.', evidence: 'POST /oauth/token with grant_type authorization_code.' },
  { key: 'issue-token', edges: [15, 16, 17], title: 'Verify client and issue token', what: 'The IdP fetches ChatGPT\'s public keys, verifies the client assertion and the PKCE verifier, then issues an audience-bound access token.', evidence: 'Access token aud is the MCP resource; scope benefits:read.' },
  { key: 'gateway-validate', edges: [18], title: 'Gateway validates access token', what: 'ChatGPT retries POST /mcp with the bearer token; the gateway checks signature, audience, expiry, scope, member and consent.', evidence: 'Invalid or missing checks return 401 or 403 before any policy call.' },
  { key: 'p1az', edges: [19, 20], title: 'Fine-grained P1AZ decision', what: 'The gateway asks PingOne Authorize for a Permit or Deny on member, client, tool, action and resource. Consent is necessary where required but never overrides policy.', evidence: 'Inputs: action benefits.read, resource member/{me}/benefits, context consent_id, scope, risk.' },
  { key: 'api-call', edges: [21, 22], title: 'Call downstream benefits API', what: 'Only a Permit allows the gateway to call the benefits API; a Deny stops execution.', evidence: 'The API returns only the permitted benefits.' },
  { key: 'result', edges: [23, 24], title: 'Return authorized result', what: 'The gateway returns the tool result to ChatGPT, which explains the benefits to the member.', evidence: 'Illustrative proposed architecture; generic, not a production claim.' },
];
