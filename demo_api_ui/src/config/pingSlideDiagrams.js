// Two Ping-deck slides redrawn as ReactFlow (PingSlideFlow): the OBO digital assistant and the coding agent.
// Each edge carries `step` (1-based) = the walkthrough step that animates it; STEPS feeds the page's step bar.
const N = (id, kind, x, y, o = {}) => ({ id, kind, x, y, ...o });
const E = (from, to, fs, ts, step, o = {}) => ({ from, to, fs, ts, step, ...o });
const S = (title, desc) => [title, desc];

export const OBO_SLIDE = {
  title: 'Workload Agent:',
  subtitle: 'Digital Assistant (OBO)',
  nodes: [
    N('boundary', 'boundary', 215, 10, { w: 28, h: 560 }),
    N('user', 'user', 20, 400, { w: 96, h: 96 }),
    N('idp', 'ping', 420, 60, { w: 62, h: 62, label: 'IdP/\nOAuth AS' }),
    N('az', 'ping', 760, 60, { w: 62, h: 62, label: 'Fine Grained AZ' }),
    N('agent', 'robot', 380, 380, { w: 150, h: 150, badge: '3', label: 'Agent Credential', sub: '(PK-JWT or\nSVID-JWT)' }),
    N('gw', 'gateway', 1010, 60, { w: 86, h: 500, label: 'Agent Gateway' }),
    N('hd', 'text', 1420, 40, { label: 'Backend Data Resources' }),
    N('sa', 'servers', 1400, 90, { mcp: true, label: 'Service A' }),
    N('sb', 'servers', 1400, 220, { mcp: true, label: 'Service B' }),
    N('sc', 'servers', 1400, 350, { label: 'Service C' }),
    N('sd', 'servers', 1400, 480, { label: 'Service D' }),
  ],
  edges: [
    E('user', 'idp', 't', 'l', 1, { n: '1', label: 'User Authentication', dx: 60 }),
    E('user', 'agent', 'r', 'l', 2, { n: '2', label: 'Access Token', sub: '(UserID)', dx: 25 }),
    E('agent', 'idp', 't', 'b', 3, { n: '3a', label: 'Access Token', sub: '(UserID)', off: -14, dx: -105 }),
    E('idp', 'az', 'r', 'l', 4, { n: '3b', label: 'Authorize the exchange', dashed: true }),
    E('idp', 'agent', 'b', 't', 5, { n: '3c', label: 'TX Token', sub: '(UserID, AgentID)', off: 14, dx: 125 }),
    E('agent', 'gw', 'r', 'l', 6, { n: '4', label: 'TX Token', sub: '(UserID, AgentID)' }),
    E('gw', 'az', 'lt', 'r', 7, { n: '5', label: 'Per-call decision', dashed: true }),
    E('gw', 'sa', 'r', 'l', 8, { n: '6a', label: 'mTLS', at: 'end' }),
    E('gw', 'sb', 'r', 'l', 8, { n: '6b', label: 'ClientID / Client Secret', at: 'end' }),
    E('gw', 'sc', 'r', 'l', 8, { n: '6c', label: 'Access Token', sub: '(UserID)', at: 'end' }),
    E('gw', 'sd', 'r', 'l', 8, { n: '6d', label: 'API Key', at: 'end' }),
  ],
};

export const OBO_STEPS = [
  ['User authentication', 'The user signs in at the IdP / OAuth authorization server from outside the trust boundary.'],
  ['Access token to the assistant', 'The user hands the digital assistant an access token that carries only the UserID.'],
  ['Agent credential + token presented', 'The agent proves its own identity (PK-JWT or SVID-JWT) and presents the user access token to the IdP.'],
  ['Fine Grained AZ checks the exchange', 'The IdP asks fine-grained authorization whether this agent may act for this user.'],
  ['TX token issued', 'The IdP returns a transaction token that names both the user and the agent.'],
  ['Agent calls through the gateway', 'The agent presents the TX token (UserID, AgentID) to the Agent / MCP / API gateway.'],
  ['Gateway asks for a decision', 'The gateway asks fine-grained authorization to decide this specific call.'],
  ['Gateway reaches each backend its own way', 'The gateway uses mTLS, client credentials, the user access token or an API key, whatever each service accepts. The agent never holds those.'],
];

