// banking_api_ui/src/components/education/PingGatewayMcpPanel.js
import EducationDrawer from '../shared/EducationDrawer';

function OverviewTab() {
  return (
    <div>
      <p style={{ color: "#374151", marginBottom: "1rem" }}>
        <strong>MCP servers contain no security logic.</strong> Token validation, scope enforcement, protocol compliance, rate limiting, and audit all live in the gateway. The MCP server trusts that whatever reaches it has already been authorized — it focuses entirely on tool execution.
      </p>
      <h3 style={{ marginTop: 0 }}>Why secure MCP with a gateway?</h3>
      <p>
        MCP servers expose <strong>tools</strong> that perform real actions — account reads, transfers,
        user lookups. Without a gateway in front of the MCP server, every tool call hits the
        application directly with no centralized enforcement layer.
      </p>

      <h4>What PingGateway adds</h4>
      <ul>
        <li><strong>Token validation</strong> — every request's Bearer token is introspected or JWT-verified before reaching the MCP server</li>
        <li><strong>Scope enforcement</strong> — maps MCP tool names to required OAuth scopes (e.g. <code>get_balance</code> → <code>read</code>)</li>
        <li><strong>Rate limiting</strong> — per-client, per-user, or per-tool call limits</li>
        <li><strong>Audit logging</strong> — centralized log of every tool invocation with caller identity</li>
        <li><strong>Content filtering</strong> — inspect request/response payloads for sensitive data leakage</li>
      </ul>

      <h4>Architecture</h4>
      <pre className="edu-code">{`┌─────────────┐     ┌──────────────────┐     ┌────────────────┐
│  BFF / Agent │────▶│   PingGateway    │────▶│   MCP Server   │
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
        PingGateway acts as a <strong>reverse proxy</strong> — the MCP server never receives
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
│  │ PingGateway  │──│ MCP Server │ │
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
             │ PingGateway  │    │  MCP Server         │
  Client ───▶│ Load balanced│───▶│  Not internet-facing│
             │ TLS termination│  │  Internal DNS only  │
             └──────────────┘    └────────────────────┘`}</pre>

      <h4>Token validation flow</h4>
      <ol>
        <li>Client sends <code>tools/call</code> with <code>Authorization: Bearer &lt;token&gt;</code></li>
        <li>PingGateway extracts the Bearer token</li>
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
        MCP servers often use WebSocket (Streamable HTTP or legacy stdio-over-WS). PingGateway
        supports WebSocket upgrade — it validates the token on the initial HTTP upgrade request,
        then proxies the WebSocket frames transparently.
      </p>
    </div>
  );
}

function ComparisonTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Custom gateway vs PingGateway</h3>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Capability</th>
            <th style={{ padding: '8px' }}>Custom Gateway</th>
            <th style={{ padding: '8px' }}>PingGateway</th>
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
        <li><strong>Custom gateway</strong> — learning exercise, unique requirements not met by PingGateway, or you already have an API gateway (Kong, Envoy) with OAuth plugins</li>
        <li><strong>PingGateway</strong> — production deployment, compliance requirements, need audit integration with PingOne, want minimal ongoing maintenance</li>
        <li><strong>Hybrid</strong> — use your existing API gateway for HTTP routes, add PingGateway specifically for MCP/WebSocket traffic that needs identity-aware proxying</li>
      </ul>
    </div>
  );
}

function ConfigTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>PingGateway configuration example</h3>
      <p>
        PingGateway uses JSON-based route configurations. Below is an example route
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
      <h3 style={{ marginTop: 0 }}>Official PingGateway MCP filters</h3>
      <p>
        PingGateway ships three dedicated MCP filters (as of 2025.11). They run as a chain
        before the <code>ReverseProxyHandler</code> that forwards traffic to the MCP server.
      </p>

      <h4>Filter chain order</h4>
      <pre className="edu-code">{`[McpAuditFilter] → [McpProtectionFilter] → [McpValidationFilter] → ReverseProxyHandler`}</pre>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Filter</th>
            <th style={{ padding: '8px' }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['McpAuditFilter', <>Records all MCP request activity to audit/mcp.audit.json<br />Audit log entries include user email (from <code className="edu-code">sub</code> claim resolution), agent <code className="edu-code">client_id</code> (from <code className="edu-code">act.sub</code>), the full delegation chain (<code className="edu-code">act</code> nesting), the target service, and request latency — giving complete attribution for every tool invocation.</>],
            ['McpProtectionFilter', 'OAuth 2.0 resource server validation for MCP — introspects or JWT-verifies the Bearer token'],
            ['McpValidationFilter', 'Validates MCP protocol compliance (message shape, method names, JSON-RPC structure)'],
          ].map(([name, desc], i) => (
            <tr key={name} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '8px' }}><code>{name}</code></td>
              <td style={{ padding: '8px' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

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

      <h4>admin.json: enable streaming</h4>
      <p>
        MCP relies on Server-Sent Events (SSE) for tool responses. Without this flag, SSE connections
        are closed immediately and tool calls silently drop.
      </p>
      <pre className="edu-code">{`{
  "streamingEnabled": true
}`}</pre>

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
        Reference:{' '}
        <a href="https://docs.pingidentity.com/pinggateway/2025.11/mcp/index.html" target="_blank" rel="noopener noreferrer">
          MCP security gateway | PingGateway 2025.11
        </a>
      </p>
    </div>
  );
}

const tabs = [
  { id: 'overview', label: 'Overview', content: <OverviewTab /> },
  { id: 'architecture', label: 'Architecture', content: <ArchitectureTab /> },
  { id: 'official-filters', label: 'MCP Filters', content: <OfficialFiltersTab /> },
  { id: 'comparison', label: 'Custom vs PingGateway', content: <ComparisonTab /> },
  { id: 'config', label: 'Configuration', content: <ConfigTab /> },
];

export default function PingGatewayMcpPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="PingGateway — Securing MCP Servers"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(700px, 100vw)"
    />
  );
}
