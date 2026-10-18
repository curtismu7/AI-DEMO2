// banking_api_ui/src/components/education/GleanPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import StaticFlowDiagram from '../StaticFlowDiagram';
import FlowDiagram from '../FlowDiagram';

const GLEAN_GROUPS = {
  agent: { label: 'AI agent', bg: 'var(--th-status-info)' },
  ping: { label: 'Ping', bg: 'var(--th-status-error)' },
  gateway: { label: 'Gateway', bg: 'var(--th-bg-emphasis)' },
  resource: { label: 'MCP server', bg: 'var(--th-status-success)' },
};

const ARCH_NODES = [
  { id: 'glean', group: 'agent', label: 'Glean Platform', x: 0, y: 0 },
  { id: 'pf', group: 'ping', label: 'PingFed', sub: ['(Enterprise IdP/SSO)'], x: 320, y: 0 },
  { id: 'gw', group: 'gateway', label: 'MCP Gateway', x: 0, y: 170 },
  { id: 'paz', group: 'ping', label: 'PingAuthorize', sub: ['(Fine-grained authz)'], x: 320, y: 170 },
];
const ARCH_EDGES = [
  ['glean', 'pf', 'CIBA/OIDC (two-way)'],
  ['glean', 'gw', 'tool calls', { vertical: true }],
  ['gw', 'paz', 'policy eval (two-way)'],
];

const CIBA_SEQUENCE = `sequenceDiagram
    participant G as Glean agent
    participant PF as PingFed
    participant U as User device
    G->>G: 1. Needs elevated access
    G->>PF: 2. CIBA initiation: POST /backchannel/authentication<br/>login_hint: user@ebay.com · scope: openid write:records<br/>binding_message: Approve export?
    PF->>U: 3. Push approval request (mobile push / authenticator app)
    U->>PF: 4. User approves on device
    PF->>G: 5. Delegated access token
    G->>G: 6. Proceeds with authorized tool call`;

const PIPELINE_NODES = [
  { id: 'glean', group: 'agent', label: 'Glean', x: 0, y: 0 },
  { id: 'validate', group: 'gateway', label: '[1] Validate inbound token', sub: ['aud = gateway'], x: 0, y: 110 },
  { id: 'policy', group: 'gateway', label: '[2] GatewayTokenPolicy', sub: ['sub, act.sub, anti-bypass'], x: 0, y: 240 },
  { id: 'paz', group: 'ping', label: '[3] PingAuthorize', sub: ['PERMIT / DENY / INDETERMINATE'], x: 0, y: 370 },
  { id: 'mcp', group: 'resource', label: 'MCP server', x: 0, y: 520 },
];
const PIPELINE_EDGES = [
  ['glean', 'validate', 'tool call + bearer token', { vertical: true }],
  ['validate', 'policy', '', { vertical: true }],
  ['policy', 'paz', '', { vertical: true }],
  ['paz', 'mcp', '[4] Forward original bearer token unchanged', { vertical: true }],
];

function OverviewTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Glean + PingOne: Enterprise AI Authorization</h3>
      <p>
        Glean is an enterprise AI assistant and search platform. When deployed at organizations
        like eBay, it connects to dozens of internal data sources and exposes a chat interface
        backed by retrieval-augmented generation (RAG). The identity and authorization layer
        ensures Glean only surfaces data the requesting user is entitled to see.
      </p>

      <img
        src="/images/glean-architecture.png"
        alt="Glean integration architecture with PingFed, PingAuthorize, CIBA, and Agent Gateway"
        style={{ width: '100%', borderRadius: 8, marginBottom: 16, border: '1px solid var(--border-light, #ddd)' }}
        onError={(e) => { e.target.style.display = 'none'; }}
      />

      <StaticFlowDiagram
        NODES={ARCH_NODES}
        EDGES={ARCH_EDGES}
        GROUPS={GLEAN_GROUPS}
        testId="glean-arch-diagram"
        ariaLabel="eBay Enterprise: Glean, PingFed, MCP Gateway and PingAuthorize"
      />
      <p style={{ fontSize: '0.82rem' }}>All four components sit inside the eBay Enterprise boundary.</p>

      <h4>Key components</h4>
      <ul>
        <li>
          <strong>Glean Platform</strong> — Enterprise AI search and assistant; acts as the
          AI agent orchestrating tool calls across internal services.
        </li>
        <li>
          <strong>PingFed</strong> — Enterprise identity provider handling SSO, OIDC token
          issuance, and CIBA for delegated authorization flows.
        </li>
        <li>
          <strong>PingAuthorize</strong> — Evaluates fine-grained access policies before
          any MCP tool call proceeds; PERMIT/DENY per-request based on user identity,
          resource attributes, and contextual signals.
        </li>
        <li>
          <strong>Agent Gateway</strong> — Sits between Glean and backend MCP servers;
          validates inbound tokens, calls PingAuthorize for fine-grained policy evaluation,
          and forwards the original bearer token to MCP servers only on PERMIT.
        </li>
      </ul>
    </div>
  );
}

function CibaTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>CIBA for Agent Authorization</h3>
      <p>
        Client-Initiated Backchannel Authentication (CIBA) lets Glean request user approval
        out-of-band — without interrupting the browser session. This is critical for
        enterprise AI agents that may need elevated permissions for a specific action.
      </p>

      <FlowDiagram source={CIBA_SEQUENCE} label="Glean CIBA approval sequence diagram" />

      <p>
        This pattern keeps the AI agent honest — it cannot act with elevated scope without
        explicit human approval, even if the LLM requests it. Human-in-the-loop approval
        is enforced at the IdP layer, not just the application layer.
      </p>
    </div>
  );
}

function McpGatewayTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Agent Gateway Security Pipeline</h3>
      <p>
        The Agent Gateway is the enforcement boundary between Glean's AI layer and backend
        tool servers. Every tool call passes through the full pipeline:
      </p>

      <StaticFlowDiagram
        NODES={PIPELINE_NODES}
        EDGES={PIPELINE_EDGES}
        GROUPS={GLEAN_GROUPS}
        testId="glean-pipeline-diagram"
        ariaLabel="Agent Gateway pipeline: validate token, GatewayTokenPolicy, PingAuthorize, forward to MCP server"
      />

      <h4>Key invariants</h4>
      <ul>
        <li>
          Token audience scoping is established by the BFF's single RFC 8693 exchange before
          the gateway — gateway enforces policy, does not re-scope
        </li>
        <li>PERMIT → forward original bearer token unchanged to upstream MCP server</li>
        <li>DENY from PingAuthorize = 403, no upstream call made</li>
        <li>INDETERMINATE = 403 hitl_required (HTTP) or -32002 (WebSocket)</li>
        <li>PingAuthorize unreachable = fail closed (403)</li>
      </ul>

      <h4>Why this matters</h4>
      <ul>
        <li>
          <strong>No token leakage to LLM</strong> — Glean's LLM component never sees
          the actual OAuth tokens; only the gateway handles bearer credentials.
        </li>
        <li>
          <strong>Per-hop audience isolation</strong> — A token issued for the Agent Gateway
          cannot be replayed directly against a backend MCP server (RFC 8707 resource
          indicators enforced).
        </li>
        <li>
          <strong>Fine-grained policy</strong> — PingAuthorize can evaluate user attributes,
          resource sensitivity, time-of-day, and risk signals — not just scope strings.
        </li>
      </ul>
    </div>
  );
}

export default function GleanPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: <OverviewTab />,
    },
    {
      id: 'ciba',
      label: 'CIBA flow',
      content: <CibaTab />,
    },
    {
      id: 'gateway',
      label: 'Agent Gateway',
      content: <McpGatewayTab />,
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Glean + PingOne Integration"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(660px, 100vw)"
    />
  );
}
