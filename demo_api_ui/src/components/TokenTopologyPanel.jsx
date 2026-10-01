// TokenTopologyPanel.jsx
// Real-time security topology diagram — shows RFC 8693 delegation chain as
// nodes appear dynamically while the agent flow runs. Separate from Flow Detail.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  getSmoothStepPath,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { MCP_STEP_IDS, laneLabel } from '../services/tokenChainTrace/buildTraceSteps';
import { buildA2aEvidenceRows } from '../utils/a2aChainDetail';
import { getElk } from '../utils/elkLayout';
import { useTheme } from '../context/ThemeContext';
import useDividerDrag from '../hooks/useDividerDrag';
import './TokenTopologyPanel.css';

const TOPOLOGY_SPEEDS = [
  { value: 1200, label: 'Fast' },
  { value: 2400, label: 'Normal' },
  { value: 4200, label: 'Slow' },
];

const TOPOLOGY_NODE_WIDTH = 220;
const TOPOLOGY_NODE_HEIGHT = 300;

// Coerce any value to a renderable string — trace data can contain {message} objects
function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v.message) return String(v.message);
  return JSON.stringify(v);
}

const STEP_ICONS = {
  website: '🪟',
  signin: '🔐',
  prompt: 'CH',
  agent: '👤',
  'tools-list-challenge': '401',
  'tools-list': 'TL',
  'tools-call-challenge': '401',
  llm: 'ML',
  'agent-token': 'AT',
  'exchange-1': 'X1',
  exchange: 'TX',
  // Enterprise-Managed MCP Authorization: the IdP signs the grant, the MCP
  // authorization server redeems it. Without entries here both hops fall back
  // to a two-letter lane abbreviation and read as unlabelled boxes.
  'id-jag-issued': '🔑',
  'id-jag-redeemed': 'JR',
  authorize: 'AZ',
  stepup: '🔑',
  'intent-binding': 'IB',
  gateway: 'GW',
  'vault-key-inject': 'VK',
  'api-key-swap': 'KS',
  mcp: 'M',
  api: 'API',
  reply: 'CH',
};

// Which hops are control points, what verb they apply, and what object they guard.
// `object` selects the badge glyph; `verb` + `what` render the callout box above
// the node. Presentation-only vocabulary, so it lives beside STEP_ICONS rather
// than in the step model — a step-id rename stays a one-file fix either way.
const ENFORCEMENT = {
  signin: { verb: 'Block', what: 'Unauthenticated users', object: 'user' },
  'exchange-1': { verb: 'Control', what: "Agent's own scope, pre-delegation", object: 'token' },
  exchange: { verb: 'Control', what: 'Delegated scope + audience', object: 'token' },
  authorize: { verb: 'Control', what: 'What this agent may do', object: 'action' },
  stepup: { verb: 'Check', what: 'Human approval (HITL / MFA)', object: 'human' },
  'intent-binding': { verb: 'Control', what: 'Amount vs declared intent', object: 'intent' },
  'tools-list-challenge': { verb: 'Block', what: 'Callers with no credential', object: 'token' },
  'tools-call-challenge': { verb: 'Block', what: 'Callers with no credential', object: 'token' },
  gateway: { verb: 'Block', what: 'Untrusted or mis-scoped tokens', object: 'token' },
  'vault-key-inject': { verb: 'Control', what: 'Route-bound API key from the BFF vault bridge', object: 'key' },
  'api-key-swap': { verb: 'Control', what: 'Credential handed downstream', object: 'key' },
  mcp: { verb: 'Control', what: 'Access to Services & Tools', object: 'tool' },
  database: { verb: 'Control', what: 'Access to Documents & Data', object: 'data' },
};

// Badge/callout colour state. A DENY decision outranks a 'done' status: the hop
// completed, but it completed by refusing.
export function enforcementFor(step) {
  const spec = ENFORCEMENT[step?.baseId || step?.id];
  if (!spec) return null;
  const outcome = String(step?.detail?.decision?.outcome || '').toLowerCase();
  const state = step.status === 'error' || outcome === 'deny'
    ? 'deny'
    : step.status === 'active'
      ? 'live'
      : outcome === 'permit'
        ? 'permit'
        : 'idle';
  return { ...spec, state };
}

// Connector label — the lane the hop hands off to.
export function edgeLabel(nextNode) {
  return laneLabel(String(nextNode?.lane || '').toUpperCase()) || null;
}

// The tool-call hops hang below the spine as a branch, the way a topology
// diagram draws "Services & Tools" off the main request path.
export function partitionSpineBranch(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const isBranch = (node) => MCP_STEP_IDS.includes(node?.step?.baseId || node?.id);
  const firstBranchIdx = list.findIndex(isBranch);
  return {
    spine: list.filter((node) => !isBranch(node)),
    branch: list.filter(isBranch),
    anchorId: firstBranchIdx > 0 ? list[firstBranchIdx - 1].id : null,
  };
}

