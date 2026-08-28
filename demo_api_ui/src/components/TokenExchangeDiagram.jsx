// Live Mermaid flowchart of the RFC 8693 token exchange pipeline.
// Subscribes to tokenChainTraceStore — starts blank, nodes appear as steps complete.
import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import DiagramExportBar from './DiagramExportBar';

// ── helpers ─────────────────────────────────────────────────────────────────

const trunc = (v, n = 40) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const t = s.length > n ? s.slice(0, n - 1) + '…' : s;
  // Mermaid node labels are "…"-delimited, so a literal " in a claim value
  // closes the label early and the whole diagram fails to parse. aud is the
  // usual offender — it arrives as an array and stringifies to
  // ["enduser.ping.demo"]. Every dynamic value in this file goes through
  // trunc, so this is the one place that has to be safe.
  return t.replace(/"/g, "'");
};

const kpad  = (k) => k.padEnd(11);
const findEv = (events, ...ids) => (events || []).find(e => e && ids.includes(e.id)) || null;
const stepOf = (steps, id) => (steps || []).find(s => s?.id === id) || null;
const isDone = (step) => step && (step.status === 'done' || step.status === 'error' || step.status === 'active');

// ── colours ──────────────────────────────────────────────────────────────────

const C = {
  user:    { fill: '#0c2040', color: '#7dd3fc', stroke: '#2563eb' },
  agent:   { fill: '#1a1535', color: '#c4b5fd', stroke: '#7c3aed' },
  exchange:{ fill: '#231700', color: '#fbbf24', stroke: '#b45309' },
  issued:  { fill: '#0a2418', color: '#6ee7b7', stroke: '#059669' },
  authzOk: { fill: '#0f1a2e', color: '#a5b4fc', stroke: '#4f46e5' },
  authzDn: { fill: '#2d0a0a', color: '#fca5a5', stroke: '#dc2626' },
  gateway: { fill: '#071a0f', color: '#86efac', stroke: '#16a34a' },
  mcp:     { fill: '#071520', color: '#67e8f9', stroke: '#0891b2' },
};

const sty = (id, c) =>
  `    style ${id} fill:${c.fill},color:${c.color},stroke:${c.stroke},stroke-width:1px`;

// ── claim row builder ────────────────────────────────────────────────────────

function claimRows(claims, keys) {
  if (!claims) return '        (no claims yet)';
  return keys
    .filter(k => claims[k] != null)
    .map(k => `        ${kpad(k)} ${trunc(claims[k])}`)
    .join('\n');
}

// ── diagram builder — incremental ────────────────────────────────────────────

