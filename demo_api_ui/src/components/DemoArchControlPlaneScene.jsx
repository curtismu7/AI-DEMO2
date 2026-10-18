// DemoArchControlPlaneScene.jsx — the "Agentic Control Plane" reference
// architecture block diagram, each block named for what runs in this demo.
import { Card, Chip } from "./demoArchPrimitives";

export const CONTROL_PLANE_META = {
  subtitle: "Agentic Control Plane · reference architecture mapped to the Super AI Demo",
  aria: "Agentic control plane reference architecture: users on the left, an agentic control plane column, an IAM core row (identity provider, fine-grained authorization, credential broker, secret stores, workload identity), an Agent Privilege and Ping Gateway in the middle, agents at the bottom, and MCP servers and LLM providers on the right.",
  caption: "Every block names the component that plays that role in this demo. Red lines are the control path: identity, authorization and credentials flow from the IAM core down through the gateways to the agents; the control plane column on the left watches all of it.",
  steps: [
    ["Who shows up", "Customers in the vertical apps, external MCP clients that have never talked to this system, agent builders, and the IAM and security admins. Four audiences, four trust levels."],
    ["One issuer of tokens", "PingOne (and PingFederate for ID-JAG) is the only place tokens are issued, exchanged or revoked: SSO with passkeys, per-agent OAuth clients, RFC 8693 exchange, CIBA."],
    ["Fine-grained decisions", "PingOne Authorize decides PERMIT, DENY, STEP-UP or HITL for every tool call, with intent binding (PAR) and directory attributes. Helix supplies the language model that turns a prompt into an intent."],
    ["Credentials are brokered", "PingOne Privilege hands agents virtual LLM keys and brokers MCP credentials just in time, reading from the encrypted secrets.vault and its own vault. An agent never holds a provider key."],
    ["Workload identity", "SPIRE attests each agent container and issues SPIFFE JWT-SVIDs through the spiffe-helper sidecar. The SVID becomes the actor_token on the exchange."],
    ["Enforcement at the gateways", "The Agent Privilege tier (LLM proxy, MCP gateway, A2A delegation, AI Guard) and PingGateway as ingress PEP apply those decisions and credentials to every request."],
    ["Agents do the work", "Personal agents (LM Studio, Claude Desktop, MCP Inspector, LibreChat) come in through the external door; enterprise agents run as the AG-UI orchestrator, A2A specialists and ephemeral autonomous runs. The discovery agent inventories what is running on the host."],
    ["Tools and models", "Custom MCP servers (banking, invest, mortgage), third-party MCP (weather, Brave, hosted PingOne MCP), a virtual MCP facade, and LLM providers from local llama.cpp to OpenAI and Anthropic via Privilege."],
    ["The control plane sees all of it", "Catalog, registry, discovery, governance and observability: /agent-registry, /mcp-tools, the shadow-AI detector, IGA access reviews (UC46), and Grafana, Jaeger and Loki."],
  ],
};

function Lines({ x, y, items }) {
  return items.map((t, i) => (
    <text key={t} x={x} y={y + i * 14} className="das-s">• {t}</text>
  ));
}

function Band({ x, y, w, text, tone = "info" }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="22" rx="4" className={`das-band das-band-${tone}`} />
      <text x={x + w / 2} y={y + 15} textAnchor="middle" className={`das-fs11 das-band-ink-${tone}`}>{text}</text>
    </g>
  );
}

