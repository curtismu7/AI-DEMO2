// SystemFlowMap.jsx
// The run painted onto the deployment map — which boxes were involved, and
// where the decision was taken. Sibling of TokenTopologyPanel, which answers
// the other question (what happened, in what order) as a lane diagram.
//
// Reads the same feed as every other chain view: tokenChainTraceStore. Nothing
// here derives its own verdict — the authorize decision comes off the authorize
// step and the headline off buildRunStory, so the map cannot disagree with the
// rail or the Proof verdict.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Controls, Handle, Position, EdgeLabelRenderer, getBezierPath, useStore } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildRunStory, buildTraceSteps } from '../services/tokenChainTrace/buildTraceSteps';
import { useThemeOptional } from '../context/ThemeContext';
import './SystemFlowMap.css';
import { useDraggableNodes } from '../hooks/useDraggableNodes';
import { useDiagramStepper, stepEdges, markNodes, edgeCaptions } from '../hooks/useDiagramStepper';
import DiagramStepBar from './DiagramStepBar';
import { routeEdges } from './StaticFlowDiagram'; // the shared pingStyle router (orthogonal, around the boxes)
import { labelPoint, pathFromPoints } from '../utils/orthoRoute';
import './DiagramReel.css'; // the shared dstep-hot ring on the replayed hop's two boxes

// Presenter map size (A-/A+), same pattern as TokenChainTraceRail's ZOOM_*
// (readStoredZoom there) — a separate key because the two panels are scaled
// independently.
const ZOOM_KEY = 'sfm:zoom:v1';
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