export const CODING_SLIDE = {
  title: 'Employee Agents:',
  subtitle: 'Coding Agents',
  nodes: [
    N('boundary', 'boundary', 20, 10, { w: 28, h: 560 }),
    N('dev', 'user', 90, 380, { w: 70, h: 70, label: 'Developer' }),
    N('idp', 'ping', 300, 60, { w: 62, h: 62, label: 'IdP/\nOAuth AS' }),
    N('agent', 'robot', 300, 360, { w: 130, h: 130, label: 'Coding Agent', sub: 'PingOne Privilege Endpoint Controller' }),
    N('gw', 'gateway', 640, 60, { w: 86, h: 500, label: 'Agent Broker' }),
    N('hd', 'text', 1000, 30, { label: 'Backend Data Resources' }),
    N('sa', 'servers', 960, 90, { mcp: true, label: 'Service A', sub: '(Jira)' }),
    N('sb', 'servers', 960, 210, { mcp: true, label: 'Service B', sub: '(Github / Gitlab)' }),
    N('sc', 'servers', 960, 340, { label: 'Server' }),
    N('sd', 'servers', 960, 470, { label: 'Database' }),
  ],
  edges: [
    E('dev', 'idp', 't', 'l', 1, { n: '1', label: 'User Authentication', dx: 50 }),
    E('dev', 'agent', 'r', 'l', 2, { n: '2', label: 'Starts the agent', dx: -20 }),
    E('agent', 'gw', 'r', 'l', 3, { n: '3', label: 'Calls the broker', dx: 20 }),
    E('gw', 'idp', 'lt', 'r', 4, { n: '4', label: 'Broker resolves identity', sub: 'user + agent' }),
    E('gw', 'sa', 'r', 'l', 5, { n: '5a', label: 'JIT Credential', sub: 'Access Token · Sub: UserID', at: 'end' }),
    E('gw', 'sb', 'r', 'l', 5, { n: '5b', label: 'JIT Credential', sub: 'Access Token · Sub: UserID', at: 'end' }),
    E('gw', 'sc', 'r', 'l', 5, { n: '5c', label: 'JIT Credential', sub: 'SSH Key · Sub: UserID', at: 'end' }),
    E('gw', 'sd', 'r', 'l', 5, { n: '5d', label: 'JIT Credential', sub: 'DB Key · Sub: admin', at: 'end' }),
  ],
};

export const CODING_STEPS = [
  ['User authentication', 'The developer signs in to the IdP, so every agent action traces to a person.'],
  ['Developer starts the coding agent', 'The agent runs under the developer, with the endpoint controller watching the host.'],
  ['Agent calls the broker', 'The agent never holds long-lived credentials; it asks the Agent Broker for access.'],
  ['Broker resolves identity', 'The broker ties the request to the developer and the agent at the IdP / OAuth AS.'],
  ['Just-in-time credentials', 'The broker injects a short-lived credential per resource (token, SSH key, DB key) so agents only get what they need, when they need it.'],
];

