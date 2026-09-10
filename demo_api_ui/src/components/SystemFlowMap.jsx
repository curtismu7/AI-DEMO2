// SystemFlowMap.jsx
// The run painted onto the deployment map — which boxes were involved, and
// where the decision was taken. Sibling of TokenTopologyPanel, which answers
// the other question (what happened, in what order) as a lane diagram.
//
// Reads the same feed as every other chain view: tokenChainTraceStore. Nothing
// here derives its own verdict — the authorize decision comes off the authorize
// step and the headline off buildRunStory, so the map cannot disagree with the
// rail or the Proof verdict.
import React, { useState, useEffect, useMemo } from 'react';
import { ReactFlow, Controls, Handle, Position, getBezierPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DraggableModal from './DraggableModal';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { buildRunStory } from '../services/tokenChainTrace/buildTraceSteps';
import './SystemFlowMap.css';

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
  'p1-stepup': { name: 'CIBA / MFA', sub: 'HITL step-up' },
  browser: { name: 'Browser', sub: 'demo_api_ui :4000' },
  bff: { name: 'BFF', sub: 'demo_api_server :3001' },
  agent: { name: 'LangGraph agent', sub: 'demoAgentLangGraphService' },
  llm: { name: 'LLM proxy', sub: ':8090 · one shared rate bucket' },
  pep: { name: 'Gateway PEP', sub: 'PingGateway :3036 · /mcp' },
  mcp: { name: 'MCP server', sub: 'oauth-mcp · resource server' },
  api: { name: 'Backend API', sub: 'banking / vertical REST' },
  db: { name: 'Data store', sub: 'SQLite · vertical dataset' },
};

// Box and band geometry, in flow units. React Flow scales the whole canvas to
// fit, so these are proportions, not pixels.
const W = 160;
const H = 64; // name + a two-line wrapped subtitle + padding
const GAP = 14;
const PAD = 12;
const TOP = 26; // room for the band label

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
    nodes: ['p1-signin', 'p1-agenttok', 'p1-exchange', 'p1-authorize', 'p1-stepup'],
  },
  { id: 'stack', label: 'Demo stack · BFF + agent', x: 0, y: 122, cols: 2, nodes: ['browser', 'bff', 'agent'] },
  { id: 'pep', label: 'PEP · gateway', x: 378, y: 122, cols: 1, nodes: ['pep'] },
  { id: 'backends', label: 'MCP servers · data', x: 582, y: 122, cols: 1, nodes: ['mcp', 'api', 'db'] },
  { id: 'model', label: 'Model · demo_llm_proxy', x: 0, y: 322, cols: 1, nodes: ['llm'] },
];

// Bands before their boxes — React Flow requires a parent ahead of its children.
const LAYOUT_NODES = [];
const CENTRE = {};
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
    data: { label: b.label },
  });
  b.nodes.forEach((id, i) => {
    const position = { x: PAD + (i % cols) * (W + GAP), y: TOP + Math.floor(i / cols) * (H + GAP) };
    CENTRE[id] = { x: b.x + position.x + W / 2, y: b.y + position.y + H / 2 };
    LAYOUT_NODES.push({ id, type: 'hop', parentId: bandId, position, width: W, height: H, data: NODES[id] });
  });
}

/**
 * Which sides a lane leaves and enters by: vertical between bands stacked
 * above one another, horizontal between boxes sharing a row.
 * @returns {[string, string]} [source side, target side]
 */
export function sidesFor(from, to) {
  const a = CENTRE[from];
  const b = CENTRE[to];
  if (Math.abs(b.y - a.y) >= H) return b.y > a.y ? ['bottom', 'top'] : ['top', 'bottom'];
  return b.x > a.x ? ['right', 'left'] : ['left', 'right'];
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
  stepup: { from: 'pep', to: 'p1-stepup', kind: 'ciba' },
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
};

// A gate outcome is not an error — the control fired and the run is waiting on
// a human. Painting STEP_UP red would read as a failure in front of a room.
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
 * Fold the run's steps into node states and edges.
 * @param {Array} steps from buildTraceSteps
 * @returns {{ nodeStates: object, edges: Array, decision: string|null, lit: number }}
 */