export default function DemoArchControlPlaneScene({ st }) {
  return (
    <svg viewBox="0 0 1480 830" role="img" aria-label={CONTROL_PLANE_META.aria} className="das-svg das-svg--wide">
      <defs>
        <marker id="das-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="das-cur" />
        </marker>
      </defs>

      {/* Users */}
      <g className={st(1)}>
        <Card x={20} y={180} w={115} h={100} title="Customers" sub="AI consumers">
          <Lines x={34} y={60 + 180} items={["Super Sports", "9 verticals"]} />
        </Card>
        <Card x={20} y={300} w={115} h={100} title="External" sub="MCP clients">
          <Lines x={34} y={360} items={["LM Studio", "Claude Desktop"]} />
        </Card>
        <Card x={20} y={420} w={115} h={100} title="Builders" sub="AI developers">
          <Lines x={34} y={480} items={["/agent-builder", "MCP Inspector"]} />
        </Card>
        <Card x={20} y={540} w={115} h={100} title="IT Admins" sub="IAM and security">
          <Lines x={34} y={600} items={["/admin", "Feature flags"]} />
        </Card>
      </g>

      {/* Agentic Control Plane */}
      <g className={st(9)}>
        <rect x="150" y="105" width="172" height="670" rx="12" className="das-outline das-outline-strong" />
        <text x="165" y="130" className="das-b das-fs14">Agentic Control Plane</text>
        <text x="165" y="146" className="das-s">visibility across agents</text>
        <Card x={165} y={165} w={142} h={100} title="Agent/MCP Catalog" cls="das-outline das-outline-dashed">
          <Chip x={177} y={199} w={118} text="/mcp-tools" />
          <Chip x={177} y={227} w={118} text="/agent-registry" />
        </Card>
        <Card x={165} y={285} w={142} h={100} title="Agent Registry" cls="das-outline das-outline-dashed">
          <Chip x={177} y={319} w={118} text="PingOne agent clients" />
          <Chip x={177} y={347} w={118} text="A2A Agent Cards" />
        </Card>
        <Card x={165} y={405} w={142} h={110} title="Agent Discovery" cls="das-outline das-outline-dashed">
          <Chip x={177} y={439} w={118} text="mcp-discovery-agent" />
          <Chip x={177} y={465} w={118} text="Shadow AI detector" />
          <Chip x={177} y={491} w={118} text="/mcp-discovery" />
        </Card>
        <Card x={165} y={535} w={142} h={100} title="Agent Governance" cls="das-outline das-outline-dashed">
          <Chip x={177} y={569} w={118} text="/agent-lifecycle" />
          <Chip x={177} y={597} w={118} text="IGA for AI · UC46" />
        </Card>
        <Card x={165} y={655} w={142} h={100} title="Observability" cls="das-outline das-outline-dashed">
          <Chip x={177} y={689} w={118} text="Grafana · Jaeger · Loki" />
          <Chip x={177} y={717} w={118} text="/mcp-observability" />
        </Card>
      </g>

      {/* IAM core row */}
      <g className={st(2)}>
        <Card x={345} y={105} w={310} h={165} title="IDP / OAuth Authorization Server" sub="PingOne · PingFederate · the only issuer of tokens">
          <Chip x={358} y={155} w={140} text="SSO · PKCE · passkey" />
          <Chip x={505} y={155} w={140} text="Agent identity · clients" />
          <Chip x={358} y={185} w={140} text="Token exchange RFC 8693" />
          <Chip x={505} y={185} w={140} text="OAuth 2.0 · CIBA · ID-JAG" />
          <Band x={358} y={235} w={287} text="Issuance, validation, exchange and revocation happen here" tone="info" />
        </Card>
        <line x1="500" y1="270" x2="500" y2="330" className="das-bus" />
      </g>

      <g className={st(3)}>
        <rect x="665" y="40" width="195" height="55" rx="10" className="das-outline das-outline-ok" />
        <text x="679" y="62" className="das-b das-fs14">Helix</text>
        <text x="679" y="78" className="das-s">LLM · intent engine for the agent</text>
        <line x1="762" y1="95" x2="762" y2="105" className="das-bus" />
        <Card x={665} y={105} w={195} h={165} title="Fine-grained Authz" sub="PingOne Authorize · PDP">
          <Chip x={678} y={155} w={170} text="PERMIT · DENY · STEP-UP · HITL" />
          <Chip x={678} y={181} w={170} text="Intent binding · PAR" />
          <Chip x={678} y={207} w={170} text="Attributes (PIP)" />
          <Band x={678} y={235} w={170} text="decisions before resource access" tone="ok" />
        </Card>
        <line x1="762" y1="270" x2="762" y2="330" className="das-bus" />
      </g>

      <g className={st(4)}>
        <Card x={870} y={105} w={200} h={165} title="JIT Credential Broker" sub="PingOne Privilege">
          <Chip x={883} y={155} w={175} text="Virtual LLM keys" />
          <Chip x={883} y={181} w={175} text="OAuth handling · MCP creds" />
          <Chip x={883} y={207} w={175} text="JIT injection · rotation" />
          <Band x={883} y={235} w={175} text="agents never see a real credential" tone="warn" />
        </Card>
        <line x1="970" y1="270" x2="970" y2="330" className="das-bus" />
        <line x1="1070" y1="188" x2="1085" y2="188" className="das-bus" />
        <Card x={1085} y={105} w={165} h={165} title="Secret Stores" sub="Privilege reads from here">
          <Chip x={1097} y={155} w={141} text="secrets.vault · AES-GCM" />
          <Chip x={1097} y={181} w={141} text="PingOne Privilege vault" />
          <Chip x={1097} y={207} w={141} text="K8s secrets (SE cluster)" />
        </Card>
        <line x1="1167" y1="270" x2="1167" y2="330" className="das-bus" />
      </g>

      <g className={st(5)}>
        <Card x={1260} y={105} w={200} h={165} title="Workload IDP" sub="SPIRE · credential broker" cls="das-outline das-outline-dashed">
          <Chip x={1273} y={155} w={175} text="Workload identity · attestation" />
          <Chip x={1273} y={181} w={175} text="SPIFFE JWT-SVID issuance" />
          <Chip x={1273} y={207} w={175} text="JIT injection · spiffe-helper" />
          <Band x={1273} y={235} w={175} text="agents never see a real credential" tone="warn" />
        </Card>
        <line x1="1360" y1="270" x2="1360" y2="330" className="das-bus" />
      </g>

      {/* Bus 1 + gateways */}
      <g className={st(6)}>
        <line x1="500" y1="330" x2="1360" y2="330" className="das-bus" />
        <line x1="645" y1="330" x2="645" y2="400" className="das-bus" />
        <line x1="1055" y1="330" x2="1055" y2="400" className="das-bus" />
        <Card x={345} y={400} w={600} h={175} title="Agent Privilege" sub="PEP · identity from the IAM core · decisions from Authorize · credentials from Privilege">
          <Card x={358} y={445} w={135} h={90} title="LLM Gateway" sub="demo_llm_proxy :8090">
            <Lines x={370} y={502} items={["routing · allow-lists", "Privilege virtual key"]} />
          </Card>
          <Card x={503} y={445} w={135} h={90} title="MCP Gateway" sub="mcp_gateway :3005">
            <Lines x={515} y={502} items={["tool-level authz · HITL", "token passthrough"]} />
          </Card>
          <Card x={648} y={445} w={135} h={90} title="A2A Gateway" sub="UC2 delegation">
            <Lines x={660} y={502} items={["nested act chain", "specialist registry"]} />
          </Card>
          <Card x={793} y={445} w={135} h={90} title="AI Guard" sub="Privilege AI Guard">
            <Lines x={805} y={502} items={["prompt injection · exfil", "OWASP LLM Top 10"]} />
          </Card>
          <Band x={358} y={545} w={570} text="routing · mediation · authorization · threat protection · audit and observability" tone="info" />
        </Card>
        <Card x={975} y={400} w={160} h={175} title="Ping Gateway" sub="PingGateway (IG) :3036">
          <Card x={987} y={445} w={136} h={90} title="MCP Gateway" sub="ingress access control">
            <Lines x={999} y={502} items={["introspect RFC 7662", "Authorize decision"]} />
          </Card>
          <Band x={987} y={545} w={136} text="validation · authz · throttling" tone="info" />
        </Card>
      </g>

      {/* Right column: tools and models */}
      <g className={st(8)}>
        <Card x={1210} y={370} w={250} h={50} title="Custom MCP Servers" sub="oauth-mcp · invest RS · mortgage RS" />
        <Card x={1210} y={430} w={250} h={50} title="3rd-party MCP Servers" sub="weather · Brave · hosted PingOne MCP" />
        <Card x={1210} y={490} w={250} h={50} title="Virtual MCP Servers" sub="MCP facade · aggregation at the gateway" />
        <Card x={1210} y={550} w={250} h={50} title="LLM Providers" sub="llama.cpp · OpenAI · Anthropic via Privilege" />
      </g>

      {/* Bus 2 + agents */}
      <g className={st(7)}>
        <line x1="645" y1="575" x2="645" y2="600" className="das-bus" />
        <line x1="1055" y1="575" x2="1055" y2="600" className="das-bus" />
        <line x1="480" y1="600" x2="1055" y2="600" className="das-bus" />
        <line x1="480" y1="600" x2="480" y2="640" className="das-bus" />
        <line x1="900" y1="600" x2="900" y2="640" className="das-bus" />
        <Card x={420} y={580} w={175} h={45} title="Endpoint Controller" sub="mcp-discovery-agent · pid: host" />
        <Card x={395} y={640} w={170} h={140} title="Personal Agents" sub="local developer tools · external door">
          <Chip x={408} y={690} w={70} text="LM Studio" />
          <Chip x={484} y={690} w={70} text="Claude" />
          <Chip x={408} y={718} w={70} text="Inspector" />
          <Chip x={484} y={718} w={70} text="LibreChat" />
          <Chip x={408} y={746} w={146} text="ChatGPT · Claude Code" />
        </Card>
        <Card x={615} y={640} w={570} h={140} title="Enterprise Workload Agents" sub="an ecosystem of agents">
          <Card x={638} y={685} w={170} h={85} title="SaaS embedded" sub="/personal-agent · P1 MCP">
            <Lines x={650} y={742} items={["hosted PingOne MCP tools"]} />
          </Card>
          <Card x={818} y={685} w={170} h={85} title="Orchestrator agents" sub="demo_agent_service · AG-UI">
            <Lines x={830} y={742} items={["generalist + A2A specialists"]} />
          </Card>
          <Card x={998} y={685} w={170} h={85} title="Ephemeral agents" sub="autonomous runs">
            <Lines x={1010} y={742} items={["short-lived · per-run identity"]} />
          </Card>
        </Card>
      </g>

      <text x="1460" y="815" textAnchor="end" className="das-s">AI-DEMO2 · local Docker</text>
    </svg>
  );
}
