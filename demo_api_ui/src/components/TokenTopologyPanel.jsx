// TokenTopologyPanel.jsx
// Real-time security topology diagram — shows RFC 8693 delegation chain as
// nodes light up while the agent flow runs. Separate from Flow Detail.
import React, { useState, useEffect, useCallback } from 'react';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildRunStory } from '../services/tokenChainTrace/buildTraceSteps';
import './TokenTopologyPanel.css';

const NODES = [
  { id: 'signin',    icon: '🔐', name: 'PingOne AS',   lane: 'PINGONE',  connLabel: null },
  { id: 'exchange',  icon: '🔄', name: 'BFF Exchange', lane: 'BFF',      connLabel: 'user token' },
  { id: 'authorize', icon: '⚡', name: 'P1 Authorize', lane: 'AUTHZ',    connLabel: 'delegated token' },
  { id: 'gateway',   icon: '🛡', name: 'Gateway',      lane: 'GATEWAY',  connLabel: 'decision' },
  { id: 'mcp',       icon: '🔧', name: 'MCP Server',   lane: 'MCP',      connLabel: 'validated' },
];

function claimsFromStep(step) {
  if (!step?.detail) return null;
  const d = step.detail;
  if (d.claims && Object.keys(d.claims).length) {
    return Object.entries(d.claims).slice(0, 10).map(([k, v]) => ({
      k,
      v: typeof v === 'object' ? JSON.stringify(v) : String(v),
      cls: k === 'scope' ? 'hi' : k === 'act' || k === 'may_act' ? 'ok' : k === 'aud' ? 'aud' : '',
    }));
  }
  if (d.decision) {
    const dec = d.decision;
    const rows = [];
    if (dec.outcome) rows.push({ k: 'decision', v: String(dec.outcome).toUpperCase(), cls: dec.outcome === 'PERMIT' || dec.outcome === 'done' ? 'ok' : 'warn' });
    if (dec.decisionId) rows.push({ k: 'decision_id', v: dec.decisionId, cls: '' });
    if (dec.engine)     rows.push({ k: 'engine', v: dec.engine, cls: '' });
    if (dec.why)        rows.push({ k: 'reason', v: dec.why.slice(0, 80), cls: '' });
    return rows.length ? rows : null;
  }
  if (d.kv?.length) {
    return d.kv.slice(0, 10).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), cls: '',
    }));
  }
  return null;
}

function NodeBox({ node, step, expanded, blocked, onClick }) {
  const st = step?.status || (blocked ? 'notinpath' : 'pending');
  const isOk    = st === 'done';
  const isErr   = st === 'error';
  const isPend  = st === 'pending';
  const isSkip  = st === 'notinpath' || blocked;

  const statusMark = isOk ? '✓' : isErr ? '✕' : isPend ? '' : '—';
  const statusCls  = isOk ? 'ok' : isErr ? 'err' : isPend ? 'pend' : 'nd';

  return (
    <div
      className={`ttp-node${expanded ? ' expanded' : ''}${isErr ? ' error' : ''}${isSkip ? ' skip' : ''}`}
      onClick={isSkip ? undefined : onClick}
    >
      <div className={`ttp-box${expanded ? ' active' : ''}${isErr ? ' error' : ''}${isSkip ? ' skip' : ''}${isPend && !isSkip ? ' pulsing' : ''}`}>
        <div className={`ttp-status ${statusCls}`}>
          {isPend && !isSkip
            ? <span className="ttp-pulse-dot" />
            : statusMark}
        </div>
        <div className="ttp-icon">{node.icon}</div>
        <div className="ttp-name">{node.name}</div>
        <span className={`ttp-lane ttp-lane--${node.lane.toLowerCase()}`}>{node.lane}</span>
      </div>
      {expanded && step && <InlineClaimsCard step={step} />}
    </div>
  );
}

function InlineClaimsCard({ step }) {
  const claims = claimsFromStep(step);
  if (!claims?.length) return null;
  return (
    <div className="ttp-inline-claims">
      {claims.slice(0, 4).map(({ k, v, cls }) => (
        <div key={k} className="ttp-inline-row">
          <span className="ttp-ik">{k}</span>
          <span className={`ttp-iv${cls ? ' ' + cls : ''}`}>{String(v).slice(0, 26)}</span>
        </div>
      ))}
    </div>
  );
}

