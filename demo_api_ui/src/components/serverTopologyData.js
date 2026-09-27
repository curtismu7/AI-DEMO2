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
  id, type: "server", position: position(x, y), draggable: false,
  data: { title, service, group, kind, role, protocol, network, security, ...refs, ...extra },
});

// Coordinates deliberately leave room for the selected details pane and the wider/taller canvas.
export const SERVER_NODES = [
  server("browser", "Browser / MCP client", "external client", "core", "client", 40, 500, "User agent and external MCP clients enter through the public app or gateway endpoint.", "HTTPS · browser session · OAuth redirects", "User device → local TLS origin or Kubernetes ingress", "TLS at public edge; browser session cookie at the BFF.", { rfcs: ["oauth", "pkce", "bcp", "tls"] }, { local: "https://local.ping-devops.com:4000", k8s: "Public ingress :443" }),
  server("ingress", "Ingress / reverse proxy", "nginx ingress", "core", "gateway", 320, 500, "Routes public requests to the frontend, BFF, and explicitly exposed services.", "HTTPS → HTTP(S) service routes", "Public edge → local reverse proxy or Kubernetes ingress", "TLS terminates at the configured public edge; upstream encryption depends on the target.", { rfcs: ["http", "tls"] }, { local: "https://local.ping-devops.com:4000", k8s: "ingress-nginx → frontend / BFF" }),
  server("frontend", "Frontend", "demo_api_ui", "core", "app", 600, 500, "React application; owns browser presentation and sends API requests to the BFF.", "HTTPS · JSON/HTTP API · SSE where enabled", "Docker bridge or Kubernetes ClusterIP; public path through ingress", "Browser TLS ends at the configured frontend/ingress boundary.", { serviceKey: "frontend", rfcs: ["http", "tls", "oauth", "pkce"] }),
  server("bff", "BFF / API server", "demo_api_server", "core", "app", 880, 500, "Sole browser-token custodian. Coordinates sessions, OAuth, agents, gateways, and API calls.", "HTTPS · JSON/HTTP · WebSocket clients · SSE", "Internal Docker network or ai-demo namespace", "Session cookies are handled at the browser edge; downstream MCP mTLS is conditional.", { serviceKey: "bff", rfcs: ["oauth", "pkce", "exchange", "resource", "dpop", "rar", "bcp", "tls"] }),
  server("pingone", "PingOne", "Authorization server / policy", "identity", "identity", 600, 70, "External identity provider for sign-in, token issuance/exchange, and configured authorization services.", "OAuth 2.0 / OIDC · token endpoint · introspection", "Outbound HTTPS :443", "External TLS; enabled authorization behavior depends on environment configuration.", { rfcs: ["oauth", "pkce", "exchange", "resource", "introspection", "bcp", "tls"] }, { local: "auth.pingone.com:443", k8s: "auth.pingone.com:443" }),
  server("pinggw", "PingGateway", "ping-gateway", "core", "gateway", 1180, 390, "Identity Gateway route for MCP requests and policy enforcement; separate from the Node gateway.", "HTTP · MCP JSON-RPC · introspection / Authorize", "Internal service network; external authorization calls use outbound HTTPS", "Internal HTTP in declared topology. Public TLS, if exposed, terminates upstream.", { serviceKey: "ping-gateway", rfcs: ["metadata", "introspection", "exchange", "resource", "http", "tls"], specs: ["mcp", "jsonrpc"] }),
  server("authz", "AuthZ / PDP", "authz-server", "identity", "identity", 1480, 270, "Mock authorization and introspection service. Compose runs a separate demo-auth service; Kubernetes runs it as a PingGateway sidecar.", "HTTP · policy decision / introspection", "Compose service network or same-pod Kubernetes loopback", "Internal HTTP; gateway fails closed if the selected authorization endpoint is unavailable.", { rfcs: ["introspection", "oauth"] }, { profile: "demo-auth", local: "http://authz-server:9001", k8s: "http://127.0.0.1:9001 · PingGateway pod" }),
  server("nodegw", "Demo MCP Gateway", "demo_mcp_gateway", "core", "gateway", 1180, 650, "Node gateway route. Applies MCP routing and policy, then forwards to configured MCP services.", "MCP Streamable HTTP · JSON-RPC · WebSocket upstream", "Docker network or ai-demo namespace", "Internal HTTP by default. SPIFFE workload mTLS is optional and requires SVID verification at both endpoints.", { serviceKey: "mcp-gateway", rfcs: ["oauth", "exchange", "resource", "metadata", "introspection", "http", "http2"], specs: ["mcp", "jsonrpc", "websocket", "spiffe"] }),
  server("mcpmcp", "OAuth MCP server", "oauth-mcp / mcp-server", "core", "data", 1480, 500, "Protected MCP server that owns banking tools and resource access.", "MCP · JSON-RPC · WebSocket / HTTP endpoints", "Reached through an allowed gateway or BFF path; cluster-local service", "Local MCP mTLS is opt-in via MCP_MTLS_ON. Kubernetes manifests do not declare workload mTLS for this hop.", { serviceKey: "mcp-server", rfcs: ["metadata", "resource", "oauth", "tls", "mtls"], specs: ["mcp", "jsonrpc", "websocket"] }),
  server("mcpresource", "MCP resource server", "demo_mcp_resource_server", "core", "data", 1780, 400, "Investing and read-path MCP tools backed by service data.", "MCP · JSON-RPC · WebSocket", "Internal service network / namespace", "Internal HTTP in declared topology; no Kubernetes workload mTLS setting found in checked-in manifests.", { serviceKey: "mcp-resource-server", rfcs: ["metadata", "resource", "http"], specs: ["mcp", "jsonrpc", "websocket"] }),
  server("apiresource", "API resource server", "api-resource-server", "core", "data", 1780, 600, "Banking and vertical API backends used by protected tools.", "HTTP · JSON REST", "Internal service network / namespace", "Internal HTTP in declared topology; bearer authorization is enforced by API routes.", { serviceKey: "api-resource-server", rfcs: ["http", "oauth"] }),
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
  server("privgw", "Privilege MCP Gateway", "ping-mcpgw · mcpgw-nginx", "optional", "gateway", 1010, 1220, "Optional PingOne Privilege MCP gateway and Nginx ingress services.", "MCP · Streamable HTTP / SSE compatibility", "Optional public ingress and gateway path", "TLS behavior depends on ingress mode; passthrough and TLS termination are distinct.", { rfcs: ["metadata", "http", "tls"], specs: ["mcp"] }, { profile: "privilege", local: "Profile endpoints vary", k8s: "Public ingress → gateway service" }),
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

export const SERVER_EDGES = [
  edge("browser-ingress", "browser", "ingress", "HTTPS :443", "mcp", "HTTPS · public edge", "User device → reverse proxy", "TLS", { rfcs: ["http", "tls"] }),
  edge("ingress-frontend", "ingress", "frontend", "HTTP(S) :4000", "mcp", "HTTP(S) · frontend route", "Edge → app network", "TLS boundary depends on deployment", { rfcs: ["http", "tls"] }),
  edge("frontend-bff", "frontend", "bff", "HTTPS / JSON API", "mcp", "HTTPS · JSON/HTTP", "Frontend → BFF", "TLS", { rfcs: ["http", "tls"] }),
  edge("bff-pingone", "bff", "pingone", "OAuth / OIDC", "oauth", "OAuth 2.0 · OIDC", "Outbound HTTPS :443", "TLS · user and client credentials", { rfcs: ["oauth", "pkce", "bcp"] }),
  edge("bff-pinggw", "bff", "pinggw", "MCP route A", "mcp", "MCP · HTTP / JSON-RPC", "Internal service network", "Bearer token; internal HTTP by declared topology", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc"] }),
  edge("bff-nodegw", "bff", "nodegw", "MCP route B", "mcp", "MCP Streamable HTTP", "Internal service network", "Bearer token; optional workload mTLS on downstream MCP hop", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc"] }),
  edge("pinggw-authz", "pinggw", "authz", "policy / introspection", "oauth", "HTTP · PDP / introspection", "Loopback or same-pod sidecar", "Internal sidecar connection", { rfcs: ["oauth", "introspection"] }, { profile: "demo-auth" }),
  edge("pinggw-mcpmcp", "pinggw", "mcpmcp", "MCP / HTTP or WS", "mcp", "MCP · JSON-RPC · HTTP/WebSocket", "Gateway → MCP server", "Local mTLS is opt-in; K8s workload mTLS not declared", { rfcs: ["metadata", "resource", "introspection"], specs: ["mcp", "jsonrpc", "websocket"] }),
  edge("nodegw-mcpmcp", "nodegw", "mcpmcp", "MCP / Streamable HTTP", "mcp", "MCP · JSON-RPC · Streamable HTTP", "Gateway → MCP server", "Local mTLS is opt-in; SPIFFE identity is optional", { rfcs: ["metadata", "resource", "exchange"], specs: ["mcp", "jsonrpc", "spiffe"] }),
  edge("mcpmcp-mcpresource", "mcpmcp", "mcpresource", "tool / data API", "data", "HTTP · protected service call", "Internal service network", "Service authorization; internal HTTP in topology", { rfcs: ["http", "oauth"] }),
  edge("mcpmcp-apiresource", "mcpmcp", "apiresource", "REST / JSON", "data", "HTTP · REST/JSON", "Internal service network", "Bearer authorization at protected API", { rfcs: ["http", "oauth"] }),
  edge("bff-langchain", "bff", "langchain", "agent request", "agent", "HTTP · AG-UI/SSE", "BFF → agent service", "Internal HTTP in topology", { rfcs: ["http"] }),
  edge("bff-discovery", "bff", "discovery", "service discovery", "mcp", "HTTP · discovery registry", "BFF → MCP discovery agent :3910", "Internal service network", { rfcs: ["http"] }),
  edge("langchain-llmproxy", "langchain", "llmproxy", "model request", "agent", "HTTP · model API", "Agent → LLM proxy", "Credentials handled by provider configuration", { rfcs: ["http"] }),
  edge("llmproxy-model", "llmproxy", "model", "HTTPS :443", "agent", "HTTPS · provider API", "Outbound egress", "TLS", { rfcs: ["http", "tls"] }),
  edge("bff-hitl", "bff", "hitl", "approval / challenge", "optional", "HTTP · JSON/events", "BFF → HITL service", "Internal service network", { rfcs: ["http"] }),
  edge("nodegw-mcpjwt", "nodegw", "mcpjwt", "JWKS / verify", "optional", "HTTP · verification", "Gateway support service", "Internal service network", { rfcs: ["http"] }),
  edge("nodegw-mcpaudit", "nodegw", "mcpaudit", "audit events", "telemetry", "HTTP · audit ingestion", "Gateway → MCP audit service :8898", "Secret-guarded internal ingest", { rfcs: ["http"] }),
  edge("mcpproxy-nodegw", "mcpproxy", "nodegw", "REST to MCP", "mcp", "HTTP REST → MCP", "MCP proxy → configured gateway URL", "Bearer token forwarded to the configured gateway", { rfcs: ["http"], specs: ["mcp"] }),
  edge("alloy-loki", "alloy", "loki", "logs", "telemetry", "HTTP · log push", "Telemetry network", "Internal telemetry connection", { rfcs: ["http"] }),
  edge("grafana-prometheus", "grafana", "prometheus", "metrics query", "telemetry", "HTTP · PromQL", "Telemetry network", "Dashboard data-source connection", { rfcs: ["http"] }),
  edge("grafana-jaeger", "grafana", "jaeger", "trace query", "telemetry", "HTTP · trace query", "Telemetry network", "Dashboard data-source connection", { rfcs: ["http"] }),
  edge("prometheus-alertmanager", "prometheus", "alertmanager", "alert events", "telemetry", "HTTP · Prometheus alert API", "Telemetry network", "Internal telemetry connection", { rfcs: ["http"] }),
  edge("spire-mcpmcp", "spire", "mcpmcp", "SVID / trust bundle", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket and workload identity path", "Only active in configured SPIFFE profile", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
  edge("agentservice-llmproxy", "agentservice", "llmproxy", "agent / model", "agent", "HTTP · model API", "Agent → proxy", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "agents" }),
  edge("mcpmcp-weather", "mcpmcp", "weather", "tool backend", "optional", "HTTP · weather tool", "Optional service network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "mcp-extras" }),
  edge("mcpmcp-brave", "mcpmcp", "brave", "tool backend", "optional", "HTTP · search tool", "Optional service network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "mcp-extras" }),
  edge("llamaindex-search", "llamaindex", "search", "retrieval APIs", "optional", "HTTP · RAG APIs", "Optional profile network", "Internal HTTP in topology", { rfcs: ["http"] }, { profile: "rag" }),
  edge("opensearchmcp-search", "opensearchmcp", "search", "search backend", "optional", "HTTP · OpenSearch API", "MCP adapter → OpenSearch backend", "Internal profile network", { rfcs: ["http"] }, { profile: "rag" }),
  edge("browser-privgw", "browser", "privgw", "optional public MCP route", "optional", "HTTPS → MCP Streamable HTTP", "Browser → mcpgw-nginx → Privilege MCP gateway", "TLS terminates or passes through depending on ingress mode", { rfcs: ["http", "tls"], specs: ["mcp"] }, { profile: "privilege" }),
  edge("privgw-mcpmcp", "privgw", "mcpmcp", "Privilege MCP backend", "optional", "MCP · Streamable HTTP", "Privilege gateway → mcp-server:8080", "Optional profile; gateway authentication and ingress TLS configuration apply", { rfcs: ["http", "tls"], specs: ["mcp"] }, { profile: "privilege" }),
  edge("prometheus-pinggw", "prometheus", "pinggw", "scrape metrics :8085", "telemetry", "HTTP · Prometheus scrape", "Prometheus → PingGateway admin connector :8085", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-nodegw", "prometheus", "nodegw", "scrape metrics :3005", "telemetry", "HTTP · Prometheus scrape", "Prometheus → Node MCP Gateway /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-mcpmcp", "prometheus", "mcpmcp", "scrape metrics :8080", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-mcpresource", "prometheus", "mcpresource", "scrape metrics :8081", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP resource server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-apiresource", "prometheus", "apiresource", "scrape metrics :8082", "telemetry", "HTTP · Prometheus scrape", "Prometheus → API resource server /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-mcpproxy", "prometheus", "mcpproxy", "scrape metrics :8895", "telemetry", "HTTP · Prometheus scrape", "Prometheus → MCP proxy /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-langchain", "prometheus", "langchain", "scrape metrics :8888", "telemetry", "HTTP · Prometheus scrape", "Prometheus → LangChain agent /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("prometheus-llmproxy", "prometheus", "llmproxy", "scrape metrics :8090", "telemetry", "HTTP · Prometheus scrape", "Prometheus → LLM proxy /metrics", "Internal metrics endpoint", { rfcs: ["http"] }),
  edge("spire-bff", "spire", "bff", "BFF workload identity", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket / SVID delivery", "Conditional on MCP_MTLS_ON and configured SVID verification", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
  edge("spire-nodegw", "spire", "nodegw", "Gateway workload identity", "optional", "SPIFFE Workload API · X.509-SVID", "Optional Unix socket / SVID delivery", "Conditional on MCP_MTLS_ON and configured SVID verification", { rfcs: ["tls"], specs: ["spiffe"] }, { profile: "spiffe" }),
];

export const SERVER_ZONES = [
  { id: "zone-client", label: "Client & edge", x: 20, y: 400, width: 260, height: 640, tone: "external" },
  { id: "zone-external", label: "External identity & model services", x: 570, y: 20, width: 900, height: 180, tone: "identity" },
  { id: "zone-app", label: "AI demo service network", x: 290, y: 225, width: 1780, height: 780, tone: "app" },
  { id: "zone-optional", label: "Optional profiles & supporting services", x: 290, y: 1040, width: 1690, height: 370, tone: "optional" },
  { id: "zone-observability", label: "Telemetry", x: 2030, y: 225, width: 300, height: 1165, tone: "observability" },
  { id: "zone-trust", label: "Workload identity", x: 1760, y: 1160, width: 280, height: 230, tone: "trust" },
].map((zone) => ({
  id: zone.id, type: "zone", position: position(zone.x, zone.y), draggable: false, selectable: false,
  zIndex: -1, style: { width: zone.width, height: zone.height, zIndex: -1 }, data: zone,
}));

export const PLAYBACKS = {
  nodeGateway: {
    label: "Request · Node MCP Gateway",
    edgeIds: ["browser-ingress", "ingress-frontend", "frontend-bff", "bff-pingone", "bff-nodegw", "nodegw-mcpmcp", "mcpmcp-apiresource"],
  },
  pingGateway: {
    label: "Request · PingGateway",
    edgeIds: ["browser-ingress", "ingress-frontend", "frontend-bff", "bff-pingone", "bff-pinggw", "pinggw-authz", "pinggw-mcpmcp", "mcpmcp-mcpresource"],
  },
  telemetry: {
    label: "Telemetry & alerts",
    edgeIds: ["prometheus-nodegw", "prometheus-mcpmcp", "prometheus-mcpresource", "prometheus-apiresource", "prometheus-alertmanager"],
  },
};
