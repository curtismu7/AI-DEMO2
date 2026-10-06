// demo_api_ui/src/components/TokenChainFlowDiagram.jsx
import React, { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { stepEdges } from '../hooks/useDiagramStepper';
import './TokenChainFlowDiagram.css';

/**
 * TokenChainFlowDiagram — React Flow conversion of the token-chain
 * architecture graph previously rendered as Mermaid (MERMAID_DIAGRAM in
 * TokenChainArchitecturePage.js).
 *
 * Subgraph → group, node → card, edge label → labeled smooth-step edge.
 * Group colors and node colors carry over verbatim from the Mermaid style
 * directives — the summary cards below the diagram match those same colors
 * by design (matched-legend rule, see TokenChainArchitecturePage.css).
 *
 * Layout is hand-placed: nine group columns in flow order
 * CLIENT → AUTHENTICATION → AGENT → TOKEN EXCHANGE → GATEWAY →
 * AUTHORIZATION → MCP SERVERS → RESOURCES, with SAFETY above the gateway.
 */

// Palette carried over verbatim from the Mermaid style directives.
const GROUPS = {
  client: { label: 'CLIENT', bg: '#1e3a5f', border: '#0f2438' },
  auth: { label: '🔐 AUTHENTICATION', bg: '#2e5090', border: '#1a3a5c' },
  agent: { label: 'AGENT', bg: '#3b5998', border: '#2a3f6c' },
  exchange: { label: 'TOKEN EXCHANGE', bg: '#28a745', border: '#1e7e34', ink: '#020617' },
  gateway: { label: 'GATEWAY', bg: '#f57c00', border: '#d66b00', ink: '#020617' },
  authz: { label: '✅ AUTHORIZATION', bg: '#dc3545', border: '#a02830' },
  mcps: { label: 'MCP SERVERS', bg: '#6f42c1', border: '#4a276a' },
  resources: { label: 'RESOURCES', bg: '#17a2b8', border: '#0e5968', ink: '#020617' },
  safety: { label: 'SAFETY', bg: '#ffc107', border: '#d9a308', ink: '#020617' },
};

// node id → { group, label, sub, x, y }
const NODES = [
  { id: 'user', group: 'client', label: '👤 User', x: 0, y: 120 },
  { id: 'olb', group: 'client', label: 'OLB Application', sub: 'chatbot', x: 0, y: 260 },
  { id: 'pingone', group: 'auth', label: 'PingOne/PF/AIC', x: 280, y: 40 },
  { id: 'humanToken', group: 'auth', label: 'Human Token', sub: 'sub: user1 · may_act: agent1', x: 280, y: 220 },
  { id: 'agentSvc', group: 'agent', label: 'Agent Service', x: 560, y: 120 },
  { id: 'llm', group: 'agent', label: 'LLM', sub: 'tool selector', x: 560, y: 300 },
  { id: 'agentToken', group: 'agent', label: 'Agent Token', sub: 'client_id: agent1 · SPIFFE SVID', x: 560, y: 460 },
  { id: 'txService', group: 'exchange', label: 'Exchange Service', x: 840, y: 120 },
  { id: 'txToken', group: 'exchange', label: 'TX Token', sub: 'sub: user1 · act: agent1 · scope: mcp', x: 840, y: 300 },
  { id: 'gwService', group: 'gateway', label: 'Agent Gateway', sub: 'route & introspect', x: 1120, y: 120 },
  { id: 'authCall', group: 'gateway', label: 'authorize()', sub: 'check token', x: 1120, y: 320 },
  { id: 'pingAuthz', group: 'authz', label: 'PingAuthorize', sub: 'Policy Engine · Read metadata', x: 1120, y: 520 },
  { id: 'mcpOlb', group: 'mcps', label: 'MCP OLB', sub: 'mcp-olb.bxf.com', x: 1400, y: 120 },
  { id: 'mcpInvest', group: 'mcps', label: 'MCP Resource Server', sub: 'mcp-resource-server.bxf.com', x: 1400, y: 520 },
  { id: 'rsOlb', group: 'resources', label: 'olb-resource', sub: '/balance /transfer', x: 1660, y: 120 },
  { id: 'rsInvest', group: 'resources', label: 'invest-resource', sub: 'API key vault', x: 1660, y: 520 },
  { id: 'hitl', group: 'safety', label: 'HITL/CIBA', sub: 'step-up', x: 560, y: 660 },
  { id: 'metadata', group: 'safety', label: 'Agent metadata', sub: 'capabilities', x: 1400, y: 680 },
];

const NODE_W = 200;
const NODE_H = 64;
const GROUP_PAD = 24;
const HEADER_H = 34;

const NODE_TO_GROUP = Object.fromEntries(NODES.map((n) => [n.id, n]));

/**
 * Per-node click detail: role in the chain + a MOCK decoded token (teaching
 * values, never secrets — shapes mirror docs/ACT_CLAIM_VERIFICATION.md).
 * Nodes that are not tokens carry `mockToken: null` and explain why.
 */
export const NODE_DETAILS = {
  user: {
    role: 'Human actor — signs in via OLB and drives the chatbot. Never holds an access token in the browser.',
    mockToken: null,
    tokenNote: 'No token yet — the user exists only as the future `sub` of every token downstream.',
  },
  olb: {
    role: 'Chat surface. Starts OIDC login with PingOne and presents the human token to the agent on the user\u2019s behalf.',
    mockToken: null,
    tokenNote: 'Holds only the session cookie; the access token stays server-side.',
  },
  pingone: {
    role: 'Identity provider. Authenticates the human, issues the human token with the may_act delegation claim, and signs every exchanged token.',
    mockToken: {
      note: 'Human token (issued by PingOne)',
      header: { alg: 'RS256', kid: 'pingone-signing-key-1', typ: 'JWT' },
      claims: {
        iss: 'https://auth.pingone.com/bxf-env/as',
        sub: 'user1',
        aud: ['olb-chatbot'],
        scope: 'openid profile transfer:read',
        may_act: { sub: 'agent1' },
        acr: 'urn:ping:acr:pwd',
        exp: 1788030829,
      },
    },
  },
  humanToken: {
    role: 'The user\u2019s access token. Its may_act claim pre-authorizes agent1 to act for the user in a later exchange — it does not delegate yet.',
    mockToken: {
      note: 'Human token · decoded claims (mock)',
      claims: {
        iss: 'https://auth.pingone.com/bxf-env/as',
        sub: 'user1',
        aud: ['agentgateway.bxf.com'],
        scope: 'openid profile transfer:read',
        may_act: { sub: 'agent1' },
        act: null,
        note_act: 'absent — no delegation has happened yet',
      },
    },
  },
  agentSvc: {
    role: 'The agent runtime. Plans tool calls, presents the human token plus its own actor token to the Exchange Service, and executes what the gateway permits.',
    mockToken: null,
    tokenNote: 'Consumes tokens; mints none of its own beyond the Agent Token.',
  },
  llm: {
    role: 'Tool selector. The LLM chooses WHICH tool to call (e.g. balance); it never sees tokens — tool calls flow through the gateway.',
    mockToken: null,
    tokenNote: 'No token — the LLM is not a security principal in this chain.',
  },
  agentToken: {
    role: 'The agent\u2019s own credential (client_credentials), bound to its SPIFFE workload identity. This becomes the actor in Exchange #1.',
    mockToken: {
      note: 'Agent actor token · client_credentials (mock)',
      claims: {
        iss: 'https://auth.pingone.com/bxf-env/as',
        sub: 'agent1',
        client_id: 'agent1',
        aud: ['agentgateway.bxf.com'],
        scope: 'agent:invoke',
        may_act: { sub: 'user1' },
        spiffe_id: 'spiffe://bxf.com/ns/demo/sa/agent1',
      },
    },
  },
  txService: {
    role: 'RFC 8693 token-exchange service. Combines the human subject token and the agent actor token into the TX token — the only place the act claim is minted.',
    mockToken: null,
    tokenNote: 'Mints the TX token; holds no long-lived credential itself.',
  },
  txToken: {
    role: 'The exchanged token presented to the gateway: subject stays the user, act names the agent. Audience and scope are narrowed to MCP.',
    mockToken: {
      note: 'TX token · RFC 8693 exchange result (mock)',
      claims: {
        iss: 'https://auth.pingone.com/bxf-env/as',
        sub: 'user1',
        aud: ['mcp-olb.bxf.com'],
        scope: 'mcp:balance:read',
        act: { sub: 'agent1' },
        may_act: null,
        note: 'scope narrowed from transfer:read to mcp:balance:read',
      },
    },
  },
  gwService: {
    role: 'Agent Gateway. Routes each tool call, introspects the TX token, and enforces the PingAuthorize decision before anything reaches an MCP server.',
    mockToken: null,
    tokenNote: 'Never issues tokens — validates and forwards them.',
  },
  authCall: {
    role: 'The gateway\u2019s authorize() check: token introspection plus a policy call. DENY here is what forces the HITL step-up path.',
    mockToken: null,
    tokenNote: 'Emits decisions (PERMIT/DENY), not tokens.',
  },
  pingAuthz: {
    role: 'Policy engine. Evaluates scopes, audience, ACR, and transaction details. Reads agent metadata for context. INDETERMINATE fails closed as DENY.',
    mockToken: null,
    tokenNote: 'Consumes introspection requests; the decision is its output.',
  },
  mcpOlb: {
    role: 'MCP server for OLB tools. Validates the TX token, then fetches an API key from the resource vault to call the backend.',
    mockToken: null,
    tokenNote: 'Accepts the TX token (aud matches mcp-olb.bxf.com).',
  },
  mcpInvest: {
    role: 'MCP resource server for investment tools. Same validation pattern; called only after the MFA step-up produces a fresh TX token.',
    mockToken: null,
    tokenNote: 'Requires acr with MFA on the TX token for transfer-class tools.',
  },
  rsOlb: {
    role: 'OLB backend API (/balance, /transfer). Only reachable through MCP OLB with the API key from the vault.',
    mockToken: {
      note: 'API key (not a JWT) · from vault (mock)',
      claims: {
        type: 'api_key',
        key_id: 'olb-key-7f3a',
        issued_to: 'mcp-olb.bxf.com',
        scopes: ['balance:read', 'transfer:write'],
      },
    },
  },
  rsInvest: {
    role: 'Investment backend behind the API-key vault. Only reachable through MCP Resource Server.',
    mockToken: {
      note: 'API key (not a token) · from vault (mock)',
      claims: {
        type: 'api_key',
        key_id: 'invest-key-9c2d',
        issued_to: 'mcp-resource-server.bxf.com',
        scopes: ['execute:trade'],
      },
    },
  },
  hitl: {
    role: 'Human-in-the-loop step-up. A CIBA authentication request pushes MFA to the user\u2019s device; approval yields a fresh ACR that unlocks the retry exchange.',
    mockToken: null,
    tokenNote: 'Produces an MFA ACR assertion, not a token.',
  },
  metadata: {
    role: 'Agent capability metadata. PingAuthorize queries it to decide what this agent may ask for.',
    mockToken: null,
    tokenNote: 'Static capability document — no tokens involved.',
  },
};

// Compute per-group bounding boxes from member node positions.
const GROUP_BOXES = (() => {
  const boxes = {};
  NODES.forEach(({ id, group, x, y }) => {
    const b = (boxes[group] ||= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x + NODE_W);
    b.y1 = Math.max(b.y1, y + NODE_H);
  });
  return Object.fromEntries(
    Object.entries(boxes).map(([g, b]) => [g, {
      x: b.x0 - GROUP_PAD,
      y: b.y0 - GROUP_PAD - HEADER_H,
      w: b.x1 - b.x0 + GROUP_PAD * 2,
      h: b.y1 - b.y0 + GROUP_PAD * 2 + HEADER_H,
    }]),
  );
})();

// [source, target, label] — edge order follows the Mermaid graph.
const EDGES = [
  ['user', 'olb', 'login'],
  ['olb', 'pingone', 'auth'],
  ['pingone', 'humanToken', 'token'],
  ['humanToken', 'agentSvc', 'present'],
  ['agentSvc', 'agentToken', 'own creds'],
  ['agentSvc', 'gwService', 'tool list'],
  ['gwService', 'authCall', 'agent token'],
  ['authCall', 'pingAuthz', 'verify'],
  ['agentSvc', 'llm', 'route tool'],
  ['llm', 'agentSvc', 'select: balance'],
  ['agentSvc', 'gwService', 'call'],
  ['gwService', 'authCall', 'DENY · no subject'],
  ['authCall', 'agentSvc', 'unauthorized'],
  ['agentSvc', 'txService', 'human+agent'],
  ['txService', 'txToken', 'issue'],
  ['txToken', 'gwService', 'authorize'],
  ['gwService', 'pingAuthz', 'introspect'],
  ['pingAuthz', 'gwService', 'PERMIT'],
  ['gwService', 'mcpOlb', 'balance · PERMIT'],
  ['mcpOlb', 'rsOlb', 'get API key'],
  ['rsOlb', 'mcpOlb', 'data'],
  ['mcpOlb', 'gwService', 'response'],
  ['gwService', 'authCall', 'transfer'],
  ['authCall', 'gwService', 'DENY · HITL required'],
  ['gwService', 'agentSvc', 'step-up'],
  ['agentSvc', 'hitl', 'CIBA'],
  ['hitl', 'agentSvc', 'MFA approve'],
  ['agentSvc', 'txService', 'MFA token'],
  ['txService', 'txToken', 'new TX'],
  ['txToken', 'gwService', 'retry'],
  ['gwService', 'mcpInvest', 'PERMIT'],
  ['mcpInvest', 'rsInvest', 'execute'],
  ['rsInvest', 'mcpInvest', 'confirm'],
  ['mcpInvest', 'gwService', 'result'],
  ['agentSvc', 'metadata', 'check'],
  ['pingAuthz', 'metadata', 'query'],
];

function ChainNode({ data }) {
  const group = GROUPS[data.group];
  return (
    <div className="tcf-node" style={{ '--group-color': group.bg, '--group-border': group.border, '--group-ink': group.ink }}>
      <Handle type="target" position={Position.Left} />
      <div className="tcf-node__title">{data.label}</div>
      {data.sub && <div className="tcf-node__sub">{data.sub}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function GroupBox({ data }) {
  const group = GROUPS[data.group];
  return (
    <div
      className="tcf-group"
      style={{
        width: '100%',
        height: '100%',
        background: `${group.bg}14`,
        borderColor: group.border,
      }}
    >
      <span className="tcf-group__label" style={{ color: group.bg }}>{data.label}</span>
    </div>
  );
}

function ChainEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } = props;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
    borderRadius: 12,
  });
  const label = data?.label;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label && (
        <>
          <path id={`${id}-lp`} d={path} fill="none" stroke="none" />
          <text className="tcf-edge-label">
            <textPath href={`#${id}-lp`} startOffset="50%" textAnchor="middle">{label}</textPath>
          </text>
        </>
      )}
    </>
  );
}

