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
    // Compose service is `ui`; k8s Service is `frontend` (10-frontend-deployment.yaml).
    // Without `frontend`, /check from the in-cluster BFF reports Banking UI ECONNREFUSED
    // while ingress is still serving that UI to the browser (REGRESSION 2026-07-16).
    candidates: candidates(
      env('UI_URL'),
      'https://ui:4000',
      'https://frontend:4000',
      'https://localhost:4000',
    ),
    purpose: 'The demo web app, served over HTTPS.',
  },
  {
    key: 'api-resource-server', name: 'Mortgage Service', container: 'ai-demo-api-resource-server',
    hostPort: 8082, internalPort: 8082, lang: 'Node', category: 'core', sourceDir: 'demo_api_resource_server', probe: true,
    candidates: candidates(env('API_RESOURCE_SERVER_URL'), 'http://api-resource-server:8082', 'http://localhost:8082'),
    purpose: 'Mock mortgage backend/business API.',
  },
  {
    key: 'mcp-server', name: 'MCP Server (OLB)', container: 'ai-demo-mcp-server',
    hostPort: 8080, internalPort: 8080, lang: 'Node (WebSocket)', category: 'mcp', sourceDir: 'oauth-mcp', probe: true,
    // Scheme FOLLOWS MCP_MTLS_ENABLED. Since mTLS became the default the server
    // serves HTTPS on 8080, so the old http:// candidates got ECONNREFUSED and
    // /check reported a healthy, working MCP server as DOWN on every run —
    // a false red on the demo-readiness screen. Verified live:
    //   http://mcp-server:8080/health  -> refused
    //   https://mcp-server:8080/health -> 200
    // Both schemes stay in the list so a non-mTLS stack still probes clean; the
    // probe already ignores self-signed certs (rejectUnauthorized: false).
    candidates: candidates(
      normalizeWs(env('MCP_SERVER_URL')),
      ...(/^(1|true|yes|on)$/i.test(String(env('MCP_MTLS_ENABLED') || ''))
        ? ['https://mcp-server:8080', 'https://localhost:8080', 'http://mcp-server:8080', 'http://localhost:8080']
        : ['http://mcp-server:8080', 'http://localhost:8080', 'https://mcp-server:8080', 'https://localhost:8080']),
    ),
    purpose: 'Primary MCP server — online-banking tools over WebSocket.',
  },
  {
    key: 'mcp-resource-server', name: 'MCP Invest', container: 'ai-demo-mcp-resource-server',
    hostPort: 8081, internalPort: 8081, lang: 'Node/TS', category: 'mcp', sourceDir: 'demo_mcp_resource_server', probe: true,
    candidates: candidates(normalizeWs(env('MCP_RESOURCE_SERVER_WS_URL')), 'http://mcp-resource-server:8081', 'http://localhost:8081'),
    purpose: 'Second MCP server exposing investment tools.',
  },
  {
    key: 'mcp-gateway', name: 'MCP Gateway (custom)', container: 'ai-demo-mcp-gateway',
    hostPort: 3005, internalPort: 3005, lang: 'Node/TS', category: 'mcp', sourceDir: 'demo_mcp_gateway', probe: true,
    candidates: candidates(env('MCP_GATEWAY_HTTP_URL'), 'http://mcp-gateway:3005', 'http://localhost:3005'),
    purpose: 'Auth-enforcing MCP gateway — routes to mcp-server/mcp-resource-server, PingAuthorize introspection.',
  },
  {
    key: 'ping-gateway', name: 'PingGateway (IG)', container: 'ai-demo-ping-gateway',
    hostPort: 3036, internalPort: 8080, lang: 'Ping Identity IG', category: 'mcp', sourceDir: 'ping-gateway', probe: true,
    // IG routes `/health` (ping-gateway/config/routes/00-health.json — the P1AZ
    // readiness probe: 200 ready, 503 misconfigured) and routes NOTHING at `/`.
    // Probing `/` made IG's RouterHandler log
    // "No handler to dispatch to for request 'http://ping-gateway:8080/'" at ERROR
    // once per refresh, and acceptAnyStatus turned that 404 into a green "Up" —
    // the board reported the gateway healthy on the strength of an error.
    healthPath: '/health',
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
    // Port 8890 is the health/inspector server — deliberately bound to
    // 127.0.0.1 only (api/health.py) since /inspector/mcp-host leaks the
    // full MCP tool registry, so it's unreachable from other containers by
    // design. Probe the AG-UI HTTP port instead (401 without auth is still
    // proof the process is up and serving).
    healthPath: '/', acceptAnyStatus: true,
    candidates: candidates('http://langchain-agent:8888', 'http://localhost:8888'),
    purpose: 'LangChain agent runtime — 8888 AG-UI SSE, 8889 WS chat, 8890 health (loopback-only).',
  },
  {
    key: 'openai-agent', name: 'OpenAI Agent', container: 'ai-demo-openai-agent',
    hostPort: 8891, internalPort: 8891, lang: 'Python (uvicorn)', category: 'agents', sourceDir: 'openai_agent', probe: true,
    // docker-compose.yml profiles:["agents"] — off by default in lean-core.
    optional: true,
    candidates: candidates('http://openai-agent:8891', 'http://localhost:8891'),
    purpose: 'OpenAI-SDK agent runtime variant.',
  },
  {
    key: 'mastra-agent', name: 'Mastra Agent', container: 'ai-demo-mastra-agent',
    hostPort: 8892, internalPort: 8892, lang: 'Node/TS (Mastra)', category: 'agents', sourceDir: 'mastra_agent', probe: true,
    // docker-compose.yml profiles:["agents"] — off by default in lean-core.
    optional: true,
    candidates: candidates('http://mastra-agent:8892', 'http://localhost:8892'),
    purpose: 'Mastra agent runtime variant.',
  },
  {
    key: 'pydantic-agent', name: 'Pydantic Agent', container: 'ai-demo-pydantic-agent',
    hostPort: 8893, internalPort: 8893, lang: 'Python (uvicorn)', category: 'agents', sourceDir: 'pydantic_agent', probe: true,
    // docker-compose.yml profiles:["agents"] — off by default in lean-core.
    optional: true,
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
    // docker-compose.yml profiles:["demo-auth"] — off by default in lean-core.
    optional: true,
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
    // docker-compose.yml profiles:["rag"] — off by default in lean-core.
    optional: true,
    candidates: candidates(env('WEAVIATE_URL'), 'http://weaviate:8080'),
    purpose: 'Vector DB backing RAG code search. Internal only — no host port.',
  },
  {
    key: 'embeddings', name: 'Embeddings (llama.cpp)', container: 'ai-demo-embeddings',
    hostPort: 8084, internalPort: 8080, lang: 'llama.cpp server', category: 'ai-infra', sourceDir: null, probe: true,
    // docker-compose.yml profiles:["rag"] — off by default in lean-core.
    optional: true,
    candidates: candidates(env('EMBEDDINGS_URL'), 'http://embeddings:8080', 'http://localhost:8084'),
    purpose: 'OpenAI-compatible /v1/embeddings (nomic-embed-text GGUF); warms up to 180s.',
  },
  {
    key: 'mcp-code-search', name: 'MCP Code Search', container: 'ai-demo-mcp-code-search',
    hostPort: 8095, internalPort: 8095, lang: 'Node', category: 'ai-infra', sourceDir: 'demo_mcp_code_search', probe: true,
    // docker-compose.yml profiles:["rag"] — off by default in lean-core.
    optional: true,
    candidates: candidates(env('MCP_CODE_SEARCH_URL'), 'http://demo-mcp-code-search:8095', 'http://localhost:8095'),
    purpose: 'RAG code-search MCP service over weaviate + embeddings.',
  },
  {
    key: 'ungoverned-agent', name: 'Ungoverned Agent', container: 'ai-demo-ungoverned-agent',
    hostPort: null, internalPort: null, lang: 'Node + headless browser', category: 'demo-prop', sourceDir: 'demo_ungoverned_agent', probe: false,
    purpose: 'Demo attack prop — on-demand only (profile demo-attack); rides a logged-in bank session via the UI.',
  },
  // Two local llama-server tiers: small (Phi-4-mini on :8091) and big
  // (gpt-oss-20b on :8096). :8095 is the mcp-code-search container.
  ...[1, 6].map((n) => ({
    key: `llama-tier-${n}`, name: `llama-server tier ${n}`, container: null, sourceDir: null,
    hostPort: 8090 + n, internalPort: 8090 + n, lang: 'llama.cpp server', category: 'ai-infra', probe: true,
    candidates: candidates(`http://host.docker.internal:${8090 + n}`, `http://localhost:${8090 + n}`),
    purpose: `Host-side local LLM backend (${n === 1 ? 'small / Phi-4-mini' : 'big / gpt-oss-20b'}) — target of llm-proxy. Not in compose; start via demo_llm_proxy/start-local-models.sh.`,
  })),
];

module.exports = { SERVER_INVENTORY };
