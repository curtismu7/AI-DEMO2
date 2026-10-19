import React, { useState } from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import StaticFlowDiagram from "../components/StaticFlowDiagram";
import "./PrivilegeMcpLearningPage.css";
import PageHeader from '../components/common/PageHeader';

// The request flow, as a walkthrough: the shared Play/Step bar and movie reel
// come with StaticFlowDiagram (walk drives them). Replaces the hand-built
// three-box div chain — same story, now steppable and consistent with every
// other diagram page.
const PFL_NODES = [
  { id: "client", group: "user", label: "MCP Client", sub: ["BFF · LM Studio · Postman"], x: 40, y: 130 },
  { id: "gw", group: "gateway", label: "Load balancer + 2 gateways", sub: ["sign-in · policy · audit"], x: 400, y: 130 },
  { id: "server", group: "resource", label: "Backend MCP Server", sub: ["in-cluster or sidecar"], x: 800, y: 130 },
];

const PFL_EDGES = [
  ["client", "gw", "One public URL", { detail: "Every client points at mcpgw.ai-demo.ping-devops.com — one door, two gateways behind it." }],
  ["gw", "server", "Policy-gated proxy call", { detail: "The gateway signs the client in, checks policy, and only then proxies to the backend server." }],
];

const PFL_WALK = [
  {
    title: "Client connects", label: "One public URL",
    nodes: ["client", "gw"], edges: [0],
    lines: [{ who: "MCP Client", text: PFL_EDGES[0][3].detail }],
  },
  {
    title: "Gateway gates the call", label: "Policy-gated proxy call",
    nodes: ["gw", "server"], edges: [1],
    lines: [{ who: "Gateway", text: PFL_EDGES[1][3].detail }],
  },
];

const PFL_GROUPS = {
  user: { label: "User", bg: "var(--th-status-info)" },
  gateway: { label: "Gateway", bg: "var(--th-status-warning)" },
  resource: { label: "Resource server", bg: "var(--th-border-strong)" },
};