// Inline SVG so the badge glyph names the guarded object without reaching for a
// non-allowlisted emoji. `currentColor` lets the state class drive the colour.
const OBJECT_PATHS = {
  user: 'M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8Zm-5 5.4c0-2.4 2.2-3.8 5-3.8s5 1.4 5 3.8',
  token: 'M10.2 3a3 3 0 1 0-2.6 4.5L3 12.1v1.5h1.9v-1.4h1.4v-1.4h1.3l1-1a3 3 0 0 0 1.6-6.8Zm.6 2.6h.01',
  key: 'M10.2 3a3 3 0 1 0-2.6 4.5L3 12.1v1.5h1.9v-1.4h1.4v-1.4h1.3l1-1a3 3 0 0 0 1.6-6.8Zm.6 2.6h.01',
  action: 'M8 1.8 13.2 4v4c0 3-2.2 5.3-5.2 6.2C5 13.3 2.8 11 2.8 8V4L8 1.8Z',
  human: 'M5.2 8.6V4.2a1.1 1.1 0 0 1 2.2 0v3M7.4 7.2V3a1.1 1.1 0 0 1 2.2 0v4.2m0-1.2a1.1 1.1 0 0 1 2.2 0v3.6c0 2.4-1.7 4.2-4 4.2-2 0-3.3-1-4-2.6L2.6 9.4a1.1 1.1 0 0 1 1.8-1.2l.8 1',
  intent: 'M4 1.8h5l3 3v9.4H4V1.8Zm5 0v3h3M5.8 10l1.4 1.5 3-3.4',
  tool: 'M10.4 1.9a3.6 3.6 0 0 0-3.1 5.4l-5 5 1.4 1.4 5-5a3.6 3.6 0 0 0 4.7-4.4l-2 2-1.7-1.7 2-2a3.6 3.6 0 0 0-1.3-.7Z',
  data: 'M8 1.9c2.9 0 5.2.8 5.2 1.8S10.9 5.5 8 5.5 2.8 4.7 2.8 3.7 5.1 1.9 8 1.9Zm5.2 1.8v8.6c0 1-2.3 1.8-5.2 1.8s-5.2-.8-5.2-1.8V3.7M13.2 8c0 1-2.3 1.8-5.2 1.8S2.8 9 2.8 8',
};

function ObjectIcon({ object }) {
  const d = OBJECT_PATHS[object] || OBJECT_PATHS.action;
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Every step in the chain, including the ones that never fired. A control point
// that was available and went unused is part of the security story — filtering
// to observed-only hops made the diagram unable to say "this check exists here
// but was not needed", which is exactly what the enforcement callouts report.
// Unfired hops render as ghosts in the topology canvas.
const UNFIRED_STATUSES = ['pending', 'notinpath'];

export function isUnfired(step) {
  return UNFIRED_STATUSES.includes(step?.status);
}

export function buildObservedTopology(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => ['active', 'done', 'error', ...UNFIRED_STATUSES].includes(step?.status))
    .map((step) => {
      const baseId = step.baseId || step.id;
      const [name, ...descriptionParts] = str(step.title || step.id).split(' — ');
      return {
        id: step.id,
        icon: STEP_ICONS[baseId] || str(step.lane).slice(0, 2),
        name,
        lane: step.lane || 'FLOW',
        desc: descriptionParts.join(' — ') || `${step.lane || 'Flow'} hop observed in this run`,
        step,
      };
    });
}

export function buildA2aTopology(events) {
  return buildA2aEvidenceRows(events);
}