export function buildDiagramSource(trace, steps) {
  const events = trace?.tokenEvents || [];
  const hasActivity = !!(trace?.startedAt || events.length);

  // ── idle state ───────────────────────────────────────────────────────────
  if (!hasActivity) {
    return `flowchart LR
    IDLE["Waiting for trace...
        Run a tool from the agent
        to see tokens appear here."]
    style IDLE fill:#0d1117,color:#374151,stroke:#1e293b,stroke-dasharray:5 5,stroke-width:2px`;
  }

  const userTok  = findEv(events, 'user-token');
  const agentTok = findEv(events, 'agent-actor-token', 'two-ex-agent-actor');
  const delegTok = findEv(events, 'exchanged-token', 'two-ex-final-token');

  const signinStep  = stepOf(steps, 'signin');
  const agentTkStep = stepOf(steps, 'agent-token');
  const exchStep    = stepOf(steps, 'exchange');
  const azStep      = stepOf(steps, 'authorize');
  const gwStep      = stepOf(steps, 'gateway');
  const mcpStep     = stepOf(steps, 'mcp');

  // Show each node only when its step has completed (or errored).
  const showUT  = isDone(signinStep);
  const showAT  = isDone(agentTkStep);
  const showEX  = isDone(exchStep);
  const showDT  = showEX && !!delegTok;
  const showPOL = isDone(azStep) && azStep.status !== 'notinpath';
  const showGW  = isDone(gwStep)  && gwStep.status  !== 'notinpath';
  const showTC  = isDone(mcpStep) && mcpStep.status !== 'notinpath';

  // Subgraphs only rendered when they have at least one visible node.
  const showP1  = showUT;
  const showBFF = showAT || showEX || showDT;
  const showAZ  = showPOL;
  const showGWs = showGW;
  const showMCP = showTC;

  const lines = ['flowchart LR'];
  const styles = [];

  // ── P1 subgraph ──────────────────────────────────────────────────────────
  if (showP1) {
    const uc = userTok?.claims || {};
    lines.push(`    subgraph P1["🔐 PingOne Authorization Server"]`);
    lines.push(`        UT["User Token  ·  RS256`);
        lines.push(`        ────────────────────────`);
        lines.push(claimRows(uc, ['sub', 'iss', 'aud', 'scope', 'exp']));
    lines.push(`"]`);
    lines.push(`    end`);
    styles.push(sty('UT', C.user));
  }

  // ── BFF subgraph ─────────────────────────────────────────────────────────
  if (showBFF) {
    lines.push(`    subgraph BFF["BFF  ·  RFC 8693 Token Exchange"]`);
    if (showAT || showEX) lines.push(`        direction TB`);

    if (showAT) {
      const ac = agentTok?.claims || {};
      lines.push(`        AT["Agent Token  ·  client_credentials`);
          lines.push(`        ────────────────────────`);
          lines.push(claimRows(ac, ['sub', 'iss', 'aud', 'scope', 'client_id']));
      lines.push(`"]`);
      styles.push(sty('AT', C.agent));
    }

    if (showEX) {
      const dc = delegTok?.claims || {};
      const exchAud   = dc.aud   || exchStep?.detail?.kv?.find?.(([k])=>k==='audience')?.[1] || 'mcp-server';
      const exchScope = dc.scope || 'gateway:mcp:invoke';
      lines.push(`        EX["Token Exchange Request  ·  RFC 8693`);
          lines.push(`        ────────────────────────`);
          lines.push(`        ${kpad('grant')}    urn:ietf:params:oauth:grant-type:token-exchange`);
          lines.push(`        ${kpad('audience')} ${trunc(exchAud)}`);
          lines.push(`        ${kpad('scope')}    ${trunc(exchScope)}`);
          lines.push(`        ${kpad('actor')}    agent client_credentials token`);
      lines.push(`"]`);
      styles.push(sty('EX', C.exchange));
    }

    if (showDT) {
      const dc = delegTok?.claims || {};
      const actVal = dc.act?.sub ?? dc.act;
      lines.push(`        DT["Delegated Token  ·  RS256  ·  ISSUED`);
          lines.push(`        ────────────────────────`);
          lines.push(`        ${kpad('sub')}      ${trunc(dc.sub)}`);
          lines.push(`        ${kpad('aud')}      ${trunc(dc.aud)}  ← narrowed`);
          lines.push(`        ${kpad('scope')}    ${trunc(dc.scope)}  ← narrowed`);
          if (actVal) lines.push(`        ${kpad('act.sub')}  ${trunc(actVal)}  ← NEW`);
          if (dc.client_id) lines.push(`        ${kpad('client_id')} ${trunc(dc.client_id)}`);
          if (dc.exp) lines.push(`        ${kpad('exp')}      ${trunc(dc.exp)}`);
      lines.push(`"]`);
      styles.push(sty('DT', C.issued));
    }

    lines.push(`    end`);
  }

  // ── Authorize subgraph ───────────────────────────────────────────────────
  if (showAZ) {
    const dec     = azStep.detail?.decision;
    const outcome = dec?.outcome || azStep.status === 'error' ? 'DENY' : 'PERMIT';
    const engine  = dec?.label?.split(' — ')?.[1] || '';
    const isDeny  = outcome === 'DENY' || azStep.status === 'error';
    lines.push(`    subgraph AZ["PingOne Authorize  ·  Policy Decision"]`);
    lines.push(`        POL["Policy Decision`);
        lines.push(`        ────────────────────────`);
        lines.push(`        ${kpad('outcome')}  ${isDeny ? '✕ DENY' : '✓ PERMIT'}`);
        if (engine) lines.push(`        ${kpad('engine')}   ${trunc(engine, 36)}`);
    lines.push(`"]`);
    lines.push(`    end`);
    styles.push(sty('POL', isDeny ? C.authzDn : C.authzOk));
  }

  // ── Gateway subgraph ─────────────────────────────────────────────────────
  if (showGWs) {
    lines.push(`    subgraph GW["Ping Agent Gateway"]`);
    lines.push(`        TV["Token Validated`);
        lines.push(`        ────────────────────────`);
        lines.push(`        ${kpad('sub')}      confirmed — user identity`);
        lines.push(`        ${kpad('act')}      delegation chain intact`);
        lines.push(`        ${kpad('aud')}      bound to mcp-server`);
        lines.push(`        ${kpad('scope')}    gateway:mcp:invoke permitted`);
        lines.push(`        ${kpad('sig')}      RS256 verified`);
    lines.push(`"]`);
    lines.push(`    end`);
    styles.push(sty('TV', C.gateway));
  }

  // ── MCP subgraph ─────────────────────────────────────────────────────────
  if (showMCP) {
    const tool    = trace?.mcpResult?.tool || trace?.mcpResult?.toolName || '';
    const dc      = delegTok?.claims || {};
    lines.push(`    subgraph MCP_S["MCP Server"]`);
    lines.push(`        TC["Tool Executes`);
        lines.push(`        ────────────────────────`);
        if (tool) lines.push(`        ${kpad('tool')}     ${trunc(tool)}`);
        if (dc.sub) lines.push(`        ${kpad('user')}     ${trunc(dc.sub, 32)}  from sub`);
        if (dc.act) lines.push(`        ${kpad('actor')}    ${trunc(dc.act?.sub ?? dc.act, 28)}  from act`);
        lines.push(`        ${kpad('scope')}    enforced at gateway`);
    lines.push(`"]`);
    lines.push(`    end`);
    styles.push(sty('TC', mcpStep?.status === 'error' ? { fill:'#2d0a0a', color:'#fca5a5', stroke:'#dc2626' } : C.mcp));
  }

  // ── Arrows — only when both endpoints are present ────────────────────────
  if (showUT && showEX)  lines.push(`    UT -->|subject_token| EX`);
  if (showAT && showEX)  lines.push(`    AT -->|actor_token| EX`);
  if (showEX && showDT)  lines.push(`    EX -->|issued_token| DT`);
  if (showDT && showPOL) lines.push(`    DT --> POL`);
  if (showDT && !showPOL && showGW) lines.push(`    DT --> TV`);
  if (showPOL && showGW) lines.push(`    POL --> TV`);
  if (showGW  && showTC) lines.push(`    TV --> TC`);

  lines.push('');
  lines.push(...styles);

  return lines.join('\n');
}

