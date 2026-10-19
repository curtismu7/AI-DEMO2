/**
 * TokenChainArchitecturePage.js — /architecture/token-chain
 *
 * Interactive token chain diagram showing all servers, authentication,
 * authorization, token exchange, and MCP gateway flow — rendered as a React
 * Flow canvas (TokenChainFlowDiagram) replacing the previous Mermaid render.
 * Zoom/pan is built into React Flow; click a node for its details.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Controls } from '@xyflow/react';
import TokenChainFlowDiagram, { NODES, EDGES, NODE_DETAILS } from './TokenChainFlowDiagram';
import DiagramReel from './DiagramReel';
import { buildReelSteps } from '../utils/diagramReel';
import { refsFor, formFor } from '../config/tokenChainStandards';
import DiagramStepBar from './DiagramStepBar';
import { useDiagramStepper, edgeCaptions } from '../hooks/useDiagramStepper';
import './TokenChainArchitecturePage.css';

const EDGE_CAPTIONS = edgeCaptions(EDGES, Object.fromEntries(NODES.map((n) => [n.id, n.label])));
// The reel's details row reuses each node's role text (the same text the node click panel opens with).
const BASE_REEL = buildReelSteps({
  edges: EDGES,
  nodes: NODES,
  details: Object.fromEntries(Object.entries(NODE_DETAILS).map(([id, d]) => [id, d.role])),
});
// Each reel step also shows the request on the wire, the newest mock token carried so far (JSON), and the
// standards behind the step (published RFCs and emerging work).
const REEL_STEPS = BASE_REEL.map((step, i) => {
  const [source, target] = EDGES[i];
  const lines = [...step.lines];
  const form = formFor(source, target);
  if (form) lines.push({ who: 'Request', code: form });
  let token = null, issued = null;
  for (let j = i; j >= 0 && !token; j--) {
    const t = NODE_DETAILS[EDGES[j][1]]?.mockToken;
    if (t) { token = t; issued = j + 1; }
  }
  // The exchange takes two tokens in (human subject_token + agent actor_token): show both.
  if (source === 'agentSvc' && target === 'txService') {
    for (const id of ['humanToken', 'agentToken']) {
      const t = NODE_DETAILS[id]?.mockToken;
      if (t) lines.push({ who: `Input token: ${t.note.split('·')[0].trim()}`, code: `${t.note} (MOCK, teaching values only)\n${JSON.stringify({ ...(t.header ? { header: t.header } : {}), claims: t.claims }, null, 2)}` });
    }
    return { ...step, lines, refs: refsFor(source, target) };
  }
  if (token) {
    const decoded = { ...(token.header ? { header: token.header } : {}), claims: token.claims };
    lines.push({ who: `Token carried${issued !== i + 1 ? ` (issued at step ${issued})` : ''}`, code: `${token.note} (MOCK, teaching values only)\n${JSON.stringify(decoded, null, 2)}` });
  }
  return { ...step, lines, refs: refsFor(source, target) };
});

const CARDS = [
  { color: '#2E5090', title: '🔐 Authentication', body: <>PingOne issues human token with <code>may_act: agent1</code> delegation claim</> },
  { color: '#3b5998', title: 'Agent', body: 'Gets own token (client creds), routes to LLM for tool selection' },
  { color: '#28a745', title: 'Token Exchange', body: 'Combines human + agent tokens into single TX token for MCP calls' },
  { color: '#f57c00', title: 'Gateway', body: 'Routes tool calls, enforces authorization checks, handles introspection' },
  { color: '#dc3545', title: '✅ Authorization', body: 'PingAuthorize evaluates policies based on scopes, audience, ACR, transaction details' },
  { color: '#6f42c1', title: 'MCP Servers', body: 'Tool providers, validate tokens, forward to resources with optional exchange' },
  { color: '#17a2b8', title: 'Resources', body: 'Backend APIs behind MCP servers, may do token exchange for API keys' },
  // Yellow (#ffc107) is too light for title text on either page background,
  // so unlike the others this card's heading tracks the theme instead of
  // its own accent -- the border still matches the diagram's Safety group.
  { color: '#ffc107', titleColor: 'themed', title: 'HITL/CIBA', body: 'Step-up flow for high-risk actions (transfers), requires Multi-Factor ACR' },
];

function CanvasWithControls({ onNodeClick, step }) {
  return (
    <div className="tca-canvas-frame">
      <ReactFlowProvider>
        <TokenChainFlowDiagram onClickNode={onNodeClick} step={step} />
        <Controls position="top-right" showInteractive={false} />
      </ReactFlowProvider>
    </div>
  );
}

export default function TokenChainArchitecturePage({ user }) {
  const [selectedId, setSelectedId] = useState(null);
  const stepper = useDiagramStepper(EDGES.length);
  // selected = { group, label, sub, id, detail: { role, mockToken, tokenNote } }, built from the selected box id
  const selected = selectedId ? (() => {
    const n = NODES.find((x) => x.id === selectedId);
    return n ? { ...n, id: selectedId, detail: NODE_DETAILS[selectedId] || null } : null;
  })() : null;
  const info = selected?.detail;
  const reelRef = useRef(null);
  const detailRef = useRef(null);

  // A box click jumps the reel to that box's first arrow (arrows into it first, else out of it).
  const pickNode = (id) => {
    setSelectedId(id);
    // Bring the reel and the detail into view when a box is picked on the diagram.
    requestAnimationFrame(() => (detailRef.current || reelRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const into = EDGES.findIndex((e) => e[1] === id);
    const out = EDGES.findIndex((e) => e[0] === id);
    if (into >= 0 || out >= 0) stepper.goTo(into >= 0 ? into : out);
  };
  // Moving the reel or the step bar selects that step's box, unless the box already picked is part of the step.
  useEffect(() => {
    if (stepper.step < 0) return;
    const [from, to] = EDGES[stepper.step];
    setSelectedId((cur) => (cur === from || cur === to ? cur : to));
  }, [stepper.step]);

  return (
    <div className="tca-page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1>Token Chain Architecture</h1>
          <p className="tca-subtitle">
            Complete flow: PingOne auth → Agent → Token Exchange → Agent Gateway → Authorization → Resource Servers
          </p>
        </div>
      </div>

      <div className="tca-diagram-frame">
        <p className="tca-zoom-hint">
          Use + and − to zoom · Drag to pan · Click a node for its role and the (mock) token it carries
        </p>
        <DiagramStepBar stepper={stepper} caption={EDGE_CAPTIONS[stepper.step]} />
        {stepper.step >= 0 && (() => {
          // The token the request carries at this step: the newest token that has arrived by now (mock, teaching values).
          let token = null, from = null;
          for (let j = stepper.step; j >= 0 && !token; j--) {
            const t = NODE_DETAILS[EDGES[j][1]]?.mockToken;
            if (t) { token = t; from = j + 1; }
          }
          return (
            <div className="tca-step-token" data-testid="tca-step-token">
              {token ? (
                <>
                  <p className="tca-node-detail-note">
                    Carried at step {stepper.step + 1}{from !== stepper.step + 1 ? ` (issued at step ${from})` : ''}: {token.note} (MOCK, teaching values only)
                  </p>
                  <pre className="tca-node-detail-json">{JSON.stringify(token.claims, null, 2)}</pre>
                </>
              ) : (
                <p className="tca-node-detail-note">Step {stepper.step + 1}: no token has been issued yet.</p>
              )}
            </div>
          );
        })()}
        <CanvasWithControls onNodeClick={(node) => pickNode(node.id)} step={stepper.step} />
        <div ref={reelRef}><DiagramReel steps={REEL_STEPS} stepper={stepper} testId="tca-reel" /></div>
      </div>

      {info && (
        <div className="tca-node-detail" role="status" ref={detailRef}>
          <div className="tca-node-detail-head">
            <strong>{selected.label}</strong>
            <span className="tca-node-detail-group">· {selected.group} · {selected.id}</span>
            <button
              type="button"
              className="tca-node-detail-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close node detail"
            >
              ✕
            </button>
          </div>
          <p className="tca-node-detail-role">{info.role}</p>
          {info.mockToken ? (
            <>
              <p className="tca-node-detail-note">
                {info.mockToken.note} — decoded claims (MOCK, teaching values only):
              </p>
              <pre className="tca-node-detail-json">
                {JSON.stringify(info.mockToken.claims, null, 2)}
              </pre>
            </>
          ) : (
            <p className="tca-node-detail-note">{info.tokenNote}</p>
          )}
        </div>
      )}

      {/* Card accents match the flow graph's group colors above by design —
          a matched legend, so they stay literal regardless of theme. */}
      <div className="tca-cards">
        {CARDS.map(({ color, titleColor, title, body }) => (
          <div key={title} className="tca-card" style={{ borderLeft: `4px solid ${color}` }}>
            <div
              className="tca-card-title"
              style={titleColor === 'themed' ? undefined : { color }}
            >
              {title}
            </div>
            <div>{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
