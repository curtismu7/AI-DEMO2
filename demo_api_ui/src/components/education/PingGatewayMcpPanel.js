// banking_api_ui/src/components/education/PingGatewayMcpPanel.js
import EducationDrawer from '../shared/EducationDrawer';

const MCP_SECURITY_GATEWAY_DOC =
  'https://docs.pingidentity.com/pinggateway/2026/mcp/index.html';

function OverviewTab() {
  return (
    <div>
      <p style={{ color: "#374151", marginBottom: "1rem" }}>
        <strong>MCP servers contain no security logic.</strong> Token validation, scope enforcement, protocol compliance, rate limiting, and audit all live in the gateway. The MCP server trusts that whatever reaches it has already been authorized — it focuses entirely on tool execution.
      </p>
      <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        Canonical Ping docs:{' '}
        <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
          MCP security gateway | PingOne Agent Gateway 2026
        </a>
        {' '}(Evolving interface stability).
      </p>
      <h3 style={{ marginTop: 0 }}>Why secure MCP with a gateway?</h3>
      <p>
        MCP is an open standard to connect AI agents with AI servers. Exposing services over MCP
        makes them usable by agents — but you still need an appropriate, consistent, documented,
        and adaptable security model across those assets. PingOne Agent Gateway sits as an MCP gateway so
        business teams can accelerate AI adoption while IAM/security teams own enforcement.
      </p>

      <h4>What PingOne Agent Gateway protects MCP servers to do</h4>
      <p style={{ fontSize: '0.82rem', color: '#374151' }}>
        From the official{' '}
        <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
          MCP security gateway
        </a>{' '}
        guide:
      </p>
      <ul>
        <li><strong>Allow only valid MCP requests</strong> — protocol / JSON-RPC shape before tools run</li>
        <li><strong>Audit MCP requests and actors</strong> — <code>McpAuditFilter</code> → <code>audit/mcp.audit.json</code>; Token Chain shows the same 5W1H hop live</li>
        <li><strong>Throttle request rates</strong> — protect backends from noisy or malicious agents</li>
        <li><strong>Enforce coarse-grained OAuth 2.0</strong> — RS validation, scopes, audience</li>
        <li><strong>Enforce fine-grained access control</strong> — PingOne Authorize, PingAuthorize, PingOne Protect, Advanced Identity Cloud</li>
        <li><strong>Token transformation</strong> — map inbound agent tokens to your backend security model</li>
        <li><strong>Metrics</strong> — Prometheus <code>ig_mcp_*</code> counts, latencies, and errors per MCP method/tool</li>
      </ul>

      <h4>Architecture</h4>
      <pre className="edu-code">{`┌─────────────┐     ┌──────────────────┐     ┌────────────────┐
│  BFF / Agent │────▶│   PingOne Agent Gateway    │────▶│   MCP Server   │
│  (client)    │     │                  │     │                │
│              │◀────│  • Token check   │◀────│  • tools/list  │
│              │     │  • Scope enforce │     │  • tools/call  │
│              │     │  • Rate limit    │     │  • resources   │
│              │     │  • Audit log     │     │                │
└─────────────┘     └──────────────────┘     └────────────────┘
                           │
                    ┌──────▼──────┐
                    │   PingOne   │
                    │ /as/introspect │
                    │ /as/jwks    │
                    └─────────────┘`}</pre>

      <p>
        PingOne Agent Gateway acts as a <strong>reverse proxy</strong> — the MCP server never receives
        unauthenticated traffic. The gateway validates tokens by calling PingOne's introspection
        endpoint or verifying JWT signatures against the JWKS.
      </p>
    </div>
  );
}

function ArchitectureTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Deployment topology</h3>

      <h4>Option A: Sidecar (same host)</h4>
      <pre className="edu-code">{`┌────────────────────────────────────┐
│  Docker Host / K8s Pod             │
│                                    │
│  ┌──────────────┐  ┌────────────┐ │
│  │ PingOne Agent Gateway  │──│ MCP Server │ │
│  │ :8443 (TLS)  │  │ :8080      │ │
│  └──────────────┘  └────────────┘ │
│         │                          │
└─────────┼──────────────────────────┘
          │ Only :8443 exposed
          ▼
   External traffic`}</pre>

      <h4>Option B: Standalone gateway</h4>
      <pre className="edu-code">{`Internet          DMZ                  Private Network
─────────    ┌──────────────┐    ┌────────────────────┐
             │ PingOne Agent Gateway  │    │  MCP Server         │
  Client ───▶│ Load balanced│───▶│  Not internet-facing│
             │ TLS termination│  │  Internal DNS only  │
             └──────────────┘    └────────────────────┘`}</pre>

      <h4>Token validation flow</h4>
      <ol>
        <li>Client sends <code>tools/call</code> with <code>Authorization: Bearer &lt;token&gt;</code></li>
        <li>PingOne Agent Gateway extracts the Bearer token</li>
        <li>Gateway calls <code>POST /as/introspect</code> on PingOne (cached for token lifetime)</li>
        <li>If <code>active: true</code> and scopes match → forward to MCP server</li>
        <li>If invalid → return <code>401 Unauthorized</code> before MCP server is reached</li>
      </ol>

      <h4 style={{ color: "#1e293b", marginBottom: "0.5rem", marginTop: "1.5rem" }}>Route-level enforcement example</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
        <thead>
          <tr style={{ backgroundColor: "#1e293b" }}>
            <th style={{ padding: "0.5rem", textAlign: "left", color: "#e2e8f0" }}>Route</th>
            <th style={{ padding: "0.5rem", textAlign: "left", color: "#e2e8f0" }}>Required scope</th>
          </tr>
        </thead>
        <tbody>
          {[
            { route: "/ecommerce", scope: "read, write" },
            { route: "/crm", scope: "crm:read, crm:write" },
          ].map(({ route, scope }) => (
            <tr key={route} style={{ borderBottom: "1px solid #334155" }}>
              <td style={{ padding: "0.5rem", color: "#374151" }}><code className="edu-code">{route}</code></td>
              <td style={{ padding: "0.5rem", color: "#374151" }}><code className="edu-code">{scope}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "#374151", marginBottom: "1rem" }}>
        Each route is independently configured — a token scoped for <code className="edu-code">/ecommerce</code> is rejected at <code className="edu-code">/crm</code>.
      </p>

      <h4>WebSocket upgrade</h4>
      <p>
        MCP servers often use WebSocket (Streamable HTTP or legacy stdio-over-WS). PingOne Agent Gateway
        supports WebSocket upgrade — it validates the token on the initial HTTP upgrade request,
        then proxies the WebSocket frames transparently.
      </p>
    </div>
  );
}

function ComparisonTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Custom gateway vs PingOne Agent Gateway</h3>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Capability</th>
            <th style={{ padding: '8px' }}>Custom Gateway</th>
            <th style={{ padding: '8px' }}>PingOne Agent Gateway</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Token validation', 'Build JWT verify + introspect logic', 'Built-in, auto-discovers JWKS'],
            ['Scope enforcement', 'Manual route → scope mapping', 'Policy-driven, declarative config'],
            ['Rate limiting', 'Implement from scratch (Redis, etc.)', 'Built-in per-client policies'],
            ['Audit logging', 'Custom logging pipeline', 'Integrated with PingOne audit'],
            ['WebSocket support', 'Build upgrade handling + frame proxy', 'Native WebSocket proxy'],
            ['mTLS / TLS', 'Configure certs manually', 'Built-in cert management'],
            ['Deployment', 'Docker/K8s, you maintain', 'Docker image, Ping maintains'],
            ['Time to production', '2–6 weeks engineering', '1–2 days configuration'],
            ['Ongoing maintenance', 'You patch CVEs, update deps', 'Ping patches, you upgrade image'],
            ['Cost', 'Engineering time + infra', 'License fee'],
          ].map(([cap, custom, pg], i) => (
            <tr key={cap} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '8px', fontWeight: 600 }}>{cap}</td>
              <td style={{ padding: '8px' }}>{custom}</td>
              <td style={{ padding: '8px' }}>{pg}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ marginTop: '1.5rem' }}>When to choose what</h4>
      <ul>
        <li><strong>Custom gateway</strong> — learning exercise, unique requirements not met by PingOne Agent Gateway, or you already have an API gateway (Kong, Envoy) with OAuth plugins</li>
        <li><strong>PingOne Agent Gateway</strong> — production deployment, compliance requirements, need audit integration with PingOne, want minimal ongoing maintenance</li>
        <li><strong>Hybrid</strong> — use your existing API gateway for HTTP routes, add PingOne Agent Gateway specifically for MCP/WebSocket traffic that needs identity-aware proxying</li>
      </ul>
    </div>
  );
}

function ConfigTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>PingOne Agent Gateway configuration example</h3>
      <p>
        PingOne Agent Gateway uses JSON-based route configurations. Below is an example route
        that protects an MCP server with token validation and scope enforcement.
      </p>

      <h4>Route: MCP Server Protection</h4>
      <pre className="edu-code">{`{
  "name": "mcp-server-route",
  "baseURI": "http://mcp-server:8080",
  "condition": "\${matches(request.uri.path, '^/mcp')}",
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        {
          "type": "OAuth2ResourceServerFilter",
          "config": {
            "scopes": ["read"],
            "accessTokenResolver": {
              "type": "StatelessAccessTokenResolver",
              "config": {
                "issuer": "https://auth.pingone.com/{envId}/as",
                "jwkSetUri": "https://auth.pingone.com/{envId}/as/jwks"
              }
            }
          }
        },
        {
          "type": "ScriptableFilter",
          "config": {
            "type": "application/x-groovy",
            "source": [
              "// Map MCP tool names to required scopes",
              "def toolName = request.entity.json?.params?.name",
              "def scopeMap = [",
              "  'get_balance':    'read',",
              "  'get_transactions': 'read',",
              "  'transfer_funds': 'transfer',",
              "  'get_all_users':  'admin'",
              "]",
              "def required = scopeMap[toolName]",
              "if (required && !context.oauth2.scopes.contains(required)) {",
              "  return new Response(Status.FORBIDDEN)",
              "}",
              "return next.handle(context, request)"
            ]
          }
        },
        {
          "type": "ThrottlingFilter",
          "config": {
            "rate": { "numberOfRequests": 100, "duration": "1 minute" }
          }
        }
      ],
      "handler": "ClientHandler"
    }
  }
}`}</pre>

      <h4>Key configuration sections</h4>
      <ul>
        <li><strong>OAuth2ResourceServerFilter</strong> — validates Bearer token against PingOne JWKS</li>
        <li><strong>ScriptableFilter</strong> — maps tool names to required scopes (Groovy script)</li>
        <li><strong>ThrottlingFilter</strong> — rate limits to 100 requests/minute</li>
        <li><strong>baseURI</strong> — points to the internal MCP server (not exposed publicly)</li>
      </ul>

      <h4>Audit logging</h4>
      <pre className="edu-code">{`{
  "type": "AuditService",
  "config": {
    "config": {
      "handlerForQueries": {
        "type": "PingOneAuditHandler",
        "config": {
          "environmentId": "\${env.PINGONE_ENVIRONMENT_ID}",
          "apiKey": "\${env.PINGONE_AUDIT_API_KEY}"
        }
      }
    }
  }
}`}</pre>
      <p>
        With audit configured, every MCP tool call is logged to PingOne's audit system
        with the caller's identity (sub claim), scopes used, and response status.
      </p>
    </div>
  );
}

function OfficialFiltersTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Official PingOne Agent Gateway MCP filters</h3>
      <p>
        PingOne Agent Gateway ships dedicated MCP filters (Agent Gateway module, Evolving stability).
        They run as a chain before the <code>ReverseProxyHandler</code> that forwards traffic
        to the MCP server.
      </p>

      <h4>Filter chain order</h4>
      <pre className="edu-code">{`[McpAuditFilter] → [McpProtectionFilter] → [McpValidationFilter] → … → ReverseProxyHandler`}</pre>
      <p style={{ fontSize: '0.82rem', color: '#374151' }}>
        Docs require an <code>McpValidationFilter</code> <em>after</em>{" "}
        <code>McpAuditFilter</code> so <code>McpContext</code> is populated for audit events.
        This demo also runs PingOne Authorize and token exchange after validation.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Filter</th>
            <th style={{ padding: '8px' }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['McpAuditFilter', <>Records MCP request activity to <code className="edu-code">audit/mcp.audit.json</code> via an <code className="edu-code">AuditService</code> (topics <code className="edu-code">access</code> + <code className="edu-code">mcp</code>). Ping describes it as emitting MCP audit events for <em>who called which tool, where, and with what result</em>. Attribution includes user (<code className="edu-code">sub</code>), agent (<code className="edu-code">act.sub</code> / client), nested delegation, target service, and latency.</>],
            ['McpProtectionFilter', 'OAuth 2.0 resource server validation for MCP — introspects or JWT-verifies the Bearer token, serves protected-resource metadata, enforces aud vs resourceId'],
            ['McpValidationFilter', <>Validates Origin / Accept, JSON-RPC + MCP client message shape; rewrites protocol version; populates <code className="edu-code">McpContext</code> (<code className="edu-code">${'{'}contexts.mcp{'}'}</code>); optionally records metrics (<code className="edu-code">metricsEnabled</code>, default true)</>],
          ].map(([name, desc], i) => (
            <tr key={name} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '8px' }}><code>{name}</code></td>
              <td style={{ padding: '8px' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>What McpAuditFilter logs (5W1H)</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Dimension</th>
            <th style={{ padding: '8px' }}>Captured</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Who', 'User subject + acting agent (act / client_id) and delegation depth'],
            ['What', 'MCP method (e.g. tools/call) and tool / param name'],
            ['When', 'Event timestamp (and latency via metrics)'],
            ['Where', 'Gateway resource / route and target MCP service'],
            ['How / result', 'Forwarded vs blocked; policy outcome when Authorize runs'],
          ].map(([dim, cap], i) => (
            <tr key={dim} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '8px', fontWeight: 600 }}>{dim}</td>
              <td style={{ padding: '8px' }}>{cap}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.82rem' }}>
        In this demo, the same 5W1H payload is also mirrored on{" "}
        <code className="edu-code">X-Gw-Audit-Trail.mcpAudit</code> and shown as a Token Chain hop
        (<code className="edu-code">gw-mcp-audit</code>) so you can show it off live without opening
        the IG audit volume.
      </p>

      <h4>Broader MCP observability</h4>
      <ul style={{ fontSize: '0.82rem' }}>
        <li>
          <strong>Structured MCP traffic logging</strong> — <code>McpAuditFilter</code> +{" "}
          <code>McpValidationFilter</code> (validation rejects bad Origin/Accept/JSON-RPC before
          tools run; audit records accepted traffic and actors).
        </li>
        <li>
          <strong>Metrics per MCP method/tool</strong> — with <code>metricsEnabled: true</code>{" "}
          (default), Prometheus scrapes include{" "}
          <code>ig_mcp_method_time_seconds</code> (latency summary with method/tool labels) and{" "}
          <code>ig_mcp_error_total</code> (error counters). Endpoint pattern:{" "}
          <code>/metrics/prometheus/0.0.4</code> on the IG monitoring port.
        </li>
        <li>
          <strong>Audit / throttling visibility</strong> — requests that are validated, rejected
          (401/403/429), or forwarded are visible in audit + route metrics. Optional{" "}
          <code>ThrottlingFilter</code> (rate / MappedThrottlingPolicy) returns{" "}
          <code>429 Too Many Requests</code> with <code>Retry-After</code> when limits are hit —
          per route, tool, client, or identity.
        </li>
      </ul>

      <h4>McpContext (for downstream filters)</h4>
      <p style={{ fontSize: '0.82rem' }}>
        After validation, <code>${'{'}contexts.mcp{'}'}</code> exposes client/server message types,
        JSON-RPC payloads, protocol version, and MCP <code>sessionId</code> — so throttling,
        policy, and metrics can key off method and tool name without re-parsing the body.
      </p>

      <h4>McpProtectionFilter key properties</h4>
      <pre className="edu-code">{`{
  "type": "McpProtectionFilter",
  "config": {
    "resourceId": "https://ig.example.com:8443/mcp",
    "authorizationServerUri": "https://auth.pingone.com/{envId}/as",
    "resourceIdPointer": "/audience",
    "supportedScopes": ["read", "write", "mcp:invoke"]
  }
}`}</pre>
      <ul style={{ fontSize: '0.82rem' }}>
        <li><strong>resourceId</strong> — the gateway endpoint URI, used as the expected <code>aud</code> value</li>
        <li><strong>resourceIdPointer</strong> — JSON pointer into the JWT where the audience is found (typically <code>/audience</code>)</li>
        <li><strong>supportedScopes</strong> — scopes this resource accepts; requests with other scopes are rejected</li>
      </ul>

      <h4>AuditService + McpAuditFilter (this demo)</h4>
      <pre className="edu-code">{`{
  "name": "AuditService",
  "type": "AuditService",
  "config": {
    "eventHandlers": [{
      "class": "org.forgerock.audit.handlers.json.JsonAuditEventHandler",
      "config": {
        "name": "json",
        "logDirectory": "&{ig.instance.dir}/audit",
        "topics": ["access", "mcp"]
      }
    }]
  }
}

{
  "type": "McpAuditFilter",
  "config": { "auditService": "AuditService" }
}`}</pre>

      <h4>admin.json: enable streaming</h4>
      <p>
        MCP relies on Server-Sent Events (SSE) for tool responses. Without this flag, SSE connections
        are closed immediately and tool calls silently drop.
      </p>
      <pre className="edu-code">{`{
  "streamingEnabled": true
}`}</pre>

      <h4>Official sample route — what Ping documents</h4>
      <p style={{ fontSize: '0.82rem' }}>
        The{' '}
        <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
          MCP security gateway tutorial
        </a>{' '}
        walks a sample <code>mcp.json</code> route. Key points from that page:
      </p>
      <ul style={{ fontSize: '0.82rem' }}>
        <li>PingOne Agent Gateway acts as an <strong>OAuth 2.0 resource server (RS)</strong> in front of the MCP server.</li>
        <li><code>McpAuditFilter</code> audits MCP requests into <code>audit/mcp.audit.json</code>.</li>
        <li><code>UriPathRewriteFilter</code> maps gateway <code>/mcp</code> to the MCP server root <code>/</code>.</li>
        <li><code>McpProtectionFilter</code> extends the RS config for MCP (<code>resourceId</code>, AS URI, scopes, <code>resourceIdPointer</code>).</li>
        <li><code>McpValidationFilter</code> validates MCP requests after audit/protection.</li>
        <li><code>ReverseProxyHandler.soTimeout</code> (e.g. <code>20 seconds</code>) accommodates agents with infrequent SSE updates.</li>
        <li><code>streamingEnabled: true</code> in <code>admin.json</code> is required for SSE (part of MCP).</li>
        <li>MCP needs <strong>RFC 8707 resource indicators</strong> so the access token <code>audience</code> matches <code>resourceId</code> (Access Token Modification script on AIC/AM).</li>
        <li>The simple sample route does <em>not</em> include throttling or fine-grained access control — add those for production.</li>
      </ul>

      <h4>UriPathRewriteFilter + socket timeout</h4>
      <p>
        The gateway routes <code>/mcp</code> to the backend's <code>/</code> root, and sets a long
        socket timeout to accommodate infrequent SSE heartbeats from AI agents.
      </p>
      <pre className="edu-code">{`{
  "type": "UriPathRewriteFilter",
  "config": { "mappings": { "/mcp": "/" } }
}

// ReverseProxyHandler with extended timeout
{
  "type": "ReverseProxyHandler",
  "config": {
    "soTimeout": "20 seconds"
  }
}`}</pre>

      <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: '1rem' }}>
        Primary reference:{' '}
        <a href={MCP_SECURITY_GATEWAY_DOC} target="_blank" rel="noopener noreferrer">
          https://docs.pingidentity.com/pinggateway/2026/mcp/index.html
        </a>
        <br />
        Also:{' '}
        <a href="https://docs.pingidentity.com/pinggateway/2026/reference/McpAuditFilter.html" target="_blank" rel="noopener noreferrer">
          McpAuditFilter
        </a>
        {' · '}
        <a href="https://docs.pingidentity.com/pinggateway/2026/reference/McpValidationFilter.html" target="_blank" rel="noopener noreferrer">
          McpValidationFilter
        </a>
        {' · '}
        <a href="https://docs.pingidentity.com/pinggateway/2026/reference/MonitoringMetrics.html" target="_blank" rel="noopener noreferrer">
          Prometheus MCP metrics
        </a>
        {' · '}
        <a href="https://developer.pingidentity.com/blog/securing-mcp-servers-with-pings-mcp-gateway/" target="_blank" rel="noopener noreferrer">
          Developer blog
        </a>
      </p>
    </div>
  );
}

const tabs = [
  { id: 'overview', label: 'Overview', content: <OverviewTab /> },
  { id: 'architecture', label: 'Architecture', content: <ArchitectureTab /> },
  { id: 'official-filters', label: 'MCP Filters', content: <OfficialFiltersTab /> },
  { id: 'comparison', label: 'Custom vs PingOne Agent Gateway', content: <ComparisonTab /> },
  { id: 'config', label: 'Configuration', content: <ConfigTab /> },
];

export default function PingGatewayMcpPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="PingOne Agent Gateway — Securing MCP Servers"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(700px, 100vw)"
    />
  );
}