const ARCH_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    icon: "\u{1F3D7}\uFE0F",
  },
  {
    id: "demo",
    label: "How to Demo",
    icon: "\u{1F4BC}",
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
  const { size: navWidth, handleProps: navHandleProps } = useDividerDrag({
    min: 180,
    max: 400,
    initial: 220,
    storageKey: "plp-sidebar-width",
  });

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="plp-page">
      <PageHeader className="plp-header" back={{ to: "/privilege-mcp-client", label: "Back to Privilege MCP Client" }} title="AI Agent Gateway" summary="Just-in-time, least-privilege access control for MCP servers — hiding backend credentials from AI agents while enforcing tool-level policies with full audit." />

      <div className="plp-layout" style={{ "--plp-nav-w": `${navWidth}px` }}>
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

        <div className="divider-drag-handle" aria-label="Resize section navigation" {...navHandleProps} />

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
              <li>Inserts the credentials an MCP server needs into upstream calls, without
                exposing them to the agent</li>
              <li>Provides complete audit trail: tool names, arguments, progress tokens</li>
              <li>Supports approval workflows and time-windowed access grants</li>
              <li>Works in agentless mode (SSO only, no endpoint agent required)</li>
            </ul>

            <h3>What this demo runs today</h3>
            <ul>
              <li>Two gateways on Kubernetes behind one load balancer and one public URL:{" "}
                <code>{"https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp"}</code></li>
              <li>Each MCP server is registered once in the Privilege console as an Agentic App</li>
              <li>Clients sign in with PingOne through the gateway. No client ID or secret is
                configured on the client: it discovers the gateway, registers itself and runs PKCE</li>
              <li>This page&apos;s client, LM Studio and Postman all use the same URL</li>
            </ul>

            <h3>Agent-to-agent (A2A)</h3>
            <ul>
              <li>The same gateway fronts agents as well as MCP servers. An agent is registered as a
                Remote Agent app and called at <code>{"https://<gateway>/<AppName>/a2a"}</code></li>
              <li>A calling agent has no browser to sign in with, so it presents an agent key from
                Agent Privilege &gt; Agent Registry. The key carries scopes (<code>llm</code>,{" "}
                <code>mcp</code>, <code>a2a</code>), an allowed model and the apps it may reach</li>
              <li>The gateway checks the key, the scope and the policy on every hop, and its guardrail
                screens agent messages and tool results</li>
              <li>See it run: the A2A tab on the{" "}
                <a href="/privilege-a2a">gateway client</a>, the
                Agent-to-agent tab on{" "}
                <a href="/privilege-gateway-topologies">Privilege Gateway Topologies</a>, and Demo
                Step 26 for a three-deep agent chain</li>
            </ul>
          </Section>

          {/* ─── How to demo ─── */}
          <Section id="demo" title="How to Demo (Business Value)">
            <p>
              The story in one line: <strong>the agent gets exactly the tools this person is
              allowed, for as long as they are allowed, and never holds a backend credential</strong>.
              Everything below runs from the Privilege MCP Client page behind this guide.
            </p>

            <h3>What the buyer cares about</h3>
            <TableBlock
              headers={["Business value", "What to show", "The proof on screen"]}
              rows={[
                [
                  "Stop credential sprawl in AI tools",
                  "The MCP client is configured with a URL and nothing else",
                  "No client ID, secret or API key anywhere in the client. The person signs in with PingOne; the gateway holds the backend credentials.",
                ],
                [
                  "Least privilege per person, per tool",
                  "Get MCP Tools as a user with a narrow policy",
                  "The tool list is only what the policy grants. A tool outside it is refused with 403.",
                ],
                [
                  "Access that expires on its own",
                  "A time-boxed policy in the Privilege console",
                  "When the window closes the same call is denied, with no change on the client or the MCP server.",
                ],
                [
                  "An audit trail a reviewer can use",
                  "Privilege console, Activity Logs, after a tool call",
                  "The named user, the tool and its arguments are recorded for every call.",
                ],
                [
                  "Works with the AI tools people already use",
                  "The same URL in LM Studio or Postman",
                  "No code change and no plugin: any MCP client that supports OAuth connects.",
                ],
                [
                  "No change to the MCP server",
                  "The backend registered with Auth Mode None",
                  "The server is unchanged and unreachable from outside; the gateway is the only way in.",
                ],
                [
                  "Scales out behind one address",
                  "Two gateways, one URL, one registration",
                  "The X-Served-By response header names the gateway that answered. It is not shown on this page: use curl -i against the client URL.",
                ],
              ]}
            />

            <h3>Demo script (about 5 minutes)</h3>
            <ol>
              <li><strong>Set up the problem.</strong> In the <em>Path</em> picker choose{" "}
                <em>Direct to MCP</em> and press Get MCP Tools. The server still checks who you
                are, but no per-tool policy is applied, nothing is denied and nothing is
                recorded. Privilege is not in this path.</li>
              <li><strong>Put the gateway in the path.</strong> Switch Path to{" "}
                <em>Agent Privilege</em> and sign in with PingOne. Open Settings to show the
                OAuth Client ID field is empty: the client registered itself and the person
                authenticated.</li>
              <li><strong>Show least privilege.</strong> The tool list loads on its own after
                sign-in. It holds only the tools the policy grants; tools outside the policy
                are not listed at all.</li>
              <li><strong>Call a tool.</strong> Press Run on a tool in the Tools tab. The TRACE
                tab shows the request going to the gateway URL, and RESULTS shows the data.
                The client never addresses the backend.</li>
              <li><strong>Show a denial.</strong> Switch to an app with no policy for this user.
                The page reports that the gateway said <code>403 Forbidden</code>. Open the
                Privilege console to show why.</li>
              <li><strong>Show the audit.</strong> In the console, open Activity Logs and find
                the calls you just made, with the user, tool and arguments.</li>
              <li><strong>Show it is not our client.</strong> Paste the same URL into LM Studio,
                sign in, and ask the model a question that uses the tool.</li>
            </ol>

            <div className="plp-callout plp-callout--info">
              <strong>Before the demo:</strong>
              <ul>
                <li>Check that the policy on the app you will use has not expired. An expired
                  policy denies exactly like a missing one.</li>
                <li>Sign in once ahead of time in each client. A gateway restart forgets every
                  registered client, and LM Studio then needs its entry removed and re-added.</li>
                <li>Keep one app without a policy if you want a clean denial to show.</li>
              </ul>
            </div>

            <div className="plp-callout plp-callout--warn">
              <strong>Say these plainly if asked:</strong>
              <ul>
                <li>Both gateways serve every app. If one stops, the load balancer moves its clients
                  to the other within about 10 seconds, and those clients sign in again.</li>
                <li>Moving a client from one gateway to the other costs that person one sign-in,
                  because sessions live in each gateway&apos;s memory.</li>
                <li>Guardrail verdicts of Alert and Sanitize are recorded in the console but are
                  not visible in the response. Only Block is.</li>
              </ul>
            </div>
          </Section>

          {/* ─── Architecture ─── */}
          <Section id="architecture" title="Architecture">
            <h3>Request flow</h3>
            <StaticFlowDiagram
              NODES={PFL_NODES}
              EDGES={PFL_EDGES}
              GROUPS={PFL_GROUPS}
              walk={PFL_WALK}
              details={Object.fromEntries(PFL_NODES.map((n) => [n.id, (PFL_EDGES.find(([from]) => from === n.id) || [])[3]?.detail || ""]))}
              ariaLabel="Privilege MCP request flow"
              testId="pfl-flow"
            />

            <h3>What is deployed</h3>
            <TableBlock
              headers={["Piece", "Where", "Role"]}
              rows={[
                [
                  "Load balancer (mcpgw-lb)",
                  "ping-devops-curtismuir, part of the gateway chart",
                  "Receives everything for mcpgw.ai-demo.ping-devops.com and sends each client to one gateway.",
                ],
                [
                  "Gateway 1",
                  "Helm release agentless-mcpgw, ping-devops-curtismuir, mesh cluster ai-demo-cmuir",
                  "Serves every Agentic App and runs the sidecar MCP servers.",
                ],
                [
                  "Gateway 2",
                  "Helm release agentless-mcpgw2, ping-devops-cmuir, second node of mesh cluster ai-demo-cmuir",
                  "Serves every Agentic App itself and runs the same sidecar MCP servers.",
                ],
              ]}
            />

            <h3>How the two gateways share one registration</h3>
            <ul>
              <li><strong>An app is registered once.</strong> An Agentic App is one tenant-wide
                object bound to one Mesh Cluster.</li>
              <li><strong>Both gateways are nodes of that cluster.</strong> Each serves every app
                on its own, so nothing is forwarded between them and neither depends on the other.</li>
              <li><strong>Every client is pinned to one gateway.</strong> Registrations, sign-in
                state and tokens live in each gateway&apos;s memory, so a token from one gateway
                gets <code>401</code> on the other. The load balancer hashes on the client
                address and keeps every path for that client on the same gateway.</li>
              <li><strong>Failover is automatic but not invisible.</strong> A failed gateway is
                held out for 10 minutes. Clients that move sign in again.</li>
            </ul>

            <h3>How a client connects</h3>
            <ol>
              <li>The client calls <code>{"/<AppName>/mcp"}</code> with no token and gets a{" "}
                <code>401</code> with a <code>WWW-Authenticate</code> challenge.</li>
              <li>It reads the gateway&apos;s OAuth metadata and registers itself (dynamic
                client registration).</li>
              <li>It runs an authorization-code flow with PKCE; the gateway sends the person
                to PingOne to sign in.</li>
              <li>It calls <code>{"/<AppName>/mcp"}</code> with the gateway&apos;s token. The
                gateway checks policy, then proxies to the backend.</li>
            </ol>
          </Section>

          {/* ─── Installation ─── */}
          <Section id="install" title="Installation">
            <h3>Prerequisites</h3>
            <ul>
              <li>A PingOne tenant with PingOne Privilege enabled</li>
              <li>Admin console access to Privilege (AI Security section)</li>
              <li>A Kubernetes namespace with an ingress class and a cert-manager issuer</li>
              <li>A DNS name for the gateway</li>
              <li>At least one MCP server the gateway can reach inside the cluster</li>
            </ul>

            <h3>Step 1: Create the OIDC application in PingOne</h3>
            <ul>
              <li>Type: OIDC Web App, token endpoint auth <strong>Client Secret Basic</strong></li>
              <li>Grant types: Authorization Code and Token Exchange</li>
              <li>Redirect URI: <code>{"https://<gateway-host>/callback"}</code></li>
              <li>Resources: <code>openid profile email</code></li>
            </ul>

            <h3>Step 2: Get an enrollment token</h3>
            <p>
              In the Privilege console: Gateways, Add New, Add via Docker. Copy the token from
              the generated command. It is single-use and short-lived, so install straight away.
              Its <code>clusterID</code> claim is the Mesh Cluster name you will pick when
              registering apps.
            </p>

            <h3>Step 3: Install the chart</h3>
            <CodeBlock title="secrets.yaml (keep it private, chmod 600)">
{`proxyToken: "<enrollment token>"
oidc:
  clientId: "<client id>"
  clientSecret: "<client secret>"
  authUrl:  "https://auth.pingone.com/<env-id>/as/authorize"
  tokenUrl: "https://auth.pingone.com/<env-id>/as/token"
  userUrl:  "https://auth.pingone.com/<env-id>/as/userinfo"`}
            </CodeBlock>
            <CodeBlock title="Install (from pingone-privgateway-helm-main/agentless)">
{`helm upgrade --install agentless-mcpgw agentless-mcpgw/ \\
  --namespace <namespace> \\
  --set hostname=<gateway-host> \\
  --set namespace=<namespace> \\
  --set oidc.serverUrl=https://<gateway-host> \\
  --values secrets.yaml`}
            </CodeBlock>

            <h3>Step 4: Verify enrollment</h3>
            <CodeBlock title="Gateway log">
{`kubectl logs -n <namespace> deployment/agentless-mcpgw -c log-tailer --tail=200 \\
  | grep LinkStatus
# Success: LinkStatus:Active`}
            </CodeBlock>

            <div className="plp-callout plp-callout--info">
              <strong>Enrollment persists.</strong> After the first successful enrollment the
              identity lives in the <code>agentless-mcpgw-ssl</code> volume, so restarts do not
              need the token again.
            </div>
            <div className="plp-callout plp-callout--warn">
              <strong>Changing OIDC values needs a restart.</strong> <code>helm upgrade</code>{" "}
              rewrites the secret but the running pod keeps the old values, which shows up as
              an authorize redirect with an empty <code>client_id</code>.
            </div>
          </Section>

          {/* ─── Configuration ─── */}
          <Section id="config" title="Configuration">
            <h3>Network ports</h3>
            <TableBlock
              headers={["Port", "Direction", "Purpose"]}
              rows={[
                ["443/TCP", "Inbound (ingress)", "The public URL. The ingress sends it to the load balancer."],
                ["8623/TCP", "In-cluster", "The gateway Service port the load balancer talks to."],
                ["8690/TCP", "In-cluster", "Gateway-to-gateway mesh. Must be published on both gateway Services (meshPort)."],
                ["443/TCP", "Outbound", "gRPC to the Privilege control plane."],
                ["443/TCP", "Outbound", "HTTPS to auth.pingone.com for sign-in."],
              ]}
            />

            <h3>Chart values that matter</h3>
            <TableBlock
              headers={["Value", "Set on", "Why"]}
              rows={[
                ["loadBalancer.enabled, loadBalancer.peers[]", "Gateway 1", "Turns on the load balancer and lists the other gateways."],
                ["loadBalancer.ownParked / peers[].parked", "Gateway 1", "Takes a gateway out of rotation for a test without removing it."],
                ["loadBalancer.failTimeout (600s)", "Gateway 1", "How long a failed gateway is held out. With 10s, clients were bounced back and signed in twice."],
                ["meshPort: 8690", "Both", "Publishes the mesh port on the Service so the peer can dial it."],
                ["gatewayHostname", "Gateway 2", "The address a gateway advertises to its peer: its in-cluster Service name. Left in place from the two-cluster layout; whether it is still needed is untested."],
                ["hostAliases", "Gateway 2", "Points the public hostname at gateway 1's Service from inside gateway 2. Same: left in place, untested."],
                ["oidc.serverUrl", "Both", "The public URL on both. TLS follows this matching the certificate, so gateway 2 serves plain HTTP and the load balancer bridges to it."],
                ["extraContainers", "Both", "Sidecar MCP servers. Catalog apps expect their backend on the localhost of whichever pod takes the call, so both gateways need the same list."],
              ]}
            />

            <div className="plp-callout plp-callout--warn">
              <strong>Upgrade rules learned the hard way:</strong>
              <ul>
                <li>Always pass <code>--reuse-values</code>, and keep every sidecar in the
                  values file: <code>extraContainers</code> is a list and is replaced whole.</li>
                <li><code>--reuse-values</code> does not pick up new chart defaults. Spell out
                  every key in the overlay file.</li>
                <li>Upgrade from the chart source directory. The packaged <code>.tgz</code>{" "}
                  goes stale silently after a template edit.</li>
                <li>Helm dry-runs and <code>helm get manifest</code> print the release&apos;s
                  secrets. Never write them to a shared directory.</li>
              </ul>
            </div>

            <h3>BFF settings (this page&apos;s client)</h3>
            <p>
              The BFF reads its gateway URLs from <code>demo_api_server/.env</code>, not the
              root <code>.env</code>. The main one is <code>PRIVILEGE_MCPGW_URL</code>; each
              additional door has its own <code>PRIVILEGE_*_URL</code> entry.
            </p>
          </Section>

          {/* ─── Console Setup ─── */}
          <Section id="console" title="Console Setup">
            <h3>Registering an MCP server</h3>
            <p>In the Privilege console: AI Security, Agentic Apps, Add Application, MCP Server.</p>
            <CodeBlock title="Example">
{`Application Name  aggregate
MCP Server URL    http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/mcp
Mesh Cluster      ai-demo-cmuir
Auth Mode         None`}
            </CodeBlock>

            <div className="plp-callout plp-callout--warn">
              <strong>Register the backend on <code>/mcp</code>, not <code>/sse</code>.</strong>{" "}
              Current gateway builds discover tools by POSTing <code>initialize</code> to the
              registered path, and an <code>/sse</code> endpoint refuses that. The registered
              path is also the only client-facing path: a client calling <code>/mcp</code> on
              an app registered on <code>/sse</code> gets a bare <code>404</code>.
            </div>

            <div className="plp-callout plp-callout--warn">
              <strong>Never register an app a second time to test the other gateway.</strong>{" "}
              Changing an app&apos;s Mesh Cluster moves it off the gateway that had it. It does
              not copy it. One registration serves both gateways through the mesh.
            </div>

            <h3>Backend URL and client URL are different ends</h3>
            <TableBlock
              headers={["URL", "Who uses it", "Example"]}
              rows={[
                ["MCP Server URL (backend)", "The gateway only. Resolves only inside the cluster.", "http://<service>.<namespace>.svc.cluster.local/mcp or http://localhost:<port>/mcp for a sidecar"],
                ["Client URL", "Every MCP client", "https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp"],
              ]}
            />

            <h3>Tool discovery</h3>
            <p>
              Policies cannot be created until the gateway has discovered the app&apos;s tools.
              Discovery runs when the app is registered and again when the gateway restarts.
              A failure shows in the console as <em>Gateway Unreachable — Error discovering MCP
              server: calling &quot;initialize&quot;: Unauthorized</em>, which reads like an
              auth fault and usually is not one. The gateway log line{" "}
              <code>Error discovering MCP server</code> names the method and path it used.
            </p>

            <h3>Console sections</h3>
            <TableBlock
              headers={["Section", "Purpose"]}
              rows={[
                ["Gateways", "Mesh clusters, nodes and enrollment tokens"],
                ["AI Security > Agentic Apps", "Register MCP servers and remote agents; set the backend URL and auth mode"],
                ["Policies (per app)", "Grant users access to specific tools, with optional approvals and time windows"],
                ["Activity > Session Logs", "MCP sessions and connected clients"],
                ["Activity > Activity Logs", "Tool names and arguments: the audit trail"],
              ]}
            />

            <div className="plp-callout plp-callout--info">
              <strong>Wrong tenant?</strong> If the console shows apps you did not create, or
              your edits do not appear, you are in a different tenant from the gateway. Check
              the tenant name before changing anything.
            </div>
          </Section>

          {/* ─── Policies ─── */}
          <Section id="policies" title="Policies">
            <h3>How policies work</h3>
            <p>
              Policies are configured per Agentic App. They define which users or groups can
              use which tools, with optional approval workflows and time windows.
            </p>

            <h3>Policy capabilities</h3>
            <ul>
              <li><strong>Allow specific tools</strong> — list individual tools by name</li>
              <li><strong>Allow prompts</strong> — optional, permit MCP prompt resources</li>
              <li><strong>Restrict resources</strong> — by pattern or regex</li>
              <li><strong>Bind to identities</strong> — PingOne users or groups</li>
              <li><strong>Approval workflows</strong> — require approval before granting access</li>
              <li><strong>Time-bound access</strong> — grant access for a specific window only</li>
            </ul>
            <p>
              These are Ping&apos;s documented capabilities. In this demo we have exercised tool
              allow-lists, user binding and time windows. Approval workflows, prompt grants
              and resource patterns have not been tested here.
            </p>

            <h3>Behaviour the console does not tell you</h3>
            <ul>
              <li><strong>A new app has no policy, and that means deny everything.</strong> It
                does not inherit a sibling app&apos;s policy.</li>
              <li><strong>Policies add up.</strong> A second policy on the same app widens
                access; it does not replace the first. To narrow access, delete the broader
                policy.</li>
              <li><strong>Policies expire.</strong> An expired policy denies exactly like a
                missing one, with nothing in the response to tell them apart.</li>
              <li><strong>The client only ever sees <code>403 Forbidden</code>.</strong> The
                real reason is in the gateway log.</li>
            </ul>

            <h3>Reading a denial</h3>
            <CodeBlock title="Gateway log">
{`kubectl logs -n ping-devops-curtismuir deployment/agentless-mcpgw -c log-tailer --tail=200 \\
  | grep -E 'identity resolved|policy denied'`}
            </CodeBlock>
            <TableBlock
              headers={["Log line", "Meaning", "Fix"]}
              rows={[
                ["policy denied … : user not found in system", "The user is not synced into Privilege", "Fix the PingOne Privilege app's group membership and the user's group"],
                ["policy denied … : Access Denied for", "The user is synced; no policy on this app covers them", "Add or renew the policy on this app"],
                ["User identity resolved: … Email= (empty)", "Cosmetic. Empty for every user, including ones that work", "Nothing"],
              ]}
            />
          </Section>

          {/* ─── Troubleshooting ─── */}
          <Section id="troubleshooting" title="Troubleshooting">
            <TableBlock
              headers={["Symptom", "Cause", "Fix"]}
              rows={[
                [
                  'Console: "Gateway Unreachable … initialize: Unauthorized", no tools, policy disabled',
                  "Tool discovery failed: backend registered on /sse, wrong backend hostname, or an expired policy reported misleadingly",
                  "Read the gateway's Error discovering MCP server log line. Register the backend on /mcp, then restart the gateway to re-run discovery.",
                ],
                [
                  "Unknown client page at /authorize",
                  "The gateway restarted and forgot every registered client",
                  "Our BFF re-registers by itself. Other clients must be removed and added again.",
                ],
                [
                  'LM Studio: "This client\'s registration has expired"',
                  "Same cause, or the client now lands on the other gateway (one was parked, restarted or failed over)",
                  "Remove the entry from ~/.lmstudio/mcp.json, quit LM Studio, add it again and sign in.",
                ],
                [
                  "401 on /<app>/mcp straight after a successful sign-in",
                  "The token came from one gateway and the call reached the other: pinning is broken",
                  "Compare node= on the token and mcp lines of the mcpgw-lb log. Every path for one client must show the same node.",
                ],
                [
                  "500 on /<app>/mcp while sign-in works",
                  "Mesh link down: the client's gateway does not own the app and cannot reach the one that does",
                  "Look for Error connecting to <node> in gateway 1's log. Check meshPort and gateway 2's advertised hostname.",
                ],
                [
                  "404 on /<app>/mcp once signed in",
                  "The app is registered on a different path (for example /sse)",
                  "Re-register the backend on /mcp.",
                ],
                [
                  "403 Forbidden / the MCP server denied this operation",
                  "No policy on this app covers the user, the policy expired, or the user is not synced",
                  "Read the policy denied line in the gateway log (Policies section).",
                ],
                [
                  "An app stops working on one gateway after a console edit",
                  "Its Mesh Cluster was changed, which moves the app",
                  "Set the Mesh Cluster back.",
                ],
                [
                  "Error finding next hop to <cluster>. Cluster not found",
                  "The app's Mesh Cluster names a gateway that no longer exists",
                  "Set it to a live cluster.",
                ],
                [
                  "MCP client hangs forever",
                  "It is pointed at a svc.cluster.local backend URL, which only resolves inside the cluster",
                  "Use the client URL: https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp",
                ],
                [
                  "Authorize redirects with an empty client_id",
                  "The pod is still running the OIDC values from before a helm upgrade",
                  "Restart the gateway deployment.",
                ],
                [
                  "A 400 right after every LM Studio connect",
                  "Harmless. The client probes a newer MCP protocol version, the backend refuses, the client falls back",
                  "Nothing.",
                ],
                [
                  "helm upgrade fails with conflict with kubectl-client-side-apply",
                  "Helm 4 applies server-side and the object was first created with kubectl apply",
                  "Add --force-conflicts.",
                ],
                [
                  "Sidecars disappear after a helm upgrade",
                  "The upgrade used a stale .tgz, or a values file that did not restate every sidecar",
                  "Upgrade from the chart source directory with the full sidecar values file.",
                ],
              ]}
            />

            <div className="plp-callout plp-callout--info">
              <strong>Log lines that mean nothing:</strong> <code>re-establishing link to
              node</code>, <code>has same NodeURL</code> and mesh-controller{" "}
              <code>not found</code> are a node handling its own record. Do not chase them.
            </div>
          </Section>

          {/* ─── Reference ─── */}
          <Section id="reference" title="Reference">
            <h3>Key identifiers (this demo)</h3>
            <TableBlock
              headers={["What", "Value"]}
              rows={[
                ["Public gateway host", "mcpgw.ai-demo.ping-devops.com"],
                ["Client URL", "https://mcpgw.ai-demo.ping-devops.com/<AppName>/mcp"],
                ["Gateway 1", "Helm release agentless-mcpgw, namespace ping-devops-curtismuir, mesh cluster ai-demo-cmuir"],
                ["Gateway 2", "Helm release agentless-mcpgw2, namespace ping-devops-cmuir, mesh cluster ai-demo-cmuir2"],
                ["Load balancer", "Deployment and Service mcpgw-lb, namespace ping-devops-curtismuir"],
                ["Gateway image", "public.ecr.aws/s7q1z8z4/privilege-aigw"],
                ["Gateway's PingOne tenant", "0428ba4f-169c-436b-aff9-b230496e0e3b (AI Agent)"],
              ]}
            />

            <h3>File locations</h3>
            <TableBlock
              headers={["File", "Purpose"]}
              rows={[
                ["pingone-privgateway-helm-main/agentless/agentless-mcpgw/", "The gateway Helm chart, including the load balancer template"],
                ["pingone-privgateway-helm-main/agentless/gateway1-lb.values.yaml", "Gateway 1 overlay: load balancer and mesh port (no secrets)"],
                ["pingone-privgateway-helm-main/agentless/gateway2-mesh.values.yaml", "Gateway 2 overlay: mesh settings (no secrets)"],
                ["pingone-privgateway-helm-main/agentless/sidecars.values.yaml", "Every sidecar MCP server in gateway 1's pod"],
                ["privilege/GATEWAY-LOAD-BALANCER.md", "Two-gateway design, evidence, runbook and failover drill"],
                ["privilege/GATEWAY-REGISTERING-AN-MCP-SERVER.md", "Registering an MCP server, with the test record"],
                ["privilege/GATEWAY-CONNECTING-AN-MCP-CLIENT.md", "How a client discovers, registers and signs in"],
                ["privilege/GATEWAY-READING-GATEWAY-ERRORS.md", "What each status code means and the log line behind it"],
                ["privilege/LESSONS-LEARNED.md", "Policy, registration and operating behaviour that is not documented elsewhere"],
                ["demo_api_server/routes/privilegeMcpClient.js", "BFF route behind the Privilege MCP Client page"],
              ]}
            />

            <h3>Quick checklist for a new MCP server</h3>
            <ol>
              <li>Make the server reachable from the gateway (in-cluster Service or sidecar)</li>
              <li>Register it as an Agentic App with the backend URL ending in <code>/mcp</code></li>
              <li>Set Mesh Cluster to <code>ai-demo-cmuir</code> and Auth Mode to None</li>
              <li>Wait for tool discovery; restart the gateway if the tool list stays empty</li>
              <li>Create a policy granting your user the tools, and check its time window</li>
              <li>Test from this page, then from LM Studio, using the client URL</li>
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