// ID-JAG slide (dark): same story as the SVG scene it replaces, for the six WORKLOAD_META.idjag steps.
export const ID_JAG_SLIDE = {
  title: 'Workload Agents',
  subtitle: '3rd-party MCP via ID-JAG · as built in the Super AI Demo',
  dark: true,
  aspect: '1700 / 850',
  nodes: [
    N('zone', 'zone', 250, 20, { w: 1220, h: 820, label: 'Trust boundary' }),
    N('user', 'user', 10, 420, { w: 90, h: 90 }),
    N('uilab', 'text', 0, 520, { label: 'Customer · Admin\nbrowser · passkey' }),
    N('ui', 'win', 140, 432, { w: 150, h: 66, label: 'demo_api_ui :4000', sub: 'React SPA · cookie only' }),
    N('bff', 'redbar', 340, 260, { w: 76, h: 400, label: 'demo_api_server :3001', sub: 'BFF · token custodian · session' }),
    N('idp', 'redbox', 560, 90, { w: 300, h: 80, label: 'PingOne / PingFederate', sub: '(IdP · AS) · PingFederate issues the ID-JAG' }),
    N('authz', 'redbox', 1060, 90, { w: 280, h: 80, label: 'PingOne Authorize', sub: 'PAP / PDP · mock demo_authz_server :9001' }),
    N('agents', 'agents', 580, 400, { w: 360, h: 210, label: 'Enterprise agents', items: ['demo_agent_service :3006', 'langchain_agent :8888', 'openai · mastra · pydantic', 'A2A specialist'] }),
    N('gw', 'redbar', 1120, 300, { w: 80, h: 380, label: 'PingGateway (IG) :3036', sub: 'PEP · alt: demo_mcp_gateway :3005' }),
    N('mcp', 'win', 1560, 440, { w: 220, h: 80, label: '3rd-party MCP: oauth-mcp', sub: 'external door · dual role' }),
    N('spire', 'grey', 580, 690, { w: 360, h: 80, label: 'SPIRE 1.15.2', sub: 'trust domain spiffe://bxfinance.demo' }),
    N('as', 'grey', 1120, 740, { w: 300, h: 70, label: '3rd-party AS', sub: 'embedded OAuth 2.1 · ID-JAG grant' }),
  ],
  edges: [
    E('user', 'ui', 'r', 'l', 1),
    E('ui', 'bff', 'r', 'l', 1),
    E('user', 'idp', 't', 'l', 1, { label: 'User AuthN', sub: 'PingFederate login · UC40', dx: -150, dy: 34 }),
    E('bff', 'idp', 't', 'l', 2, { label: 'RFC 8693 → ID-JAG', sub: 'subject = user · BFF holds the refresh token\naudience = 3rd-party AS · resource = 3rd-party MCP', dx: 60, dy: -78 }),
    E('spire', 'agents', 't', 'b', 2, { label: 'JWT-SVID', sub: '→ actor_token on the exchange', at: 'end', dx: 150 }),
    E('bff', 'agents', 'r', 'l', 3, { label: 'AG-UI · SSE · STATE_DELTA', sub: 'OTel traces → Jaeger · Grafana', dy: 46 }),
    E('gw', 'agents', 'l', 'r', 3, { label: 'Invalid token → 401', sub: 'RFC 9728 · discover the AS', dashed: true, deny: true, off: 26, dy: 52 }),
    E('bff', 'as', 'b', 'l', 4, { label: 'ID-JAG → 3rd-party AT', sub: 'jwt-bearer grant (RFC 7523)\nvalidates PingFederate JWKS · issuer · audience · resource · replay', dx: 150, dy: 58 }),
    E('agents', 'gw', 'r', 'l', 5, { label: 'MCP tools/call', sub: '3rd-party AT · not the ID-JAG', off: -26, dy: -50, dx: -40 }),
    E('gw', 'authz', 't', 'b', 5, { label: 'Token validation', sub: 'introspect RFC 7662 + decision request', dx: -120 }),
    E('authz', 'gw', 'b', 't', 6, { label: 'PERMIT', sub: 'aud · resource checked', dashed: true, off: 26, dx: 80 }),
    E('gw', 'mcp', 'r', 'l', 6, { label: 'PERMIT → tool runs', sub: 'on the 3rd-party MCP server' }),
  ],
};

