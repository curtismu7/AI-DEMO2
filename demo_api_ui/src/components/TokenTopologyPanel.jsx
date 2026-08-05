// TokenTopologyPanel.jsx
// Real-time security topology diagram — shows RFC 8693 delegation chain as
// nodes appear dynamically while the agent flow runs. Separate from Flow Detail.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildA2aChainDetail } from '../utils/a2aChainDetail';
import { useTheme } from '../context/ThemeContext';
import './TokenTopologyPanel.css';

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
  llm: 'ML',
  'agent-token': 'AT',
  exchange: 'TX',
  authorize: 'AZ',
  stepup: '🔑',
  'intent-binding': 'IB',
  gateway: 'GW',
  'api-key-swap': 'KS',
  mcp: 'M',
  api: 'API',
  reply: 'CH',
};

export function buildObservedTopology(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => ['active', 'done', 'error'].includes(step?.status))
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

function eventById(events, id) {
  return (Array.isArray(events) ? events : []).find((event) => event?.id === id) || null;
}

function evidenceStatus(event) {
  if (!event) return 'pending';
  const status = String(event.status || '').toLowerCase();
  return ['error', 'failed', 'failure', 'denied'].includes(status) ? 'error' : 'done';
}

function audience(event) {
  const value = event?.claims?.aud;
  if (Array.isArray(value)) return value[value.length - 1] || null;
  return value || null;
}

export function buildA2aTopology(events) {
  const detail = buildA2aChainDetail(events);
  if (!detail.present) return null;

  const exchange1 = eventById(events, 'a2a-exchange1');
  const exchange2 = eventById(events, 'a2a-exchange2');
  const wireBearer = eventById(events, 'a2a-protocol-bearer');
  const agentCard = eventById(events, 'a2a-agent-card');
  const message = eventById(events, 'a2a-protocol-message');
  const specialist = detail.specialist || 'Specialist agent';

  return {
    identity: [
      { id: 'a2a-main-identity', name: 'Main agent', desc: str(detail.generalist) || 'Generalist', status: exchange1 ? 'done' : 'pending' },
      { id: 'a2a-exchange1', name: 'Exchange #1', desc: `RFC 8693 · user + main actor${audience(exchange1) ? ` · aud ${audience(exchange1)}` : ''}`, status: evidenceStatus(exchange1) },
      { id: 'a2a-exchange2', name: 'Exchange #2', desc: `RFC 8693 · nested act${audience(exchange2) ? ` · aud ${audience(exchange2)}` : ''}`, status: evidenceStatus(exchange2) },
      { id: 'a2a-specialist-identity', name: specialist, desc: 'Specialist identity used for delegated MCP authorization', status: evidenceStatus(exchange2) },
    ],
    wire: [
      { id: 'a2a-main-wire', name: 'Main agent', desc: 'A2A client', status: wireBearer ? 'done' : 'pending' },
      { id: 'a2a-wire-bearer', name: 'PingOne wire bearer', desc: `Separate client-credentials token${audience(wireBearer) ? ` · aud ${audience(wireBearer)}` : ''}`, status: evidenceStatus(wireBearer) },
      { id: 'a2a-agent-card', name: 'Agent Card', desc: 'Specialist discovery', status: evidenceStatus(agentCard) },
      { id: 'a2a-send-message', name: 'A2A SendMessage', desc: 'JSON-RPC handoff', status: evidenceStatus(message) },
      { id: 'a2a-specialist-wire', name: specialist, desc: 'Specialist agent called by main agent', status: evidenceStatus(message) },
    ],
  };
}