const nodeTypes = { chain: ChainNode, group: GroupBox };
const edgeTypes = { chain: ChainEdge };

function buildFlow() {
  return [
    ...Object.entries(GROUP_BOXES).map(([group, box]) => ({
      id: `group-${group}`,
      type: 'group',
      position: { x: box.x, y: box.y },
      data: { group, label: GROUPS[group].label },
      style: { width: box.w, height: box.h },
      zIndex: 0,
      selectable: false,
      draggable: false,
    })),
    ...NODES.map(({ id, group, label, sub, x, y }) => ({
      id,
      type: 'chain',
      position: { x, y },
      data: { group, label, sub },
      zIndex: 1,
      parentNode: `group-${group}`,
      extent: 'parent',
    })),
  ];
}

export default function TokenChainFlowDiagram({ onClickNode, step = -1 }) {
  const nodes = useMemo(buildFlow, []);
  const edges = useMemo(
    () => stepEdges(EDGES.map(([source, target, label], i) => ({
      id: `e${i}`,
      source,
      target,
      type: 'chain',
      data: { label },
      zIndex: 2,
    })), step),
    [step],
  );

  return (
    <div className="tcf-canvas" data-testid="tcf-token-chain-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        minZoom={0.2}
        maxZoom={2.5}
        onNodeClick={(_, node) => {
          if (node.type === 'chain') {
            onClickNode?.({ ...node.data, id: node.id, detail: NODE_DETAILS[node.id] || null });
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
      </ReactFlow>
    </div>
  );
}

export { NODES, EDGES, GROUPS };