export function buildFlowModel(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const az = list.find((s) => s && (s.baseId || s.id) === 'authorize');
  const raw = az?.detail?.decision?.outcome;
  // NOT_RECORDED is the display default for an evaluation with no decision
  // field, not a verdict — buildRunStory makes the same exclusion.
  const decision = raw && raw !== 'NOT_RECORDED' ? raw : null;

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

  for (const step of list) {
    const spec = STEP_TO_EDGE[step?.baseId || step?.id];
    if (!spec) continue;
    const state = stateForStep(step, spec.to === 'p1-authorize' ? decision : null);
    if (!state) continue;
    if (state !== 'skipped') lit += 1;
    if (spec.node) {
      bump(spec.node, state);
      continue;
    }
    const key = `${spec.from}|${spec.to}`;
    const prev = edgeByPair.get(key);
    if (!prev) {
      edgeByPair.set(key, {
        id: key, from: spec.from, to: spec.to, kind: spec.kind, state, titles: [step.title],
      });
    } else {
      prev.titles.push(step.title);
      // Strongest state owns the lane, for the same reason it owns a box.
      if (RANK[state] > RANK[prev.state]) {
        prev.state = state;
        prev.kind = spec.kind;
      }
    }
    bump(spec.to, state);
    // The source box is at least reached — it originated the hop. Never
    // stronger than `done`, so a failing hop reddens its target, not its caller.
    bump(spec.from, state === 'skipped' ? 'skipped' : 'done');
  }

  // `lit` counts hops that ran, not lanes drawn — collapsing three bff→pep
  // steps into one line must not make the header under-report the run.
  const edges = [...edgeByPair.values()].map((e) => ({
    ...e,
    title: [...new Set(e.titles)].join(' · '),
  }));
  return { nodeStates, edges, decision, lit };
}

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
  return <div className="sfm-band" data-band={data.label} />;
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
function HopEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }) {
  const [d] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <path d={d} className={`sfm-edge sfm-edge--${data.state}`} data-kind={data.kind}>
      <title>{data.title}</title>
    </path>
  );
}

const NODE_TYPES = { band: BandNode, hop: HopNode };
const EDGE_TYPES = { hop: HopEdge };

/** The map itself, with no shell — mounted bare as a page and inside the modal. */
export function SystemFlowMapView() {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());

  useEffect(() => tokenChainTraceStore.subscribe(setStoreState), []);

  const { trace, steps } = storeState;
  const { nodeStates, edges, decision, lit } = useMemo(() => buildFlowModel(steps), [steps]);
  const story = useMemo(() => buildRunStory(trace, steps), [trace, steps]);
  const elapsed = trace?.finishedAt && trace?.startedAt ? trace.finishedAt - trace.startedAt : null;

  const flowNodes = useMemo(
    () => LAYOUT_NODES.map((n) => (n.type === 'hop' ? { ...n, data: { ...n.data, state: nodeStates[n.id] } } : n)),
    [nodeStates],
  );
  const flowEdges = useMemo(
    () => edges.map((e) => {
      const [out, into] = sidesFor(e.from, e.to);
      return {
        id: e.id, source: e.from, target: e.to, sourceHandle: `s-${out}`, targetHandle: `t-${into}`, type: 'hop', data: e,
      };
    }),
    [edges],
  );

  return (
    <div className="sfm-root">
      <div className="sfm-head">
        <span className={`sfm-verdict sfm-verdict--${verdictTone(decision, story)}`}>
          {verdictLabel(decision, story)}
        </span>
        {elapsed != null ? (
          <span className="sfm-ms">{elapsed}<span>ms</span></span>
        ) : null}
        <span className="sfm-hops">{lit} {lit === 1 ? 'hop' : 'hops'}</span>
        <span className="sfm-spacer" />
        <button type="button" className="sfm-clear" onClick={() => tokenChainTraceStore.reset()}>
          Clear
        </button>
      </div>

      <div className="sfm-caption">
        {story ? story.headline : 'No run yet — send an agent prompt and the hops paint here.'}
      </div>

      <div className="sfm-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          minZoom={0.4}
          maxZoom={2}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="sfm-legend">
        <span><i data-kind="http" />http / MCP</span>
        <span><i data-kind="oauth" />OAuth / RFC 8693</span>
        <span><i data-kind="pdp" />PDP sideband</span>
        <span><i data-kind="ciba" />CIBA step-up</span>
        <span><i data-kind="data" />data</span>
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