function Inspector({ step, onClose }) {
  const [tab, setTab] = useState('claims');
  useEffect(() => { setTab('claims'); }, [step?.id]);

  if (!step) {
    return (
      <div className="ttp-insp-empty">
        <div className="ttp-insp-empty-icon">🔑</div>
        <div className="ttp-insp-empty-text">Click a node to inspect its token / decision</div>
      </div>
    );
  }

  const claims   = claimsFromStep(step);
  const rfcs     = step.detail?.rfcs || step.rfcs || [];
  const narrative = step.detail?.narrative || '';
  const actClaim  = step.id === 'exchange' && step.detail?.claims?.act;

  return (
    <div className="ttp-insp">
      <div className="ttp-insp-header">
        <span className={`ttp-lane ttp-lane--${(step.lane || 'bff').toLowerCase()}`}>{step.lane}</span>
        <span className="ttp-insp-title">{step.title}</span>
        <button className="ttp-insp-close" onClick={onClose}>✕</button>
      </div>
      <div className="ttp-insp-tabs">
        {claims && (
          <button className={`ttp-itab${tab === 'claims' ? ' active' : ''}`} onClick={() => setTab('claims')}>Claims</button>
        )}
        <button className={`ttp-itab${tab === 'why' ? ' active' : ''}`} onClick={() => setTab('why')}>Why</button>
      </div>
      <div className="ttp-insp-body">
        {tab === 'claims' && claims && (
          <>
            <div className="ttp-claims-table">
              {claims.map(({ k, v, cls }) => (
                <div key={k} className="ttp-ct-row">
                  <span className="ttp-ct-k">{k}</span>
                  <span className={`ttp-ct-v${cls ? ' ' + cls : ''}`}>{v}</span>
                </div>
              ))}
            </div>
            {actClaim && (
              <div className="ttp-act-chip">✅ act · delegation chain intact — RFC 8693 §4.1</div>
            )}
            {rfcs.length > 0 && (
              <div className="ttp-rfc-row">
                {rfcs.map(r => <span key={r} className="ttp-rfc">{r}</span>)}
              </div>
            )}
          </>
        )}
        {tab === 'why' && (
          <div className="ttp-narrative">
            <div className="ttp-nar-title">{step.title}</div>
            {narrative || step.detail?.why || 'No narrative available.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TokenTopologyPanel({ isOpen, onClose }) {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [expandedId, setExpandedId] = useState(null);
  const [selectedStep, setSelectedStep] = useState(null);

  useEffect(() => {
    return tokenChainTraceStore.subscribe(setStoreState);
  }, []);

  const { trace, steps } = storeState;

  const handleNodeClick = useCallback((nodeId, step) => {
    if (expandedId === nodeId) {
      setExpandedId(null);
      setSelectedStep(null);
    } else {
      setExpandedId(nodeId);
      setSelectedStep(step || null);
    }
  }, [expandedId]);

  const routingMode = trace.routingMode || (trace.llmDetail ? 'llm' : trace.phases?.length ? 'heuristic' : null);
  const prompt = trace.prompt || null;
  const hasActivity = steps.some(s => s.status !== 'pending');

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Token Topology"
      defaultWidth={900}
      defaultHeight={440}
      storageKey="ba-token-topology-panel"
      footer={null}
      noBackdrop
      zIndex={10001}
      minWidth={520}
      minHeight={300}
    >
      <div className="ttp-root">
        {/* Context bar */}
        {(prompt || routingMode) && (
          <div className="ttp-ctx">
            {prompt && <><span className="ttp-ctx-lbl">Prompt</span><span className="ttp-ctx-prompt">{prompt}</span></>}
            {routingMode && <span className="ttp-ctx-mode">{routingMode}</span>}
          </div>
        )}

        {/* Main: topology + inspector side-by-side */}
        <div className={`ttp-body${selectedStep ? ' has-insp' : ''}`}>
          <div className="ttp-diagram">
            {!hasActivity && (
              <div className="ttp-idle">Waiting for agent run — nodes will light up in real time</div>
            )}
            <div className="ttp-label">Security topology · RFC 8693 delegation chain — click a node to inspect</div>
            <div className="ttp-row">
              {NODES.map((node, i) => {
                const step = steps.find(s => s.id === node.id);
                // a node is blocked if any prior node errored
                const priorError = i > 0 && steps.slice(0, i).some(s => {
                  const prior = NODES[i - 1];
                  return steps.find(ps => ps.id === prior?.id)?.status === 'error';
                });
                const blocked = priorError || (!step && steps.find(s => s.id === NODES[i - 1]?.id)?.status === 'error');

                return (
                  <React.Fragment key={node.id}>
                    {i > 0 && (
                      <div className={`ttp-conn${step?.status === 'error' || blocked ? ' blocked' : ''}`}>
                        <div className="ttp-line" />
                        <span className="ttp-arrowhead">▶</span>
                        {node.connLabel && <div className="ttp-conn-label">{node.connLabel}</div>}
                      </div>
                    )}
                    <NodeBox
                      node={node}
                      step={step}
                      expanded={expandedId === node.id}
                      blocked={!!blocked}
                      onClick={() => handleNodeClick(node.id, step)}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {selectedStep && (
            <div className="ttp-insp-pane">
              <Inspector step={selectedStep} onClose={() => { setSelectedStep(null); setExpandedId(null); }} />
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
