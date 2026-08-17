import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./PrivilegeMcpLearningPage.css";

const ARCH_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    icon: "\u{1F3D7}\uFE0F",
  },
  {
    id: "architecture",
    label: "Architecture",
    icon: "\u{1F9E9}",
  },
  {
    id: "install",
    label: "Installation",
    icon: "\u{1F4E6}",
  },
  {
    id: "config",
    label: "Configuration",
    icon: "\u2699\uFE0F",
  },
  {
    id: "console",
    label: "Console Setup",
    icon: "\u{1F5A5}\uFE0F",
  },
  {
    id: "policies",
    label: "Policies",
    icon: "\u{1F6E1}\uFE0F",
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    icon: "\u{1F527}",
  },
  {
    id: "reference",
    label: "Reference",
    icon: "\u{1F4DA}",
  },
];

function CodeBlock({ title, children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="plp-code">
      {title && <div className="plp-code-title">{title}</div>}
      <pre>
        <code>{children}</code>
      </pre>
      <button className="plp-code-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TableBlock({ headers, rows }) {
  return (
    <div className="plp-table-wrap">
      <table className="plp-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="plp-section">
      <h2 className="plp-section-title">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivilegeMcpLearningPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const navigate = useNavigate();

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="plp-page">
      <header className="plp-header">
        <button className="plp-back" onClick={() => navigate("/privilege-mcp-client")}>
          Back to Privilege MCP Client
        </button>
        <h1>AI Agent Gateway</h1>
        <p className="plp-subtitle">
          Just-in-time, least-privilege access control for MCP servers — hiding backend
          credentials from AI agents while enforcing tool-level policies with full audit.
        </p>
      </header>

      <div className="plp-layout">
        <nav className="plp-sidebar">
          {ARCH_SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`plp-nav-item ${activeSection === s.id ? "plp-nav-item--active" : ""}`}
              onClick={() => scrollTo(s.id)}
            >
              <span className="plp-nav-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <main className="plp-content">
          {/* ─── Overview ─── */}
          <Section id="overview" title="Overview">
            <p>
              AI Agent Gateway is an inline security gateway that enforces
              just-in-time, least-privilege access to MCP (Model Context Protocol) servers.
              It is the recommended approach for workforce and personal-assistant MCP use
              cases where the primary requirement is <strong>MCP access governance</strong>:
              controlling which MCP servers, tools, prompts, and resources a user can access,
              under what approvals, for how long, and with what audit trail.
            </p>

            <div className="plp-callout plp-callout--info">
              <strong>Privilege vs PingOne Agent Gateway — when to use which:</strong>
              <ul>
                <li><strong>AI Agent Gateway</strong> — MCP access governance, JIT approvals,
                  time-bound access, credential protection, tool-level audit. Sits near the agent/client.</li>
                <li><strong>PingOne Agent Gateway MCP Security Gateway</strong> — downstream token mediation,
                  introspection, transformation, audience/resource handling, RFC 8693 enforcement.
                  Sits near the backend MCP server.</li>
              </ul>
            </div>

            <h3>What it does</h3>
            <ul>
              <li>Enforces per-user, per-tool access policies on every MCP request</li>
              <li>Hides backend MCP server credentials from AI agents and clients</li>
              <li>Injects vaulted secrets (API keys, tokens) into upstream calls</li>
              <li>Provides complete audit trail: tool names, arguments, progress tokens</li>
              <li>Supports approval workflows and time-windowed access grants</li>
              <li>Works in agentless mode (SSO only, no endpoint agent required)</li>
            </ul>
          </Section>

          {/* ─── Architecture ─── */}
          <Section id="architecture" title="Architecture">
            <h3>Request flow</h3>
            <div className="plp-flow-diagram">
              <div className="plp-flow-box plp-flow-box--client">MCP Client<br /><small>(our BFF)</small></div>
              <div className="plp-flow-arrow">Bearer token + headers</div>
              <div className="plp-flow-box plp-flow-box--gateway">Privilege Gateway<br /><small>(cloud or local proxy)</small></div>
              <div className="plp-flow-arrow">Policy-gated proxy call</div>
              <div className="plp-flow-box plp-flow-box--server">Backend MCP Server<br /><small>(our banking tools)</small></div>
            </div>

            <h3>Deployment paths</h3>
            <TableBlock
              headers={["Path", "Endpoint", "How it works"]}
              rows={[
                [
                  "Agentless self-hosted (working)",
                  "https://<appname>.mcpgw.<your-dns>/mcp via nginx → gateway :8620",
                  "nginx rewrites Host to <appname>.default.applications.procyon.ai:8643 and proxies to the gateway's -alp-port :8620 (plain HTTP). Requires privilege-mcpgw image. Console token works end to end.",
                ],
                [
                  "Cloud frontend",
                  "https://<appname>-app-default.applications.privilege.pingone.com:8643/mcp",
                  "Console-assigned FQDN routes through Privilege cloud mesh to the enrolled proxy. Blocked by IssuerPublicKey:[] — all tokens rejected with 'JWT signature validation failed'. Not currently usable.",
                ],
              ]}
            />

            <h3>Required headers (Cloud API)</h3>
            <TableBlock
              headers={["Header", "When", "Value"]}
              rows={[
                ["Authorization", "Always", "Bearer <user PingOne SSO token>"],
                ["x-procyon-session-id", "Always", "Unique UUID per session"],
                ["mcp-protocol-version", "Non-initialize requests", "2024-11-05"],
                ["Content-Type", "Always", "application/json"],
              ]}
            />

            <h3>Agentless mode</h3>
            <p>
              The local endpoint agent/controller is <strong>not required</strong>. In agentless
              mode, traffic enters the gateway's MCP frontend port (<code>-alp-port :8620</code>)
              through an nginx front door. The gateway acts as its own OAuth server once
              front-end OAuth config is wired. The demo currently authenticates with a Privilege
              console token, which carries <code>kid: infra-root-jwt</code> from Privilege's
              internal Notary PKI — the only token class the gateway trusts by default.
            </p>
            <div className="plp-callout plp-callout--warn">
              <strong>Port note:</strong> Port <code>8620</code> is the MCP frontend
              (<code>-alp-port</code>). Port <code>8623</code> is the mesh/mTLS port used for
              the gateway-to-control-plane channel — <strong>not</strong> the MCP client port.
              nginx must proxy to <code>8620</code> over plain HTTP.
            </div>
          </Section>

          {/* ─── Installation ─── */}
          <Section id="install" title="Installation">
            <h3>Prerequisites</h3>
            <ul>
              <li>A PingOne tenant with PingOne Privilege enabled</li>
              <li>Admin console access to Privilege (AI Security section)</li>
              <li>At least one backend MCP server accessible from the gateway host</li>
              <li>Docker on the host (for local proxy deployment)</li>
              <li>A DNS name for the gateway (e.g. <code>local.ping-devops.com</code>)</li>
              <li>Sizing: 2 CPU cores, 4 GB RAM, 20 GB storage (RHEL/Debian/Ubuntu, AMD64 or ARM64)</li>
            </ul>

            <h3>Step 1: Create the OIDC application</h3>
            <p>In PingOne, create an OIDC application for the gateway:</p>
            <ul>
              <li>Type: OIDC Web App</li>
              <li>Redirect URI: <code>{"http://<mcpgw-dns>:<port>/callback"}</code></li>
              <li>Scopes: <code>openid profile email</code></li>
              <li>Note the Client ID and Client Secret</li>
            </ul>

            <h3>Step 2: Prepare the environment file</h3>
            <CodeBlock title="/var/lib/procyon/config/pingone.env">
{`SERVER_URL=https://<mcpgw-dns>:<port>
OIDC_CLIENT_ID=<your-client-id>
OIDC_CLIENT_SECRET=<your-client-secret>
OIDC_AUTH_URL=https://auth.pingone.com/<env-id>/as/authorize
OIDC_TOKEN_URL=https://auth.pingone.com/<env-id>/as/token
OIDC_USER_URL=https://auth.pingone.com/<env-id>/as/userinfo
OIDC_SCOPES=openid profile email`}
            </CodeBlock>

            <div className="plp-callout plp-callout--warn">
              <strong>Important:</strong> <code>SERVER_URL</code> is required. Internal
              troubleshooting confirms its absence causes silent failures. Mount this as a
              <em> file</em> (not just env vars) at exactly{" "}
              <code>/var/lib/procyon/config/pingone.env</code>.
            </div>

            <h3>Step 3: TLS certificates</h3>
            <p>
              The gateway needs TLS certs whose CN or SAN matches the gateway DNS name. Place at:
            </p>
            <ul>
              <li><code>/var/lib/procyon/ssl/mcpgw-cert.pem</code></li>
              <li><code>/var/lib/procyon/ssl/mcpgw-key.pem</code></li>
            </ul>

            <h3>Step 4: Register the gateway in Privilege console</h3>
            <ol>
              <li>Navigate to Cloud &gt; Gateways</li>
              <li>Click &quot;Add Gateway&quot; and follow the wizard</li>
              <li>Provide: cluster name, FQDN, select the environment file path</li>
              <li>The wizard generates a Docker run command with an enrollment token</li>
            </ol>

            <h3>Step 5: Start the proxy</h3>
            <div className="plp-callout plp-callout--warn">
              <strong>Use the privilege-mcpgw image, not privilege-proxy.</strong> The
              <code>privilege-proxy</code>/<code>cyonproxy</code> binary lacks the OAuth challenge
              flow strings. Only <code>privilege-mcpgw</code>/<code>mcpgw</code> emits a proper
              <code>WWW-Authenticate</code> response.
            </div>
            <CodeBlock title="Docker run (host network, recommended for dev)">
{`docker run -d \\
  -e ENV_PROXY_TOKEN="<enrollment-jwt>" \\
  --net=host \\
  --name privilege-mcpgw \\
  -v ai-demo_mcpgw-ssl:/procyon/ssl \\
  -v /var/log/procyon:/var/log/procyon \\
  -v /var/lib/procyon/recordings:/procyon/recordings \\
  -v /path/to/pingone.env:/var/lib/procyon/config/pingone.env:ro \\
  public.ecr.aws/s7q1z8z4/privilege-mcpgw \\
  /procyon/bin/mcpgw -hostname <your-dns-name>`}
            </CodeBlock>
            <div className="plp-callout plp-callout--warn">
              <strong>Fresh enrollment CA trust gap (2026-08-12):</strong> New enrollment tokens
              currently fail with <code>error Verifying siging cert x509: certificate signed by
              unknown authority (Root CA PingOne Privilege)</code>. Nodes enrolled before this
              regression window (approx. 2026-08-11 19:22 UTC) continue to work because they
              never re-verify the token after the first enrollment. If you need a fresh
              deployment, escalate to Ping — this is a vendor-side CA rotation issue, not a
              config problem.
            </div>

            <h3>Step 6: Verify enrollment</h3>
            <CodeBlock title="Check logs">
{`docker logs privilege-proxy 2>&1 | grep -i "enrolled\\|connected\\|ready\\|error"
# Should see: "Proxy enrolled successfully" or similar`}
            </CodeBlock>

            <div className="plp-callout plp-callout--info">
              <strong>Enrollment token expiry:</strong> Tokens from the wizard expire in ~24h.
              After first successful enrollment, the proxy persists its identity in
              <code>/procyon/ssl/proxy-config.data</code> — subsequent restarts do NOT need the token.
            </div>
          </Section>

          {/* ─── Configuration ─── */}
          <Section id="config" title="Configuration">
            <h3>Network ports</h3>
            <TableBlock
              headers={["Port", "Direction", "Purpose"]}
              rows={[
                ["8620/TCP", "Inbound", "MCP frontend (-alp-port) — nginx proxies here over plain HTTP. This is the MCP client port."],
                ["8623/TCP", "Inbound", "Mesh port (mTLS) — gateway-to-control-plane channel. NOT the MCP client port; nginx must NOT target this."],
                ["8690/TCP", "Inbound", "Gateway-to-gateway mesh communication"],
                ["443/TCP", "Outbound", "gRPC to grpc.privilege.pingone.com (control plane)"],
                ["443/TCP", "Outbound", "HTTPS to auth.pingone.com (OIDC)"],
              ]}
            />

            <h3>Backend MCP server settings</h3>
            <p>
              When the Privilege gateway is the security boundary, the backend MCP server
              should relax its own auth to avoid double-gating:
            </p>
            <TableBlock
              headers={["Setting", "Value", "Why"]}
              rows={[
                ["MCP_MTLS_ENABLED", "false", "Privilege connects via plain HTTP; mTLS would reject it"],
                ["NODE_ENV", "development", "Required for permissive token validation"],
                ["SKIP_TOKEN_SIGNATURE_VALIDATION", "true", "Accept gateway-issued tokens without JWKS check"],
                ["ALLOW_JWKS_FAILOPEN", "true", "Don't crash if JWKS endpoint is unreachable"],
                ["tmpfs: /app/dev-data", "(volume)", "Dev mode writes session data; container runs as uid 1001"],
              ]}
            />

            <h3>BFF environment variables</h3>
            <TableBlock
              headers={["Variable", "Value", "Purpose"]}
              rows={[
                ["PRIVILEGE_MCPGW_URL", "https://<appname>.mcpgw.<your-dns>/mcp", "Gateway endpoint the BFF connects to. Must be the nginx front-door URL, NOT privilege.pingone.com/api/mcp (that URL 401s all tokens)."],
                ["PRIVILEGE_SSO_ENV_ID", "8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b", "Privilege's own PingOne tenant — required for OIDC discovery"],
                ["PRIVILEGE_SSO_CLIENT_ID", "deff60f5-5a67-4a6e-b283-47252856c89c", "OIDC client (MCPGW-CMUIR) in env 8d4d7a4c"],
              ]}
            />

            <h3>Docker Compose snippet</h3>
            <CodeBlock title="docker-compose.yml (mcp-server service)">
{`mcp-server:
  environment:
    NODE_ENV: development
    MCP_MTLS_ENABLED: "false"
    MCP_SERVER_RESOURCE_URI: "mcpserver.ping.demo,mcpgateway.ping.demo,https://api.pingone.com"
  env_file:
    - path: ./oauth-mcp/.env
      required: false
  tmpfs:
    - /app/dev-data:uid=1001,gid=1001`}
            </CodeBlock>

            <h3>Kubernetes notes</h3>
            <ul>
              <li>Mount <code>pingone.env</code> as a file via ConfigMap/Secret at <code>/var/lib/procyon/config/pingone.env</code></li>
              <li>Map port 443 → 8623 in the Ingress if needed</li>
              <li>The <code>/.well-known/oauth-protected-resource</code> endpoint is served by the gateway for OIDC discovery</li>
              <li>Use a PersistentVolume for <code>/procyon/ssl/</code> to survive pod restarts</li>
            </ul>
          </Section>

          {/* ─── Console Setup ─── */}
          <Section id="console" title="Console Setup">
            <h3>Creating the MCP Server application</h3>
            <ol>
              <li>Navigate to <strong>AI Security &gt; Agentic Apps</strong></li>
              <li>Click <strong>Add Application &gt; MCP Server</strong></li>
              <li>Fill in:
                <ul>
                  <li><strong>Application Name</strong> — descriptive name (e.g. &quot;AI Demo MCP Server&quot;)</li>
                  <li><strong>Frontend URL</strong> — client-facing gateway URL</li>
                  <li><strong>MCP Server URL</strong> — backend endpoint (e.g. <code>http://host.docker.internal:8080/mcp</code>)</li>
                  <li><strong>Optional Headers</strong> — static headers to inject on upstream calls</li>
                </ul>
              </li>
              <li>Set <strong>Auth Mode</strong>:
                <ul>
                  <li><strong>Static Token</strong> — fixed bearer or no auth for the backend</li>
                  <li><strong>OAuth (Pre-Register)</strong> — provide client_id/secret/endpoints for the backend</li>
                  <li><strong>OAuth (DCR)</strong> — gateway auto-registers via RFC 7591</li>
                </ul>
              </li>
              <li>Attach the <strong>Mesh Cluster</strong> (your registered gateway)</li>
            </ol>

            <div className="plp-callout plp-callout--warn">
              <strong>Tool discovery prerequisite:</strong> Before policies can be created, the
              gateway must discover tools by calling <code>initialize</code> + <code>tools/list</code> on
              the backend. If discovery fails (e.g. mTLS blocks the connection), the console shows
              &quot;No Tools, Prompts, or Resources Discovered.&quot;
            </div>

            <h3>Console sections</h3>
            <TableBlock
              headers={["Section", "Purpose"]}
              rows={[
                ["Cloud > Gateways", "Manage proxy infrastructure: clusters, nodes, enrollment tokens"],
                ["AI Security > Agentic Apps > MCP Servers", "Register which MCP server the gateway protects; set upstream auth mode"],
                ["Access Control / Policies", "Grant users access to specific tools with optional approvals"],
                ["Activity > Session Logs", "View MCP sessions, connected clients"],
                ["Activity > Activity Logs", "Tool names, arguments, progress tokens — full audit"],
              ]}
            />

            <h3>Frontend Name and Host routing</h3>
            <p>
              The <strong>Frontend Name</strong> field in the console UI is read-only. It
              shows a <code>*.applications.privilege.pingone.com</code> hostname, but the
              gateway's internal routing key is the <code>procyon.ai</code> form:
            </p>
            <TableBlock
              headers={["Where", "Value shown"]}
              rows={[
                ["Console UI display", "<appname>-app-default.applications.privilege.pingone.com:8643"],
                ["Internal routing key (actual)", "<appname>.default.applications.procyon.ai:8643"],
              ]}
            />
            <p>
              nginx must rewrite the <code>Host</code> header to the internal
              <code>procyon.ai</code> form. Forwarding your own hostname unchanged causes
              <em>Domain not found</em> and an empty <code>200</code> body. Read the true value
              from the console API (<code>.Applications[0].Spec.McpAppConfig.FrontEndName</code>)
              — the UI shows stale values once its session expires.
            </p>
            <h3>Linking gateway to MCP app</h3>
            <p>
              The gateway (cluster) and the MCP app are separate entities. They are linked
              via the <strong>Mesh Cluster</strong> dropdown on the MCP app configuration.
              After linking, the gateway discovers tools from the backend within ~30 seconds
              (though on some builds discovery dispatch is delayed or requires a retry).
            </p>
          </Section>

          {/* ─── Policies ─── */}
          <Section id="policies" title="Policies">
            <h3>How policies work</h3>
            <p>
              Policies are configured per MCP Server application under Access Control.
              They define which users or groups can access which tools, with optional
              approval workflows and time-bound windows.
            </p>

            <h3>Policy capabilities</h3>
            <ul>
              <li><strong>Allow specific tools</strong> — whitelist individual tools by name</li>
              <li><strong>Allow prompts</strong> — optional, permit MCP prompt resources</li>
              <li><strong>Restrict resources</strong> — by pattern or regex</li>
              <li><strong>Bind to identities</strong> — PingOne users or groups</li>
              <li><strong>Approval workflows</strong> — require manager/admin approval before granting access</li>
              <li><strong>Time-bound access</strong> — grant access for a specific window only</li>
            </ul>

            <h3>User experience</h3>
            <ol>
              <li>User makes a request to the gateway</li>
              <li>Gateway validates the user&apos;s PingOne SSO token</li>
              <li>Policy engine evaluates: does this user have access to this tool?</li>
              <li>If permitted: request is proxied to the backend MCP server</li>
              <li>If denied: 401 &quot;User is not authorized&quot; returned to client</li>
              <li>Only authorized tools appear in the MCP <code>tools/list</code> response</li>
            </ol>

            <div className="plp-callout plp-callout--info">
              <strong>First-time setup:</strong> After creating an MCP app, wait for tool
              discovery, then create a policy granting your test user access. Without a policy,
              all requests get 401 &quot;User is not authorized.&quot;
            </div>
          </Section>

          {/* ─── Troubleshooting ─── */}
          <Section id="troubleshooting" title="Troubleshooting">
            <TableBlock
              headers={["Symptom", "Cause", "Fix"]}
              rows={[
                [
                  "IssuerPublicKey:[] in proxy logs / 401 JWT signature validation failed",
                  "Gateway validates inbound token kid against infra-root-jwt (fetched from Privilege Notary PKI at startup). PingOne-issued tokens have a JWKS kid that never matches.",
                  "Console token (kid: infra-root-jwt) works end to end. PingOne tokens require ResourceOAuth + cyctl idprovider wiring — not yet confirmed working on published builds. Switch to privilege-mcpgw image first.",
                ],
                [
                  '401 "Bearer Token not found." with no WWW-Authenticate',
                  "Gateway has no front-end OAuth config — falls back to bare 401 with no challenge. cyonproxy binary lacks the OAuth challenge strings entirely.",
                  "Use privilege-mcpgw image (public.ecr.aws/s7q1z8z4/privilege-mcpgw). It contains the challenge flow. Also ensure front-end OAuth is wired in the console app.",
                ],
                [
                  "Domain not found / empty 200 body",
                  "Host header sent to gateway doesn't match any registered Frontend Name. The gateway routes on <appname>.default.applications.procyon.ai:8643, not on your DNS hostname.",
                  "Configure nginx to rewrite Host to the procyon.ai form. Read the true FrontEndName from the console API (.Applications[0].Spec.McpAppConfig.FrontEndName), not the console UI.",
                ],
                [
                  "error Verifying siging cert x509: certificate signed by unknown authority (Root CA PingOne Privilege)",
                  "Fresh enrollment tokens fail CA trust verification. Ping rotated the root CA after approx. 2026-08-11T19:22Z; published proxy images don't yet trust the new root.",
                  "Vendor-side gap — escalate to Ping. Existing enrolled nodes (those enrolled before the regression window) continue to work because they never re-verify the token after first enrollment.",
                ],
                [
                  '"No Tools, Prompts, or Resources Discovered"',
                  "Proxy can't reach MCP server (mTLS blocks, wrong URL/port)",
                  "Set MCP_MTLS_ENABLED=false; ensure backend URL is http://host.docker.internal:8080/mcp",
                ],
                [
                  '401 "User is not authorized" / 403 doesn\'t have access to MCP app',
                  "User has no active Privilege policy for the MCP app, or policy expired",
                  "Assign or renew policy in Privilege console. Policies with time-bound windows expire silently and look identical to never having existed.",
                ],
                [
                  "400: mcp-protocol-version header required",
                  "Non-initialize requests need protocol version header",
                  "Add mcp-protocol-version: 2024-11-05 (or the version from the initialize response) on every non-initialize call",
                ],
                [
                  "Server crash: EACCES mkdir './dev-data'",
                  "Dev mode needs writable dir; container runs as uid 1001",
                  "Add tmpfs: /app/dev-data:uid=1001,gid=1001 to compose",
                ],
                [
                  "Configuration validation failed",
                  "SKIP_TOKEN_SIGNATURE_VALIDATION=true forbidden outside dev",
                  "Set NODE_ENV: development on mcp-server service",
                ],
                [
                  "curl: Empty reply from server / EPROTO TLS error",
                  "MCP_MTLS_ENABLED=true — server speaks TLS, gateway connects plain HTTP",
                  "Set MCP_MTLS_ENABLED=false; ensure backend URL scheme matches",
                ],
                [
                  "Proxy exits immediately",
                  "No proxy-config.data and no ENV_PROXY_TOKEN",
                  "Provide enrollment token from console wizard (Gateway > Add Node)",
                ],
                [
                  '"not found" on enrollment (500)',
                  "Token's nodeId was deleted from the gateway in console",
                  "Console > Gateways > Add Node to get a fresh token",
                ],
                [
                  "Console: Gateway Unreachable — Showing Cached Data",
                  "Console session (~60 min) expired; all values on screen are stale",
                  "Sign in again via https://console.pingone.com/?env=8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b then launch Privilege",
                ],
                [
                  "gRPC UNAVAILABLE / proxy silent hang",
                  "Firewall blocking outbound to grpc.privilege.pingone.com:443",
                  "Allow outbound 443; no inbound holes needed for control plane",
                ],
              ]}
            />
          </Section>

          {/* ─── Reference ─── */}
          <Section id="reference" title="Reference">
            <h3>Key identifiers (this demo)</h3>
            <TableBlock
              headers={["What", "Value"]}
              rows={[
                ["AI-Demo PingOne Env", "01d89b06-66d5-430e-9f28-65636843788b (banking demo users live here)"],
                ["Privilege Tenant / SSO Env", "8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b (all Privilege console work happens here)"],
                ["OIDC Client (MCPGW-CMUIR)", "deff60f5-5a67-4a6e-b283-47252856c89c in env 8d4d7a4c — the Privilege OIDC client"],
                ["Proxy Image", "public.ecr.aws/s7q1z8z4/privilege-mcpgw (replaces privilege-proxy)"],
                ["Proxy Binary", "/procyon/bin/mcpgw (replaces cyonproxy)"],
                ["Cluster Name", "ai-demo-fresh"],
                ["Node ID (Docker local)", "1cf90baf-2a83-45db-830f-581ea98110d1"],
                ["Cloud API Endpoint", "https://privilege.pingone.com/api/mcp — BLOCKED (401s all tokens)"],
                ["Working Local Endpoint", "https://mcp-pingone-admin.mcpgw.local.ping-devops.com/mcp via nginx"],
                ["Internal Frontend Name", "mcp-pingone-admin.default.applications.procyon.ai:8643 (procyon.ai, not pingone.com)"],
                ["gRPC Controller", "grpc.privilege.pingone.com:443"],
                ["Backend MCP Server", "http://mcp-server:8080/mcp (compose DNS) or http://host.docker.internal:8080/mcp"],
              ]}
            />

            <h3>File locations</h3>
            <TableBlock
              headers={["File", "Purpose"]}
              rows={[
                ["ping-mcpgw/config/pingone.env", "OIDC config mounted into proxy container at /var/lib/procyon/config — live config in agentless mode"],
                ["ping-mcpgw/config/proxy-token", "Enrollment JWT (gitignored). Consumed once on first enrollment; durable identity is the mTLS cert pair in the mcpgw-ssl volume."],
                ["ping-mcpgw/procyon/ssl/", "Gateway mTLS cert tree (proxy-crt.pem, proxy-key.pem, proxy-ca.pem). DO NOT delete the mcpgw-ssl Docker volume without a fresh enrollment token ready."],
                ["demo_mcpgw_nginx/nginx.conf", "nginx front door — rewrites Host to procyon.ai form, proxies to :8620"],
                ["demo_api_server/routes/privilegeMcpClient.js", "BFF relay route for Privilege MCP Client page"],
                ["demo_api_server/.env", "PRIVILEGE_MCPGW_URL, PRIVILEGE_SSO_* — BFF reads THIS file, NOT root .env"],
                ["docker-compose.yml", "ping-mcpgw + mcpgw-nginx services (profile: mcpgw)"],
                ["k8s/75-ping-mcpgw-deployment.yaml", "Kubernetes deployment manifest (image: privilege-mcpgw, ports 8620/8623/8690)"],
                ["scripts/privilege-smoke.sh", "Five-assertion end-to-end check (manual — needs a live console token)"],
              ]}
            />

            <h3>Enrollment token renewal</h3>
            <CodeBlock title="Check token expiry">
{`cat ping-mcpgw/config/proxy-token | cut -d. -f2 | \\
  base64 -d 2>/dev/null | python3 -c "
import sys, json, datetime
d = json.loads(sys.stdin.read())
exp = datetime.datetime.fromtimestamp(d['exp'], tz=datetime.timezone.utc)
now = datetime.datetime.now(tz=datetime.timezone.utc)
status = 'EXPIRED' if now > exp else 'valid'
print(f'{status} — expires {exp.isoformat()}')
"`}
            </CodeBlock>

            <h3>Quick install checklist</h3>
            <ol>
              <li>Get enrollment token from Privilege console (Gateway wizard &gt; Add Node)</li>
              <li>Create <code>pingone.env</code> with OIDC config</li>
              <li>Start proxy with Docker (host network mode)</li>
              <li>Verify enrollment in logs</li>
              <li>Register MCP app in console (AI Security &gt; Agentic Apps)</li>
              <li>Set MCP Server URL to backend (e.g. <code>http://host.docker.internal:8080/mcp</code>)</li>
              <li>Attach mesh cluster to the app</li>
              <li>Wait for tool discovery (~30s)</li>
              <li>Create policy granting user access to discovered tools</li>
              <li>Test from the AI Agent Gateway Client page</li>
            </ol>

            <h3>External resources</h3>
            <ul>
              <li><a href="https://docs.pingidentity.com/pingone-privilege" target="_blank" rel="noopener noreferrer">PingOne Privilege Documentation</a></li>
              <li><a href="https://spec.modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer">MCP Specification</a></li>
              <li><a href="https://datatracker.ietf.org/doc/html/rfc9728" target="_blank" rel="noopener noreferrer">RFC 9728 — OAuth Protected Resource Metadata</a></li>
            </ul>
          </Section>
        </main>
      </div>
    </div>
  );
}
