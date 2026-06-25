// banking_api_ui/src/components/education/AgentRestrictionsPanel.js
import EducationDrawer from '../shared/EducationDrawer';

function OverviewTab() {
  return (
    <>
      <p style={{ color: '#374151', marginBottom: '1rem' }}>
        <strong>P1AZ as the Resource Server Control Plane.</strong> PingOne Authorize makes a policy decision on every banking API call the agent triggers — not just at the gateway or the BFF tool-call layer.
      </p>

      <h3 style={{ marginTop: 0 }}>What this enforces</h3>
      <p>
        Each user has a custom PingOne attribute <code>agentRestrictions</code> with three values:
      </p>
      <ul>
        <li><strong>write</strong> — agent may call any tool (default)</li>
        <li><strong>read</strong> — agent can browse but cannot transact</li>
        <li><strong>none</strong> — agent is fully blocked from all banking API calls</li>
      </ul>
      <p>
        P1AZ reads this attribute <strong>live at evaluation time</strong> — it is not cached in the token. An admin can change it in PingOne (or via the admin Users panel) and the agent feels the change within 5 seconds, with no token re-issue and no logout.
      </p>

      <h3>How it fits in the token chain</h3>
      <pre className="edu-code">{`Browser → (cookie) → BFF
  → agentRestrictionsGate (NEW)
      → fetchAgentRestrictions(userId)    ← live PingOne fetch (5s TTL)
      → P1AZ: DENY or PERMIT
      → HITL task if DENY
  → authenticateToken → banking route handler`}</pre>
    </>
  );
}

function FlowTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Mid-session capability change</h3>
      <p>The demo moment — admin changes the attribute, agent feels it on the next call:</p>
      <ol>
        <li>Admin opens Users panel, sets a user's agent access to <code>read</code></li>
        <li>Agent attempts a write tool (e.g. create_transfer)</li>
        <li>BFF middleware fetches <code>agentRestrictions</code> from PingOne — sees <code>read</code></li>
        <li>P1AZ evaluates: DENY (read tier cannot perform write operation)</li>
        <li>HITL task created — consent dialog appears in the agent sidebar</li>
        <li>User approves in the sidebar → call proceeds</li>
      </ol>

      <h3>Tier resolution</h3>
      <p>
        The capability tier (<code>read</code> or <code>write</code>) for each tool is derived from
        <code>scope-topology.json</code> — the single source of truth. Each scope has a
        <code>riskLevel</code>:
      </p>
      <ul>
        <li><strong>low / medium</strong> → read tier</li>
        <li><strong>high / critical</strong> → write tier</li>
      </ul>
      <p>No hardcoded route map — tier stays in sync as tools evolve.</p>
    </div>
  );
}

function ImplementationTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Key components</h3>

      <h4>BFF middleware (agentRestrictionsGate.js)</h4>
      <ul>
        <li>Mounted at <code>app.use(['/api/accounts', '/api/transactions'], agentRestrictionsGate)</code></li>
        <li>Detects agent calls via <code>X-Agent-Sub</code> header (set by MCP Server)</li>
        <li>No-op for all direct user calls (header absent)</li>
        <li>5-second in-memory cache per user — reduces PingOne API calls</li>
      </ul>

      <h4>MCP Server headers</h4>
      <pre className="edu-code">{`BankingAPIClient adds to every BFF request:
  X-Agent-Sub: <act.sub from the delegated MCP token>
  X-MCP-Tool:  <tool name, e.g. create_transfer>`}</pre>

      <h4>Feature flag</h4>
      <p>
        Gated by <code>ff_agent_restrictions</code> (default: <code>false</code>). Enable via
        Config in the admin panel. The <code>agentRestrictions</code> attribute is always
        provisioned during bootstrap regardless of flag state.
      </p>

      <h4>P1AZ policy rule</h4>
      <pre className="edu-code">{`DENY  if agentRestrictions == "none"
DENY  if agentRestrictions == "read" AND requiredTier == "write"
PERMIT otherwise`}</pre>
    </div>
  );
}

const tabs = [
  { id: 'overview', label: 'Overview', content: <OverviewTab /> },
  { id: 'flow', label: 'Mid-Session Change', content: <FlowTab /> },
  { id: 'implementation', label: 'Implementation', content: <ImplementationTab /> },
];

export default function AgentRestrictionsPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="P1AZ as Resource Server Control Plane"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(700px, 100vw)"
    />
  );
}
