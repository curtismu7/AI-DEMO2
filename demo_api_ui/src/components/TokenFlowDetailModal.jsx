import React, { useState, useEffect, useCallback, useRef } from 'react';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildRunStory } from '../services/tokenChainTrace/buildTraceSteps';
import './TokenFlowDetailModal.css';

// ── Helpers ────────────────────────────────────────────────────────────────

const IC = { done: '✓', error: '✕', pending: '·', notinpath: '—', wait: '!' };
const IC_CLS = { done: 'done', error: 'error', pending: 'pending', notinpath: 'skip', wait: 'wait' };

function badgeCls(lane) {
  return `tfd-step-badge tfd-badge-${lane || 'BFF'}`;
}

function inspBadgeCls(lane) {
  return `tfd-insp-lane tfd-badge-${lane || 'BFF'}`;
}

// Extract a concise technical subtitle from step detail
function stepSub(step) {
  if (!step.detail) return null;
  const d = step.detail;
  if (step.id === 'exchange') {
    const aud = d.claims?.aud || d.claims?.audience;
    const scope = d.claims?.scope;
    if (aud || scope) return [aud && `aud: ${aud}`, scope && `scope: ${scope}`].filter(Boolean).join(' · ');
  }
  if (step.id === 'authorize') {
    const dec = d.decision?.outcome || d.outcome || d.decision;
    if (dec) return String(dec).toUpperCase();
  }
  if (step.id === 'exchange' && d.why) return d.why.slice(0, 60);
  return null;
}

// Build a terse claims list from step detail for the inspector
function buildClaims(step) {
  const d = step.detail || {};
  // Token exchange step: show token claims
  if (step.id === 'exchange' && d.claims) {
    return Object.entries(d.claims).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v),
      cls: k === 'scope' ? 'hi' : k === 'act' || k === 'may_act' ? 'ok' : k === 'aud' ? 'aud' : '',
    }));
  }
  // Authorize: show decision attributes
  if ((step.id === 'authorize' || step.id === 'authorize2') && d.decision) {
    const dec = d.decision;
    const rows = [];
    if (dec.outcome) rows.push({ k: 'decision', v: String(dec.outcome).toUpperCase(), cls: dec.outcome === 'PERMIT' || dec.outcome === 'done' ? 'ok' : 'warn' });
    if (dec.decisionId) rows.push({ k: 'decision_id', v: dec.decisionId });
    if (dec.engine) rows.push({ k: 'engine', v: dec.engine });
    if (dec.decisionContext) rows.push({ k: 'context', v: dec.decisionContext });
    if (dec.why) rows.push({ k: 'reason', v: dec.why });
    return rows;
  }
  // Sign-in: show user token claims
  if (step.id === 'signin' && d.claims) {
    return Object.entries(d.claims).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), cls: '',
    }));
  }
  // Any step with a claims object
  if (d.claims && Object.keys(d.claims).length) {
    return Object.entries(d.claims).map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v),
      cls: k === 'scope' ? 'hi' : k === 'act' || k === 'may_act' ? 'ok' : k === 'aud' ? 'aud' : '',
    }));
  }
  // Any step with kv pairs (gateway, mcp, etc.)
  if (d.kv?.length) {
    return d.kv.map(([k, v]) => ({
      k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), cls: '',
    }));
  }
  // Gateway: synthesize from trace event detail
  if (d.tokenId || d.tool || d.result) {
    const rows = [];
    if (d.tokenId) rows.push({ k: 'token_id', v: d.tokenId, cls: '' });
    if (d.tool)    rows.push({ k: 'tool', v: String(d.tool), cls: '' });
    if (d.result)  rows.push({ k: 'result', v: String(d.result).slice(0, 60), cls: '' });
    if (rows.length) return rows;
  }
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StepRow({ step, num, selected, onClick }) {
  const skip = step.status === 'notinpath';
  const halted = step.status === 'error' && step.detail?.isHalt;
  const ic = IC[step.status] || '·';
  const icCls = IC_CLS[step.status] || 'pending';
  const sub = stepSub(step);

  return (
    <div
      className={`tfd-step${selected ? ' selected' : ''}${halted ? ' halted' : ''}${skip ? ' notinpath' : ''}`}
      onClick={skip ? undefined : onClick}
    >
      <span className={`tfd-step-ic ${icCls}`}>{ic}</span>
      <span className="tfd-step-num">{num}.</span>
      <span className="tfd-step-title">
        {step.title}
        {sub && <span className="tfd-step-sub"> · {sub}</span>}
      </span>
      {skip
        ? <span className="tfd-notinpath-tag">Not in path</span>
        : <span className={badgeCls(step.lane)}>{step.lane}</span>
      }
      {!skip && <span className="tfd-arrow">▶</span>}
    </div>
  );
}