function EvidenceFlow({ label, nodes }) {
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
            <div className={`ttp-evidence-node ttp-evidence-node--${node.status}`}>
              <span className="ttp-evidence-status">{node.status === 'done' ? '✓' : node.status === 'error' ? 'FAILED' : 'WAITING'}</span>
              <strong>{node.name}</strong>
              <span>{node.desc}</span>
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

function NodeBox({ node, step, selected, onClick, animateIn }) {
  const st = step?.status || 'pending';
  const isOk = st === 'done';
  const isErr = st === 'error';
  const isPend = st === 'pending';

  const statusMark = isOk ? '✓' : isErr ? 'DENIED' : isPend ? '' : '—';
  const statusCls = isOk ? 'ok' : isErr ? 'err' : isPend ? 'pend' : 'nd';

  const claims = claimsFromStep(step, { truncateReason: true });

  return (
    <div
      className={`ttp-node${selected ? ' selected' : ''}${animateIn ? ' animate-in' : ''}`}
      onClick={onClick}
    >
      <div className={`ttp-box${selected ? ' active' : ''}${isPend ? ' pulsing' : ''}`}>
        <div className={`ttp-status ${statusCls}`}>
          {isPend ? <span className="ttp-pulse-dot" /> : statusMark}
        </div>
        <div className="ttp-icon">{node.icon}</div>
        <div className="ttp-name">{node.name}</div>
        <div className="ttp-desc">{node.desc}</div>
        <span className={`ttp-lane ttp-lane--${node.lane.toLowerCase()}`}>{node.lane}</span>
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
    </div>
  );
}

function Inspector({ step, topologyNodes, onClose }) {
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
        <span className={`ttp-lane ttp-lane--${(str(step.lane) || 'bff').toLowerCase()}`}>{str(step.lane)}</span>
        <span className="ttp-insp-title">{str(step.title)}</span>
        <button className="ttp-insp-close" onClick={onClose}>✕</button>
      </div>

      {/* Mini Interaction Map */}
      <div className="ttp-insp-interaction-map" style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid #30363d', fontSize: '11px', textAlign: 'center', marginBottom: '8px' }}>
        {prevNode && (
          <><span style={{ color: '#8b949e' }}>[{prevNode.icon}] {prevNode.name}</span> <span style={{ fontWeight: 'bold', margin: '0 4px' }}>➔</span> </>
        )}
        <span style={{ color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold' }}>
          [{activeNode?.icon}] {activeNode?.name || 'Current'}
        </span>
        {nextNode && (
          <> <span style={{ fontWeight: 'bold', margin: '0 4px' }}>➔</span> <span style={{ color: '#8b949e' }}>[{nextNode.icon}] {nextNode.name}</span></>
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
              <div className="ttp-detail-text muted">Waiting for details...</div>
            )}
          </div>
        )}
        {tab === 'overview' && (spec.mandate || spec.why) && (
          <div className="ttp-detail-view">
            {spec.mandate && (
              <div className="ttp-detail-section">
                 <div className="ttp-detail-label">Role / Mandate</div>
                 <div className="ttp-detail-text" style={{ fontSize: '13px', lineHeight: 1.5, color: '#c9d1d9' }}>{str(spec.mandate)}</div>
              </div>
            )}
            {spec.why && (
              <div className="ttp-detail-section">
                 <div className="ttp-detail-label">Interaction / Why</div>
                 <div className="ttp-detail-text" style={{ fontSize: '13px', lineHeight: 1.5, color: '#c9d1d9' }}>{str(spec.why)}</div>
              </div>
            )}
            {spec.failure && (
              <div className="ttp-detail-section" style={{ borderLeft: '3px solid #f87171', paddingLeft: '8px', marginTop: '16px' }}>
                 <div className="ttp-detail-label" style={{ color: '#f87171', marginBottom: '4px' }}>Failure Mode</div>
                 <div className="ttp-detail-text" style={{ fontSize: '12px', color: '#8b949e', lineHeight: 1.4 }}>{str(spec.failure)}</div>
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

export default function TokenTopologyPanel({ isOpen, onClose }) {
  const { darkMode, setDarkMode } = useTheme();
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [expandedId, setExpandedId] = useState(null);
  const prevRunId = useRef(null);
  const [inspWidth, setInspWidth] = useState(320);
  const dragging = useRef(false);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = inspWidth;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setInspWidth(Math.max(200, Math.min(600, startW + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [inspWidth]);

  useEffect(() => {
    return tokenChainTraceStore.subscribe(setStoreState);
  }, []);

  const { trace, steps } = storeState;

  // Auto-clear selection when a new run starts
  useEffect(() => {
    if (trace.runId && trace.runId !== prevRunId.current) {
      prevRunId.current = trace.runId;
      setExpandedId(null);
    }
  }, [trace.runId]);

  const handleNodeClick = useCallback((nodeId) => {
    if (expandedId === nodeId) {
      setExpandedId(null);
    } else {
      setExpandedId(nodeId);
    }
  }, [expandedId]);

  const handleClear = useCallback(() => {
    tokenChainTraceStore.reset();
    setExpandedId(null);
  }, []);

  const routingMode = trace.routingMode || (trace.llmDetail ? 'llm' : trace.phases?.length ? 'heuristic' : null);
  const prompt = trace.prompt || null;
  const a2aTopology = buildA2aTopology(trace.tokenEvents);

  const hasActivity = Boolean(
    trace.startedAt || trace.prompt || trace.tokenEvents?.length || trace.phases?.length ||
    trace.mcpResult || trace.authorize || trace.llmDetail || trace.llmReply ||
    trace.outcome || trace.routingMode || a2aTopology,
  );
  const topologyNodes = hasActivity ? buildObservedTopology(steps) : [];
  const selectedStep = expandedId
    ? topologyNodes.find((node) => node.id === expandedId)?.step || null
    : null;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Topology"
      defaultWidth={960}
      defaultHeight={520}
      storageKey="ba-token-topology-panel"
      footer={null}
      noBackdrop
      zIndex={10001}
      minWidth={580}
      minHeight={360}
      className={`ttp-modal ttp-modal--${darkMode ? 'dark' : 'light'}`}
    >
      <div className="ttp-root" data-theme={darkMode ? 'dark' : 'light'}>
        {/* Toolbar */}
        <div className="ttp-toolbar">
          <div className="ttp-toolbar-left">
            {prompt && <><span className="ttp-ctx-lbl">Prompt</span><span className="ttp-ctx-prompt">{str(prompt)}</span></>}
            {routingMode && <span className="ttp-ctx-mode">{str(routingMode)}</span>}
          </div>
          <div className="ttp-toolbar-actions">
            <div className="ttp-theme-control" aria-label="Token topology color theme">
              <span className={!darkMode ? 'active' : ''}>Light</span>
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
              <span className={darkMode ? 'active' : ''}>Dark</span>
            </div>
            <button className="ttp-clear-btn" onClick={handleClear} title="Clear and restart">
              <span className="ttp-clear-icon">↺</span> Clear
            </button>
          </div>
        </div>

        {/* Main: topology + inspector side-by-side */}
        <div className={`ttp-body${selectedStep ? ' has-insp' : ''}`}>
          <div className="ttp-diagram">
            {hasActivity ? (
              <>
                <div className="ttp-label">Live delegated pipeline — nodes appear as evidence arrives</div>
                <div className="ttp-row">
                  {topologyNodes.map((node, i) => {
                    const { step } = node;
                    return (
                      <React.Fragment key={node.id}>
                        {i > 0 && (
                          <div className={`ttp-conn${step.status === 'error' ? ' blocked' : ''}`}>
                            <div className="ttp-line" />
                            <span className="ttp-arrowhead">▶</span>
                          </div>
                        )}
                        <NodeBox
                          node={node}
                          step={step}
                          selected={expandedId === node.id}
                          animateIn
                          onClick={() => handleNodeClick(node.id)}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="ttp-idle">
                <div>Run an agent flow to build the topology.</div>
                <div>Nodes will appear as each hop produces evidence.</div>
              </div>
            )}
            {a2aTopology && (
              <div className="ttp-a2a-topology">
                <div className="ttp-a2a-heading">
                  <strong>A2A: main agent calling specialist agent</strong>
                  <span>Identity and wire-protocol evidence are separate paths.</span>
                </div>
                <EvidenceFlow
                  label="Identity path — RFC 8693 token exchanges for MCP authorization"
                  nodes={a2aTopology.identity}
                />
                <EvidenceFlow
                  label="Wire path — Agent Card and JSON-RPC handoff"
                  nodes={a2aTopology.wire}
                />
              </div>
            )}
          </div>

          {selectedStep ? (
            <div className="ttp-insp-pane" style={{ width: inspWidth }}>
              <div className="ttp-resize-handle" onMouseDown={handleResizeStart} />
              <Inspector
                step={selectedStep}
                topologyNodes={topologyNodes}
                onClose={() => setExpandedId(null)}
              />
            </div>
          ) : hasActivity && (
            <div className="ttp-insp-pane" style={{ width: inspWidth }}>
              <div className="ttp-resize-handle" onMouseDown={handleResizeStart} />
              <div className="ttp-insp-empty">
                <div className="ttp-insp-empty-icon">🔑</div>
                <div className="ttp-insp-empty-text">Click a node to inspect its token details</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
