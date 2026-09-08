// SystemFlowMap.jsx
// The run painted onto the deployment map — which boxes were involved, and
// where the decision was taken. Sibling of TokenTopologyPanel, which answers
// the other question (what happened, in what order) as a lane diagram.
//
// Reads the same feed as every other chain view: tokenChainTraceStore. Nothing
// here derives its own verdict — the authorize decision comes off the authorize
// step and the headline off buildRunStory, so the map cannot disagree with the
// rail or the Proof verdict.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

export const BANDS = [
  {
    id: 'ping',
    label: 'Ping Identity · PingOne · Authorize PDP',
    layout: 'row',
    nodes: ['p1-signin', 'p1-agenttok', 'p1-exchange', 'p1-authorize', 'p1-stepup'],
  },
  { id: 'stack', label: 'Demo stack · BFF + agent', layout: 'row', nodes: ['browser', 'bff', 'agent'] },
  { id: 'pep', label: 'PEP · gateway', layout: 'row', nodes: ['pep'] },
  { id: 'backends', label: 'MCP servers · data', layout: 'col', nodes: ['mcp', 'api', 'db'] },
  { id: 'model', label: 'Model · demo_llm_proxy', layout: 'row', nodes: ['llm'] },
];

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

/** Anchor two boxes on their facing sides, then curve between them. */
function pathBetween(box, a, b) {
  if (!box || !a || !b) return null;
  const A = a.getBoundingClientRect();
  const B = b.getBoundingClientRect();
  const ax = A.left - box.left + A.width / 2;
  const ay = A.top - box.top + A.height / 2;
  const bx = B.left - box.left + B.width / 2;
  const by = B.top - box.top + B.height / 2;
  // Control offsets are purely proportional. A fixed floor overshot on short
  // gaps: two adjacent boxes 10px apart produced C223…177… — control points
  // past each other — drawing an S-squiggle where a near-straight line belongs.
  // The centres pick which SIDES to leave from; the anchor points that result
  // pick which way the curve travels. Those disagree whenever the boxes overlap
  // on that axis — a wrapped flex row puts the agent below AND left of the BFF,
  // and steering by the centres then pushed both control points outside the
  // span (C134…446 for a line from 205 to 375), doubling the curve back.
  //
  // Offsets stay proportional too: a fixed floor overshot on short gaps, drawing
  // an S-squiggle between two boxes 10px apart.
  // Which axis to leave on. Centres alone mislead when one box is much wider
  // than the other: the LLM proxy fills its band, so its centre sits far to the
  // right of the agent directly above it, and a centre-distance test sent that
  // edge sweeping sideways across the map. If the boxes share a column and not
  // a row, the honest line is vertical — and vice versa.
  const sharesColumn = Math.min(A.right, B.right) - Math.max(A.left, B.left) > 0;
  const sharesRow = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 0;
  const horizontal = sharesRow !== sharesColumn
    ? sharesRow
    : Math.abs(bx - ax) > Math.abs(by - ay) * 1.1;
  if (horizontal) {
    const s = bx - ax > 0 ? 1 : -1;
    const x1 = ax + (s * A.width) / 2;
    const x2 = bx - (s * B.width) / 2;
    const dir = x2 >= x1 ? 1 : -1;
    const o = Math.abs(x2 - x1) * 0.42;
    return `M${x1},${ay} C${x1 + dir * o},${ay} ${x2 - dir * o},${by} ${x2},${by}`;
  }
  const t = by - ay > 0 ? 1 : -1;
  const y1 = ay + (t * A.height) / 2;
  const y2 = by - (t * B.height) / 2;
  const dir = y2 >= y1 ? 1 : -1;
  const p = Math.abs(y2 - y1) * 0.45;
  return `M${ax},${y1} C${ax},${y1 + dir * p} ${bx},${y2 - dir * p} ${bx},${y2}`;
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

function Band({ band, nodeStates, nodeRefs }) {
  if (!band) return null;
  return (
    <div className="sfm-band" data-band={band.label}>
      <div className={`sfm-nodes sfm-nodes--${band.layout}`}>
        {band.nodes.map((id) => (
          <div
            key={id}
            className="sfm-node"
            data-state={nodeStates[id] || undefined}
            ref={(el) => { nodeRefs.current[id] = el; }}
          >
            <span className="sfm-node-name">{NODES[id].name}</span>
            <span className="sfm-node-sub">{NODES[id].sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The map itself, with no shell — mounted bare as a page and inside the modal. */
export function SystemFlowMapView() {
  const [storeState, setStoreState] = useState(() => tokenChainTraceStore.getState());
  const [paths, setPaths] = useState([]);
  const nodeRefs = useRef({});
  const mapRef = useRef(null);

  useEffect(() => tokenChainTraceStore.subscribe(setStoreState), []);

  const { trace, steps } = storeState;
  const { nodeStates, edges, decision, lit } = useMemo(() => buildFlowModel(steps), [steps]);
  const story = useMemo(() => buildRunStory(trace, steps), [trace, steps]);
  const elapsed = trace?.finishedAt && trace?.startedAt ? trace.finishedAt - trace.startedAt : null;

  // Edges are measured, not computed, so the map stays responsive instead of
  // carrying hard-coded coordinates that drift when a node label wraps.
  const measure = useCallback(() => {
    const el = mapRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPaths(
      edges
        .map((e) => ({ ...e, d: pathBetween(box, nodeRefs.current[e.from], nodeRefs.current[e.to]) }))
        .filter((e) => e.d),
    );
  }, [edges]);

  useEffect(() => {
    measure();
    // A second pass on the next frame: inside DraggableModal the panel is still
    // sizing when the effect first runs, and the paths measured then anchor to
    // where the boxes WERE — one edge drew from the agent out through the side
    // of the panel.
    const raf = requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(raf);
    // Observe the boxes, not just their container. Nodes reflow inside a map
    // whose own box never changes (font swap, a label wrapping), and watching
    // only the container missed every one of those.
    const ro = new ResizeObserver(measure);
    if (mapRef.current) ro.observe(mapRef.current);
    for (const el of Object.values(nodeRefs.current)) if (el) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measure]);

  const rowBands = BANDS.filter((b) => ['stack', 'pep', 'backends'].includes(b.id));

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

      <div className="sfm-scroll">
        <div className="sfm-map" ref={mapRef}>
          <svg className="sfm-edges" aria-hidden="true">
            {paths.map((e) => (
              <path key={e.id} d={e.d} className={`sfm-edge sfm-edge--${e.state}`} data-kind={e.kind}>
                <title>{e.title}</title>
              </path>
            ))}
          </svg>

          <Band band={BANDS[0]} nodeStates={nodeStates} nodeRefs={nodeRefs} />

          <div className="sfm-row">
            {rowBands.map((band) => (
              <Band key={band.id} band={band} nodeStates={nodeStates} nodeRefs={nodeRefs} />
            ))}
          </div>

          <Band
            band={BANDS.find((b) => b.id === 'model')}
            nodeStates={nodeStates}
            nodeRefs={nodeRefs}
          />
        </div>
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