function DetailCard({ step, num, selected, onClick }) {
  const skip = step.status === 'notinpath';
  const ic = IC[step.status] || '·';
  const icCls = IC_CLS[step.status] || 'pending';
  const rfcs = step.detail?.rfcs || step.rfcs || [];
  const narrative = step.detail?.narrative || '';

  return (
    <div
      className={`tfd-card ${step.status}${selected ? ' selected' : ''}`}
      onClick={skip ? undefined : onClick}
    >
      <div className="tfd-card-head">
        <span className={`tfd-card-ic ${icCls}`}>{ic}</span>
        <div className="tfd-card-info">
          <div className="tfd-card-top">
            <span className="tfd-card-num">{num}.</span>
            <span className={`tfd-card-title${skip ? ' striked' : ''}`}>{step.title}</span>
            <span className={badgeCls(step.lane)}>{step.lane}</span>
          </div>
          {step.detail?.why && (
            <div className="tfd-card-sub">{step.detail.why.slice(0, 80)}</div>
          )}
          {rfcs.length > 0 && (
            <div className="tfd-card-tags">
              {rfcs.map(r => <span key={r} className="tfd-rfc-pill">{r}</span>)}
            </div>
          )}
        </div>
        {!skip && (
          <button className="tfd-card-inspect" onClick={onClick}>→ inspect</button>
        )}
      </div>
      {narrative && !skip && (
        <div className="tfd-card-narrative">{narrative}</div>
      )}
    </div>
  );
}

function Inspector({ step, onClose }) {
  const [tab, setTab] = useState('claims');

  useEffect(() => { setTab('claims'); }, [step?.id]);

  if (!step) {
    return (
      <div className="tfd-insp-empty">
        <div className="tfd-insp-empty-icon">🔑</div>
        <div>Click a step to inspect its token</div>
      </div>
    );
  }

  const claims = buildClaims(step);
  const rfcs = step.detail?.rfcs || step.rfcs || [];
  const spec = step.detail?.spec;
  const actClaim = step.id === 'exchange' && step.detail?.claims?.act;

  return (
    <>
      <div className="tfd-insp-header">
        <span className={inspBadgeCls(step.lane)}>{step.lane}</span>
        <span className="tfd-insp-title">{step.title}</span>
        <button className="tfd-insp-close" onClick={onClose} title="Close inspector">✕</button>
      </div>
      <div className="tfd-insp-tabs">
        {claims && <button className={`tfd-insp-tab${tab==='claims'?' active':''}`} onClick={() => setTab('claims')}>Claims</button>}
        <button className={`tfd-insp-tab${tab==='narrative'?' active':''}`} onClick={() => setTab('narrative')}>Why</button>
        {spec && <button className={`tfd-insp-tab${tab==='spec'?' active':''}`} onClick={() => setTab('spec')}>RFC</button>}
        {step.detail && <button className={`tfd-insp-tab${tab==='raw'?' active':''}`} onClick={() => setTab('raw')}>Raw</button>}
      </div>
      <div className="tfd-insp-body">
        {tab === 'claims' && claims && (
          <>
            <div className="tfd-insp-section">Token / Decision Claims</div>
            <div className="tfd-claims-table">
              {claims.map(({ k, v, cls }) => (
                <div key={k} className="tfd-ct-row">
                  <span className="tfd-ct-k">{k}</span>
                  <span className={`tfd-ct-v${cls ? ' '+cls : ''}`}>{v}</span>
                </div>
              ))}
            </div>
            {actClaim && (
              <div className="tfd-act-chip">
                ✅ act · delegation chain intact — RFC 8693 §4.1
              </div>
            )}
            {rfcs.length > 0 && (
              <div className="tfd-rfc-tags">
                {rfcs.map(r => <span key={r} className="tfd-rfc-pill">{r}</span>)}
              </div>
            )}
          </>
        )}

        {tab === 'narrative' && (
          <>
            <div className="tfd-insp-section">What happens on this hop</div>
            <div className="tfd-edu-box">
              <div className="tfd-edu-title">{step.title}</div>
              {step.detail?.narrative || 'No narrative available for this step.'}
            </div>
            {step.detail?.why && (
              <div className="tfd-edu-box" style={{ marginTop: 0 }}>
                <div className="tfd-edu-title">Why this run</div>
                {step.detail.why}
              </div>
            )}
          </>
        )}

        {tab === 'spec' && spec && (
          <>
            <div className="tfd-insp-section">Specification</div>
            {spec.refs?.length > 0 && (
              <div className="tfd-rfc-tags">
                {spec.refs.map(r => (
                  <a key={r.label} href={r.href} target="_blank" rel="noreferrer"
                    className="tfd-rfc-pill" style={{ textDecoration: 'none' }}
                    title={r.title}
                  >{r.label}</a>
                ))}
              </div>
            )}
            {spec.mandate && (
              <div className="tfd-edu-box">
                <div className="tfd-edu-title">Mandate</div>
                {spec.mandate}
              </div>
            )}
            {spec.why && (
              <div className="tfd-edu-box">
                <div className="tfd-edu-title">Why this demo</div>
                {spec.why}
              </div>
            )}
            {spec.failure && (
              <div className="tfd-edu-box" style={{ borderColor: 'rgba(248,81,73,.2)', background: 'rgba(248,81,73,.06)' }}>
                <div className="tfd-edu-title" style={{ color: '#fca5a5' }}>Common failure</div>
                {spec.failure}
              </div>
            )}
          </>
        )}

        {tab === 'raw' && step.detail && (
          <>
            <div className="tfd-insp-section">Raw Step Detail</div>
            <pre className="tfd-json-pre">{JSON.stringify(step.detail, null, 2)}</pre>
          </>
        )}
      </div>
    </>
  );
}

