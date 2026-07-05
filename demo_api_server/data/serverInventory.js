'use strict';

// Server inventory — the dataset behind GET /api/health/inventory and the
// /servers page. Prose mirrors docs/server-inventory-sot.md (the human-readable
// source of truth); keep both in sync when services change.
//
// candidates[] is the probe order: env override → compose hostname → localhost,
// so the same module works in docker (./run-docker.sh) and native (./run.sh).

const normalizeWs = (u) =>
  u && u.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');

const env = (name) => process.env[name] || null;

const candidates = (...urls) => urls.filter(Boolean);

const SERVER_INVENTORY = [
  {
    key: 'api-server', name: 'Banking API Server (BFF)', container: 'ai-demo-api-server',
    hostPort: 3001, internalPort: 3001, lang: 'Node (Express)', category: 'core', sourceDir: 'demo_api_server', probe: 'self',
    purpose: 'Backend-for-frontend — OAuth/sessions, token chain, admin, reports; fronts every backend.',
  },
  {
    key: 'ui', name: 'Banking UI', container: 'ai-demo-ui',
    hostPort: 4000, internalPort: 4000, lang: 'React/Vite + nginx', category: 'core', sourceDir: 'demo_api_ui', probe: true,
    healthPath: '/', acceptAnyStatus: true,
    candidates: candidates('https://frontend:4000', 'https://localhost:4000'),
    purpose: 'The demo web app, served over HTTPS.',
  },
  {
    key: 'mortgage-service', name: 'Mortgage Service', container: 'ai-demo-mortgage-service',
    hostPort: 8082, internalPort: 8082, lang: 'Node', category: 'core', sourceDir: 'demo_mortgage_service', probe: true,
    candidates: candidates(env('MORTGAGE_SERVICE_URL'), 'http://mortgage-service:8082', 'http://localhost:8082'),
    purpose: 'Mock mortgage backend/business API.',
  },
  {
    key: 'mcp-server', name: 'MCP Server (OLB)', container: 'ai-demo-mcp-server',
    hostPort: 8080, internalPort: 8080, lang: 'Node (WebSocket)', category: 'mcp', sourceDir: 'demo_mcp_server', probe: true,
    candidates: candidates(normalizeWs(env('MCP_SERVER_URL')), 'http://mcp-server:8080', 'http://localhost:8080'),
    purpose: 'Primary MCP server — online-banking tools over WebSocket.',
  },
  {
    key: 'mcp-invest', name: 'MCP Invest', container: 'ai-demo-mcp-invest',
    hostPort: 8081, internalPort: 8081, lang: 'Node/TS', category: 'mcp', sourceDir: 'demo_mcp_invest', probe: true,
    candidates: candidates(normalizeWs(env('MCP_INVEST_WS_URL')), 'http://mcp-invest:8081', 'http://localhost:8081'),
    purpose: 'Second MCP server exposing investment tools.',
  },
  {
    key: 'mcp-gateway', name: 'MCP Gateway (custom)', container: 'ai-demo-mcp-gateway',
    hostPort: 3005, internalPort: 3005, lang: 'Node/TS', category: 'mcp', sourceDir: 'demo_mcp_gateway', probe: true,
    candidates: candidates(env('MCP_GATEWAY_HTTP_URL'), 'http://mcp-gateway:3005', 'http://localhost:3005'),
    purpose: 'Auth-enforcing MCP gateway — routes to mcp-server/mcp-invest, PingAuthorize introspection.',
  },
  {
    key: 'ping-gateway', name: 'PingGateway (IG)', container: 'ai-demo-ping-gateway',
    hostPort: 3036, internalPort: 8080, lang: 'Ping Identity IG', category: 'mcp', sourceDir: 'ping-gateway', probe: true,
    healthPath: '/', acceptAnyStatus: true,
    candidates: candidates(env('MCP_PINGGATEWAY_URL'), 'http://ping-gateway:8080', 'http://localhost:3036'),
    purpose: 'Alternative MCP gateway using the real PingGateway product (ff_mcp_gateway_pinggateway).',
  },
  {
    key: 'mcp-proxy', name: 'MCP Proxy', container: 'ai-demo-mcp-proxy',
    hostPort: 8895, internalPort: 8895, lang: 'Node', category: 'mcp', sourceDir: 'demo_mcp_proxy', probe: true,
    candidates: candidates(env('MCP_PROXY_URL'), 'http://mcp-proxy:8895', 'http://localhost:8895'),
    purpose: 'HTTP-to-MCP sidecar — exposes MCP tools as plain REST.',
  },
  {
    key: 'agent-service', name: 'Agent Service', container: 'ai-demo-agent-service',
    hostPort: 3016, internalPort: 3006, lang: 'Node/TS (LangGraph)', category: 'agents', sourceDir: 'demo_agent_service', probe: true,
    candidates: candidates(env('AGENT_SERVICE_URL'), 'http://agent-service:3006', 'http://localhost:3016', 'http://localhost:3006'),
    purpose: 'Agent orchestration / Helix routing service (host port 3016 — OrbStack reserves 3006).',
  },
  {
    key: 'langchain-agent', name: 'LangChain Agent', container: 'ai-demo-langchain-agent',
    hostPort: 8888, internalPort: 8888, lang: 'Python (uvicorn)', category: 'agents', sourceDir: 'langchain_agent', probe: true,
    candidates: candidates('http://langchain-agent:8890', 'http://localhost:8890'),
    purpose: 'LangChain agent runtime — 8888 AG-UI SSE, 8889 WS chat, 8890 health.',
  },
  {
    key: 'openai-agent', name: 'OpenAI Agent', container: 'ai-demo-openai-agent',
    hostPort: 8891, internalPort: 8891, lang: 'Python (uvicorn)', category: 'agents', sourceDir: 'openai_agent', probe: true,
    candidates: candidates('http://openai-agent:8891', 'http://localhost:8891'),
    purpose: 'OpenAI-SDK agent runtime variant.',
  },
  {
    key: 'mastra-agent', name: 'Mastra Agent', container: 'ai-demo-mastra-agent',
    hostPort: 8892, internalPort: 8892, lang: 'Node/TS (Mastra)', category: 'agents', sourceDir: 'mastra_agent', probe: true,
    candidates: candidates('http://mastra-agent:8892', 'http://localhost:8892'),
    purpose: 'Mastra agent runtime variant.',
  },
  {
    key: 'pydantic-agent', name: 'Pydantic Agent', container: 'ai-demo-pydantic-agent',
    hostPort: 8893, internalPort: 8893, lang: 'Python (uvicorn)', category: 'agents', sourceDir: 'pydantic_agent', probe: true,
    candidates: candidates('http://pydantic-agent:8893', 'http://localhost:8893'),
    purpose: 'Pydantic-AI agent runtime variant.',
  },
  {
    key: 'hitl-service', name: 'HITL Service', container: 'ai-demo-hitl-service',
    hostPort: 3009, internalPort: 3009, lang: 'Node', category: 'authz', sourceDir: 'demo_hitl_service', probe: true,
    candidates: candidates(env('HITL_SERVICE_URL'), 'http://hitl-service:3009', 'http://localhost:3009'),
    purpose: 'Human-in-the-loop consent service (CIBA-style approvals).',
  },
  {
    key: 'authz-server', name: 'Mock Authz Server', container: 'ai-demo-authz-server',
    hostPort: 9001, internalPort: 9001, lang: 'Node', category: 'authz', sourceDir: 'demo_authz_server', probe: true,
    candidates: candidates('http://authz-server:9001', 'http://localhost:9001'),
    purpose: 'Mock PingOne Authorization — token introspection + policy decisions.',
  },
  {
    key: 'llm-proxy', name: 'LLM Proxy (router)', container: 'ai-demo-llm-proxy',
    hostPort: 8090, internalPort: 8090, lang: 'Node', category: 'ai-infra', sourceDir: 'demo_llm_proxy', probe: true,
    candidates: candidates(env('LLAMACPP_BASE_URL'), 'http://llm-proxy:8090', 'http://localhost:8090'),
    purpose: 'Smart router — classifies each LLM request onto the smallest capable host llama tier.',
  },
  {
    key: 'weaviate', name: 'Weaviate', container: 'ai-demo-weaviate',
    hostPort: null, internalPort: 8080, lang: 'Go (vector DB)', category: 'ai-infra', sourceDir: null, probe: true,
    healthPath: '/v1/meta',
    candidates: candidates(env('WEAVIATE_URL'), 'http://weaviate:8080'),
    purpose: 'Vector DB backing RAG code search. Internal only — no host port.',
  },
  {
    key: 'embeddings', name: 'Embeddings (llama.cpp)', container: 'ai-demo-embeddings',
    hostPort: 8084, internalPort: 8080, lang: 'llama.cpp server', category: 'ai-infra', sourceDir: null, probe: true,
    candidates: candidates(env('EMBEDDINGS_URL'), 'http://embeddings:8080', 'http://localhost:8084'),
    purpose: 'OpenAI-compatible /v1/embeddings (nomic-embed-text GGUF); warms up to 180s.',
  },
  {
    key: 'mcp-code-search', name: 'MCP Code Search', container: 'ai-demo-mcp-code-search',
    hostPort: 8095, internalPort: 8095, lang: 'Node', category: 'ai-infra', sourceDir: 'demo_mcp_code_search', probe: true,
    candidates: candidates(env('MCP_CODE_SEARCH_URL'), 'http://demo-mcp-code-search:8095', 'http://localhost:8095'),
    purpose: 'RAG code-search MCP service over weaviate + embeddings.',
  },
  {
    key: 'ungoverned-agent', name: 'Ungoverned Agent', container: 'ai-demo-ungoverned-agent',
    hostPort: null, internalPort: null, lang: 'Node + headless browser', category: 'demo-prop', sourceDir: 'demo_ungoverned_agent', probe: false,
    purpose: 'Demo attack prop — on-demand only (profile demo-attack); rides a logged-in bank session via the UI.',
  },
  ...[1, 2, 3, 4].map((n) => ({
    key: `llama-tier-${n}`, name: `llama-server tier ${n}`, container: null, sourceDir: null,
    hostPort: 8090 + n, internalPort: 8090 + n, lang: 'llama.cpp server', category: 'ai-infra', probe: true,
    candidates: candidates(`http://host.docker.internal:${8090 + n}`, `http://localhost:${8090 + n}`),
    purpose: `Host-side local LLM backend (${n === 1 ? 'smallest' : n === 4 ? 'largest' : 'mid'}) — target of llm-proxy. Not in compose; start via demo_llm_proxy/start-local-models.sh.`,
  })),
];

module.exports = { SERVER_INVENTORY };