// ---- Topology and CIBA slides (dark): same nodes as the ID-JAG slide plus the MCP servers and HITL service ----
const workloadBase = (opts = {}) => [
  N('zone', 'zone', 250, -40, { w: 1220, h: 890, label: 'Trust boundary' }),
  N('user', 'user', 10, 420, { w: 90, h: 90 }),
  N('uilab', 'text', 0, 520, { label: 'Customer · Admin\nbrowser · passkey' }),
  N('ui', 'win', 130, 422, { w: 170, h: 90, label: 'demo_api_ui :4000', sub: 'React SPA · cookie only' }),
  N('bff', 'redbar', 340, 260, { w: 76, h: 400, label: 'demo_api_server :3001', sub: 'BFF · token custodian · session' }),
  N('idp', 'redbox', 560, 90, { w: 300, h: 80, label: 'PingOne / PingFederate', sub: opts.idpSub }),
  N('authz', 'redbox', 1080, 90, { w: 280, h: 80, label: 'PingOne Authorize', sub: 'PAP / PDP · mock demo_authz_server :9001' }),
  N('agents', 'agents', 580, 400, { w: 360, h: 250, label: 'Enterprise agents', items: ['demo_agent_service :3006', 'langchain_agent :8888', 'openai · mastra · pydantic', 'A2A specialist', 'LLM via demo_llm_proxy :8090 (llama.cpp · oMLX)'] }),
  N('gw', 'redbar', 1140, 300, { w: 80, h: 380, label: 'PingGateway (IG) :3036', sub: 'PEP · alt: demo_mcp_gateway :3005' }),
  N('m1', 'win', 1580, 300, { w: 230, h: 66, label: 'oauth-mcp :8080', sub: 'Banking · aud mcp_banking' }),
  N('m2', 'win', 1580, 400, { w: 230, h: 66, label: 'mcp_resource_server :8081', sub: 'Invest MCP · SQLite' }),
  N('m3', 'win', 1580, 500, { w: 230, h: 66, label: 'api_resource_server :8082', sub: 'mortgage REST · X-API-Key' }),
  N('hitl', 'win', 1140, 730, { w: 250, h: 70, label: 'demo_hitl_service :3009', sub: 'HITL challenge · receipts' }),
];

export const TOPOLOGY_SLIDE = {
  title: 'Workload Agents',
  subtitle: 'Agent Core + Gateway + Authorization · as built in the Super AI Demo',
  dark: true,
  aspect: '1900 / 900',
  nodes: [
    ...workloadBase({ idpSub: '(IdP · AS) · RFC 8693 · RFC 7662 · JWKS' }),
    N('dir', 'redbox', 900, -10, { w: 190, h: 66, label: 'PingOne Directory', sub: 'users · groups · agent clients' }),
    N('spire', 'grey', 580, 730, { w: 360, h: 80, label: 'SPIRE 1.15.2', sub: 'trust domain spiffe://bxfinance.demo' }),
    N('third', 'win', 1580, 620, { w: 230, h: 66, label: '3rd-party MCP', sub: 'mcp-weather · mcp-brave · public' }),
  ],
  edges: [
    E('spire', 'agents', 't', 'b', 1, { label: 'JWT-SVID', sub: 'attest · container selectors', dx: 150, dy: -20 }),
    E('user', 'idp', 't', 't', 2, { label: 'User AuthN', sub: 'OIDC auth code + PKCE · passkey', dx: -40, dy: -10 }),
    E('idp', 'dir', 'r', 'l', 2),
    E('user', 'ui', 'r', 'l', 3),
    E('ui', 'bff', 'r', 'l', 3),
    E('bff', 'idp', 't', 'l', 4, { label: 'RFC 8693 token exchange', sub: 'subject = user AT · actor = agent', dx: 120, dy: -60 }),
    E('idp', 'agents', 'b', 't', 4, { both: true, label: 'Delegated AT', sub: 'sub = user · act = agent · aud = mcp-gw', dx: 90 }),
    E('bff', 'agents', 'r', 'l', 5, { both: true, label: 'AG-UI · SSE · STATE_DELTA', sub: 'OTel traces → Jaeger · Grafana', dy: 46 }),
    E('agents', 'gw', 'r', 'l', 6, { label: 'MCP tools/call', sub: 'JSON-RPC · WS', off: -26, dy: -50, dx: -40 }),
    E('gw', 'agents', 'l', 'r', 6, { dashed: true, deny: true, label: 'Invalid token → 401', sub: 'RFC 9728 metadata', off: 26, dy: 52 }),
    E('gw', 'authz', 't', 'b', 7, { both: true, label: 'Token validation', sub: 'introspect RFC 7662 + decision', dx: -130 }),
    E('dir', 'authz', 'r', 't', 7, { dashed: true, label: 'PIP', sub: 'user · group · agent attrs' }),
    E('gw', 'm1', 'r', 'l', 8), E('gw', 'm2', 'r', 'l', 8), E('gw', 'm3', 'r', 'l', 8),
    E('gw', 'hitl', 'b', 't', 9, { both: true, label: '-32002 / 403 hitl_required', sub: 'challenge opened; tool runs after approval', dx: 130 }),
  ],
};