function readStoredZoom() {
  try {
    const v = Number(window.localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

function truncate(text, max) {
  if (!text) return '';
  const s = String(text);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// The deployment, grouped by who owns the box. Five bands: the model is its own
// trust boundary because the agent calls OUT to it — a run that never reaches
// the PEP is then visibly a model-side outcome.
//
// Deliberately no introspect/JWKS box: no step in buildTraceSteps carries that
// evidence, and a box that can never light is noise on a diagram people read
// under demo pressure.
export const NODES = {
  'p1-signin': { name: 'PingOne /as/authorize', sub: 'auth code + PKCE' },
  'p1-agenttok': { name: 'PingOne /as/token', sub: 'client_credentials · actor' },
  'p1-exchange': { name: 'Token exchange', sub: 'RFC 8693 · act chain' },
  'p1-authorize': { name: 'PingOne Authorize', sub: 'PDP · sideband' },
  // Three independent mechanisms, tracked separately — see deriveGateStates
  // below for the evidence each one actually lights on:
  'p1-mfa': { name: 'MFA', sub: 'Device step-up · PingOne MFA' },
  'p1-consent': { name: 'Consent', sub: 'HITL approval · transfer consent' },
  'p1-ciba': { name: 'CIBA', sub: 'Approval link · OIDC CIBA' },
  browser: { name: 'Browser', sub: 'demo_api_ui :4000' },
  bff: { name: 'BFF', sub: 'demo_api_server :3001' },
  agent: { name: 'LangGraph agent', sub: 'demoAgentLangGraphService' },
  llm: { name: 'LLM proxy', sub: ':8090 · one shared rate bucket' },
  pep: { name: 'Gateway PEP', sub: 'PingOne Agent Gateway :3036 · /mcp' },
  mcp: { name: 'MCP Server', sub: 'oauth-mcp · protected resource' },
  // The downstream business-logic API the MCP tool call actually reaches —
  // named "Resource Server" first since that is the role people ask "where is
  // it" about; "MCP Server" above is the protocol front door to it, not a
  // second one.
  api: { name: 'Resource Server', sub: 'Backend API · banking / vertical REST' },
  db: { name: 'Data store', sub: 'SQLite · vertical dataset' },
  // A Privilege A2A chain run (UC47). Agents present agent keys, not OAuth
  // tokens, and every hop passes the Agent Privilege, which is a
  // different component from the Gateway PEP above.
  'pa-main': { name: 'Main agent', sub: 'Privilege A2A · its own agent key' },
  'pa-gw': { name: 'Agent Privilege', sub: 'key · scope · policy · guardrail' },
  'pa-middle': { name: 'LangChain agent', sub: 'Middle agent · its own agent key' },
  'pa-specialist': { name: 'Specialist agent', sub: 'Remote Agent app' },
};

// Box and band geometry, in flow units. React Flow scales the whole canvas to
// fit, so these are proportions, not pixels.
export const W = 160;
export const H = 64; // name + a two-line wrapped subtitle + padding
// GAP is the corridor the router runs arrows through between two boxes (and the
// space between bands is BAND_GAP): at 14 the router found no way between
// neighbours and fell back to straight curves through boxes.
export const GAP = 64;
export const PAD = 20;
export const TOP = 30; // room for the band label

// x/y place each band on the canvas; `cols` wraps its boxes into a grid. The
// stack puts the agent under the browser, not beside the BFF, so the bff→pep
// lane runs clear instead of straight through the agent box.
export const BANDS = [
  {
    id: 'ping',
    label: 'Ping Identity · PingOne · Authorize PDP',
    x: 0,
    y: 0,
    cols: 5,
    // MFA sits next to Authorize so the gateway's step-up lane to it and the
    // BFF's token lanes up to the other PingOne boxes do not cross.
    nodes: ['p1-signin', 'p1-agenttok', 'p1-exchange', 'p1-mfa', 'p1-authorize'],
  },
  // A null in `nodes` leaves that grid cell empty, so a box can sit directly
  // under its neighbour (the agent under the BFF) without a lane running past it.
  { id: 'stack', label: 'Demo stack · BFF + agent', x: 0, y: 184, cols: 2, nodes: ['browser', 'bff', null, 'agent'] },
  { id: 'pep', label: 'PEP · gateway', x: 494, y: 184, cols: 1, nodes: ['pep'] },
  { id: 'backends', label: 'MCP servers · data', x: 764, y: 184, cols: 3, nodes: ['mcp', 'api', 'db'] },
  { id: 'gates', label: 'Human approval · consent + CIBA', x: 494, y: 368, cols: 2, nodes: ['p1-consent', 'p1-ciba'] },
  { id: 'model', label: 'Model · demo_llm_proxy', x: 0, y: 496, cols: 1, nodes: ['llm'] },
  { id: 'privilege', label: 'Privilege A2A · agents through the Agent Privilege', x: 0, y: 680, cols: 3, nodes: ['pa-main', 'pa-gw', 'pa-specialist', null, 'pa-middle'] },
];

// Bands before their boxes — React Flow requires a parent ahead of its children.
export const LAYOUT_NODES = [];
// Absolute {x, y, w, h} of every box at rest, for the first routing pass and the tests.
export const RECTS = {};
for (const b of BANDS) {
  const cols = Math.min(b.cols, b.nodes.length);
  const rows = Math.ceil(b.nodes.length / cols);
  const bandId = `band-${b.id}`;
  LAYOUT_NODES.push({
    id: bandId,
    type: 'band',
    position: { x: b.x, y: b.y },
    width: 2 * PAD + cols * W + (cols - 1) * GAP,
    height: TOP + rows * H + (rows - 1) * GAP + PAD,
    data: { label: b.label, bandKey: b.id },
  });
  b.nodes.forEach((id, i) => {
    if (!id) return;
    const position = { x: PAD + (i % cols) * (W + GAP), y: TOP + Math.floor(i / cols) * (H + GAP) };
    RECTS[id] = { x: b.x + position.x, y: b.y + position.y, w: W, h: H };
    LAYOUT_NODES.push({ id, type: 'hop', parentId: bandId, position, width: W, height: H, data: NODES[id] });
  });
}

/**
 * Which sides a lane leaves and enters by, from where the two boxes really are
 * (a dragged box changes it). Boxes a column apart and less than two rows apart
 * face each other sideways; boxes in different rows meet top to bottom.
 * @returns {[string, string]} [source side, target side]
 */
export function sidesForRects(a, b) {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
  const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  const sideways = dx > 0 ? ['right', 'left'] : ['left', 'right'];
  if (Math.abs(dx) >= W + GAP && Math.abs(dy) < 2 * H) return sideways;
  if (Math.abs(dy) >= H) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  return sideways;
}

/** The same, for the boxes at rest. */
export function sidesFor(from, to) {
  return sidesForRects(RECTS[from], RECTS[to]);
}

/**
 * Route the lanes around the boxes with the shared pingStyle router.
 * Shortest lanes are routed first: they take the lanes nearest their boxes, and
 * a longer lane from the same side then nests outside them instead of cutting
 * across (the router gives the lane it sees first the best corridor).
 * @param {Object<string, {x:number,y:number,w:number,h:number}>} measured absolute box rectangles by node id
 * @param {Array<{id: string, from: string, to: string}>} lanes
 * @returns {{ routes: object, fallbacks: number, sides: Object<string, [string, string]> }}
 */
export function routeLanes(measured, lanes) {
  // A box React Flow has not placed yet sits where the layout puts it.
  const rects = { ...RECTS, ...measured };
  const sides = {};
  const edges = lanes.map((l) => {
    const a = rects[l.from];
    const b = rects[l.to];
    const [out, into] = sidesForRects(a, b);
    sides[l.id] = [out, into];
    return { id: l.id, source: l.from, target: l.to, sourceHandle: `s${out[0]}`, targetHandle: `t${into[0]}`, data: {}, span: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) };
  });
  const { routes, fallbacks } = routeEdges(rects, [...edges].sort((p, q) => p.span - q.span));
  return { routes, fallbacks, sides };
}

// Which two boxes each hop runs between. Keyed by step baseId (the authorize
// step carries a baseId when a run evaluates twice), so a repeated hop paints
// the same edge rather than falling off the map.
//
// A step with `node` and no from/to only lights a box — `website` is where the
// run originates, not a hop between two boxes.
export const STEP_TO_EDGE = {
  website: { node: 'browser' },
  signin: { from: 'browser', to: 'p1-signin', kind: 'oauth' },
  prompt: { from: 'browser', to: 'bff', kind: 'http' },
  agent: { from: 'bff', to: 'agent', kind: 'http' },
  llm: { from: 'agent', to: 'llm', kind: 'http' },
  'agent-token': { from: 'bff', to: 'p1-agenttok', kind: 'oauth' },
  'exchange-1': { from: 'bff', to: 'p1-agenttok', kind: 'oauth' },
  exchange: { from: 'bff', to: 'p1-exchange', kind: 'oauth' },
  'id-jag-issued': { from: 'bff', to: 'p1-exchange', kind: 'oauth' },
  'id-jag-redeemed': { from: 'bff', to: 'p1-exchange', kind: 'oauth' },
  'tools-list-challenge': { from: 'bff', to: 'pep', kind: 'http' },
  'tools-list': { from: 'bff', to: 'pep', kind: 'http' },
  'tools-call-challenge': { from: 'bff', to: 'pep', kind: 'http' },
  gateway: { from: 'bff', to: 'pep', kind: 'http' },
  authorize: { from: 'pep', to: 'p1-authorize', kind: 'pdp' },
  'intent-binding': { from: 'pep', to: 'p1-authorize', kind: 'pdp' },
  // MFA/Consent/CIBA are NOT wired here — buildTraceSteps' single 'stepup'
  // step can't tell them apart (see deriveGateStates below), so they're
  // derived straight from trace evidence instead of from the step loop this
  // map runs over.
  'api-key-swap': { from: 'pep', to: 'mcp', kind: 'http' },
  mcp: { from: 'pep', to: 'mcp', kind: 'http' },
  api: { from: 'mcp', to: 'api', kind: 'http' },
  database: { from: 'api', to: 'db', kind: 'data' },
  sqlite: { from: 'api', to: 'db', kind: 'data' },
  postgres: { from: 'api', to: 'db', kind: 'data' },
  postgresql: { from: 'api', to: 'db', kind: 'data' },
  mysql: { from: 'api', to: 'db', kind: 'data' },
  mariadb: { from: 'api', to: 'db', kind: 'data' },
  sqlserver: { from: 'api', to: 'db', kind: 'data' },
  reply: { from: 'bff', to: 'browser', kind: 'http' },
  // Support-console operator write + delegation ceremony (PR #1143). The BFF
  // mints these events server-side; buildTraceSteps projects them through
  // operatorChainSteps with the same ids, so the map lights the same boxes the
  // agent-run path uses — one deployment map for both stories.
  'operator-session': { node: 'browser' },
  'operator-verification': { from: 'browser', to: 'p1-mfa', kind: 'oauth' },
  'customer-signon': { from: 'bff', to: 'p1-mfa', kind: 'oauth' },
  'customer-token-issued': { from: 'p1-mfa', to: 'bff', kind: 'oauth' },
  // The ceremony's exchange hop shares the agent run's 'exchange' id, which
  // already maps bff→p1-exchange — no second entry needed.
  'operator-write': { from: 'bff', to: 'api', kind: 'http' },
  'operator-audit': { node: 'bff' },
};

// A gate outcome is not an error — the control fired and the run is waiting on
// a human. Painting STEP_UP red would read as a failure in front of a room.
const CHAIN_LANE_NODES = { 'MAIN-AGENT': 'pa-main', GATEWAY: 'pa-gw', 'LANGCHAIN-AGENT': 'pa-middle' };
const HELD_DECISIONS = new Set(['STEP_UP', 'HITL_REQUIRED', 'INDETERMINATE']);

// Strongest state wins when several hops touch one box: the BFF is the source
// of six hops, and a later clean hop must not repaint an earlier failure.
const RANK = { skipped: 1, done: 2, active: 3, held: 4, error: 5 };

/**
 * What one step does to the map. Returns null for a hop with no evidence yet,
 * which stays unlit rather than guessing.
 * @param {object} step a buildTraceSteps step
 * @param {string|null} decision authorize outcome, only for the authorize hop
 * @returns {string|null}
 */
export function stateForStep(step, decision) {
  if (!step) return null;
  if (decision) {
    if (decision === 'DENY') return 'error';
    if (HELD_DECISIONS.has(decision)) return 'held';
  }
  switch (step.status) {
    case 'done': return 'done';
    case 'active': return 'active';
    case 'error': return 'error';
    case 'notinpath': return 'skipped';
    default: return null;
  }
}

/**
 * True once the reply step has real evidence (a streamed LLM reply, or a
 * heuristic reply composed from a tool result) — independent of
 * trace.outcome, which buildTraceSteps.js documents live runs frequently
 * never set. Used to repaint a hop that is still reading 'active' after the
 * run has actually finished, rather than leaving it lit blue forever.
 * @param {Array} list steps from buildTraceSteps
 * @returns {boolean}
 */
function runEnded(list) {
  return list.some((s) => s && (s.baseId || s.id) === 'reply' && s.status === 'done');
}

const hasPhase = (phases, name) => Array.isArray(phases) && phases.some((p) => p && p.phase === name);
const findTokenEvent = (events, id) => (Array.isArray(events) ? events.find((e) => e && e.id === id) : undefined);

/**
 * MFA, Consent and CIBA are three independent mechanisms buildTraceSteps.js's
 * single 'stepup' step folds into one chip for the rail (it can't tell them
 * apart) — this map needs them separate so a presenter can see WHICH one
 * actually fired. Derived straight from trace evidence rather than from that
 * shared step, so splitting them here cannot ripple into TokenChainTraceRail
 * or any other consumer of buildTraceSteps' step list.
 * @param {object|null|undefined} trace
 * @param {boolean} ended the run has genuinely finished (buildFlowModel's own `ended`)
 * @returns {{ mfa: string|null, consent: string|null, ciba: string|null }}
 */
function deriveGateStates(trace, ended) {
  const phases = trace?.phases;
  const tokenEvents = trace?.tokenEvents;

  // routes/mfa.js's own phases — the actual device step-up flow.
  const mfaFailed = hasPhase(phases, 'mfa_challenge_failed');
  const mfaDone = hasPhase(phases, 'mfa_challenge_completed');
  const mfaStarted = hasPhase(phases, 'mfa_challenge_initiated');
  const mfa = mfaFailed ? 'error' : mfaDone ? 'done' : mfaStarted ? 'active' : ended ? 'skipped' : null;

  // authorize_denied_hitl (local/simulated path) and gateway_hitl_required
  // (live PingOne Agent Gateway path) are the two PDPs' phases for the SAME HITL_CONSENT
  // obligation this demo enforces on transfers (authorizeObligations.js,
  // simulatedAuthorizeService.js: "all transfers require human consent").
  // mcp_auth_challenge_intercepted is the anonymous-caller 401 leg of the same
  // gate. trace.authorize.hitlApproved is stamped once a verified receipt
  // permits the retry (tokenChainTraceStore's carried-gate handling).
  const consentStarted = hasPhase(phases, 'authorize_denied_hitl')
    || hasPhase(phases, 'gateway_hitl_required')
    || hasPhase(phases, 'mcp_auth_challenge_intercepted');
  const consentApproved = trace?.authorize?.hitlApproved === true;
  const consent = consentStarted ? (consentApproved ? 'done' : 'active') : ended ? 'skipped' : null;

  // CIBA has no phase of its own — it's a fully separate REST round trip
  // (POST /api/auth/ciba/initiate + poll) AIAgent.js drives client-side, so
  // it's tagged directly onto trace.tokenEvents at those call sites instead
  // (id: 'ciba-poll', additionalData.status: 'pending' | 'approved' | 'denied').
  const cibaTok = findTokenEvent(tokenEvents, 'ciba-poll');
  const cibaStatus = cibaTok?.additionalData?.status;
  const ciba = !cibaTok ? (ended ? 'skipped' : null)
    : cibaStatus === 'denied' ? 'error'
    : cibaStatus === 'approved' ? 'done'
    : 'active';

  return { mfa, consent, ciba };
}

/**
 * Fold the run's steps into node states and edges.
 * @param {Array} steps from buildTraceSteps
 * @param {object|null} [trace] the raw trace — only used to derive the
 *   MFA/Consent/CIBA boxes, which have no entry in STEP_TO_EDGE
 * @returns {{ nodeStates: object, edges: Array, decision: string|null, lit: number }}
 */
/**
 * Display names the run's steps give the chain boxes (the active vertical's agent and
 * specialist). The lane -> node mapping above is untouched; only the box text changes.
 */
export function chainNodeNames(steps) {
  const names = {};
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!String(step?.id).startsWith('pa2a-') || !step.laneLabel || step.lane === 'GATEWAY' || step.lane === 'MCP-TOOLS') continue;
    const node = CHAIN_LANE_NODES[step.lane] || 'pa-specialist';
    if (node !== 'pa-middle' && !names[node]) names[node] = step.laneLabel;
  }
  return names;
}

export function buildFlowModel(steps, trace) {
  const list = Array.isArray(steps) ? steps : [];
  const az = list.find((s) => s && (s.baseId || s.id) === 'authorize');
  const raw = az?.detail?.decision?.outcome;
  // NOT_RECORDED is the display default for an evaluation with no decision
  // field, not a verdict — buildRunStory makes the same exclusion.
  const decision = raw && raw !== 'NOT_RECORDED' ? raw : null;
  const ended = runEnded(list);

  const nodeStates = {};
  // Keyed by node pair, not by step. Several steps legitimately run between the
  // same two boxes — tools-list-challenge, tools-list and gateway are all
  // bff→pep — and one path per step drew three coincident lines whose visible
  // colour was just whichever rendered last. A skipped hop could then paint a
  // lane that had actually succeeded.
  const edgeByPair = new Map();
  let lit = 0;
  const bump = (id, state) => {
    if (!id || !state) return;
    if (!nodeStates[id] || RANK[state] > RANK[nodeStates[id]]) nodeStates[id] = state;
  };

  const addEdge = (from, to, kind, state, title) => {
    const key = `${from}|${to}`;
    const prev = edgeByPair.get(key);
    if (!prev) {
      edgeByPair.set(key, { id: key, from, to, kind, state, titles: [title] });
      return;
    }
    prev.titles.push(title);
    // Strongest state owns the lane, for the same reason it owns a box.
    if (RANK[state] > RANK[prev.state]) {
      prev.state = state;
      prev.kind = kind;
    }
  };

  // A Privilege A2A chain run: its steps carry their actor as the lane (see
  // privilegeA2aChainSteps.js), so each step lights its actor's box and draws
  // the hop from the previous actor.
  let chainFrom = null;
  for (const step of list) {
    // The CLIENT lane (the run's start and done nodes) has no box in this band.
    if (!String(step?.id).startsWith('pa2a-') || step.lane === 'CLIENT') continue;
    const node = CHAIN_LANE_NODES[step.lane] || 'pa-specialist';
    const state = stateForStep(step, null);
    if (state) {
      lit += 1;
      if (chainFrom && chainFrom !== node) {
        addEdge(chainFrom, node, 'http', state, step.title);
        bump(chainFrom, 'done');
      }
      bump(node, state);
    }
    chainFrom = node;
  }

  for (const step of list) {
    const spec = STEP_TO_EDGE[step?.baseId || step?.id];
    if (!spec) continue;
    let state = stateForStep(step, spec.to === 'p1-authorize' ? decision : null);
    if (!state) continue;
    // The run is over — nothing is genuinely still in flight, so a hop stuck
    // on 'active' is stale evidence, not a live one.
    if (ended && state === 'active') state = 'done';
    if (state !== 'skipped') lit += 1;
    if (spec.node) {
      bump(spec.node, state);
      continue;
    }
    addEdge(spec.from, spec.to, spec.kind, state, step.title);
    bump(spec.to, state);
    // The source box is at least reached — it originated the hop. Never
    // stronger than `done`, so a failing hop reddens its target, not its caller.
    bump(spec.from, state === 'skipped' ? 'skipped' : 'done');
  }

  // MFA / Consent / CIBA — not in STEP_TO_EDGE (see deriveGateStates), so
  // folded in here instead of the step loop above.
  const gates = deriveGateStates(trace, ended);
  for (const [key, nodeId] of Object.entries({ mfa: 'p1-mfa', consent: 'p1-consent', ciba: 'p1-ciba' })) {
    const state = gates[key];
    if (!state) continue;
    if (state !== 'skipped') lit += 1;
    bump(nodeId, state);
    edgeByPair.set(`pep|${nodeId}`, {
      id: `pep|${nodeId}`, from: 'pep', to: nodeId, kind: 'ciba', state, titles: [NODES[nodeId].name],
    });
    bump('pep', state === 'skipped' ? 'skipped' : 'done');
  }

  // `lit` counts hops that ran, not lanes drawn — collapsing three bff→pep
  // steps into one line must not make the header under-report the run.
  const edges = [...edgeByPair.values()].map((e) => ({
    ...e,
    title: [...new Set(e.titles)].join(' · '),
  }));
  return { nodeStates, edges, decision, lit };
}

// What Simulate replays when the map has no traffic yet: the hops of the
// standard agent run (the store's empty-trace step template) as if they all ran.
// Gate lanes are dropped — an idle run never reaches MFA/Consent/CIBA.
export const CANONICAL_EDGES = buildFlowModel(
  buildTraceSteps({ phases: [], tokenEvents: [] }).map((s) => ({ ...s, status: 'done' })),
).edges.filter((e) => e.state !== 'skipped');

export function verdictLabel(decision, story) {
  if (decision) return decision.replace(/_/g, ' ');
  if (!story) return 'IDLE';
  if (story.outcome === 'error') return 'RUN ERROR';
  if (story.outcome === 'ok') return 'COMPLETE';
  return 'RUNNING';
}

export function verdictTone(decision, story) {
  if (decision === 'DENY') return 'error';
  if (decision && HELD_DECISIONS.has(decision)) return 'held';
  if (story?.outcome === 'error') return 'error';
  if (story?.outcome === 'active') return 'active';
  return 'done';
}

function BandNode({ data }) {
  return <div className="sfm-band" data-band={data.label} data-band-id={data.bandKey} />;
}

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

// A handle per side, each way, so a lane can pick the sides that face its
// other end (sidesFor). They are anchors only — nothing here is connectable.
function HopNode({ data }) {
  return (
    <div className="sfm-node" data-state={data.state || undefined}>
      <span className="sfm-node-name">{data.name}</span>
      <span className="sfm-node-sub">{data.sub}</span>
      {Object.entries(SIDES).flatMap(([side, position]) => [
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={position} isConnectable={false} />,
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={position} isConnectable={false} />,
      ])}
    </div>
  );
}

// Own path rather than React Flow's default edge, so the existing kind (dash)
// and state (colour) classes apply unchanged and the step titles show on hover.
// Routed around the boxes by the shared router when it found a way; the bezier
// is the fallback, and what is drawn while a box is being dragged.
function HopEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, style }) {
  const route = data.route;
  const routed = Boolean(route && route.ok);
  const [bezier, bx, by] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const d = routed ? pathFromPoints(route.pts) : bezier;
  const at = routed ? route.label || labelPoint(route.pts) : { x: bx, y: by };
  return (
    <>
      <path d={d} className={`sfm-edge sfm-edge--${data.state}`} data-kind={data.kind} style={style} markerEnd={`url(#sfm-arrow-${data.state})`}>
        <title>{data.title}</title>
      </path>
      <EdgeLabelRenderer>
        <div
          className={`sfm-edge-num nodrag nopan sfm-edge-num--${data.state}`}
          style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          title={data.title}
        >
          {data.n}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { band: BandNode, hop: HopNode };
const EDGE_TYPES = { hop: HopEdge };

const DRAG_THRESHOLD = 5; // px: a wiggle is still a click
const STATES = ['done', 'active', 'held', 'error', 'skipped'];

// The head of each arrow, one per state so it takes the lane's colour.
function ArrowDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="sfm-defs">
      <defs>
        {STATES.map((state) => (
          <marker key={state} id={`sfm-arrow-${state}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`sfm-arrow sfm-arrow--${state}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/**
 * The React Flow canvas. Arrows are routed around the boxes where they really
 * are (measured, and after a drag), so this lives inside the provider that
 * gives it the node store. While a box is being dragged the cheap bezier shows.
 */
function FlowCanvas({ nodes, onNodesChange, shownEdges, replaying, step }) {
  const [dragging, setDragging] = useState(false);
  const nodeLookup = useStore((st) => st.nodeLookup);
  // React Flow moves boxes in place: a string of their absolute boxes re-routes on a drop.
  const absKey = useStore((st) => {
    let k = '';
    for (const n of st.nodeLookup.values()) {
      if (n.type !== 'hop') continue;
      const p = n.internals.positionAbsolute;
      k += `${n.id}:${Math.round(p.x)},${Math.round(p.y)},${Math.round(n.measured?.width ?? 0)},${Math.round(n.measured?.height ?? 0)}|`;
    }
    return k;
  });

  const rects = useMemo(() => {
    const out = {};
    for (const n of nodeLookup.values()) {
      if (n.type !== 'hop') continue;
      const p = n.internals.positionAbsolute;
      out[n.id] = { x: p.x, y: p.y, w: n.measured?.width ?? W, h: n.measured?.height ?? H };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absKey]);

  const routing = useMemo(() => {
    if (dragging) return { routes: {}, fallbacks: null, sides: {} };
    return routeLanes(rects, shownEdges.map((e) => ({ id: e.id, from: e.from, to: e.to })));
  }, [rects, shownEdges, dragging]);

  const flowEdges = useMemo(
    () => stepEdges(shownEdges.map((e, i) => {
      // While a box is being dragged the sides come from where the boxes are now, like the route does.
      const [out, into] = routing.sides[e.id] || sidesForRects({ ...RECTS, ...rects }[e.from], { ...RECTS, ...rects }[e.to]);
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        sourceHandle: `s-${out}`,
        targetHandle: `t-${into}`,
        type: 'hop',
        data: { ...e, n: i + 1, route: routing.routes[e.id] },
      };
    }), replaying ? step : -1),
    [shownEdges, rects, routing, replaying, step],
  );

  return (
    <div className="sfm-canvas" data-route-fallbacks={routing.fallbacks ?? undefined}>
      <ArrowDefs />
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        nodeDragThreshold={DRAG_THRESHOLD}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => setDragging(false)}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** The map itself, with no shell — mounted bare as a page and inside the modal. */
export function SystemFlowMapView() {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());

  useEffect(() => tokenChainTraceStore.subscribe(setStoreState), []);

  const { darkMode, toggleDarkMode } = useThemeOptional();

  // null = following the live run. Set to a past run's id (from the replay
  // strip below) to freeze the map on one of the last few completed runs
  // instead — a deliberate look-back, so a new live run starting does not
  // yank the presenter out of it.
  const [viewingRunId, setViewingRunId] = useState(null);
  const history = storeState.history || [];
  const viewingTrace = viewingRunId != null ? history.find((h) => h.runId === viewingRunId) : null;
  const trace = viewingTrace || storeState.trace;
  const steps = useMemo(
    () => (viewingTrace ? buildTraceSteps(viewingTrace) : storeState.steps),
    [viewingTrace, storeState.steps],
  );

  const [zoom, setZoom] = useState(readStoredZoom);
  useEffect(() => {
    try { window.localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* private mode — size still works, just not remembered */ }
  }, [zoom]);
  const stepZoom = useCallback((delta) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));
  }, []);

  const { nodeStates, edges, decision, lit } = useMemo(() => buildFlowModel(steps, trace), [steps, trace]);
  const story = useMemo(() => buildRunStory(trace, steps), [trace, steps]);
  // buildRunStory's outcome also comes from trace.outcome, and reads 'active'
  // ('RUNNING') just as indefinitely when that never gets set. The reply
  // step existing is the same "run is actually over" evidence buildFlowModel
  // uses above — reuse it so the verdict badge cannot disagree with the map.
  const ended = useMemo(() => Array.isArray(steps)
    && steps.some((s) => s && (s.baseId || s.id) === 'reply' && s.status === 'done'), [steps]);
  const displayStory = useMemo(() => {
    if (!story || !ended || story.outcome !== 'active') return story;
    return {
      ...story,
      outcome: 'ok',
      headline: decision
        ? `This run completed successfully — Authorize returned ${decision.replace(/_/g, ' ')}.`
        : 'This run completed successfully.',
    };
  }, [story, ended, decision]);
  const elapsed = trace?.finishedAt && trace?.startedAt ? trace.finishedAt - trace.startedAt : null;

  // Simulate replays the hops this map already shows, in first-hop order; with
  // no traffic it walks the canonical path instead. Off (step -1) = live view.
  const representative = edges.length === 0;
  const replayEdges = representative ? CANONICAL_EDGES : edges;
  const stepper = useDiagramStepper(replayEdges.length);
  const replaying = stepper.active;
  const shownEdges = replaying ? replayEdges : edges;
  const focus = replaying ? replayEdges[stepper.step] : null;
  const replayCaption = focus
    ? `${edgeCaptions([[focus.from, focus.to, focus.title]], Object.fromEntries(Object.entries(NODES).map(([k, v]) => [k, v.name])))[0]}${representative ? ' — representative path, no recent traffic' : ''}`
    : '';

  const chainNames = useMemo(() => chainNodeNames(steps), [steps]);
  const flowNodes = useMemo(
    () => LAYOUT_NODES.map((n) => (n.type === 'hop'
      ? { ...n, data: { ...n.data, ...(chainNames[n.id] ? { name: chainNames[n.id] } : {}), state: nodeStates[n.id] } }
      : n)),
    [nodeStates, chainNames],
  );
  const { nodes: dragNodes, onNodesChange: onDragNodes } = useDraggableNodes(flowNodes);
  const shownNodes = focus ? markNodes(dragNodes, [focus.from, focus.to]) : dragNodes;
  return (
    <div className="sfm-root" style={{ zoom }}>
      <div className="sfm-head">
        <span className={`sfm-verdict sfm-verdict--${verdictTone(decision, displayStory)}`}>
          {verdictLabel(decision, displayStory)}
        </span>
        {viewingTrace ? <span className="sfm-viewing">replay</span> : null}
        {elapsed != null ? (
          <span className="sfm-ms">{elapsed}<span>ms</span></span>
        ) : null}
        <span className="sfm-hops">{lit} {lit === 1 ? 'hop' : 'hops'}</span>
        <span className="sfm-spacer" />
        <div className="sfm-zoom" role="group" aria-label="System flow map size">
          <button
            type="button"
            className="sfm-zoom-btn"
            onClick={() => stepZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            title="Smaller map"
            aria-label="Decrease map size"
          >
            A-
          </button>
          <button
            type="button"
            className="sfm-zoom-pct"
            onClick={() => setZoom(ZOOM_DEFAULT)}
            disabled={zoom === ZOOM_DEFAULT}
            title="Reset map size"
            aria-label="Reset map size"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="sfm-zoom-btn"
            onClick={() => stepZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            title="Larger map"
            aria-label="Increase map size"
          >
            A+
          </button>
        </div>
        <button
          type="button"
          className="sfm-icon-btn"
          onClick={toggleDarkMode}
          aria-label="Toggle dark mode"
          aria-pressed={darkMode}
          title="Switch this map between light and dark"
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
        <button
          type="button"
          className="sfm-clear"
          onClick={() => { setViewingRunId(null); tokenChainTraceStore.reset(); }}
        >
          Clear run
        </button>
      </div>

      {history.length > 0 ? (
        <div className="sfm-history" role="group" aria-label="Replay last runs">
          <span className="sfm-history-label">Replay:</span>
          <button
            type="button"
            className={`sfm-history-btn${viewingRunId == null ? ' sfm-history-btn--active' : ''}`}
            onClick={() => setViewingRunId(null)}
          >
            Live
          </button>
          {history.map((h) => (
            <button
              key={h.runId}
              type="button"
              className={`sfm-history-btn${viewingRunId === h.runId ? ' sfm-history-btn--active' : ''}`}
              onClick={() => setViewingRunId(h.runId)}
              title={h.prompt?.message || `run #${h.runId}`}
            >
              {h.outcome === 'error' ? '❌ ' : h.outcome === 'ok' ? '✓ ' : ''}
              {truncate(h.prompt?.message, 22) || `run #${h.runId}`}
            </button>
          ))}
        </div>
      ) : null}

      <div className="sfm-caption">
        {displayStory ? displayStory.headline : 'No run yet — send an agent prompt and the hops paint here.'}
      </div>

      <DiagramStepBar stepper={stepper} caption={replayCaption} />

      <ReactFlowProvider>
        <FlowCanvas
          nodes={shownNodes}
          onNodesChange={onDragNodes}
          shownEdges={shownEdges}
          replaying={replaying}
          step={stepper.step}
        />
      </ReactFlowProvider>

      <div className="sfm-legend">
        <span><i data-kind="http" />http / MCP</span>
        <span><i data-kind="oauth" />OAuth / RFC 8693</span>
        <span><i data-kind="pdp" />PDP sideband</span>
        <span><i data-kind="ciba" />step-up / HITL</span>
        <span><i data-kind="data" />data</span>
        <span><b className="sfm-edge-num sfm-edge-num--key">n</b>hop n in the step bar</span>
        <span className="sfm-legend-sep" />
        <span><b className="sfm-swatch sfm-swatch--done" />reached</span>
        <span><b className="sfm-swatch sfm-swatch--held" />held for human</span>
        <span><b className="sfm-swatch sfm-swatch--error" />denied / failed</span>
        <span><b className="sfm-swatch sfm-swatch--skipped" />not in path</span>
      </div>
    </div>
  );
}

/**
 * Pop-out shell, mounted once in App.js and opened by the rail's view menu.
 * No local theme stamp: the --th-* tokens are defined on :root and
 * :root[data-theme="dark"], so this follows the app theme on its own.
 */
export default function SystemFlowMapPanel({ isOpen, onClose }) {
  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="System Flow"
      defaultWidth={980}
      defaultHeight={620}
      storageKey="ba-system-flow-map"
      footer={null}
      noBackdrop
      zIndex={10001}
      minWidth={620}
      minHeight={420}
      className="sfm-modal"
    >
      <SystemFlowMapView />
    </DraggableModal>
  );
}
