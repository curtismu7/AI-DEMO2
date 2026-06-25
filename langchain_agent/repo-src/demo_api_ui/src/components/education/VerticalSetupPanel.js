// banking_api_ui/src/components/education/VerticalSetupPanel.js
// Education panel — Vertical Multi-Tenancy Setup (plugin architecture, manifest-driven, admin controls)
import React, { useState } from "react";
import EducationDrawer from "../shared/EducationDrawer";

const Code = ({ children }) => (
  <code
    style={{
      display: "block",
      background: "var(--code-bg, #f1f5f9)",
      borderRadius: 6,
      padding: "0.75rem 1rem",
      fontFamily: "inherit",
      fontSize: "0.78rem",
      whiteSpace: "pre",
      overflowX: "auto",
      margin: "0.5rem 0",
    }}
  >
    {children}
  </code>
);

function Bullet({ children }) {
  return (
    <li style={{ marginBottom: 4, fontSize: "0.85rem", lineHeight: 1.55 }}>
      {children}
    </li>
  );
}

function OverviewTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        The banking demo supports <strong>multiple verticals</strong> — distinct
        business domains (banking, healthcare, retail, etc.) running side-by-side.
        Each vertical has its own tools, system prompt, heuristics, data store,
        and authorization rules. Verticals are{" "}
        <strong>first-class citizens</strong>, not bolt-on themes.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Architecture</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>Manifest-driven:</strong> Every vertical has a{" "}
          <code>manifest.json</code> declaring its identity, terminology, tools,
          heuristics, and mock data.
        </Bullet>
        <Bullet>
          <strong>Plugin system:</strong> When a vertical ships an{" "}
          <code>index.js</code> (plugin), the agent/NL system uses its
          implementations instead of the manifest-only defaults.
        </Bullet>
        <Bullet>
          <strong>Dual-mode fallback:</strong> If a vertical has no plugin, its
          manifest is used as-is. This lets new verticals go live with manifest
          alone before custom code.
        </Bullet>
        <Bullet>
          <strong>Admin overlay:</strong> Admins see an additional "admin"
          vertical's tools merged in for cross-vertical management.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Key Components</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>verticalManifest:</strong> BFF service that loads all
          verticals from <code>demo_api_server/config/verticals/</code>,
          validates them, and exposes loader/resolver/plugins/events.
        </Bullet>
        <Bullet>
          <strong>verticalDispatch:</strong> Single seam between shared agent/NL
          code and vertical-specific plugins. Provides: <code>heuristicsFor</code>,{" "}
          <code>systemPromptFor</code>, <code>toolSchemasFor</code>,{" "}
          <code>executeToolFor</code>, <code>authzFor</code>.
        </Bullet>
        <Bullet>
          <strong>VerticalProvider (React):</strong> Context that holds the
          active vertical, its manifest, mock data, and refetch callback.
        </Bullet>
        <Bullet>
          <strong>VerticalSwitcher:</strong> UI component for switching between
          verticals. Every authenticated user can switch; only admins can edit.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Directory Structure</h4>
      <Code>
        {`demo_api_server/config/verticals/
├── banking/                    # Banking vertical (first-class, has plugin)
│   ├── manifest.json           # Identity, terminology, tools, heuristics
│   ├── mock-data.json          # Sample accounts, transactions, users
│   └── index.js                # Plugin: getTools(), executeTool(), etc.
├── healthcare/                 # Care Connect vertical
│   ├── manifest.json
│   ├── mock-data.json
│   └── index.js
├── retail/                     # Retail vertical
│   ├── manifest.json
│   ├── mock-data.json
│   └── index.js
├── admin/                      # Admin overlay (cross-vertical mgmt tools)
│   ├── manifest.json
│   └── index.js
└── [future verticals...]`}
      </Code>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Manifest Schema</h4>
      <Code>
        {`{
  id: "banking",
  identity: {
    displayName: "Banking Demo",
    shortName: "Bank",
    color: "#1e3a5f"
  },
  terminology: {
    agent: "banker",           // "AI banker" in UI
    action: "payment",
    account: "account"
  },
  capabilities: {
    authzEnabled: true,
    hitlEnabled: true
  },
  heuristics: [
    { re: /transfer/, action: "transfer" },
    { re: /check.*balance/, action: "get_account_balance" }
  ]
}`}
      </Code>
    </>
  );
}

function PluginContractTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Every vertical plugin (<code>index.js</code>) must implement this contract.
        The BFF validates it on load.
      </p>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Required Methods</h4>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getManifest() → object
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns the vertical's manifest (identity, terminology, capabilities).
        </p>
        <Code>
          {`getManifest() {
  return {
    id: "healthcare",
    identity: { displayName: "Care Connect", shortName: "Care", color: "#00a651" },
    terminology: { agent: "care assistant", action: "appointment" }
  };
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getTools() → Array{`<`}{`{`}name, description, inputSchema, scopes, authz{`}`}{`>`}
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns the vertical's tool catalog. The agent can call any of these.
        </p>
        <Code>
          {`getTools() {
  return [
    {
      name: "book_appointment",
      description: "Book a healthcare appointment",
      inputSchema: {
        type: "object",
        properties: {
          provider_id: { type: "string" },
          date: { type: "string", format: "date" },
          reason: { type: "string" }
        },
        required: ["provider_id", "date"]
      },
      scopes: ["write:appointments"],
      authz: { consents_required: ["medical"] }
    }
  ];
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getHeuristics() → Array{`<`}{`{`}re: RegExp, action: string{`}`}{`>`}
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns pattern-based routing rules. If user input matches, invoke the
          named tool directly (no LLM).
        </p>
        <Code>
          {`getHeuristics() {
  return [
    { re: /book.*appointment/, action: "book_appointment" },
    { re: /reschedule/, action: "reschedule_appointment" },
    { re: /cancel.*appointment/, action: "cancel_appointment" },
    { re: /my.*appointments|schedule/, action: "list_appointments" }
  ];
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getSystemPrompt(ctx) → string
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns the system prompt for the agent. Can be context-aware (user
          role, vertical, etc.).
        </p>
        <Code>
          {`getSystemPrompt(ctx) {
  return \`You are a helpful Care Connect assistant. Help patients book
appointments, check their medical records, and manage their health data.
Always confirm sensitive actions with the patient.\`;
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          executeTool(name, params, ctx) → Promise{`<`}{`{`}result, render{`}`}{`>`}
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Executes a tool by name with the given parameters. Returns{" "}
          <code>{"{ result, render }"}</code> where render is 'text' or null.
        </p>
        <Code>
          {`async executeTool(name, params, ctx) {
  switch (name) {
    case "book_appointment":
      return {
        result: { appointment_id: "apt-123", confirmed: true },
        render: "text"
      };
    case "list_appointments":
      return {
        result: { appointments: [...] },
        render: "list"   // Custom renderer
      };
    default:
      throw new Error(\`Tool \${name} not found\`);
  }
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getAuthz() → object
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns authorization rules per tool (consent requirements, step-up, etc.).
        </p>
        <Code>
          {`getAuthz() {
  return {
    book_appointment: {
      step_up_threshold: 0,
      consent_required: ["medical"]
    },
    access_medical_records: {
      step_up_threshold: 500,
      consent_required: ["medical", "privacy"]
    }
  };
}`}
        </Code>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 0.5 }}>
          getDataStore() → object
        </strong>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
          Returns in-memory or external data store for the vertical's mock data.
        </p>
        <Code>
          {`getDataStore() {
  return {
    users: [...],
    appointments: [...],
    providers: [...]
  };
}`}
        </Code>
      </div>
    </>
  );
}

function ManifestTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        The <code>manifest.json</code> file is the <strong>authoritative declaration</strong> of
        a vertical's identity, terminology, tools, and heuristics. It's
        manifest-only verticals that haven't shipped a plugin yet.
      </p>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Structure</h4>
      <Code>
        {`{
  "id": "banking",
  "version": "1.0.0",

  "identity": {
    "displayName": "Banking Demo",
    "shortName": "Bank",
    "color": "#1e3a5f"    // Sidebar + UI theming
  },

  "terminology": {
    "agent": "banker",    // "AI banker" in UI
    "action": "payment",
    "account": "account"
  },

  "capabilities": {
    "authzEnabled": true,
    "hitlEnabled": true,
    "heuristicsEnabled": true
  },

  "heuristics": [
    {
      "re": "transfer",
      "action": "transfer"   // Must match a tool name
    },
    {
      "re": "balance",
      "action": "get_account_balance"
    }
  ],

  "tools": [
    {
      "name": "transfer",
      "description": "Transfer funds between accounts",
      "inputSchema": {
        "type": "object",
        "properties": {
          "from_account": { "type": "string" },
          "to_account": { "type": "string" },
          "amount": { "type": "number" }
        },
        "required": ["from_account", "to_account", "amount"]
      },
      "scopes": ["write:transactions"],
      "authz": {
        "consent_required": ["transaction"],
        "step_up_threshold": 1000
      }
    }
  ]
}`}
      </Code>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Key Fields</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>id:</strong> Unique vertical identifier (used in URLs, routing).
        </Bullet>
        <Bullet>
          <strong>terminology:</strong> Domain-specific language (e.g., "Care
          Connect" says "appointment" instead of "transaction").
        </Bullet>
        <Bullet>
          <strong>heuristics:</strong> Pattern-based tool routing (regex + tool
          name). If user input matches regex, tool is invoked directly.
        </Bullet>
        <Bullet>
          <strong>tools:</strong> Available tool schemas. If vertical has a
          plugin, this is ignored in favor of plugin.getTools().
        </Bullet>
        <Bullet>
          <strong>authz:</strong> Per-tool authorization rules (consent,
          step-up thresholds).
        </Bullet>
      </ul>
    </>
  );
}

function AdminEditorTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Admins can edit any vertical's manifest in the <strong>/admin</strong> page
        without touching the filesystem. Edits are stored in an overlay layer
        on top of the seed manifest.
      </p>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>How It Works</h4>
      <ol style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <li>
          <strong>Seed:</strong> Original manifest.json on disk (immutable).
        </li>
        <li>
          <strong>Overlay:</strong> Admin edits stored separately in memory +
          runtimeData.json.
        </li>
        <li>
          <strong>Merge:</strong> At runtime, overlay is merged on top of seed.
          Admin edits take precedence.
        </li>
        <li>
          <strong>Clear:</strong> Admins can revert a field to seed by removing
          its override.
        </li>
      </ol>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>In Practice</h4>
      <ol style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <li>Go to <strong>/admin</strong></li>
        <li>Click <strong>"Manage Verticals"</strong></li>
        <li>
          Select the vertical you want to edit from the list
        </li>
        <li>
          Edit fields (display name, terminology, tools, heuristics, authz)
        </li>
        <li>
          Click <strong>"Save Overlay"</strong> — changes take effect immediately
        </li>
        <li>
          To revert a field to seed, clear it and save
        </li>
      </ol>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Reset & Snapshots</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>Reset all:</strong> Clears all overlay edits, reverts to
          seed for all verticals.
        </Bullet>
        <Bullet>
          <strong>Snapshot:</strong> Save current overlay state (all verticals)
          so you can restore it later.
        </Bullet>
        <Bullet>
          <strong>Restore:</strong> Reapply a previously saved snapshot.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>BFF API</h4>
      <Code>
        {`# Get the active vertical
GET /api/vertical/me

# List all verticals
GET /api/vertical/list

# Switch to a vertical
POST /api/vertical/active
{
  "id": "healthcare"
}

# Get seed + overlay for a vertical (admin only)
GET /api/vertical/:id/seed

# Save overlay edits (admin only)
POST /api/vertical/:id/overlay/batch
{
  "entries": [
    { "path": ["identity", "displayName"], "value": "New Name" },
    { "path": ["terminology", "agent"], "value": "care assistant" }
  ]
}

# Reset all overlays (admin only)
POST /api/vertical/reset-all

# Save a snapshot (admin only)
POST /api/vertical/snapshot

# Restore a snapshot (admin only)
POST /api/vertical/snapshot/restore

# Delete snapshot (admin only)
DELETE /api/vertical/snapshot`}
      </Code>
    </>
  );
}

function SwitchingTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Every authenticated user can switch between verticals. The active
        vertical determines which tools, system prompt, and heuristics the agent
        uses.
      </p>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Switch Verticals</h4>
      <ol style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <li>
          Click the <strong>Vertical Switcher</strong> (dropdown in the sidebar,
          shows current vertical)
        </li>
        <li>Select a vertical from the list</li>
        <li>
          The UI updates: sidebar color, agent terminology, available tools, and
          mock data all change
        </li>
        <li>
          Send a message to the agent — it uses the new vertical's tools +
          system prompt
        </li>
      </ol>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>What Changes</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>Sidebar color:</strong> Themed by vertical.identity.color
        </Bullet>
        <Bullet>
          <strong>Agent terminology:</strong> "AI banker" vs. "AI care
          assistant" based on vertical.terminology.agent
        </Bullet>
        <Bullet>
          <strong>Tools available:</strong> Agent sees only the vertical's tools
          (or plugin.getTools())
        </Bullet>
        <Bullet>
          <strong>System prompt:</strong> Changed to the vertical's prompt
        </Bullet>
        <Bullet>
          <strong>Heuristics:</strong> Pattern-based routing uses the
          vertical's rules
        </Bullet>
        <Bullet>
          <strong>Mock data:</strong> Accounts, balances, transactions refreshed
          to the vertical's sample data
        </Bullet>
        <Bullet>
          <strong>Admin tools:</strong> If you're an admin, you also see the
          admin vertical's tools (cross-vertical mgmt)
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>React Context</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        Components use the <code>useVertical()</code> hook to access the active
        vertical:
      </p>
      <Code>
        {`import { useVertical } from '../vertical/useVertical';

export function MyComponent() {
  const { activeId, pageManifest, agentManifest, isAdmin } = useVertical();

  return (
    <div>
      <h1>Active: {pageManifest?.identity.displayName}</h1>
      <p>Agent: {agentManifest?.terminology.agent}</p>
      {isAdmin && <AdminPanel />}
    </div>
  );
}`}
      </Code>
    </>
  );
}

function ArchitectureTab() {
  return (
    <>
      <h4 style={{ marginTop: "0.5rem", marginBottom: 0.5 }}>Data Flow: BFF</h4>
      <Code>
        {`Request: POST /api/demo-agent/nl
{
  message: "Book an appointment",
  vertical_id: "healthcare"
}

1. BFF load active vertical from verticalManifest
2. verticalManifest.resolver.activeId() → "healthcare"
3. verticalDispatch.systemPromptFor("healthcare", legacy_fn)
   → calls plugin.getSystemPrompt() if exists, else legacy_fn()
4. verticalDispatch.heuristicsFor("healthcare", legacy_fn)
   → matches "appointment" against healthcare heuristics
   → returns tool name to invoke (if match) or null (if LLM)
5. If heuristic matched: execute tool directly
   If no match: pass to NL agent with vertical's system prompt
6. Response includes vertical-specific formatting + mock data`}
      </Code>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Data Flow: React</h4>
      <Code>
        {`1. App mounts → VerticalProvider fetches /api/vertical/me
2. VerticalProvider context updates with active vertical + manifest
3. All child components use useVertical() to read activeId, pageManifest
4. VerticalSwitcher listens to /api/vertical/stream (SSE)
   → receives vertical-list-changed events on admin edits
5. Components re-render when vertical changes
6. Agent sidebar, terminology, tools all update immediately`}
      </Code>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Files</h4>
      <ul style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <Bullet>
          <strong>BFF:</strong> demo_api_server/services/verticalManifest/,
          demo_api_server/services/verticalDispatch.js, demo_api_server/routes/verticalManifest.js
        </Bullet>
        <Bullet>
          <strong>React:</strong> demo_api_ui/src/vertical/VerticalProvider.jsx,
          demo_api_ui/src/vertical/useVertical.js, demo_api_ui/src/components/VerticalSwitcher.js
        </Bullet>
        <Bullet>
          <strong>Config:</strong> demo_api_server/config/verticals/[id]/
        </Bullet>
      </ul>
    </>
  );
}

function VerticalSetupPanel({ isOpen, onClose, initialTabId }) {
  const [tab, setTab] = useState(initialTabId || "overview");

  const tabConfig = [
    { id: "overview", label: "Overview", content: <OverviewTab /> },
    { id: "plugin-contract", label: "Plugin Contract", content: <PluginContractTab /> },
    { id: "manifest", label: "Manifest Schema", content: <ManifestTab /> },
    { id: "admin-editor", label: "Admin Editor", content: <AdminEditorTab /> },
    { id: "switching", label: "Switching Verticals", content: <SwitchingTab /> },
    { id: "architecture", label: "Architecture", content: <ArchitectureTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Vertical Setup"
      description="Multi-tenancy architecture: manifest-driven verticals with plugin support, admin controls, and cross-vertical tools"
      tabs={tabConfig}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}

export default VerticalSetupPanel;