export const CIBA_SLIDE = {
  title: 'Workload Agents',
  subtitle: 'Step-up authorization · CIBA (HITL) · as built in the Super AI Demo',
  dark: true,
  aspect: '1900 / 900',
  nodes: workloadBase({ idpSub: '(IdP · AS) · OIDC CIBA Core 1.0 · RFC 8693' }),
  edges: [
    E('agents', 'gw', 'r', 'l', 1, { label: 'MCP create_transfer', sub: 'delegated token', off: -26, dy: -50, dx: -40 }),
    E('gw', 'authz', 't', 'b', 2, { label: 'Token validation + decision', sub: 'STEP_UP · amount ≥ $500', dx: -150 }),
    E('gw', 'agents', 'l', 'r', 3, { dashed: true, deny: true, label: 'Not authorized', sub: 'step-up required', off: 26, dy: 52 }),
    E('bff', 'idp', 't', 'l', 4, { label: 'CIBA backchannel request', sub: 'login_hint = session user · binding_message = the transfer', dx: 120, dy: -60 }),
    E('idp', 'user', 'l', 't', 5, { dashed: true, label: 'Approved', sub: 'out-of-band · MFA push · /ciba-approve', dx: -10, dy: -26 }),
    E('idp', 'bff', 'b', 't', 6, { dashed: true, label: 'poll → tokens', sub: 'stepUpVerified · 5-min TTL', dx: 70, dy: 10 }),
    E('bff', 'agents', 'r', 'l', 7, { label: 'retry with receipt', sub: 'TX JWT · single-use', dy: 46 }),
    E('gw', 'hitl', 'b', 't', 7, { both: true, label: 'Challenge + receipt', dx: 110 }),
    E('authz', 'gw', 'b', 't', 8, { dashed: true, label: 'Approved · PERMIT', off: 30, dx: 120 }),
    E('gw', 'm1', 'r', 'l', 8), E('gw', 'm2', 'r', 'l', 8), E('gw', 'm3', 'r', 'l', 8),
  ],
};