// ── Scope Funnel ──────────────────────────────────────────────────────────

function ScopeFunnel({ steps, trace }) {
  const findEv = (...ids) => (trace?.tokenEvents || []).find(e => e && ids.includes(e.id));
  const userTok  = findEv('user-token');
  const delegTok = findEv('exchanged-token', 'two-ex-final-token');
  const exchStep  = steps.find(s => s.id === 'exchange');
  const azSteps   = steps.filter(s => s.id === 'authorize');

  if (!exchStep && !userTok) return null;

  const userScopes  = userTok?.claims?.scope ? String(userTok.claims.scope).split(/\s+/) : ['openid', 'accounts.read'];
  const delegScopes = delegTok?.claims?.scope ? String(delegTok.claims.scope).split(/\s+/) : exchStep ? ['gateway:mcp:invoke'] : [];
  const actClaim    = delegTok?.claims?.act?.sub ?? delegTok?.claims?.act;
  const exchAud     = delegTok?.claims?.aud || exchStep?.detail?.claims?.aud || 'mcp-server';

  const azDeny = azSteps.find(s => {
    const dec = s.detail?.decision?.outcome;
    return dec === 'DENY' || dec === 'INDETERMINATE' || s.status === 'error';
  });
  const azPermit = azSteps.find(s => {
    const dec = s.detail?.decision?.outcome;
    return dec === 'PERMIT' || dec === 'done';
  });

  return (
    <div className="tfd-funnel">
      <div className="tfd-funnel-label">Scope · narrowing per RFC 8707 + RFC 8693</div>
      <div className="tfd-funnel-row">

        {/* User Token */}
        <div className="tfd-fhop">
          <div className="tfd-fhop-head">
            <span className="tfd-fhop-icon">👤</span>
            <span className="tfd-fhop-name">User Token</span>
            <span className="tfd-fhop-sub">PKCE · RS256</span>
          </div>
          <div className="tfd-fscopes">
            {userScopes.map(s => (
              <span key={s} className="tfd-fscope tfd-fscope--kept">✓ {s}</span>
            ))}
          </div>
        </div>

        <span className="tfd-farrow">→</span>

        {/* RFC 8693 Exchange */}
        <div className="tfd-fhop tfd-fhop--exchange">
          <div className="tfd-fhop-head">
            <span className="tfd-fhop-icon">TX</span>
            <span className="tfd-fhop-name">RFC 8693 Exchange</span>
            {actClaim && <span className="tfd-fhop-sub">act: {String(actClaim).slice(0, 20)}</span>}
          </div>
          <div className="tfd-fscopes">
            <span className="tfd-fscope tfd-fscope--narrowed">→ {delegScopes[0] || 'gateway:mcp:invoke'}</span>
            {exchAud && <span className="tfd-fscope tfd-fscope--narrowed">→ aud: {String(exchAud).replace('https://', '')}</span>}
          </div>
        </div>

        <span className="tfd-farrow">→</span>

        {/* Delegated Token */}
        <div className="tfd-fhop tfd-fhop--issued">
          <div className="tfd-fhop-head">
            <span className="tfd-fhop-icon">🔑</span>
            <span className="tfd-fhop-name">Delegated Token</span>
            <span className="tfd-fhop-sub">issued · narrowed</span>
          </div>
          <div className="tfd-fscopes">
            {delegScopes.map(s => <span key={s} className="tfd-fscope tfd-fscope--kept">✓ {s}</span>)}
            {userScopes.filter(s => !delegScopes.includes(s)).slice(0, 3).map(s => (
              <span key={s} className="tfd-fscope tfd-fscope--dropped">❌ {s}</span>
            ))}
          </div>
        </div>

        {(azPermit || azDeny) && <span className="tfd-farrow">→</span>}

        {/* Authorize */}
        {(azPermit || azDeny) && (
          <div className={`tfd-fhop${azDeny ? ' tfd-fhop--deny' : ' tfd-fhop--permit'}`}>
            <div className="tfd-fhop-head">
              <span className="tfd-fhop-icon">{azDeny ? '❌' : '✅'}</span>
              <span className="tfd-fhop-name">PingOne Authorize</span>
              <span className="tfd-fhop-sub" style={{ color: azDeny ? 'var(--tfd-danger, #f85149)' : 'var(--tfd-success, #3fb950)' }}>
                {azDeny ? 'DENY' : 'PERMIT'}
              </span>
            </div>
            {azDeny && (
              <div className="tfd-fscopes">
                <span className="tfd-fscope tfd-fscope--blocked">✕ {azDeny.detail?.decision?.decisionContext || 'action blocked'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {actClaim && (
        <div className="tfd-act-callout">
          ✅ <strong>act</strong> · {String(actClaim)} acts FOR user — RFC 8693 §4.1
          <span className="tfd-rfc-pill" style={{ marginLeft: 'auto' }}>RFC 8693</span>
          <span className="tfd-rfc-pill">RFC 8707</span>
        </div>
      )}
    </div>
  );
}

// ── Topology View ──────────────────────────────────────────────────────────

/**
 * The topology row is FIVE CURATED SLOTS, not the whole trace — the compactness
 * is the point of this view. But which hop fills a slot depends on what actually
 * ran, so slots are defined by ROLE and filled from the run.
 *
 * The previous version hardcoded five step ids. That silently omitted
 * `exchange-1` (two-exchange mode), `api-key-swap` (API-key path), `stepup` and
 * `intent-binding`, and once ID-JAG replaced the RFC 8693 exchange it drew a
 * permanently greyed "BFF Exchange" with no sign of the hop that actually minted
 * the token. Every new flow shape needed another special case; this needs none.
 *
 * `candidates` is preference order among hops that RAN. `fallback` is what the
 * slot shows when none did, so an unstarted run renders exactly as it always has.
 */
const TOPO_SLOTS = [
  { fallback: 'signin',    candidates: ['signin'] },
  { fallback: 'exchange',  candidates: ['id-jag-redeemed', 'exchange', 'exchange-1', 'agent-token'] },
  { fallback: 'authorize', candidates: ['stepup', 'intent-binding', 'authorize'] },
  { fallback: 'gateway',   candidates: ['api-key-swap', 'gateway'] },
  { fallback: 'mcp',       candidates: ['mcp', 'api'] },
];

/** Display vocabulary per hop. `label` is the connector caption feeding INTO it. */
const NODE_PRESENTATION = {
  signin:            { icon: '\u{1F510}', name: 'PingOne AS',       lane: 'PINGONE' },
  'agent-token':     { icon: 'AT', name: 'Agent Identity',   lane: 'BFF',     label: 'client credentials' },
  'exchange-1':      { icon: 'X1', name: 'BFF Narrowing',    lane: 'BFF',     label: 'narrowed token' },
  exchange:          { icon: 'TX', name: 'BFF Exchange',     lane: 'BFF',     label: 'delegated token' },
  'id-jag-redeemed': { icon: 'JR', name: 'MCP AS — ID-JAG',  lane: 'MCP',     label: 'redeemed grant' },
  authorize:         { icon: 'AZ', name: 'P1 Authorize',     lane: 'AUTHZ',   label: 'decision' },
  'intent-binding':  { icon: 'IB', name: 'Intent Binding',   lane: 'AUTHZ',   label: 'cap checked' },
  stepup:            { icon: '\u26A0\uFE0F', name: 'Step-up required', lane: 'AUTHZ', label: 'human approval' },
  gateway:           { icon: 'GW', name: 'Gateway',          lane: 'GATEWAY', label: 'validated' },
  'api-key-swap':    { icon: 'KS', name: 'Credential Swap',  lane: 'GATEWAY', label: 'API key' },
  mcp:               { icon: 'M',  name: 'MCP Server',       lane: 'MCP',     label: 'tool call' },
  api:               { icon: 'RS', name: 'Resource Server',  lane: 'API',     label: 'backend' },
};

const RAN_STATUSES = ['active', 'done', 'error'];

function presentNode(id) {
  const p = NODE_PRESENTATION[id] || { icon: '?', name: id, lane: 'FLOW' };
  return { id, ...p, badgeCls: `tfd-badge-${p.lane}` };
}

/**
 * Resolve the five topology nodes for this run.
 * @param {Array} steps from buildTraceSteps
 * @returns {Array} one node per slot, in flow order
 */
export function resolveTopoNodes(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const ran = (id) => list.some((s) => s && s.id === id && RAN_STATUSES.includes(s.status));
  return TOPO_SLOTS.map(({ fallback, candidates }) =>
    presentNode(candidates.find(ran) || fallback));
}

function TopoNodeClaims({ step, trace }) {
  const findEv = (...ids) => (trace?.tokenEvents || []).find(e => e && ids.includes(e.id));
  if (!step) return null;
  const claims = buildClaims(step);
  if (!claims?.length) {
    // fallback: show narrative snippet
    const nar = step.detail?.narrative;
    if (!nar) return null;
    return <div style={{ fontSize: 10, color: 'var(--text-muted, #8b949e)', fontStyle: 'italic', marginTop: 4, lineHeight: 1.4 }}>{nar.slice(0, 80)}…</div>;
  }
  return (
    <div className="tfd-topo-claims">
      {claims.slice(0, 4).map(({ k, v, cls }) => (
        <div key={k} className="tfd-topo-claim">
          <span className="tfd-topo-ck">{k}</span>
          <span className={`tfd-topo-cv${cls ? ' ' + cls : ''}`}>{String(v).slice(0, 24)}</span>
        </div>
      ))}
    </div>
  );
}

function TopologyView({ steps, trace, onSelectStep }) {
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (nodeId, step) => {
    if (expandedId === nodeId) {
      setExpandedId(null);
    } else {
      setExpandedId(nodeId);
      if (step && onSelectStep) onSelectStep(step);
    }
  };

  // Which hop fills each slot depends on what ran, so resolve once per render.
  const topoNodes = resolveTopoNodes(steps);

  return (
    <div className="tfd-topo">
      <div className="tfd-topo-label">Security topology — click a node to inspect · RFC 8693 delegation chain</div>
      <div className="tfd-topo-row">
        {topoNodes.map((node, i) => {
          const step = steps.find(s => s.id === node.id);
          const status = step?.status || 'notinpath';
          const blocked = status === 'notinpath' || (i > 0 && steps.find(s => s.id === topoNodes[i-1]?.id)?.status === 'error');
          const isError = status === 'error';
          const isDone  = status === 'done';
          const expanded = expandedId === node.id;

          return (
            <React.Fragment key={node.id}>
              {i > 0 && (
                <div className={`tfd-topo-conn${blocked ? ' tfd-topo-conn--blocked' : ''}`}>
                  <div className="tfd-topo-line"></div>
                  <span className="tfd-topo-arrowhead">▶</span>
                  {node.label && <div className="tfd-topo-conn-label">{node.label}</div>}
                </div>
              )}
              <div
                className={`tfd-topo-node${expanded ? ' expanded' : ''}${isError ? ' error' : ''}${blocked ? ' pending' : ''}`}
                onClick={() => !blocked && toggle(node.id, step)}
              >
                <div className={`tfd-topo-box${expanded ? ' active' : ''}${isError ? ' error' : ''}${blocked ? ' pending' : ''}`}>
                  <div className="tfd-topo-status">
                    {isDone ? <span style={{ color: 'var(--tfd-success, #3fb950)' }}>✓</span>
                      : isError ? <span style={{ color: 'var(--tfd-danger, #f85149)', fontWeight: 700 }}>✕</span>
                      : <span style={{ color: 'var(--text-muted, #6e7681)' }}>—</span>}
                  </div>
                  <div className="tfd-topo-icon">{node.icon}</div>
                  <div className="tfd-topo-name">{node.name}</div>
                  <span className={`tfd-step-badge ${node.badgeCls}`}>{node.lane}</span>
                </div>
                {expanded && step && (
                  <TopoNodeClaims step={step} trace={trace} />
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function collectTokenData(steps, trace) {
  const findEv = (...ids) => (trace?.tokenEvents || []).find(e => e && ids.includes(e.id));
  const userTok = findEv('user-token');
  const delegTok = findEv('exchanged-token', 'two-ex-final-token');
  const exchStep = steps.find(s => s.id === 'exchange');
  const azStep = steps.find(s => s.id === 'authorize');
  const gwStep = steps.find(s => s.id === 'gateway');

  const userScopes = userTok?.claims?.scope
    ? String(userTok.claims.scope).split(/\s+/).filter(Boolean)
    : [];
  const delegatedScopes = delegTok?.claims?.scope
    ? String(delegTok.claims.scope).split(/\s+/).filter(Boolean)
    : exchStep?.detail?.claims?.scope
      ? String(exchStep.detail.claims.scope).split(/\s+/).filter(Boolean)
      : [];

  const delegatedAud = delegTok?.claims?.aud
    || exchStep?.detail?.claims?.aud
    || exchStep?.detail?.claims?.audience
    || '';
  const actClaim = delegTok?.claims?.act?.sub
    || delegTok?.claims?.act
    || exchStep?.detail?.claims?.act?.sub
    || exchStep?.detail?.claims?.act
    || '';

  const decision = azStep?.detail?.decision?.outcome || azStep?.detail?.outcome || '';
  const decisionReason = azStep?.detail?.decision?.why || azStep?.detail?.why || '';

  return {
    userScopes,
    delegatedScopes,
    delegatedAud,
    actClaim,
    decision,
    decisionReason,
    azStep,
    gwStep,
  };
}

function securityGuards(steps, trace) {
  const d = collectTokenData(steps, trace);
  const loweredAud = String(d.delegatedAud || '').toLowerCase();
  const audLooksGateway = loweredAud.includes('mcp') || loweredAud.includes('gateway');
  const leastPrivilege = d.userScopes.length > 0 && d.delegatedScopes.length > 0
    ? d.delegatedScopes.length <= d.userScopes.length
    : d.delegatedScopes.length > 0;
  const decisionKnown = d.decision === 'PERMIT' || d.decision === 'DENY' || d.decision === 'INDETERMINATE';
  const gatewayKnown = d.gwStep?.status === 'done' || d.gwStep?.status === 'error';

  return [
    {
      id: 'aud',
      title: 'Audience Bound',
      ok: !!d.delegatedAud && audLooksGateway,
      detail: d.delegatedAud ? `aud=${d.delegatedAud}` : 'Delegated audience not captured yet',
    },
    {
      id: 'scope',
      title: 'Least Privilege Scopes',
      ok: leastPrivilege,
      detail: d.delegatedScopes.length
        ? `scopes=${d.delegatedScopes.join(' ')}`
        : 'Delegated scopes not captured yet',
    },
    {
      id: 'act',
      title: 'Delegation Provenance',
      ok: !!d.actClaim,
      detail: d.actClaim ? `act=${String(d.actClaim)}` : 'No act claim captured',
    },
    {
      id: 'authz',
      title: 'Policy Decision',
      ok: d.decision === 'PERMIT',
      detail: decisionKnown ? `decision=${d.decision}` : 'Authorize decision pending',
    },
    {
      id: 'gw',
      title: 'Gateway Enforcement',
      ok: d.gwStep?.status === 'done',
      detail: gatewayKnown ? `gateway=${d.gwStep.status}` : 'Gateway step pending',
    },
  ];
}

function deriveCrossAppContext(steps, trace) {
  const eventWithVertical = (trace?.tokenEvents || []).find(e => e && e.vertical);
  const verticalRaw = eventWithVertical?.vertical || trace?.vertical || '';
  const verticalKey = String(verticalRaw || '').trim().toLowerCase();

  const verticalLabelMap = {
    banking: 'banking',
    healthcare: 'healthcare',
    retail: 'retail',
    manufacturing: 'manufacturing',
    university: 'university',
    government: 'government',
    investment: 'investment',
  };
  const verticalLabel = verticalLabelMap[verticalKey] || (verticalKey ? `${verticalKey} domain` : 'this domain');

  const mcpTool = trace?.mcpResult?.tool || trace?.mcpResult?.toolName || '';
  const routeTool = trace?.routingDetail?.action || '';
  const stepTool = steps.find(s => s.id === 'gateway')?.detail?.tool || '';
  const toolName = String(mcpTool || routeTool || stepTool || '').trim();
  const actionLabel = toolName ? toolName.replace(/_/g, ' ') : 'requested action';

  return { verticalLabel, actionLabel, hasVertical: Boolean(verticalKey), hasTool: Boolean(toolName) };
}

function CrossAppView({ steps, trace, onSelectStep }) {
  const d = collectTokenData(steps, trace);
  const guards = securityGuards(steps, trace);
  const ctx = deriveCrossAppContext(steps, trace);

  const hops = [
    {
      id: 'signin',
      title: 'User Sign-in',
      check: 'Identity verified by PingOne and token kept server-side by the BFF.',
      proof: d.userScopes.length ? `user scopes: ${d.userScopes.join(' ')}` : 'Waiting for user token scopes',
    },
    {
      id: 'exchange',
      title: 'Delegated Token Exchange',
      check: `A delegated token is minted for ${ctx.actionLabel} instead of reusing the full user token.`,
      proof: d.delegatedAud
        ? `delegated audience: ${d.delegatedAud}`
        : 'Waiting for delegated audience',
    },
    {
      id: 'authorize',
      title: 'Policy Decision',
      check: 'Policy evaluates user, actor, tool, scope, and risk before tool execution.',
      proof: d.decision ? `decision: ${d.decision}` : 'Waiting for Authorize decision',
    },
    {
      id: 'gateway',
      title: 'Gateway Scope Enforcement',
      check: 'Gateway blocks calls with wrong audience or insufficient scope.',
      proof: d.gwStep?.status ? `gateway status: ${d.gwStep.status}` : 'Waiting for gateway status',
    },
    {
      id: 'mcp',
      title: 'Tool Execution',
      check: `Only the ${ctx.hasTool ? ctx.actionLabel : 'requested tool'} call executes with the narrowed delegated token.`,
      proof: d.delegatedScopes.length
        ? `allowed scopes: ${d.delegatedScopes.join(' ')}`
        : 'No delegated scopes captured yet',
    },
  ];

  const checked = guards.filter(g => g.ok).length;
  const denied = d.decision === 'DENY' || d.decision === 'INDETERMINATE';
  const removedScopes = d.userScopes.filter(s => !d.delegatedScopes.includes(s));

  return (
    <div className="tfd-crossapp">
      <div className={`tfd-x-blast${denied ? ' deny' : ''}`}>
        <div className="tfd-x-blast-title">Cross-App Protection Envelope</div>
        <div className="tfd-x-blast-copy">
          {`This ${ctx.verticalLabel} run is restricted to the delegated audience and least-privilege scopes for ${ctx.actionLabel}.`}
        </div>
        <div className="tfd-x-blast-rows">
          <div className="tfd-x-blast-row">
            <span>Allowed in this run</span>
            <strong>{d.delegatedScopes.length ? d.delegatedScopes.join(' ') : 'pending'}</strong>
          </div>
          <div className="tfd-x-blast-row">
            <span>Blocked outside scope</span>
            <strong>{removedScopes.length ? removedScopes.slice(0, 5).join(' ') : 'none observed'}</strong>
          </div>
        </div>
      </div>

      <div className="tfd-x-guards">
        {guards.map((g) => (
          <div key={g.id} className={`tfd-x-guard${g.ok ? ' ok' : ''}`}>
            <div className="tfd-x-guard-title">{g.ok ? '✓' : '✕'} {g.title}</div>
            <div className="tfd-x-guard-detail">{g.detail}</div>
          </div>
        ))}
      </div>

      <div className="tfd-x-hops">
        {hops.map((hop, idx) => {
          const step = steps.find(s => s.id === hop.id);
          const status = step?.status || 'pending';
          return (
            <button
              key={hop.id}
              type="button"
              className={`tfd-x-hop ${status}`}
              onClick={() => step && onSelectStep(step)}
              disabled={!step}
            >
              <div className="tfd-x-hop-top">
                <span className="tfd-x-hop-num">{idx + 1}</span>
                <span className="tfd-x-hop-title">{hop.title}</span>
                <span className="tfd-x-hop-status">{status}</span>
              </div>
              <div className="tfd-x-hop-check">{hop.check}</div>
              <div className="tfd-x-hop-proof">Proof: {hop.proof}</div>
              {hop.id === 'authorize' && d.decisionReason && (
                <div className="tfd-x-hop-proof">Reason: {String(d.decisionReason).slice(0, 90)}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className={`tfd-x-receipt${denied ? ' deny' : ''}`}>
        <div className="tfd-x-receipt-title">Trust Receipt</div>
        <div className="tfd-x-receipt-row"><span>Checks passed</span><strong>{checked}/{guards.length}</strong></div>
        <div className="tfd-x-receipt-row"><span>Decision</span><strong>{d.decision || 'pending'}</strong></div>
        <div className="tfd-x-receipt-row"><span>Audience</span><strong>{d.delegatedAud || 'pending'}</strong></div>
      </div>
    </div>
  );
}

function LeastAgencyView({ steps, trace, onSelectStep }) {
  const d = collectTokenData(steps, trace);
  const guards = securityGuards(steps, trace);
  const removedScopes = d.userScopes.filter(s => !d.delegatedScopes.includes(s));
  const decisionText = d.decision || 'pending';

  const focusRows = [
    { id: 'scope-drop', label: 'Scopes Removed', value: removedScopes.length ? removedScopes.join(' ') : 'none captured' },
    { id: 'scope-allow', label: 'Scopes Allowed', value: d.delegatedScopes.length ? d.delegatedScopes.join(' ') : 'pending' },
    { id: 'aud', label: 'Audience Bound', value: d.delegatedAud || 'pending' },
    { id: 'act', label: 'Actor Proof', value: d.actClaim || 'pending' },
    { id: 'decision', label: 'Policy Decision', value: decisionText },
  ];

  return (
    <div className="tfd-least">
      <div className="tfd-least-head">
        <div className="tfd-least-title">Least Agency Controls</div>
        <div className="tfd-least-sub">Only the minimum audience and scopes flow to the tool call path.</div>
      </div>

      <div className="tfd-least-grid">
        {focusRows.map((row) => (
          <div key={row.id} className="tfd-least-card">
            <div className="tfd-least-label">{row.label}</div>
            <div className="tfd-least-value">{row.value}</div>
          </div>
        ))}
      </div>

      <div className="tfd-least-guards">
        {guards.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`tfd-least-guard${g.ok ? ' ok' : ''}`}
            onClick={() => {
              if (g.id === 'authz') {
                const step = steps.find((s) => s.id === 'authorize');
                if (step) onSelectStep(step);
              }
              if (g.id === 'gw') {
                const step = steps.find((s) => s.id === 'gateway');
                if (step) onSelectStep(step);
              }
              if (g.id === 'act' || g.id === 'scope' || g.id === 'aud') {
                const step = steps.find((s) => s.id === 'exchange');
                if (step) onSelectStep(step);
              }
            }}
          >
            <span className="tfd-least-guard-title">{g.ok ? '✓' : '⚠️'} {g.title}</span>
            <span className="tfd-least-guard-detail">{g.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function TokenFlowDetailModal({ isOpen, onClose }) {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [view, setView] = useState('simple');
  const [selectedStep, setSelectedStep] = useState(null);
  const [inspOpen, setInspOpen] = useState(false);
  const [inspWidth, setInspWidth] = useState(420);
  const [footerOpen, setFooterOpen] = useState(null);
  const [darkMode, setDarkMode] = useState(true);
  const dragging = useRef(false);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = inspWidth;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setInspWidth(Math.max(300, Math.min(760, startW + delta)));
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
  const story = buildRunStory(trace, steps);

  const selectStep = useCallback((step) => {
    setSelectedStep(step);
    setInspOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspOpen(false);
    setSelectedStep(null);
  }, []);

  const doneCount = steps.filter(s => s.status === 'done').length;
  const errorCount = steps.filter(s => s.status === 'error').length;

  const bannerClass = story
    ? (story.outcome === 'error' ? 'error' : story.outcome === 'ok' ? 'ok' : 'pending')
    : 'pending';

  const bannerIcon = bannerClass === 'error' ? '✕' : bannerClass === 'ok' ? '✓' : '·';

  const routingMode = trace.routingMode || (trace.llmDetail ? 'llm' : trace.phases?.length ? 'heuristic' : null);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Flow Detail"
      defaultWidth={860}
      defaultHeight={680}
      storageKey="ba-flow-detail-modal"
      singletonKey="ba-flow-detail-modal"
      footer={null}
      noBackdrop
      zIndex={10000}
      minWidth={480}
      className="tfd-slide-panel"
      minHeight={360}
    >
      <div className={`tfd-root${darkMode ? '' : ' tfd-light'}`}>

        {/* View tabs */}
        <div className="tfd-tabs">
          <button
            className={`tfd-tab${view === 'simple' ? ' active' : ''}`}
            onClick={() => setView('simple')}
          >
            Pipeline
            <span className="tfd-badge">{steps.length}</span>
          </button>
          <button
            className={`tfd-tab${view === 'topology' ? ' active' : ''}`}
            onClick={() => setView('topology')}
          >
            Topology
          </button>
          <button
            className={`tfd-tab${view === 'detailed' ? ' active' : ''}`}
            onClick={() => setView('detailed')}
          >
            Detailed
          </button>
          <button
            className={`tfd-tab${view === 'crossapp' ? ' active' : ''}`}
            onClick={() => setView('crossapp')}
          >
            Cross-App
          </button>
          <button
            className={`tfd-tab${view === 'leastagency' ? ' active' : ''}`}
            onClick={() => setView('leastagency')}
          >
            Least Agency
          </button>
          <button
            className="tfd-tab"
            onClick={() => setDarkMode(d => !d)}
            title="Toggle light/dark"
            style={{ marginLeft: 'auto', background: 'transparent', width: 'auto', minWidth: 32, padding: '0 8px', fontSize: 16 }}
          >
            {darkMode ? '◐' : '☾'}
          </button>
        </div>

        {/* Body */}
        <div className="tfd-body">

          {/* Pipeline column */}
          <div className="tfd-pipeline">

            {/* Context bar */}
            <div className="tfd-ctx">
              <span className="tfd-ctx-label">Prompt</span>
              {trace.prompt?.message
                ? <span className="tfd-ctx-prompt">{String(trace.prompt.message).slice(0, 60)}{String(trace.prompt.message).length > 60 ? '…' : ''}</span>
                : <span className="tfd-ctx-prompt" style={{ color: 'var(--text-muted, #8b949e)' }}>waiting…</span>
              }
              {routingMode && (
                <span className="tfd-ctx-mode">{routingMode}</span>
              )}
            </div>

            {/* Banner */}
            {story && (
              <div className={`tfd-banner ${bannerClass}`}>
                <div className="tfd-banner-title">
                  {bannerIcon} {story.headline}
                </div>
                {story.bits?.length > 0 && (
                  <div className="tfd-banner-bits">
                    {story.bits.map((bit, i) => (
                      <div key={i} className="tfd-banner-bit">
                        <span>·</span>
                        <span>{bit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pipeline header */}
            <div className="tfd-pipeline-head">
              <span className="tfd-head-label">Token pipeline</span>
              <span className="tfd-head-count">
                {doneCount} done{errorCount > 0 ? ` · ${errorCount} failed` : ''} · {steps.length} steps
              </span>
            </div>

            {/* Scope funnel — only on Pipeline tab when exchange has run */}
            {view === 'simple' && (
              <ScopeFunnel steps={steps} trace={trace} />
            )}

            {/* Topology view */}
            {view === 'topology' && (
              <TopologyView steps={steps} trace={trace} onSelectStep={selectStep} />
            )}

            {view === 'crossapp' && (
              <CrossAppView steps={steps} trace={trace} onSelectStep={selectStep} />
            )}

            {view === 'leastagency' && (
              <LeastAgencyView steps={steps} trace={trace} onSelectStep={selectStep} />
            )}

            {/* Steps */}
            <div className="tfd-steps">
              {view === 'simple'
                ? steps.map((step, i) => (
                    <StepRow
                      key={step.id + i}
                      step={step}
                      num={i + 1}
                      selected={selectedStep?.id === step.id && selectedStep?.status === step.status}
                      onClick={() => selectStep(step)}
                    />
                  ))
                : view === 'crossapp' || view === 'leastagency'
                  ? null
                  : steps.map((step, i) => (
                    <DetailCard
                      key={step.id + i}
                      step={step}
                      num={i + 1}
                      selected={selectedStep?.id === step.id}
                      onClick={() => selectStep(step)}
                    />
                  ))
              }
            </div>

            {/* Footer */}
            <div className="tfd-footer">
              <div className="tfd-footer-row" onClick={() => setFooterOpen(footerOpen === 'tokens' ? null : 'tokens')}>
                Token Summary
                <span className="tfd-footer-badge">
                  {steps.filter(s => s.detail?.claims || s.detail?.decision).length} tokens
                </span>
              </div>
              {footerOpen === 'tokens' && (
                <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
                  {steps.filter(s => s.detail?.claims && Object.keys(s.detail.claims).length > 0).map(s => (
                    <div key={s.id} style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #c9d1d9)' }}>
                      <span style={{ color: 'var(--accent, #2f81f7)' }}>{s.lane}</span>
                      {' · '}
                      {s.detail.claims.scope
                        ? <span style={{ color: '#bc8cff' }}>scope: {typeof s.detail.claims.scope === 'object' ? JSON.stringify(s.detail.claims.scope) : s.detail.claims.scope}</span>
                        : null
                      }
                      {s.detail.claims.aud
                        ? <span style={{ color: '#39d353', marginLeft: 6 }}>aud: {s.detail.claims.aud}</span>
                        : null
                      }
                    </div>
                  ))}
                  {steps.filter(s => s.detail?.claims && Object.keys(s.detail.claims).length > 0).length === 0 && (
                    <span style={{ color: 'var(--text-muted, #8b949e)' }}>No token claims captured yet.</span>
                  )}
                </div>
              )}
              <div className="tfd-footer-row" onClick={() => setFooterOpen(footerOpen === 'mode' ? null : 'mode')}>
                Exchange Mode
                <span className="tfd-footer-badge">{routingMode || '—'}</span>
              </div>
              {footerOpen === 'mode' && trace.routingDetail && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-secondary, #c9d1d9)' }}>
                  {trace.routingDetail}
                </div>
              )}
            </div>
          </div>

          {inspOpen && <div className="tfd-body-resizer" onMouseDown={handleResizeStart} />}

          {/* Inspector */}
          <div className={`tfd-inspector${inspOpen ? '' : ' closed'}`} style={inspOpen ? { width: inspWidth } : undefined}>
            <Inspector step={selectedStep} onClose={closeInspector} />
          </div>

        </div>
      </div>
    </DraggableModal>
  );
}
