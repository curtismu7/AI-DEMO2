import serviceTopology from "../service-topology.json";

export const RFC = {
  oauth: { id: "RFC 6749", title: "The OAuth 2.0 Authorization Framework", url: "https://www.rfc-editor.org/rfc/rfc6749" },
  pkce: { id: "RFC 7636", title: "Proof Key for Code Exchange (PKCE)", url: "https://www.rfc-editor.org/rfc/rfc7636" },
  exchange: { id: "RFC 8693", title: "OAuth 2.0 Token Exchange", url: "https://www.rfc-editor.org/rfc/rfc8693" },
  resource: { id: "RFC 8707", title: "Resource Indicators for OAuth 2.0", url: "https://www.rfc-editor.org/rfc/rfc8707" },
  metadata: { id: "RFC 9728", title: "OAuth 2.0 Protected Resource Metadata", url: "https://www.rfc-editor.org/rfc/rfc9728" },
  introspection: { id: "RFC 7662", title: "OAuth 2.0 Token Introspection", url: "https://www.rfc-editor.org/rfc/rfc7662" },
  dpop: { id: "RFC 9449", title: "OAuth 2.0 Demonstrating Proof of Possession", url: "https://www.rfc-editor.org/rfc/rfc9449" },
  rar: { id: "RFC 9396", title: "OAuth 2.0 Rich Authorization Requests", url: "https://www.rfc-editor.org/rfc/rfc9396" },
  tls: { id: "RFC 9846", title: "The Transport Layer Security (TLS) Protocol Version 1.3", url: "https://www.rfc-editor.org/rfc/rfc9846" },
  mtls: { id: "RFC 8705", title: "OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens", url: "https://www.rfc-editor.org/rfc/rfc8705" },
  bcp: { id: "RFC 9700", title: "Best Current Practice for OAuth 2.0 Security", url: "https://www.rfc-editor.org/rfc/rfc9700" },
  http: { id: "RFC 9110", title: "HTTP Semantics", url: "https://www.rfc-editor.org/rfc/rfc9110" },
  http2: { id: "RFC 9113", title: "HTTP/2", url: "https://www.rfc-editor.org/rfc/rfc9113" },
};

export const SPECS = {
  mcp: { id: "MCP specification", title: "Model Context Protocol · 2025-11-25 reference", url: "https://modelcontextprotocol.io/specification/2025-11-25" },
  jsonrpc: { id: "JSON-RPC 2.0", title: "JSON-RPC 2.0 specification", url: "https://www.jsonrpc.org/specification" },
  websocket: { id: "WebSocket · RFC 6455", title: "The WebSocket Protocol", url: "https://www.rfc-editor.org/rfc/rfc6455" },
  spiffe: { id: "SPIFFE", title: "SPIFFE specifications", url: "https://spiffe.io/docs/latest/spiffe-about/overview/" },
};

export const GROUPS = {
  core: { label: "App & MCP", color: "#388bfd" },
  identity: { label: "Identity & policy", color: "#bc8cff" },
  ai: { label: "AI & data", color: "#d29922" },
  optional: { label: "Optional profiles", color: "#8792a0" },
  telemetry: { label: "Observability", color: "#3fb950" },
  trust: { label: "Identity & mTLS", color: "#f0883e" },
};

const position = (x, y) => ({ x, y });
const server = (id, title, service, group, kind, x, y, role, protocol, network, security, refs = {}, extra = {}) => ({
  id, type: "server", position: position(x, y),
  data: { title, service, group, kind, role, protocol, network, security, ...refs, ...extra },
});