// ---- Agentic Control Plane (dark): reference architecture of the demo's control plane, one box per role ----
const CP = (id, kind, x, y, w, h, o = {}) => N(id, kind, x, y, { w, h, ...o });
export const CONTROL_PLANE_SLIDE = {
  title: 'Agentic Control Plane',
  subtitle: 'reference architecture mapped to the Super AI Demo',
  dark: true,
  aspect: '1900 / 1000',
  nodes: [
    CP('cust', 'card', 0, 60, 150, 90, { label: 'Customers', sub: 'AI consumers', steps: [1] }),
    CP('ext', 'card', 0, 180, 150, 90, { label: 'External', sub: 'MCP clients', steps: [1] }),
    CP('build', 'card', 0, 300, 150, 90, { label: 'Builders', sub: 'AI developers', steps: [1] }),
    CP('admin', 'card', 0, 420, 150, 90, { label: 'IT Admins', sub: 'IAM and security', steps: [1] }),
    CP('cpcol', 'panel', 180, 20, 210, 880, { label: 'Agentic Control Plane · visibility across agents' }),
    CP('catalog', 'card', 200, 60, 170, 140, { label: 'Agent/MCP Catalog', sub: '/mcp-tools\n/agent-registry', steps: [8] }),
    CP('registry', 'card', 200, 230, 170, 140, { label: 'Agent Registry', sub: 'PingOne agent clients\nA2A Agent Cards', steps: [8] }),
    CP('discovery', 'card', 200, 400, 170, 150, { label: 'Agent Discovery', sub: 'mcp-discovery-agent\nShadow AI detector\n/mcp-discovery', steps: [9] }),
    CP('govern', 'card', 200, 580, 170, 140, { label: 'Agent Governance', sub: '/agent-lifecycle\nIGA for AI · UC46', steps: [9] }),
    CP('obs', 'card', 200, 750, 170, 130, { label: 'Observability', sub: 'Grafana · Jaeger · Loki\n/mcp-observability', steps: [9] }),
    CP('idp', 'redcard', 430, 60, 330, 190, { label: 'IDP / OAuth Authorization Server', sub: 'PingOne · PingFederate · the only issuer of tokens', items: ['SSO · PKCE · passkey', 'Agent identity · clients', 'Token exchange RFC 8693', 'OAuth 2.0 · CIBA · ID-JAG'], steps: [2] }),
    CP('helix', 'card', 800, 30, 200, 70, { label: 'Helix', sub: 'LLM · intent engine for the agent', steps: [3] }),
    CP('authz', 'redcard', 800, 120, 200, 190, { label: 'Fine-grained Authz', sub: 'PingOne Authorize · PDP', items: ['PERMIT · DENY · STEP-UP · HITL', 'Intent binding · PAR', 'Attributes (PIP)'], steps: [3] }),
    CP('jit', 'redcard', 1030, 120, 210, 190, { label: 'JIT Credential Broker', sub: 'PingOne Privilege', items: ['Virtual LLM keys', 'OAuth handling · MCP creds', 'JIT injection · rotation'], steps: [4] }),
    CP('secrets', 'card', 1270, 120, 170, 190, { label: 'Secret Stores', sub: 'Privilege reads from here\nsecrets.vault · AES-GCM\nPingOne Privilege vault\nK8s secrets (SE cluster)', steps: [4] }),
    CP('spire', 'dashedcard', 1270, 340, 200, 180, { label: 'Workload IDP', sub: 'SPIRE · credential broker\nWorkload identity · attestation\nSPIFFE JWT-SVID issuance\nJIT injection · spiffe-helper', steps: [5] }),
    CP('ap', 'panel', 430, 340, 620, 300, { label: 'Agent Privilege · PEP · identity from the IAM core · decisions from Authorize · credentials from Privilege', steps: [6] }),
    CP('llmgw', 'card', 450, 420, 140, 120, { label: 'LLM Gateway', sub: 'demo_llm_proxy :8090', steps: [6] }),
    CP('mcpgw', 'card', 610, 420, 140, 120, { label: 'MCP Gateway', sub: 'mcp_gateway :3005', steps: [6] }),
    CP('a2agw', 'card', 770, 420, 140, 120, { label: 'A2A Gateway', sub: 'UC2 delegation', steps: [6] }),
    CP('guard', 'card', 930, 420, 100, 120, { label: 'AI Guard', sub: 'Privilege AI Guard', steps: [6] }),
    CP('ping-gw', 'redbar', 1080, 340, 130, 300, { label: 'Ping Gateway', sub: 'PingGateway (IG) :3036 · ingress PEP', steps: [7] }),
    CP('custmcp', 'card', 1250, 580, 230, 70, { label: 'Custom MCP Servers', sub: 'oauth-mcp · invest RS · mortgage RS', steps: [7] }),
    CP('thirdmcp', 'card', 1250, 660, 230, 70, { label: '3rd-party MCP Servers', sub: 'weather · Brave · hosted PingOne MCP', steps: [7] }),
    CP('virtmcp', 'card', 1250, 740, 230, 70, { label: 'Virtual MCP Servers', sub: 'MCP facade · aggregation at the gateway', steps: [7] }),
    CP('llmprov', 'card', 1250, 820, 230, 70, { label: 'LLM Providers', sub: 'llama.cpp · OpenAI · Anthropic via Privilege', steps: [7] }),
    CP('endpoint', 'card', 430, 680, 175, 70, { label: 'Endpoint Controller', sub: 'mcp-discovery-agent · pid: host', steps: [5] }),
    CP('personal', 'card', 430, 770, 170, 160, { label: 'Personal Agents', sub: 'local developer tools · external door\nLM Studio · Claude · Inspector · LibreChat\nChatGPT · Claude Code', steps: [10] }),
    CP('enterprise', 'panel', 630, 770, 570, 160, { label: 'Enterprise Workload Agents · an ecosystem of agents' }),
    CP('saas', 'card', 650, 810, 170, 100, { label: 'SaaS embedded', sub: '/personal-agent · P1 MCP', steps: [10] }),
    CP('orch', 'card', 830, 810, 170, 100, { label: 'Orchestrator agents', sub: 'demo_agent_service · AG-UI', steps: [10] }),
    CP('ephem', 'card', 1010, 810, 170, 100, { label: 'Ephemeral agents', sub: 'autonomous runs', steps: [10] }),
  ],
  edges: [
    E('idp', 'authz', 'r', 'l', 3),
    E('authz', 'jit', 'r', 'l', 4),
    E('jit', 'secrets', 'r', 'l', 4),
    E('spire', 'secrets', 't', 'b', 5, { dashed: true }),
    E('ap', 'authz', 't', 'b', 6, { dashed: true, dx: 280 }),
    E('ping-gw', 'custmcp', 'r', 'l', 7, { label: 'MCP' }),
    E('ping-gw', 'llmprov', 'r', 'l', 7, { label: 'LLM' }),
    E('enterprise', 'ap', 't', 'b', 10),
  ],
};