// ── render counter — prevents stale async renders overwriting newer ones ────
let _globalRenderSeq = 0;

// ── component ────────────────────────────────────────────────────────────────

export default function TokenExchangeDiagram() {
  const [snap, setSnap]         = useState(() => tokenChainTraceStore.getState());
  const [override, setOverride] = useState(null);
  const containerRef            = useRef(null);
  const renderIdRef             = useRef(0);
  const [renderError, setRenderError] = useState(null);

  useEffect(() => {
    return tokenChainTraceStore.subscribe((s) => {
      setSnap(s);
      const hasActivity = s.trace?.startedAt || (s.trace?.tokenEvents?.length ?? 0) > 0;
      if (!hasActivity) setOverride(null);
    });
  }, []);

  const liveSource = buildDiagramSource(snap.trace, snap.steps);
  const source     = override ?? liveSource;

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    const renderId = ++_globalRenderSeq;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis' },
    });

    async function render() {
      try {
        const { svg } = await mermaid.render(`ted-svg-${renderId}`, source);
        if (!cancelled && renderIdRef.current <= renderId && containerRef.current) {
          renderIdRef.current = renderId;
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) setRenderError(err?.message || 'Mermaid render failed');
      }
    }
    render();
    return () => { cancelled = true; };
  }, [source]);

  const handleImport     = useCallback((text) => setOverride(text.trim() || null), []);
  const handleResetToLive = useCallback(() => setOverride(null), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <DiagramExportBar
        source={source}
        sourceFilename="token-exchange.mmd"
        onSourceChange={handleImport}
      />
      {override && (
        <div style={{ padding: '2px 8px', background: '#2a1a00', borderBottom: '1px solid #d97706', fontSize: 11, color: '#fbbf24', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Custom diagram — live data paused</span>
          <button type="button" onClick={handleResetToLive}
            style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
            Reset to live
          </button>
        </div>
      )}
      {renderError ? (
        <div style={{ padding: 12, color: '#fca5a5', fontSize: 12, fontFamily: 'monospace' }}>
          Render error: {renderError}
        </div>
      ) : (
        <div ref={containerRef} role="img" aria-label="Token exchange flow diagram"
          style={{ flex: 1, overflow: 'auto', padding: 8 }} />
      )}
    </div>
  );
}