// Coordinates deliberately leave room for the selected details pane and the wider/taller canvas.
export const SERVER_NODES = [
  server("browser", "Browser / MCP client", "external client", "core", "client", 40, 500, "User agent and external MCP clients enter through the public app or gateway endpoint.", "HTTPS · browser session · OAuth redirects", "User device → local TLS origin or Kubernetes ingress", "TLS at public edge; browser session cookie at the BFF.", { rfcs: ["oauth", "pkce", "bcp", "tls"] }, { local: "https://local.ping-devops.com:4000", k8s: "Public ingress :443" }),
  server("ingress", "Ingress / reverse proxy", "nginx ingress", "core", "gateway", 320, 500, "Routes public requests to the frontend, BFF, and explicitly exposed services.", "HTTPS → HTTP(S) service routes", "Public edge → local reverse proxy or Kubernetes ingress", "TLS terminates at the configured public edge; upstream encryption depends on the target.", { rfcs: ["http", "tls"] }, { local: "https://local.ping-devops.com:4000", k8s: "ingress-nginx → frontend / BFF" }),
  server("frontend", "Frontend", "demo_api_ui", "core", "app", 600, 500, "React application; owns browser presentation and sends API requests to the BFF.", "HTTPS · JSON/HTTP API · SSE where enabled", "Docker bridge or Kubernetes ClusterIP; public path through ingress", "Browser TLS ends at the configured frontend/ingress boundary.", { serviceKey: "frontend", rfcs: ["http", "tls", "oauth", "pkce"] }),
  server("bff", "BFF / API server", "demo_api_server", "core", "app", 880, 500, "Sole browser-token custodian. Coordinates sessions, OAuth, agents, gateways, and API calls.", "HTTPS · JSON/HTTP · WebSocket clients · SSE", "Internal Docker network or ai-demo namespace", "Session cookies are handled at the browser edge; downstream MCP mTLS is conditional.", { serviceKey: "bff", rfcs: ["oauth", "pkce", "exchange", "resource", "dpop", "rar", "bcp", "tls"] }),
  server("pingone", "PingOne", "Authorization server / policy", "identity", "identity", 600, 70, "External identity provider for sign-in, token issuance/exchange, and configured authorization services.", "OAuth 2.0 / OIDC · token endpoint · introspection", "Outbound HTTPS :443", "External TLS; enabled authorization behavior depends on environment configuration.", { rfcs: ["oauth", "pkce", "exchange", "resource", "introspection", "bcp", "tls"] }, { local: "auth.pingone.com:443", k8s: "auth.pingone.com:443" }),
  server("pingfederate", "PingFederate", "Authorization server", "identity", "identity", 880, 70, "Configured OAuth/OIDC provider for end-user login when the provider selector is set to PingFederate.", "OAuth 2.0 / OIDC · authorization and token endpoints", "Outbound HTTPS :443; browser front-channel redirects", "External TLS; callback, client authentication, and endpoints are configuration-driven.", { rfcs: ["oauth", "pkce", "bcp", "tls"] }, { local: "Configured PingFederate issuer", k8s: "Configured PingFederate issuer" }),
  server("pinggw", "PingGateway", "ping-gateway", "core", "gateway", 1180, 390, "Identity Gateway route for MCP requests and policy enforcement; separate from the Node gateway.", "HTTP · MCP JSON-RPC · introspection / Authorize", "Internal service network; external authorization calls use outbound HTTPS", "Internal HTTP in declared topology. Public TLS, if exposed, terminates upstream.", { serviceKey: "ping-gateway", rfcs: ["metadata", "introspection", "exchange", "resource", "http", "tls"], specs: ["mcp", "jsonrpc"] }),
  server("authz", "AuthZ / PDP", "authz-server", "identity", "identity", 1480, 270, "Mock authorization and introspection service. Compose runs a separate demo-auth service; Kubernetes runs it as a PingGateway sidecar.", "HTTP · policy decision / introspection", "Compose service network or same-pod Kubernetes loopback", "Internal HTTP; gateway fails closed if the selected authorization endpoint is unavailable.", { rfcs: ["introspection", "oauth"] }, { profile: "demo-auth", local: "http://authz-server:9001", k8s: "http://127.0.0.1:9001 · PingGateway pod" }),
  server("nodegw", "Demo Agent Gateway", "demo_mcp_gateway", "core", "gateway", 1180, 650, "Node gateway route. Applies MCP routing and policy, then forwards to configured MCP services.", "MCP Streamable HTTP · JSON-RPC · WebSocket upstream", "Docker network or ai-demo namespace", "Internal HTTP by default. SPIFFE workload mTLS is optional and requires SVID verification at both endpoints.", { serviceKey: "mcp-gateway", rfcs: ["oauth", "exchange", "resource", "metadata", "http", "http2"], specs: ["mcp", "jsonrpc", "websocket", "spiffe"] }),
  server("mcpmcp", "OAuth MCP server", "oauth-mcp / mcp-server", "core", "data", 1480, 500, "Protected MCP server that owns banking tools and resource access.", "MCP · JSON-RPC · WebSocket / HTTP endpoints", "Reached through an allowed gateway or BFF path; cluster-local service", "Local MCP mTLS is opt-in via MCP_MTLS_ON. Kubernetes manifests do not declare workload mTLS for this hop.", { serviceKey: "mcp-server", rfcs: ["metadata", "resource", "oauth", "tls", "mtls"], specs: ["mcp", "jsonrpc", "websocket"] }),
  server("mcpresource", "MCP resource server", "demo_mcp_resource_server", "core", "data", 1780, 400, "Investing and read-path MCP tools backed by service data.", "MCP · JSON-RPC · WebSocket", "Internal service network / namespace", "Internal HTTP in declared topology; no Kubernetes workload mTLS setting found in checked-in manifests.", { serviceKey: "mcp-resource-server", rfcs: ["metadata", "resource", "http"], specs: ["mcp", "jsonrpc", "websocket"] }),
  server("apiresource", "API resource server", "api-resource-server", "core", "data", 1780, 600, "Demo-data API backend used by the Node gateway's API-key route.", "HTTP · JSON REST", "Internal service network / namespace", "Demo routes require X-API-Key (static or JIT service credential); this service does not validate OAuth bearer tokens.", { serviceKey: "api-resource-server", rfcs: ["http"] }),
  server("langchain", "LangChain agent", "langchain_agent", "ai", "agent", 880, 790, "Python LangChain agent service used by the BFF's agent request path.", "HTTP · AG-UI/SSE", "BFF → agent service", "Internal HTTP in declared topology.", { serviceKey: "langchain-agent", rfcs: ["http"] }),
  server("agentservice", "Agent service", "demo_agent_service", "ai", "agent", 880, 940, "Node agent service used by the alternate agent flow.", "HTTP · agent API", "BFF → agent service", "Internal HTTP in declared topology.", { serviceKey: "agent-service", rfcs: ["http"] }),
  server("llmproxy", "LLM proxy", "demo_llm_proxy", "ai", "agent", 1180, 900, "Optional model proxy that routes application requests to configured model backends.", "HTTP · model API", "Agent → proxy", "Internal HTTP in topology; upstream TLS and credentials depend on provider configuration.", { rfcs: ["http"] }, { profile: "llm-proxy", local: "llm-proxy:8090", k8s: "llm-proxy.ai-demo.svc:8090" }),
  server("model", "Model providers", "OpenAI · Anthropic · local models", "identity", "identity", 1180, 70, "Configured external or local model endpoints. Provider choice is deployment configuration.", "HTTPS · provider APIs", "External egress or configured model-service network", "External TLS; credentials come from secret/configuration sources.", { rfcs: ["http", "tls"] }, { local: "Configured provider endpoint", k8s: "Configured provider endpoint" }),
  server("hitl", "HITL service", "demo_hitl_service", "ai", "app", 1480, 790, "Human approval and challenge service for agent and MCP flows.", "HTTP · JSON API · SSE/events", "Internal service network / namespace", "Internal HTTP in declared topology.", { serviceKey: "hitl-service", rfcs: ["http"] }),
  server("weather", "Weather MCP", "mcp-weather", "optional", "data", 320, 1080, "Optional weather tool backend.", "HTTP · tool backend", "Optional service profile / namespace", "Internal HTTP in declared topology.", { serviceKey: "mcp-weather", rfcs: ["http"] }, { profile: "mcp-extras" }),
  server("brave", "Brave MCP", "mcp-brave", "optional", "data", 550, 1080, "Optional web search tool backend.", "HTTP · tool backend", "Optional service profile / namespace", "Internal HTTP in declared topology.", { serviceKey: "mcp-brave", rfcs: ["http"] }, { profile: "mcp-extras" }),
  server("mcpproxy", "MCP proxy", "mcp-proxy", "core", "gateway", 1480, 900, "HTTP-to-MCP proxy that exposes gateway tools through plain REST endpoints.", "HTTP REST → MCP", "MCP proxy → configured gateway URL", "Bearer token is forwarded to the configured gateway.", { serviceKey: "mcp-proxy", rfcs: ["http"], specs: ["mcp"] }),
  server("search", "Code search / RAG", "demo-mcp-code-search · OpenSearch · Weaviate · embeddings · Tika", "optional", "data", 1010, 1080, "Grouped optional search, document extraction, vector storage, and retrieval services.", "HTTP APIs · embeddings", "Optional RAG profile / namespace", "Internal HTTP in declared topology; model/provider egress may be enabled.", { rfcs: ["http"] }, { profile: "rag" }),
  server("llamaindex", "LlamaIndex agent", "llamaindex_agent", "optional", "agent", 1240, 1080, "Optional alternate agent implementation.", "HTTP · agent API", "Optional agent profile / namespace", "Internal HTTP in declared topology.", { rfcs: ["http"] }, { profile: "agents", local: "llamaindex-agent", k8s: "llamaindex-agent · optional manifest" }),
  server("mcpjwt", "JWT verifier", "mcp-jwt-verifier", "optional", "identity", 1470, 1080, "Optional gateway-side token/JWKS verification helper.", "HTTP · JWKS / verification API", "Gateway support service", "Internal HTTP in declared topology.", { serviceKey: "mcp-jwt-verifier", rfcs: ["oauth", "http"] }, { profile: "gateway-support" }),
  server("mcpaudit", "MCP audit", "mcp-audit", "telemetry", "telemetry", 1780, 820, "Audit event service used by configured MCP Gateway audit tools.", "HTTP · audit events", "Node MCP Gateway → mcp-audit:8898", "Secret-guarded internal ingest.", { rfcs: ["http"] }, { local: "http://mcp-audit:8898", k8s: "No corresponding service in checked-in Kubernetes manifests" }),
  server("discovery", "MCP discovery", "mcp-discovery-agent", "core", "gateway", 600, 900, "Service registry and discovery agent reached by the BFF.", "HTTP · discovery registry", "BFF → mcp-discovery-agent:3910", "Internal HTTP in the local Compose topology.", { rfcs: ["http"] }, { local: "http://mcp-discovery-agent:3910", k8s: "No corresponding resource in checked-in Kubernetes manifests" }),
  server("opensearchmcp", "OpenSearch MCP", "opensearch-mcp-server", "optional", "data", 780, 1220, "Optional MCP adapter for OpenSearch-backed tools.", "MCP · Streamable HTTP", "Optional RAG profile / namespace", "Internal HTTP in declared topology.", { rfcs: ["metadata", "http"], specs: ["mcp", "jsonrpc"] }, { profile: "rag", local: "opensearch-mcp-server:9900", k8s: "opensearch-mcp-server · optional manifest" }),
  server("privgw", "Agent Privilege", "ping-mcpgw · mcpgw-nginx", "optional", "gateway", 1010, 1220, "Optional PingOne Privilege MCP gateway and Nginx ingress services.", "MCP · Streamable HTTP / SSE compatibility", "Optional public ingress and gateway path", "TLS behavior depends on ingress mode; passthrough and TLS termination are distinct.", { rfcs: ["metadata", "http", "tls"], specs: ["mcp"] }, { profile: "privilege", local: "Profile endpoints vary", k8s: "Public ingress → gateway service" }),
  server("a2amain", "A2A main agent", "privilege-a2a-demo · main-agent", "optional", "agent", 550, 1220, "Chat and planning agent for the Privilege A2A demos. Hands work to other agents through the Agent Privilege.", "HTTP · SSE to the BFF · A2A JSON-RPC and model calls to the gateway", "BFF → main agent (shared secret) · main agent → Agent Privilege", "Presents its own agent key on every gateway call; never holds another agent's key or the model provider key.", { rfcs: ["http", "tls"], specs: ["jsonrpc"] }, { profile: "privilege" }),
  server("a2aworker", "A2A worker agent + tools", "workeragentdemo · mcpdemo", "optional", "agent", 1470, 1220, "Worker agent and its access-review MCP server. Both are reached only through the Agent Privilege.", "A2A JSON-RPC in · MCP Streamable HTTP and model calls out, all through the gateway", "Agent Privilege → worker · worker → gateway → MCP server", "The worker has its own agent key with the llm and mcp scopes; each tool is granted individually and tool results are screened.", { rfcs: ["http", "tls"], specs: ["mcp", "jsonrpc"] }, { profile: "privilege" }),
  server("auxagents", "Auxiliary agents", "mastra_agent · openai_agent · pydantic_agent · tier-manager · ungoverned-agent · Promptfoo helpers", "optional", "agent", 1240, 1220, "Grouped optional agent frameworks and demo helpers.", "HTTP · agent APIs", "Optional Compose services / profile-specific services", "Internal HTTP unless a configured model provider uses external TLS.", { rfcs: ["http"] }, { profile: "agent-extras", local: "Profile-specific endpoints", k8s: "Optional / profile-specific services" }),
  server("alertmanager", "Alertmanager", "alertmanager", "telemetry", "telemetry", 2070, 920, "Receives and groups Prometheus alerts; default receiver is a no-op until configured.", "HTTP · Prometheus alert API", "Internal telemetry network", "Internal service network.", { rfcs: ["http"] }, { local: "alertmanager:9093", k8s: "alertmanager.ai-demo.svc:9093" }),
  server("alloy", "Grafana Alloy", "alloy", "telemetry", "telemetry", 2070, 250, "Collects and forwards logs and telemetry from application services.", "OTLP · gRPC/HTTP · logs", "In-cluster telemetry collection and egress to observability services", "Internal telemetry network; provider-specific TLS is configured separately.", { rfcs: ["http", "http2"] }, { local: "alloy · OTLP / log shipper", k8s: "alloy.ai-demo.svc" }),
  server("prometheus", "Prometheus", "prometheus", "telemetry", "telemetry", 2070, 390, "Scrapes metrics endpoints and stores time-series data.", "HTTP scrape · Prometheus exposition", "Internal telemetry network", "Internal service network.", { rfcs: ["http"] }, { local: "prometheus:9090", k8s: "prometheus.ai-demo.svc:9090" }),
  server("loki", "Loki", "loki", "telemetry", "telemetry", 2070, 530, "Central log storage for Alloy and application logs.", "HTTP · log ingestion/query", "Internal telemetry network", "Internal service network.", { rfcs: ["http"] }, { local: "loki:3100", k8s: "loki.ai-demo.svc:3100" }),
  server("jaeger", "Jaeger", "jaeger", "telemetry", "telemetry", 2070, 670, "Distributed tracing backend and UI.", "OTLP · gRPC/HTTP · trace query", "Internal telemetry network", "Internal service network.", { rfcs: ["http", "http2"] }, { local: "jaeger · OTLP / query ports", k8s: "jaeger.ai-demo.svc" }),
  server("grafana", "Grafana", "grafana", "telemetry", "telemetry", 2070, 1060, "Dashboards for Prometheus, Loki, and Jaeger data sources.", "HTTPS ingress / HTTP service · dashboards", "Operator access through configured ingress", "Operator authentication; external TLS at ingress.", { rfcs: ["http", "tls"] }, { local: "grafana:3000", k8s: "grafana.ai-demo.svc:3000" }),
  server("spire", "SPIRE workload identity", "spire-server · spire-agent · registration · SVID helpers", "trust", "identity", 1780, 1220, "Optional SPIFFE/SPIRE services for workload identity, SVID delivery, and trust bundle distribution.", "SPIFFE Workload API · Unix socket · X.509-SVID", "Optional workload identity profile", "Only provides SPIFFE mTLS to services configured to consume and verify SVIDs.", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe", local: "Compose profile: spiffe", k8s: "No app workload mTLS setting declared" }),
];

export const SERVER_MAP = SERVER_NODES.map((node) => {
  const service = node.data.serviceKey ? serviceTopology.services[node.data.serviceKey] : null;
  const declared = service ? `${service.scheme}://${service.host}:${service.port}` : null;
  const cluster = service ? `${service.host}.ai-demo.svc:${service.port}` : null;
  return {
    ...node,
    data: {
      ...node.data,
      local: node.data.local || declared || "Profile-specific endpoint",
      k8s: node.data.k8s || cluster || "Optional / profile-specific service",
    },
  };
});

const edge = (id, source, target, label, kind, protocol, network, security, refs = {}, extra = {}) => ({
  id, source, target, type: "smoothstep", label, data: { kind, protocol, network, security, ...refs, ...extra },
  animated: false, markerEnd: { type: "arrowclosed", width: 16, height: 16 },
});

const WORKLOAD_MTLS_OPTIONAL = {
  id: "workload-mtls",
  title: "SPIFFE workload mTLS",
  status: "optional",
  layer: "Workload identity and transport",
  relationship: "Complements OAuth authorization",
  description: "Mutually authenticates the two services and protects their connection. It does not carry the user's delegated identity or replace service authorization.",
  requirements: "Enable the optional local SPIFFE profile and verify SVIDs at both ends. The checked-in Kubernetes manifests do not declare this service-hop mTLS configuration.",
  specs: ["spiffe"],
};

const WORKLOAD_MTLS_CANDIDATE = {
  ...WORKLOAD_MTLS_OPTIONAL,
  status: "candidate",
  requirements: "Issue and rotate workload identities, distribute trust bundles, and configure both endpoints to require and verify client certificates. No such setting is declared for this hop.",
};

const AUDIENCE_TOKEN_CANDIDATE = {
  id: "audience-token",
  title: "Audience-restricted OAuth access token",
  status: "candidate",
  layer: "Authorization",
  relationship: "Alternative to a shared or broadly-scoped credential",
  description: "Use a short-lived token restricted to this resource server and the minimum required scopes. Use RFC 8693 exchange when the caller must delegate an existing user's identity to this audience.",
  requirements: "The resource server must validate signature, issuer, audience, expiry, and scopes; the authorization server must issue the required audience and delegated claims.",
  rfcs: ["exchange", "resource", "bcp"],
};

const SERVICE_AUTH_CANDIDATE = {
  id: "service-auth",
  title: "Authenticate and authorize the calling service",
  status: "candidate",
  layer: "Service authorization",
  relationship: "Replaces trust based only on network location",
  description: "Require the backend to validate a short-lived service token with an audience and a narrow permission for this operation.",
  requirements: "Add token validation and a least-privilege permission at the receiving service. Use a delegated token instead when authorization must remain tied to the end user.",
  rfcs: ["oauth", "resource", "bcp"],
};

const OAUTH_MTLS_CLIENT_AUTH_CANDIDATE = {
  id: "oauth-mtls-client-auth",
  title: "OAuth mutual-TLS client authentication",
  status: "candidate",
  layer: "OAuth client authentication",
  relationship: "Can replace client-secret authentication; can be used with the token flow",
  description: "Authenticate the confidential OAuth client with a certificate. RFC 8705 is OAuth-specific; this is distinct from generic workload mTLS and does not replace authorization-code redemption, PKCE, or token exchange.",
  requirements: "The authorization server and client must support RFC 8705; configure certificate lifecycle and trust. Certificate-bound access tokens additionally require resource-server support.",
  rfcs: ["mtls", "bcp"],
};

const UPSTREAM_TLS_CANDIDATE = {
  id: "upstream-tls",
  title: "Re-encrypt the internal upstream hop",
  status: "candidate",
  layer: "Transport confidentiality and peer verification",
  relationship: "Can be combined with token-based authorization",
  description: "Use HTTPS from the ingress or proxy to the service, verify the upstream certificate chain, and check the expected service name.",
  requirements: "Provision a trusted certificate for the upstream service and enable certificate and hostname verification in the proxy.",
  rfcs: ["tls"],
};

const MCP_BACKEND_AUTH_CANDIDATE = {
  id: "mcp-backend-auth",
  title: "Validate caller credentials at the backend",
  status: "candidate",
  layer: "Backend authorization",
  relationship: "Adds a backend check behind gateway policy",
  description: "Require the backend itself to validate an audience-restricted token and operation-specific scope, so gateway policy is not the only authorization boundary.",
  requirements: "Implement issuer, audience, expiry, and scope validation in the backend and keep the gateway policy in place as a separate decision.",
  rfcs: ["oauth", "resource", "bcp"],
  specs: ["mcp"],
};

const PROMETHEUS_AUTH_CANDIDATE = {
  id: "prometheus-auth",
  title: "Authenticate metrics scraping",
  status: "candidate",
  layer: "Monitoring access control",
  relationship: "Complements network restrictions",
  description: "Restrict scrape endpoints to the monitoring identity and protect metrics in transit; metrics can expose operational details even when they contain no credentials.",
  requirements: "Configure matching Prometheus and exporter authentication/TLS settings, then allow only the scraper in network policy.",
  rfcs: ["tls"],
};

const ALERT_DELIVERY_AUTH_CANDIDATE = {
  ...SERVICE_AUTH_CANDIDATE,
  id: "alert-delivery-auth",
  title: "Authenticate alert delivery",
  layer: "Monitoring service authorization",
  relationship: "Complements network restrictions",
  description: "Limit the alert receiver to the Prometheus service identity and protect the delivery connection.",
  requirements: "Configure matching authentication and TLS at Prometheus and Alertmanager, and allow only the Prometheus workload in network policy.",
  rfcs: ["oauth", "tls"],
};

export const SERVER_EDGES = [
  edge("browser-ingress", "browser", "ingress", "HTTPS :443", "mcp", "HTTPS · public edge", "User device → reverse proxy", "TLS", { rfcs: ["http", "tls"] }),
  edge("ingress-frontend", "ingress", "frontend", "HTTP(S) :4000", "mcp", "HTTP(S) · frontend route", "Edge → app network", "TLS boundary depends on deployment", { rfcs: ["http", "tls"] }, { securityOptions: [UPSTREAM_TLS_CANDIDATE] }),
  edge("frontend-bff", "frontend", "bff", "HTTPS / JSON API", "mcp", "HTTPS · JSON/HTTP", "Frontend → BFF", "TLS", { rfcs: ["http", "tls"] }),
  edge("ingress-bff-login", "ingress", "bff", "Login request → BFF", "oauth", "HTTP(S) · GET /api/auth/oauth/user/login", "Ingress routes browser login request to BFF", "TLS at configured public edge", { rfcs: ["oauth", "http", "tls"] }, { securityOptions: [UPSTREAM_TLS_CANDIDATE] }),
  edge("bff-browser-redirect", "bff", "browser", "302 · authorize URL", "oauth", "HTTP · redirect response", "BFF response returns through ingress to browser", "State and PKCE challenge; no token in browser", { rfcs: ["oauth", "pkce", "bcp", "http"] }),
  edge("browser-pingone-login", "browser", "pingone", "Redirect → PingOne login", "oauth", "HTTPS · OAuth/OIDC authorize", "Browser front-channel redirect to configured PingOne authorization endpoint", "Authorization Code + PKCE; TLS", { rfcs: ["oauth", "pkce", "bcp", "tls"] }),
  edge("pingone-browser-callback", "pingone", "browser", "Redirect · authorization code", "oauth", "HTTPS · OAuth/OIDC callback redirect", "PingOne → browser → configured BFF callback URI", "One-time code and state; TLS", { rfcs: ["oauth", "pkce", "bcp", "tls"] }),
  edge("browser-ingress-callback", "browser", "ingress", "Callback → public ingress", "oauth", "HTTPS · GET /api/auth/oauth/user/callback", "Browser carries provider redirect to public ingress", "BFF validates state and PKCE transaction; TLS", { rfcs: ["oauth", "pkce", "bcp", "tls"] }),
  edge("ingress-bff-callback", "ingress", "bff", "Callback → BFF", "oauth", "HTTP(S) · OAuth callback route", "Ingress routes callback to BFF", "BFF validates state before token redemption", { rfcs: ["oauth", "pkce", "bcp", "http"] }, { securityOptions: [UPSTREAM_TLS_CANDIDATE] }),
  edge("bff-pingone", "bff", "pingone", "OAuth / OIDC", "oauth", "OAuth 2.0 · OIDC", "Outbound HTTPS :443", "TLS · user and client credentials", { rfcs: ["oauth", "pkce", "bcp"] }),
  edge("bff-pingone-token", "bff", "pingone", "Code → tokens", "oauth", "HTTPS · POST token endpoint", "BFF server-to-server outbound HTTPS :443", "Authorization code + PKCE verifier; client auth follows app configuration", { rfcs: ["oauth", "pkce", "bcp", "tls"] }, { securityOptions: [OAUTH_MTLS_CLIENT_AUTH_CANDIDATE] }),
  edge("bff-browser-session", "bff", "browser", "Session cookie response", "oauth", "HTTPS · Set-Cookie response", "BFF response returns through ingress to browser", "HttpOnly session cookie; tokens remain server-side", { rfcs: ["oauth", "bcp", "http", "tls"] }),
  edge("browser-pingfederate-login", "browser", "pingfederate", "Redirect → PingFederate login", "oauth", "HTTPS · OAuth/OIDC authorize", "Browser front-channel redirect to configured PingFederate authorization endpoint", "Authorization Code + PKCE; TLS", { rfcs: ["oauth", "pkce", "bcp", "tls"] }),
  edge("pingfederate-browser-callback", "pingfederate", "browser", "Redirect · authorization code", "oauth", "HTTPS · OAuth/OIDC callback redirect", "PingFederate → browser → configured BFF callback URI", "One-time code and state; TLS", { rfcs: ["oauth", "pkce", "bcp", "tls"] }),
  edge("bff-pingfederate-token", "bff", "pingfederate", "Code → tokens", "oauth", "HTTPS · POST token endpoint", "BFF server-to-server outbound HTTPS :443", "Authorization code + PKCE verifier; provider client auth follows configuration", { rfcs: ["oauth", "pkce", "bcp", "tls"] }, { securityOptions: [OAUTH_MTLS_CLIENT_AUTH_CANDIDATE] }),
  edge("bff-pinggw", "bff", "pinggw", "MCP route A", "mcp", "MCP · HTTP / JSON-RPC", "Internal service network", "Bearer token; internal HTTP by declared topology", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc"] }, { securityOptions: [AUDIENCE_TOKEN_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("bff-nodegw", "bff", "nodegw", "MCP route B", "mcp", "MCP Streamable HTTP", "Internal service network", "Bearer token; optional workload mTLS on downstream MCP hop", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc"] }, { securityOptions: [AUDIENCE_TOKEN_CANDIDATE, WORKLOAD_MTLS_OPTIONAL] }),
  edge("pinggw-authz", "pinggw", "authz", "policy / introspection", "oauth", "HTTP · PDP / introspection", "Loopback or same-pod sidecar", "Internal sidecar connection", { rfcs: ["oauth", "introspection"] }, { profile: "demo-auth" }),
  edge("pinggw-mcpmcp", "pinggw", "mcpmcp", "MCP / HTTP or WS", "mcp", "MCP · JSON-RPC · HTTP/WebSocket", "Gateway → MCP server", "Local mTLS is opt-in; K8s workload mTLS not declared", { rfcs: ["metadata", "resource", "introspection"], specs: ["mcp", "jsonrpc", "websocket"] }, { securityOptions: [WORKLOAD_MTLS_OPTIONAL] }),
  edge("nodegw-mcpmcp", "nodegw", "mcpmcp", "MCP / Streamable HTTP", "mcp", "MCP · JSON-RPC · Streamable HTTP", "Gateway → MCP server", "Local mTLS is opt-in; SPIFFE identity is optional", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc", "spiffe"] }, { securityOptions: [WORKLOAD_MTLS_OPTIONAL] }),
  edge("nodegw-authz", "nodegw", "pingone", "Authorize policy decision", "oauth", "HTTPS · PingOne Authorize API", "Outbound HTTPS :443", "Gateway validates access tokens locally with JWKS, then requests a per-tool policy decision from PingOne Authorize", { rfcs: ["oauth", "tls"] }),
  edge("nodegw-pingone", "nodegw", "pingone", "RFC 8693 token exchange", "oauth", "OAuth 2.0 · Token Exchange", "Outbound HTTPS :443", "Gateway exchanges the authorized subject token for an MCP-server audience token", { rfcs: ["oauth", "exchange", "resource", "tls"] }, { securityOptions: [OAUTH_MTLS_CLIENT_AUTH_CANDIDATE] }),
  edge("nodegw-apiresource-apikey", "nodegw", "apiresource", "API-key backend call", "data", "HTTP · REST/JSON · X-API-Key", "Gateway → API resource server", "Gateway drops OAuth bearer and attaches its server-side API key; key is not returned to the client", { rfcs: ["http"] }, { securityOptions: [AUDIENCE_TOKEN_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("browser-mcpmcp-direct", "browser", "mcpmcp", "Local direct MCP request", "mcp", "MCP · JSON-RPC · HTTP/WebSocket", "Local Compose publishes mcp-server:8080; hosted /mcp requests go through PingGateway", "MCP bearer validation applies at the local listener. The PF Step 9 playback uses the direct WebSocket path; the HTTP anti-mix-up issuer allowlist currently excludes PF. Hosted ingress routes ordinary MCP requests through PingGateway.", { rfcs: ["metadata", "resource", "oauth", "http"], specs: ["mcp", "jsonrpc", "websocket"] }, { securityOptions: [AUDIENCE_TOKEN_CANDIDATE] }),
  edge("mcpmcp-mcpresource", "mcpmcp", "mcpresource", "tool / data API", "data", "HTTP · protected service call", "Internal service network", "Service authorization; internal HTTP in topology", { rfcs: ["http", "oauth"] }, { securityOptions: [SERVICE_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("mcpmcp-bff-api", "mcpmcp", "bff", "BFF protected API", "data", "HTTP · REST/JSON · OAuth bearer", "OAuth MCP server → BFF service via configured API base URL", "BankingAPIClient sends the delegated user bearer to BFF API routes, which enforce route authorization", { rfcs: ["http", "oauth"] }),
  edge("mcpmcp-pingone-step9", "mcpmcp", "pingone", "Step 9 · PingOne token exchange", "oauth", "OAuth 2.0 · RFC 8693 token exchange", "MCP server → configured PingOne token endpoint", "Conditional for non-vertical banking data tools when MCP token-exchanger credentials are configured. BANKING_API_RESOURCE_URI must match the BFF resource audience; PingOne uses the resource indicator for that Banking API audience.", { rfcs: ["oauth", "exchange", "resource", "tls"] }, { securityOptions: [OAUTH_MTLS_CLIENT_AUTH_CANDIDATE] }),
  edge("mcpmcp-pingfederate-step9", "mcpmcp", "pingfederate", "Step 9 · PingFederate token exchange", "oauth", "OAuth 2.0 · RFC 8693 token exchange", "MCP server → configured PingFederate token endpoint", "Conditional for a validated PF-issued bearer on the direct local WebSocket path, when PF Step 9 is configured. BANKING_API_RESOURCE_URI must match the BFF resource audience; the Node Gateway playback uses a PingOne-issued token, and the HTTP MCP issuer allowlist currently excludes PF. PingFederate's dedicated policy selects the Banking API audience.", { rfcs: ["oauth", "exchange", "resource", "tls"] }, { securityOptions: [OAUTH_MTLS_CLIENT_AUTH_CANDIDATE] }),
  edge("bff-langchain", "bff", "langchain", "agent request", "agent", "HTTP · AG-UI/SSE", "BFF → agent service", "Internal HTTP in topology", { rfcs: ["http"] }, { securityOptions: [SERVICE_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("bff-discovery", "bff", "discovery", "service discovery", "mcp", "HTTP · discovery registry", "BFF → MCP discovery agent :3910", "Internal service network", { rfcs: ["http"] }, { securityOptions: [SERVICE_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("langchain-llmproxy", "langchain", "llmproxy", "model request", "agent", "HTTP · model API", "Agent → LLM proxy", "Credentials handled by provider configuration", { rfcs: ["http"] }),
  edge("llmproxy-model", "llmproxy", "model", "HTTPS :443", "agent", "HTTPS · provider API", "Outbound egress", "TLS", { rfcs: ["http", "tls"] }),
  edge("bff-hitl", "bff", "hitl", "approval / challenge", "optional", "HTTP · JSON/events", "BFF → HITL service", "Internal service network", { rfcs: ["http"] }, { securityOptions: [SERVICE_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("nodegw-mcpjwt", "nodegw", "mcpjwt", "JWKS / verify", "optional", "HTTP · verification", "Gateway support service", "Internal service network", { rfcs: ["http"] }),
  edge("nodegw-mcpaudit", "nodegw", "mcpaudit", "audit events", "telemetry", "HTTP · audit ingestion", "Gateway → MCP audit service :8898", "No inbound service-auth check found in the handler; currently relies on network reachability", { rfcs: ["http"] }, { securityOptions: [SERVICE_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("mcpproxy-nodegw", "mcpproxy", "nodegw", "REST to MCP", "mcp", "HTTP REST → MCP", "MCP proxy → configured gateway URL", "Bearer token forwarded to the configured gateway", { rfcs: ["http"], specs: ["mcp"] }, { securityOptions: [AUDIENCE_TOKEN_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("alloy-loki", "alloy", "loki", "logs", "telemetry", "HTTP · log push", "Telemetry network", "Internal telemetry connection", { rfcs: ["http"] }),
  edge("grafana-prometheus", "grafana", "prometheus", "metrics query", "telemetry", "HTTP · PromQL", "Telemetry network", "Dashboard data-source connection", { rfcs: ["http"] }),
  edge("grafana-jaeger", "grafana", "jaeger", "trace query", "telemetry", "HTTP · trace query", "Telemetry network", "Dashboard data-source connection", { rfcs: ["http"] }),
  edge("prometheus-alertmanager", "prometheus", "alertmanager", "alert events", "telemetry", "HTTP · Prometheus alert API", "Telemetry network", "Internal telemetry connection", { rfcs: ["http"] }, { securityOptions: [ALERT_DELIVERY_AUTH_CANDIDATE] }),
  edge("spire-mcpmcp", "spire", "mcpmcp", "SVID / trust bundle", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket and workload identity path", "Only active in configured SPIFFE profile", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
  edge("agentservice-llmproxy", "agentservice", "llmproxy", "agent / model", "agent", "HTTP · model API", "Agent → proxy", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "agents" }),
  edge("mcpmcp-weather", "mcpmcp", "weather", "tool backend", "optional", "HTTP · weather tool", "Optional service network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "mcp-extras", securityOptions: [MCP_BACKEND_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("mcpmcp-brave", "mcpmcp", "brave", "tool backend", "optional", "HTTP · search tool", "Optional service network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "mcp-extras", securityOptions: [MCP_BACKEND_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("nodegw-weather", "nodegw", "weather", "weather tool route", "optional", "MCP · JSON-RPC → HTTP tool backend", "Agent Gateway → weather MCP backend", "Gateway scope policy restricts the demo weather route; backend does not validate the caller token", { rfcs: ["oauth", "resource", "http"], specs: ["mcp", "jsonrpc"] }, { profile: "mcp-extras", securityOptions: [MCP_BACKEND_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("nodegw-brave", "nodegw", "brave", "news search tool route", "optional", "MCP · JSON-RPC → HTTP tool backend", "Agent Gateway → Brave search MCP backend", "Gateway scope/content policy applies to the demo search route; backend does not validate the caller token", { rfcs: ["oauth", "resource", "http"], specs: ["mcp", "jsonrpc"] }, { profile: "mcp-extras", securityOptions: [MCP_BACKEND_AUTH_CANDIDATE, WORKLOAD_MTLS_CANDIDATE] }),
  edge("llamaindex-search", "llamaindex", "search", "retrieval APIs", "optional", "HTTP · RAG APIs", "Optional profile network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "rag" }),
  edge("opensearchmcp-search", "opensearchmcp", "search", "search backend", "optional", "HTTP · OpenSearch API", "MCP adapter → OpenSearch backend", "Internal profile network", { rfcs: ["http"] }, { profile: "rag" }),
  edge("bff-a2amain", "bff", "a2amain", "A2A chat and chain relay", "optional", "HTTP · SSE", "BFF → main agent", "Session required at the BFF; shared secret to the main agent. No browser token is forwarded.", { rfcs: ["http"] }, { profile: "privilege" }),
  edge("a2amain-privgw", "a2amain", "privgw", "A2A and model calls · main agent key", "optional", "A2A JSON-RPC · model API", "Main agent → Agent Privilege", "Gateway checks the key, its scopes, the allowed model, the policy for the remote agent and the guardrail.", { rfcs: ["http", "tls"], specs: ["jsonrpc"] }, { profile: "privilege" }),
  edge("privgw-a2aworker", "privgw", "a2aworker", "forwarded A2A · permitted tool calls", "optional", "A2A JSON-RPC · MCP Streamable HTTP", "Agent Privilege → worker agent and MCP server", "Forwarded only after key, scope, policy and guardrail checks; tool results are screened on the way back.", { rfcs: ["http", "tls"], specs: ["mcp", "jsonrpc"] }, { profile: "privilege" }),
  edge("a2aworker-privgw", "a2aworker", "privgw", "model and tool calls · worker key", "optional", "model API · MCP Streamable HTTP", "Worker agent → Agent Privilege", "The worker's own key, with the llm and mcp scopes and per-tool grants.", { rfcs: ["http", "tls"], specs: ["mcp"] }, { profile: "privilege" }),
  edge("privgw-langchain", "privgw", "langchain", "A2A to the middle agent", "optional", "A2A JSON-RPC", "Agent Privilege → LangChain agent", "The gateway sends the app's static token; the caller's key never reaches the agent.", { rfcs: ["http", "tls"], specs: ["jsonrpc"] }, { profile: "privilege" }),
  edge("langchain-privgw", "langchain", "privgw", "A2A hand-off · its own key", "optional", "A2A JSON-RPC", "LangChain agent → Agent Privilege", "A second gateway hop with the middle agent's own key; an ungranted remote agent is refused.", { rfcs: ["http", "tls"], specs: ["jsonrpc"] }, { profile: "privilege" }),
  edge("privgw-model", "privgw", "model", "model call · real provider key", "optional", "HTTPS · model API", "Agent Privilege → model provider", "The gateway swaps the agent key for the real provider key; agents never hold it.", { rfcs: ["http", "tls"] }, { profile: "privilege" }),
  edge("browser-privgw", "browser", "privgw", "optional public MCP route", "optional", "HTTPS → MCP Streamable HTTP", "Browser → mcpgw-nginx → Privilege MCP gateway", "TLS terminates or passes through depending on ingress mode", { rfcs: ["http", "tls"], specs: ["mcp"] }, { profile: "privilege" }),
  edge("privgw-mcpmcp", "privgw", "mcpmcp", "Privilege MCP backend", "optional", "MCP · Streamable HTTP", "Privilege gateway → mcp-server:8080", "Optional profile; gateway authentication and ingress TLS configuration apply", { rfcs: ["http", "tls"], specs: ["mcp"] }, { profile: "privilege" }),
  edge("prometheus-pinggw", "prometheus", "pinggw", "scrape metrics :8085", "telemetry", "HTTP · Prometheus scrape", "Prometheus → PingGateway admin connector :8085", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-nodegw", "prometheus", "nodegw", "scrape metrics :3005", "telemetry", "HTTP · Prometheus scrape", "Prometheus → Node MCP Gateway /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-mcpmcp", "prometheus", "mcpmcp", "scrape metrics :8080", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-mcpresource", "prometheus", "mcpresource", "scrape metrics :8081", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP resource server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-apiresource", "prometheus", "apiresource", "scrape metrics :8082", "telemetry", "HTTP · Prometheus scrape", "Prometheus → API resource server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-mcpproxy", "prometheus", "mcpproxy", "scrape metrics :8895", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP proxy /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-langchain", "prometheus", "langchain", "scrape metrics :8888", "telemetry", "HTTP · Prometheus scrape", "Prometheus → LangChain agent /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("prometheus-llmproxy", "prometheus", "llmproxy", "scrape metrics :8090", "telemetry", "HTTP · Prometheus scrape", "Prometheus → LLM proxy /metrics", "Internal metrics endpoint", { rfcs: ["http"] }, { securityOptions: [PROMETHEUS_AUTH_CANDIDATE] }),
  edge("spire-bff", "spire", "bff", "BFF workload identity", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket / SVID delivery", "Conditional on MCP_MTLS_ON and configured SVID verification", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
  edge("spire-nodegw", "spire", "nodegw", "Gateway workload identity", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket / SVID delivery", "Conditional on MCP_MTLS_ON and configured SVID verification", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
];

export const DEMO_STEP_USE_CASES = {
  UC1: "Full flow — delegated access",
  UC20: "Agent observability / audit trail",
  UC30: "Weather MCP — Texas permit",
};

export const SERVER_ZONES = [
  { id: "zone-client", label: "Client & edge", x: 20, y: 400, width: 260, height: 640, tone: "external" },
  { id: "zone-external", label: "External identity & model services", x: 570, y: 20, width: 900, height: 180, tone: "identity" },
  { id: "zone-app", label: "AI demo service network", x: 290, y: 225, width: 1780, height: 780, tone: "app" },
  { id: "zone-optional", label: "Optional profiles & supporting services", x: 290, y: 1040, width: 1690, height: 370, tone: "optional" },
  { id: "zone-observability", label: "Telemetry", x: 2030, y: 225, width: 300, height: 1165, tone: "observability" },
  { id: "zone-trust", label: "Workload identity", x: 1760, y: 1160, width: 280, height: 230, tone: "trust" },
].map((zone) => ({
  id: zone.id, type: "zone", position: position(zone.x, zone.y), selectable: false,
  zIndex: -1, style: { width: zone.width, height: zone.height, zIndex: -1 }, data: zone,
}));

export const PLAYBACKS = {
  // The two A2A flows list only the agent and gateway hops. The BFF relay and
  // the gateway's call to the model provider are real (their edges are on the
  // map), but those boxes sit far away, and including them made "Flow boxes
  // only" zoom out until the cards were too small to read.
  privilegeA2a: {
    label: "Agent → Agent Privilege → agent → tools",
    resultShort: "Every hop checked by the gateway",
    result: "The main agent hands a question to the worker through the Agent Privilege. The worker calls its model and its MCP tools through the same gateway with its own key. Each agent presents only its own agent key, and the gateway holds the model provider key. The app reaches the main agent through the BFF.",
    steps: [
      { edgeId: "a2amain-privgw", title: "Main agent → gateway · A2A message with its agent key" },
      { edgeId: "privgw-a2aworker", title: "Gateway → worker · forwarded after key, scope, policy, guardrail" },
      { edgeId: "a2aworker-privgw", title: "Worker → gateway · model and tool calls with its own key" },
      { edgeId: "privgw-a2aworker", title: "Gateway → MCP server · permitted tool call, result screened" },
    ],
  },
  privilegeA2aChain: {
    label: "Three-deep agent chain through the Agent Privilege",
    resultShort: "Two gateway hops, each with the caller's own key",
    result: "The main agent calls the LangChain agent through the gateway; the LangChain agent then calls a specialist through the gateway with its own key. A prompt-injection message is blocked at the first hop, and a hand-off to an ungranted agent is refused at the second.",
    steps: [
      { edgeId: "a2amain-privgw", title: "Main agent → gateway · first hop" },
      { edgeId: "privgw-langchain", title: "Gateway → LangChain agent · forwarded" },
      { edgeId: "langchain-privgw", title: "LangChain agent → gateway · second hop with its own key" },
    ],
  },
  pingOneLogin: {
    label: "User → PingOne login → BFF session",
    resultShort: "Authenticated session established",
    result: "The user authenticates with PingOne; the browser returns a one-time code and state to the BFF, which redeems the code with PKCE and establishes the server-side session. OAuth endpoints and callback URI come from the active configuration.",
    steps: [
      { edgeId: "browser-ingress", title: "Browser → ingress · start sign-in" },
      { edgeId: "ingress-bff-login", title: "Ingress → BFF · login request" },
      { edgeId: "bff-browser-redirect", title: "BFF → browser · 302 with state and PKCE challenge" },
      { edgeId: "browser-pingone-login", title: "Browser → PingOne authorize · PKCE challenge" },
      { edgeId: "pingone-browser-callback", title: "PingOne → browser · code and state" },
      { edgeId: "browser-ingress-callback", title: "Browser → ingress · OAuth callback" },
      { edgeId: "ingress-bff-callback", title: "Ingress → BFF · validate state" },
      { edgeId: "bff-pingone-token", title: "BFF → PingOne token endpoint · code + verifier" },
      { edgeId: "bff-browser-session", title: "BFF → browser · establish HttpOnly session" },
    ],
  },
  pingFederateLogin: {
    label: "User → PingFederate login → BFF session",
    resultShort: "Authenticated session established",
    result: "The user authenticates with PingFederate; the browser returns a one-time code and state to the BFF, which redeems the code with PKCE and establishes the server-side session. PingFederate endpoints, callback URI, and client authentication come from the active configuration.",
    steps: [
      { edgeId: "browser-ingress", title: "Browser → ingress · start sign-in" },
      { edgeId: "ingress-bff-login", title: "Ingress → BFF · login request" },
      { edgeId: "bff-browser-redirect", title: "BFF → browser · 302 with state and PKCE challenge" },
      { edgeId: "browser-pingfederate-login", title: "Browser → PingFederate authorize · PKCE challenge" },
      { edgeId: "pingfederate-browser-callback", title: "PingFederate → browser · code and state" },
      { edgeId: "browser-ingress-callback", title: "Browser → ingress · OAuth callback" },
      { edgeId: "ingress-bff-callback", title: "Ingress → BFF · validate state" },
      { edgeId: "bff-pingfederate-token", title: "BFF → PingFederate token endpoint · code + verifier" },
      { edgeId: "bff-browser-session", title: "BFF → browser · establish HttpOnly session" },
    ],
  },
  directMcp: {
    label: "Local Compose: direct MCP client → MCP server",
    resultShort: "Tool result returned",
    result: "This playback shows the direct MCP listener published by local Compose. Hosted MCP requests route through PingGateway; only Protected Resource Metadata is sent directly to the MCP server. Use the PingGateway playback for the hosted request path.",
    steps: [
      { edgeId: "browser-mcpmcp-direct", title: "Local Compose client → directly published MCP server" },
    ],
  },
  directMcpPingFederateStep9: {
    label: "Local direct WebSocket · PingFederate Step 9",
    resultShort: "PF audience token reaches the protected BFF API",
    result: "Conditional local Compose WebSocket path: the MCP server receives and validates a PF-issued bearer directly, then performs Step 9 for non-vertical banking data tools when PF Step 9 is configured. BANKING_API_RESOURCE_URI must match the BFF resource audience (PINGONE_RESOURCE_BFF_URI or ENDUSER_AUDIENCE); the env refresh helper aligns these values by default. BankingAPIClient sends the resulting delegated bearer to the protected BFF API. The Node Gateway path is PingOne-issued, and the HTTP MCP route's issuer allowlist currently excludes PF; neither is part of this route.",
    steps: [
      { edgeId: "browser-mcpmcp-direct", title: "Local Compose WebSocket client → OAuth MCP server · PF-issued bearer" },
      { edgeId: "mcpmcp-pingfederate-step9", title: "MCP server → PingFederate · conditional Step 9 RFC 8693 exchange" },
      { edgeId: "mcpmcp-bff-api", title: "OAuth MCP server → BFF API · delegated user bearer" },
    ],
  },
  protectedApi: {
    label: "Agent → Demo Agent Gateway → protected BFF API · Step 9 passthrough",
    resultShort: "Authorized API data returned",
    result: "This playback covers installations where MCP Step 9 is not configured: Authorize permits the request, the gateway exchanges the subject token for an MCP-server audience token, and the OAuth MCP server passes that delegated bearer to the protected BFF API route. When Step 9 is configured, use the PingOne or PingFederate variant, which shows the additional provider-specific exchange.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway (Node MCP Gateway)" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision", demoStepIds: ["UC1"] },
      { edgeId: "nodegw-pingone", title: "Demo Agent Gateway → PingOne · RFC 8693 exchange" },
      { edgeId: "nodegw-mcpmcp", title: "Gateway → OAuth MCP server" },
      { edgeId: "mcpmcp-bff-api", title: "OAuth MCP server → BFF API · delegated user bearer", demoStepIds: ["UC1"] },
    ],
  },
  protectedApiPingOne: {
    label: "Protected BFF API · conditional PingOne Step 9",
    resultShort: "PingOne audience token reaches protected API",
    result: "Conditional variant for non-vertical banking data tools: after the gateway exchange, the OAuth MCP server performs Step 9 RFC 8693 with PingOne when MCP token-exchanger credentials are configured. BANKING_API_RESOURCE_URI must match the BFF resource audience (PINGONE_RESOURCE_BFF_URI or ENDUSER_AUDIENCE); the env refresh helper aligns these values by default. BankingAPIClient sends the resulting delegated bearer to the protected BFF API. If Step 9 is not configured, use the passthrough playback.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway (Node MCP Gateway)" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision", demoStepIds: ["UC1"] },
      { edgeId: "nodegw-pingone", title: "Demo Agent Gateway → PingOne · RFC 8693 exchange" },
      { edgeId: "nodegw-mcpmcp", title: "Gateway → OAuth MCP server" },
      { edgeId: "mcpmcp-pingone-step9", title: "MCP server → PingOne · conditional Step 9 RFC 8693 exchange" },
      { edgeId: "mcpmcp-bff-api", title: "OAuth MCP server → BFF API · delegated user bearer", demoStepIds: ["UC1"] },
    ],
  },
  apiKeyBackend: {
    label: "Agent → Demo Agent Gateway → API-key backend",
    resultShort: "Mortgage data returned · key stays server-side",
    result: "The gateway authorizes the user, replaces the OAuth bearer with its server-side API key, and returns the mortgage record through the agent. The API key stays server-side.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway (Node MCP Gateway)" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision" },
      { edgeId: "nodegw-apiresource-apikey", title: "Gateway → API resource server · X-API-Key" },
    ],
  },
  mcpResource: {
    label: "Agent → Demo Agent Gateway → MCP resource server",
    resultShort: "Resource data returned",
    result: "Authorize permits the request; the OAuth MCP server delegates the read to the MCP resource server and returns its data through the agent.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway (Node MCP Gateway)" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision", demoStepIds: ["UC1"] },
      { edgeId: "nodegw-pingone", title: "Demo Agent Gateway → PingOne · RFC 8693 exchange" },
      { edgeId: "nodegw-mcpmcp", title: "Gateway → OAuth MCP server" },
      { edgeId: "mcpmcp-mcpresource", title: "MCP server → MCP resource server", demoStepIds: ["UC1"] },
    ],
  },
  pingGateway: {
    label: "Agent → PingGateway → MCP resource server",
    resultShort: "Policy-approved result returned",
    result: "PingGateway introspects the token and evaluates policy; permitted MCP requests reach the MCP resource server and return through PingGateway to the agent.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-pinggw", title: "BFF agent → PingGateway" },
      { edgeId: "pinggw-authz", title: "PingGateway → introspection / Authorize" },
      { edgeId: "pinggw-mcpmcp", title: "PingGateway → OAuth MCP server" },
      { edgeId: "mcpmcp-mcpresource", title: "MCP server → MCP resource server" },
    ],
  },
  weather: {
    label: "Agent → Demo Agent Gateway → Weather MCP",
    resultShort: "Scoped weather result returned",
    result: "After token validation and authorization, the Demo Agent Gateway routes the weather tool to the optional weather MCP backend and returns the scoped result through the agent.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision" },
      { edgeId: "nodegw-weather", title: "Demo Agent Gateway → Weather MCP backend", demoStepIds: ["UC30"] },
    ],
  },
  brave: {
    label: "Agent → Demo Agent Gateway → Brave news search",
    resultShort: "Policy-filtered news returned",
    result: "After token validation and authorization, the Demo Agent Gateway applies the demo search policy, calls the optional Brave MCP backend, and returns filtered news through the agent.",
    steps: [
      { edgeId: "browser-ingress", title: "User / agent client → ingress" },
      { edgeId: "ingress-frontend", title: "Ingress → frontend" },
      { edgeId: "frontend-bff", title: "Frontend → BFF agent runtime" },
      { edgeId: "bff-pingone", title: "BFF → PingOne · user and gateway tokens" },
      { edgeId: "bff-nodegw", title: "BFF agent → Demo Agent Gateway" },
      { edgeId: "nodegw-authz", title: "Demo Agent Gateway → PingOne Authorize · policy decision" },
      { edgeId: "nodegw-brave", title: "Demo Agent Gateway → Brave news search MCP" },
    ],
  },
  telemetry: {
    label: "Service telemetry → alerts",
    resultShort: "Metrics and alert events delivered",
    result: "The gateway emits audit events, Prometheus scrapes service metrics, stores time series, and sends configured alert events to Alertmanager.",
    steps: [
      { edgeId: "nodegw-mcpaudit", title: "Node MCP Gateway → MCP audit event service", demoStepIds: ["UC20"] },
      { edgeId: "prometheus-nodegw", title: "Prometheus → Node MCP Gateway metrics" },
      { edgeId: "prometheus-mcpmcp", title: "Prometheus → MCP server metrics" },
      { edgeId: "prometheus-mcpresource", title: "Prometheus → MCP resource server metrics" },
      { edgeId: "prometheus-apiresource", title: "Prometheus → API resource server metrics" },
      { edgeId: "prometheus-alertmanager", title: "Prometheus → Alertmanager" },
    ],
  },
};