function EvidenceFlow({ label, nodes, selectedId, onNodeClick }) {
  return (
    <section className="ttp-evidence-flow" aria-label={label}>
      <div className="ttp-evidence-label">{label}</div>
      <div className="ttp-evidence-row">
        {nodes.map((node, index) => (
          <React.Fragment key={node.id}>
            {index > 0 && (
              <div className="ttp-evidence-conn" aria-hidden="true">
                <div className="ttp-line" />
                <span className="ttp-arrowhead">▶</span>
              </div>
            )}
            <div
              className={`ttp-evidence-node ttp-evidence-node--${node.status}${selectedId === node.sourceId ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onNodeClick?.(node.sourceId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onNodeClick?.(node.sourceId);
                }
              }}
            >
              <span className="ttp-evidence-status">{node.status === 'done' ? '✓' : node.status === 'error' ? 'FAILED' : 'WAITING'}</span>
              <strong>{node.name}</strong>
              <span>{node.desc}</span>
              {node.requestSummary && <small>Request: {node.requestSummary}</small>}
              {node.responseSummary && <small>Response: {node.responseSummary}</small>}
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function claimsFromStep(step, options = {}) {
  const { truncateReason = false } = options;
  if (!step?.detail) return null;
  const d = step.detail;
  if (d.claims && Object.keys(d.claims).length) {
    return Object.entries(d.claims).slice(0, 12).map(([k, v]) => ({
      k,
      v: typeof v === 'object' ? JSON.stringify(v) : String(v),
      cls: k === 'scope' ? 'hi' : k === 'act' || k === 'may_act' ? 'ok' : k === 'aud' ? 'aud' : '',
    }));
  }
  if (d.decision) {
    const dec = d.decision;
    const rows = [];
    if (dec.outcome) rows.push({ k: 'decision', v: String(dec.outcome).toUpperCase(), cls: dec.outcome === 'PERMIT' || dec.outcome === 'done' ? 'ok' : 'warn' });
    if (dec.decisionId) rows.push({ k: 'decision_id', v: str(dec.decisionId), cls: '' });
    if (dec.engine) rows.push({ k: 'engine', v: str(dec.engine), cls: '' });
    if (dec.why) rows.push({ k: 'reason', v: truncateReason ? str(dec.why).slice(0, 120) : str(dec.why), cls: '' });
    return rows.length ? rows : null;
  }
  if (d.kv?.length) {
    return d.kv.slice(0, 12).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), cls: '',
    }));
  }
  return null;
}

// Parse stringified JSON for display
function parseValue(val) {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 2 && (val[0] === '{' || val[0] === '[')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

// Render a value as nicely-formatted key-value pairs (not raw JSON)
function FormattedValue({ value, depth = 0 }) {
  const parsed = parseValue(value);
  if (parsed == null) return <span className="ttp-fv-null">—</span>;
  if (typeof parsed === 'boolean') return <span className={`ttp-fv-bool ${parsed ? 'ok' : 'warn'}`}>{parsed ? 'true' : 'false'}</span>;
  if (typeof parsed === 'number') return <span className="ttp-fv-num">{parsed}</span>;
  if (typeof parsed === 'string') {
    if (parsed.length > 100) return <span className="ttp-fv-str long">{parsed}</span>;
    return <span className="ttp-fv-str">{parsed}</span>;
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return <span className="ttp-fv-null">empty</span>;
    if (typeof parsed[0] === 'object' && parsed[0] !== null) {
      return (
        <div className="ttp-fv-arr">
          {parsed.slice(0, 5).map((item, i) => (
            <div key={i} className="ttp-fv-card">
              {typeof item === 'object' && item !== null
                ? Object.entries(item).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="ttp-fv-kv">
                      <span className="ttp-fv-k">{k}</span>
                      <FormattedValue value={v} depth={depth + 1} />
                    </div>
                  ))
                : <span className="ttp-fv-str">{str(item)}</span>
              }
            </div>
          ))}
          {parsed.length > 5 && <div className="ttp-fv-more">+{parsed.length - 5} more</div>}
        </div>
      );
    }
    return <span className="ttp-fv-str">{parsed.map(str).join(', ')}</span>;
  }
  if (typeof parsed === 'object') {
    if (depth > 2) return <span className="ttp-fv-str">{JSON.stringify(parsed).slice(0, 80)}</span>;
    return (
      <div className="ttp-fv-obj">
        {Object.entries(parsed).slice(0, 10).map(([k, v]) => (
          <div key={k} className="ttp-fv-kv">
            <span className="ttp-fv-k">{k}</span>
            <FormattedValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="ttp-fv-str">{str(parsed)}</span>;
}

function NodeBox({ node, step, selected, current, onClick, animateIn, ghost, branchHead = false }) {
  const st = step?.status || 'pending';
  const isOk = st === 'done';
  const isErr = st === 'error';
  const isPend = st === 'pending';

  const statusMark = isOk ? '✓' : isErr ? 'DENIED' : isPend ? '' : '—';
  const statusCls = isOk ? 'ok' : isErr ? 'err' : isPend ? 'pend' : 'nd';

  const claims = claimsFromStep(step, { truncateReason: true });
  const enf = enforcementFor(step);

  return (
    <div
      className={`ttp-node${selected ? ' selected' : ''}${current ? ' current' : ''}${animateIn ? ' animate-in' : ''}${ghost ? ' ghost' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={str(step?.title || node.name)}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {branchHead && <div className="ttp-branch-label">Services &amp; Tools — delegated tool call</div>}
      <div className="ttp-callout-slot">
        {enf && (
          <>
            <div className={`ttp-callout ttp-callout--${enf.state}`}>
              <div className="ttp-callout-verb">{enf.verb}</div>
              <div className="ttp-callout-what">{enf.what}</div>
            </div>
            <div className="ttp-callout-leader" />
          </>
        )}
      </div>
      <div className={`ttp-box${selected ? ' active' : ''}${isPend ? ' pulsing' : ''}`}>
        {enf && (
          <span
            className={`ttp-enf-badge ttp-enf-badge--${enf.state}`}
            title={`${enf.verb} — ${enf.what}`}
          >
            <ObjectIcon object={enf.object} />
          </span>
        )}
        <div className={`ttp-status ${statusCls}`}>
          {isPend ? <span className="ttp-pulse-dot" /> : statusMark}
        </div>
        <div className="ttp-icon">{node.icon}</div>
        <div className="ttp-name">{node.name}</div>
        <div className="ttp-desc">{node.desc}</div>
        <span className={`ttp-lane ttp-lane--${node.lane.toLowerCase()}`}>{laneLabel(node.lane)}</span>
        {claims && (
          <div className="ttp-node-claims">
            {claims.slice(0, 3).map(({ k, v, cls }) => (
              <div key={k} className="ttp-nc-row">
                <span className="ttp-nc-k">{str(k)}</span>
                <span className={`ttp-nc-v${cls ? ' ' + cls : ''}`}>{str(v).slice(0, 30)}</span>
              </div>
            ))}
            {claims.length > 3 && <div className="ttp-nc-more">+{claims.length - 3} more</div>}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function TopologyFlowNode({ data }) {
  return (
    <NodeBox
      node={data.node}
      step={data.step}
      selected={data.selected}
      current={data.current}
      ghost={data.ghost}
      animateIn={data.animateIn}
      branchHead={data.branchHead}
      onClick={data.onClick}
    />
  );
}

function TopologyFlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 12,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`ttp-flow-edge${data?.blocked ? ' is-blocked' : ''}${data?.ghost ? ' is-ghost' : ''}`} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div className="ttp-flow-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const TOPOLOGY_NODE_TYPES = { topology: TopologyFlowNode };
const TOPOLOGY_EDGE_TYPES = { topology: TopologyFlowEdge };

function TopologyCanvas({ nodes, edges, fitKey }) {
  const { fitView } = useReactFlow();
  const fittedRun = useRef(null);

  useEffect(() => {
    if (!nodes.length || !fitKey || fittedRun.current === fitKey) return undefined;
    const timer = setTimeout(() => {
      fitView({ padding: 0.14, duration: 220, minZoom: 0.35, maxZoom: 1.15 });
      fittedRun.current = fitKey;
    }, 50);
    return () => clearTimeout(timer);
  }, [fitKey, fitView, nodes.length]);

  return (
    <div className="ttp-flow-canvas" role="group" aria-label="Token topology graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={TOPOLOGY_NODE_TYPES}
        edgeTypes={TOPOLOGY_EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.35}
        maxZoom={2}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => node.data?.step?.status === 'error' ? '#f85149' : node.data?.step?.status === 'active' ? '#2f81f7' : '#6e7681'} />
      </ReactFlow>
    </div>
  );
}

function Inspector({ step, topologyNodes, onClose, fontSize, setFontSize }) {
  const [tab, setTab] = useState('details');
  useEffect(() => { setTab('details'); }, [step?.id]);

  if (!step) {
    return (
      <div className="ttp-insp-empty">
        <div className="ttp-insp-empty-icon">🔑</div>
        <div className="ttp-insp-empty-text">Click a node to inspect its token details</div>
      </div>
    );
  }

  const claims = claimsFromStep(step);
  const rfcs = step.detail?.rfcs || step.rfcs || [];
  const rawNar = step.detail?.narrative || '';
  const narrative = typeof rawNar === 'object' ? str(rawNar) : String(rawNar || '');
  const actClaim = step.id === 'exchange' && step.detail?.claims?.act;
  const detail = step.detail || {};
  const statements = detail.statements || detail.decision?.statements;
  const request = detail.request;
  const response = detail.response;
  const spec = detail.spec || {};

  // Build the Interaction Map sequence
  const activeNodeIdx = topologyNodes.findIndex(n => n.id === step.id);
  const activeNode = topologyNodes[activeNodeIdx];
  const prevNode = activeNodeIdx > 0 ? topologyNodes[activeNodeIdx - 1] : null;
  const nextNode = activeNodeIdx < topologyNodes.length - 1 ? topologyNodes[activeNodeIdx + 1] : null;

  return (
    <div className="ttp-insp">
      <div className="ttp-insp-header">
        <span className={`ttp-lane ttp-lane--${(str(step.lane) || 'bff').toLowerCase()}`}>{laneLabel(str(step.lane).toUpperCase() || 'BFF')}</span>
        <span className="ttp-insp-title">{str(step.title)}</span>
        <div className="ttp-insp-font-control" role="group" aria-label="Details font size">
          <button type="button" onClick={() => setFontSize('small')} aria-label="Decrease details font size" aria-pressed={fontSize === 'small'}>A−</button>
          <button type="button" onClick={() => setFontSize('medium')} aria-label="Default details font size" aria-pressed={fontSize === 'medium'}>A</button>
          <button type="button" onClick={() => setFontSize('large')} aria-label="Increase details font size" aria-pressed={fontSize === 'large'}>A+</button>
        </div>
        <button className="ttp-insp-close" onClick={onClose}>✕</button>
      </div>

      {/* Mini Interaction Map */}
      <div className="ttp-insp-interaction-map">
        {prevNode && (
          <><span className="ttp-map-neighbor">[{prevNode.icon}] {prevNode.name}</span> <span className="ttp-map-arrow">→</span> </>
        )}
        <span className="ttp-map-current">
          [{activeNode?.icon}] {activeNode?.name || 'Current'}
        </span>
        {nextNode && (
          <> <span className="ttp-map-arrow">→</span> <span className="ttp-map-neighbor">[{nextNode.icon}] {nextNode.name}</span></>
        )}
      </div>

      <div className="ttp-insp-tabs">
        <button className={`ttp-itab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        {(spec.mandate || spec.why) && (
          <button className={`ttp-itab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        )}
        {claims && <button className={`ttp-itab${tab === 'claims' ? ' active' : ''}`} onClick={() => setTab('claims')}>Claims</button>}
        {(request || response) && <button className={`ttp-itab${tab === 'request' ? ' active' : ''}`} onClick={() => setTab('request')}>Request</button>}
        {step.detail && <button className={`ttp-itab${tab === 'raw' ? ' active' : ''}`} onClick={() => setTab('raw')}>Raw</button>}
      </div>
      <div className="ttp-insp-body">
        {tab === 'details' && (
          <div className="ttp-detail-view">
            {narrative && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">What happened</div>
                <div className="ttp-detail-text">{narrative}</div>
              </div>
            )}
            {detail.decision && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">Authorization Decision</div>
                <div className="ttp-decision-card">
                  <div className={`ttp-decision-outcome ${str(detail.decision.outcome).toLowerCase() === 'permit' ? 'permit' : 'deny'}`}>
                    {str(detail.decision.outcome).toUpperCase()}
                  </div>
                  {detail.decision.engine && (
                    <div className="ttp-fv-kv"><span className="ttp-fv-k">engine</span><span className="ttp-fv-str">{str(detail.decision.engine)}</span></div>
                  )}
                  {detail.decision.decisionId && (
                    <div className="ttp-fv-kv"><span className="ttp-fv-k">id</span><span className="ttp-fv-str ttp-fv-mono">{str(detail.decision.decisionId)}</span></div>
                  )}
                  {detail.decision.why && (
                    <div className="ttp-fv-kv"><span className="ttp-fv-k">reason</span><span className="ttp-fv-str">{str(detail.decision.why)}</span></div>
                  )}
                </div>
              </div>
            )}
            {statements && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">Policy Statements</div>
                <FormattedValue value={statements} />
              </div>
            )}
            {actClaim && (
              <div className="ttp-act-chip">✅ Delegation chain intact — RFC 8693 §4.1</div>
            )}
            {rfcs.length > 0 && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">Standards</div>
                <div className="ttp-rfc-row">{rfcs.map(r => <span key={str(r)} className="ttp-rfc">{str(r)}</span>)}</div>
              </div>
            )}
            {!narrative && !detail.decision && !statements && (
              <div className="ttp-detail-text">Waiting for details...</div>
            )}
          </div>
        )}
        {tab === 'overview' && (spec.mandate || spec.why) && (
          <div className="ttp-detail-view">
            {spec.mandate && (
              <div className="ttp-detail-section">
                 <div className="ttp-detail-label">Role / Mandate</div>
                 <div className="ttp-detail-text ttp-overview-text">{str(spec.mandate)}</div>
              </div>
            )}
            {spec.why && (
              <div className="ttp-detail-section">
                 <div className="ttp-detail-label">Interaction / Why</div>
                 <div className="ttp-detail-text ttp-overview-text">{str(spec.why)}</div>
              </div>
            )}
            {spec.failure && (
              <div className="ttp-detail-section ttp-failure-section">
                 <div className="ttp-detail-label ttp-failure-label">Failure Mode</div>
                 <div className="ttp-detail-text ttp-failure-text">{str(spec.failure)}</div>
              </div>
            )}
          </div>
        )}
        {tab === 'claims' && claims && (
          <div className="ttp-claims-table">
            {claims.map(({ k, v, cls }) => (
              <div key={k} className="ttp-ct-row">
                <span className="ttp-ct-k">{str(k)}</span>
                <span className={`ttp-ct-v${cls ? ' ' + cls : ''}`}>
                  <FormattedValue value={v} />
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === 'request' && (
          <div className="ttp-detail-view">
            {request && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">Request</div>
                <FormattedValue value={request} />
              </div>
            )}
            {response && (
              <div className="ttp-detail-section">
                <div className="ttp-detail-label">Response</div>
                <FormattedValue value={response} />
              </div>
            )}
          </div>
        )}

        {tab === 'raw' && step.detail && (
          <div className="ttp-detail-view">
            <div className="ttp-detail-section">
              <div className="ttp-detail-label">Raw Step Detail</div>
              <pre className="ttp-raw-pre">{JSON.stringify(step.detail, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TokenTopologyPanel({ isOpen, onClose, inline = false }) {
  const { darkMode, setDarkMode } = useTheme();
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [expandedId, setExpandedId] = useState(null);
  const prevRunId = useRef(null);
  const [layout, setLayout] = useState({ signature: '', positions: {} });
  const { size: inspWidth, handleProps: inspHandleProps } = useDividerDrag({
    min: 200,
    max: 600,
    initial: 320,
    invert: true, // inspector pane sits right of its divider
  });
  const [playing, setPlaying] = useState(false);
  const [revealCount, setRevealCount] = useState(null);
  const [speed, setSpeed] = useState(2400);
  // Start at the presentation-friendly size; the inspector controls can still
  // reduce or increase this per session.
  const [fontSize, setFontSize] = useState('large');
  const [inspectorVisible, setInspectorVisible] = useState(false);

  useEffect(() => {
    return tokenChainTraceStore.subscribe(setStoreState);
  }, []);

  const { trace, steps } = storeState;

  // Auto-clear selection when a new run starts
  useEffect(() => {
    if (trace.runId && trace.runId !== prevRunId.current) {
      prevRunId.current = trace.runId;
      setExpandedId(null);
      setInspectorVisible(false);
    }
  }, [trace.runId]);

  const handleNodeClick = useCallback((nodeId) => {
    setInspectorVisible(true);
    if (expandedId === nodeId) {
      setExpandedId(null);
    } else {
      setExpandedId(nodeId);
    }
  }, [expandedId]);

  const handleClear = useCallback(() => {
    tokenChainTraceStore.reset();
    setExpandedId(null);
    setInspectorVisible(false);
  }, []);

  const handleInspectorToggle = useCallback(() => {
    setInspectorVisible((visible) => !visible);
  }, []);

  const handleInspectorClose = useCallback(() => {
    setExpandedId(null);
    setInspectorVisible(false);
  }, []);

  const routingMode = trace.routingMode || (trace.llmDetail ? 'llm' : trace.phases?.length ? 'heuristic' : null);
  const prompt = trace.prompt || null;
  const a2aTopology = buildA2aTopology(trace.tokenEvents);
  const a2aNodes = a2aTopology ? [...a2aTopology.identity, ...a2aTopology.wire] : [];

  const hasActivity = Boolean(
    trace.startedAt || trace.prompt || trace.tokenEvents?.length || trace.phases?.length ||
    trace.mcpResult || trace.authorize || trace.llmDetail || trace.llmReply ||
    trace.outcome || trace.routingMode || a2aTopology,
  );
  const topologyNodes = hasActivity ? buildObservedTopology(steps) : [];
  const topologySignature = topologyNodes.map((node) => node.id).join('|');
  const totalNodes = topologyNodes.length;
  const visibleCount = revealCount == null ? totalNodes : Math.min(revealCount, totalNodes);
  const visibleNodes = topologyNodes.slice(0, visibleCount);
  const { spine, branch, anchorId } = partitionSpineBranch(visibleNodes);
  const topologyPartitions = useMemo(() => partitionSpineBranch(topologyNodes), [topologySignature]);
  const currentId = playing && visibleNodes.length
    ? visibleNodes[visibleNodes.length - 1]?.id
    : topologyNodes.find((node) => node.step.status === 'active')?.id;

  // ELK positions the whole trace once per run shape. Status updates therefore
  // repaint evidence without shifting the graph around while it is being read.
  useEffect(() => {
    if (!topologyNodes.length) {
      setLayout({ signature: '', positions: {} });
      return undefined;
    }
    let cancelled = false;
    const { spine: allSpine, branch: allBranch, anchorId: allAnchorId } = topologyPartitions;
    const edges = [];
    for (let index = 1; index < allSpine.length; index += 1) {
      edges.push({ id: `spine-${allSpine[index - 1].id}-${allSpine[index].id}`, sources: [allSpine[index - 1].id], targets: [allSpine[index].id] });
    }
    if (allAnchorId && allBranch.length) {
      edges.push({ id: `branch-${allAnchorId}-${allBranch[0].id}`, sources: [allAnchorId], targets: [allBranch[0].id] });
    }
    for (let index = 1; index < allBranch.length; index += 1) {
      edges.push({ id: `branch-${allBranch[index - 1].id}-${allBranch[index].id}`, sources: [allBranch[index - 1].id], targets: [allBranch[index].id] });
    }

    getElk().then((elk) => elk.layout({
      id: 'token-topology',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '52',
        'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: topologyNodes.map((node) => ({ id: node.id, width: TOPOLOGY_NODE_WIDTH, height: TOPOLOGY_NODE_HEIGHT })),
      edges,
    })).then((result) => {
      if (cancelled) return;
      const positions = Object.fromEntries((result.children || []).map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }]));
      setLayout({ signature: topologySignature, positions });
    }).catch((error) => {
      console.error('[TokenTopologyPanel] layout failed; using linear fallback', error);
      const branchIds = new Set(allBranch.map((node) => node.id));
      const positions = Object.fromEntries(topologyNodes.map((node, index) => [node.id, {
        x: index * (TOPOLOGY_NODE_WIDTH + 80),
        y: branchIds.has(node.id) ? TOPOLOGY_NODE_HEIGHT + 72 : 0,
      }]));
      setLayout({ signature: topologySignature, positions });
    });
    return () => { cancelled = true; };
  }, [topologySignature]);

  const flowNodes = useMemo(() => {
    const branchIds = new Set(branch.map((node) => node.id));
    const branchHeadId = branch[0]?.id;
    return visibleNodes.map((node, index) => ({
      id: node.id,
      type: 'topology',
      className: branchIds.has(node.id) ? 'ttp-branch' : 'ttp-spine',
      position: layout.signature === topologySignature && layout.positions[node.id]
        ? layout.positions[node.id]
        : { x: index * (TOPOLOGY_NODE_WIDTH + 80), y: 0 },
      width: TOPOLOGY_NODE_WIDTH,
      height: TOPOLOGY_NODE_HEIGHT,
      data: {
        node,
        step: node.step,
        selected: expandedId === node.id,
        current: currentId === node.id,
        ghost: isUnfired(node.step),
        animateIn: !isUnfired(node.step),
        branchHead: node.id === branchHeadId,
        onClick: () => handleNodeClick(node.id),
      },
    }));
  }, [visibleNodes, branch, layout, topologySignature, expandedId, currentId, handleNodeClick]);

  const flowEdges = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const pairs = [];
    for (let index = 1; index < spine.length; index += 1) pairs.push([spine[index - 1], spine[index]]);
    if (anchorId && branch.length) pairs.push([topologyNodes.find((node) => node.id === anchorId), branch[0]]);
    for (let index = 1; index < branch.length; index += 1) pairs.push([branch[index - 1], branch[index]]);
    return pairs
      .filter(([source, target]) => source && target && visibleIds.has(source.id) && visibleIds.has(target.id))
      .map(([source, target]) => ({
        id: `edge-${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'topology',
        markerEnd: { type: MarkerType.ArrowClosed, color: target.step.status === 'error' ? '#f85149' : '#6e7681' },
        data: { label: edgeLabel(target), blocked: target.step.status === 'error', ghost: isUnfired(target.step) },
      }));
  }, [visibleNodes, spine, branch, anchorId, topologyNodes]);
  const flowFitKey = `${trace.runId || 'run'}:${layout.signature === topologySignature ? topologySignature : ''}`;
  const selectedStep = expandedId
    ? topologyNodes.find((node) => node.id === expandedId)?.step
      || a2aNodes.find((node) => node.sourceId === expandedId)?.step
      || null
    : null;
  const showInspector = inline ? Boolean(selectedStep) : inspectorVisible;

  useEffect(() => {
    if (revealCount == null) setRevealCount(totalNodes);
  }, [totalNodes, revealCount]);

  useEffect(() => {
    if (!playing || visibleCount >= totalNodes) {
      if (playing && totalNodes > 0 && visibleCount >= totalNodes) setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setRevealCount((count) => Math.min((count ?? 0) + 1, totalNodes)), speed);
    return () => clearTimeout(timer);
  }, [playing, visibleCount, totalNodes, speed]);

  useEffect(() => {
    if (trace.runId) {
      setRevealCount(totalNodes);
      setPlaying(false);
    }
  }, [trace.runId]);

  const handlePlayPause = useCallback(() => {
    if (!totalNodes) return;
    if (visibleCount >= totalNodes && !playing) setRevealCount(0);
    setPlaying((value) => !value);
  }, [playing, totalNodes, visibleCount]);

  const handleStartOver = useCallback(() => {
    if (!totalNodes) return;
    setRevealCount(0);
    setPlaying(true);
    setExpandedId(null);
  }, [totalNodes]);

  const content = (
      <div className="ttp-root ttp-reel-layout" data-theme={darkMode ? 'dark' : 'light'} data-font-size={fontSize}>
        {/* Toolbar */}
        <div className="ttp-toolbar">
          <div className="ttp-toolbar-left">
            {prompt && <><span className="ttp-ctx-lbl">Prompt</span><span className="ttp-ctx-prompt">{str(prompt)}</span></>}
            {routingMode && <span className="ttp-ctx-mode">{str(routingMode)}</span>}
            <span className="ttp-playback-status" aria-live="polite">
              {playing ? `Playing ${visibleCount}/${totalNodes}` : `Live ${visibleCount}/${totalNodes}`}
            </span>
          </div>
          <div className="ttp-toolbar-actions">
            <button type="button" className="ttp-play-btn" onClick={handlePlayPause} disabled={!totalNodes}>
              {playing ? 'Pause' : visibleCount >= totalNodes ? 'Play' : 'Resume'}
            </button>
            <select className="ttp-speed-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Adjust topology playback speed">
              {TOPOLOGY_SPEEDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button type="button" className="ttp-start-btn" onClick={handleStartOver} disabled={!totalNodes}>Start over</button>
            <div className="ttp-font-control" aria-label="Token topology font size">
              <button type="button" onClick={() => setFontSize('small')} aria-pressed={fontSize === 'small'} title="Use smaller text">A−</button>
              <button type="button" onClick={() => setFontSize('medium')} aria-pressed={fontSize === 'medium'} title="Use default text">A</button>
              <button type="button" onClick={() => setFontSize('large')} aria-pressed={fontSize === 'large'} title="Use larger text">A+</button>
            </div>
            <div className="ttp-theme-control" aria-label="Token topology color theme">
              <span className={!darkMode ? 'active' : ''}>☀️ Light</span>
              <button
                type="button"
                className="ttp-theme-switch"
                role="switch"
                aria-checked={darkMode}
                aria-label="Dark mode"
                title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                onClick={() => setDarkMode(!darkMode)}
              >
                <span className="ttp-theme-switch-thumb" />
              </button>
              <span className={darkMode ? 'active' : ''}>🌙 Dark</span>
            </div>
            <button className="ttp-clear-btn" onClick={handleClear} title="Clear and restart">
              <span className="ttp-clear-icon">↺</span> Clear
            </button>
            {!inline && (
              <button
                type="button"
                className="ttp-inspector-toggle"
                onClick={handleInspectorToggle}
                disabled={!hasActivity}
                aria-label={inspectorVisible ? 'Hide details' : 'Show details'}
                title={inspectorVisible ? 'Hide details' : 'Show details'}
              >
                <span aria-hidden="true">🔍</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline details follow the graph; the pop-out keeps its resizable side inspector. */}
        <div className={`ttp-body${selectedStep ? ' has-insp' : ''}`}>
          {showInspector && hasActivity && selectedStep ? (
            <div className={`ttp-insp-pane${inline ? ' ttp-insp-pane--inline' : ''}`} style={inline ? undefined : { width: inspWidth }}>
              {!inline && <div className="ttp-resize-handle" {...inspHandleProps} />}
              <Inspector step={selectedStep} topologyNodes={topologyNodes} onClose={handleInspectorClose} fontSize={fontSize} setFontSize={setFontSize} />
            </div>
          ) : showInspector && hasActivity && !inline ? (
            <div className="ttp-insp-pane" style={{ width: inspWidth }}><div className="ttp-resize-handle" {...inspHandleProps} /><div className="ttp-insp-empty"><div className="ttp-insp-empty-icon">🔑</div><div className="ttp-insp-empty-text">Click a node to inspect its token details</div></div></div>
          ) : null}
          <div className="ttp-main">
            <div className="ttp-diagram">
            {hasActivity && (
              <div className="ttp-context">
                <div className="ttp-label">Delegation context — enforcement callouts and A2A evidence for the run</div>
                {a2aTopology && (
                  <div className="ttp-a2a-topology">
                    <div className="ttp-a2a-heading"><strong>A2A: main agent calling specialist agent</strong><span>Identity and wire-protocol evidence are separate paths.</span></div>
                    <EvidenceFlow label="Identity path — RFC 8693 token exchanges for MCP authorization" nodes={a2aTopology.identity} selectedId={expandedId} onNodeClick={handleNodeClick} />
                    <EvidenceFlow label="Wire path — Agent Card and JSON-RPC handoff" nodes={a2aTopology.wire} selectedId={expandedId} onNodeClick={handleNodeClick} />
                    <div className="ttp-a2a-boundary">{a2aTopology.responseBoundary}</div>
                  </div>
                )}
              </div>
            )}
            {hasActivity ? (
              <div className="ttp-idle ttp-context-hint">
                <div>Click any node below for details. Pan or zoom to follow the full path.</div>
              </div>
            ) : (
              <div className="ttp-idle">
                <div>Run an agent flow to build the topology.</div>
                <div>Nodes will appear as each hop produces evidence.</div>
              </div>
            )}
            </div>
            {hasActivity ? (
              <div className="ttp-reel">
                <div className="ttp-label">Live delegated topology — current step is highlighted; pan or zoom to follow the full path</div>
                <ReactFlowProvider>
                  <TopologyCanvas nodes={flowNodes} edges={flowEdges} fitKey={flowFitKey} />
                </ReactFlowProvider>
              </div>
            ) : null}
          </div>
        </div>
      </div>
  );

  if (inline) return <div className="ttp-inline">{content}</div>;
  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Topology"
      defaultWidth={960}
      defaultHeight={660}
      storageKey="ba-token-topology-panel"
      footer={null}
      noBackdrop
      zIndex={10001}
      minWidth={580}
      minHeight={440}
      className={`ttp-modal ttp-modal--${darkMode ? 'dark' : 'light'}`}
    >
      {content}
    </DraggableModal>
  );
}