export const CONTROL_PLANE_STEPS = [
  S('Who shows up', 'Customers in the vertical apps, external MCP clients that have never talked to this system, agent builders, and the IAM and security admins. Four audiences, four trust levels.'),
  S('One issuer of tokens', 'PingOne (and PingFederate for ID-JAG) is the only place tokens are issued, exchanged or revoked: SSO with passkeys, per-agent OAuth clients, RFC 8693 exchange, CIBA.'),
  S('Fine-grained decisions', 'PingOne Authorize decides PERMIT, DENY, STEP-UP or HITL for every tool call, with intent binding (PAR) and directory attributes. Helix supplies the language model that turns a prompt into an intent.'),
  S('Credentials are brokered', 'PingOne Privilege hands agents virtual LLM keys and brokers MCP credentials just in time, reading from the encrypted secrets.vault and its own vault. An agent never holds a provider key.'),
  S('Workload identity', 'SPIRE attests each agent container and issues SPIFFE JWT-SVIDs through the spiffe-helper sidecar. The SVID becomes the actor_token on the exchange.'),
  S('Enforcement at the gateways', 'The Agent Privilege tier (LLM proxy, MCP gateway, A2A delegation, AI Guard) and PingGateway as ingress PEP apply those decisions and credentials to every request.'),
  S('Tools and models', 'Custom MCP servers (banking, invest, mortgage), third-party MCP (weather, Brave, hosted PingOne MCP), a virtual MCP facade, and LLM providers from local llama.cpp to OpenAI and Anthropic via Privilege.'),
  S('The control plane sees all of it', 'Catalog, registry, discovery, governance and observability: /agent-registry, /mcp-tools, the shadow-AI detector, IGA access reviews (UC46), and Grafana, Jaeger and Loki.'),
  S('Discovery and governance watch the estate', 'The catalog, registry, discovery, governance and observability columns read from every layer above.'),
  S('Agents do the work', 'Personal agents (LM Studio, Claude Desktop, MCP Inspector, LibreChat) come in through the external door; enterprise agents run as the AG-UI orchestrator, A2A specialists and ephemeral autonomous runs.'),
];
