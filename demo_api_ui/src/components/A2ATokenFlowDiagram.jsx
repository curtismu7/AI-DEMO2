// demo_api_ui/src/components/A2ATokenFlowDiagram.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
  useReactFlow,
  ReactFlowProvider as RFProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DiagramControls, STEP_TIME_OPTIONS, DEFAULT_STEP_MS } from './diagram';
import { useThemeOptional } from '../context/ThemeContext';
import './A2ATokenFlowDiagram.css';

/**
 * A2ATokenFlowDiagram — large, zoomable React Flow canvas rendering the A2A
 * delegation chain from real tokenEvents, with the shared DiagramControls
 * toolbar (play/pause/stepper/step-time/reset + zoom) matching
 * ReactFlowPocPage.jsx. Each token event is an edge hop; the active hop
 * carries an animated traveling token (SVG animateMotion) and its claims are
 * shown in a side inspector.
 *
 * Layout is FIXED (not auto-generated): five actors in delegation order, with
 * PingOne placed between the agents where the exchanges happen.
 */

const ACTORS = {
  user: { label: 'User', sub: 'signed-in customer (subject)', color: '#7c3aed', icon: '👤' },
  generalist: { label: 'Generalist Agent 1', sub: 'Banking Agent (BFF)', color: '#004687', icon: '🤖' },
  pingone: { label: 'PingOne', sub: 'token mint + Authorize', color: '#dc2626', icon: '🔐' },
  specialist: { label: 'Specialist Agent 2', sub: 'narrow-scope specialist', color: '#b45309', icon: '🤖' },
  gateway: { label: 'MCP Gateway', sub: 'enforcement + specialist tool', color: '#0e7490', icon: '🔗' },
};

const HOPS = {
  'user-token': { from: 'user', to: 'generalist', label: 'presents subject token' },
  'a2a-agent1-actor': { from: 'generalist', to: 'pingone', label: 'client_credentials (actor)' },
  'a2a-exchange1': { from: 'pingone', to: 'generalist', label: 'Exchange #1 · RFC 8693' },
  'a2a-protocol-bearer': { from: 'generalist', to: 'specialist', label: 'wire bearer (Exchange #1 token)' },
  'a2a-agent-card': { from: 'generalist', to: 'specialist', label: 'Agent Card discovery' },
  'a2a-protocol-message': { from: 'generalist', to: 'specialist', label: 'SendMessage · JSON-RPC' },
  'a2a-agent2-actor': { from: 'specialist', to: 'pingone', label: 'client_credentials (actor)' },
  'a2a-exchange2': { from: 'pingone', to: 'specialist', label: 'Exchange #2 · nested act' },
  'a2a-mcp-tool': { from: 'specialist', to: 'gateway', label: 'MCP tool call (nested-act token)' },
  'a2a-mcp-result': { from: 'gateway', to: 'specialist', label: 'tool result → JSON-RPC response' },
};

const FALLBACK_HOP = { from: 'pingone', to: 'generalist', label: 'token event' };

const IDENTITY_IDS = new Set(['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2']);

function hopFor(ev) {
  return HOPS[ev?.id] || FALLBACK_HOP;
}

function statusIsError(ev) {
  return ['error', 'failed', 'failure', 'denied'].includes(String(ev?.status || '').toLowerCase());
}

function evidenceOf(ev) {
  return ev?.claims || ev?.exchangeRequest || ev?.protocolRequest || ev?.protocolResponse || ev?.agentCard || null;
}

// ─── Custom actor node ───────────────────────────────────────────────────────

function ActorNode({ data }) {
  const actor = ACTORS[data.actor] || ACTORS.generalist;
  return (
    <div
      className={`a2t-node${data.state === 'active' ? ' a2t-node--active' : ''}${data.state === 'done' ? ' a2t-node--done' : ''}`}
      style={{ '--actor-color': actor.color }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="a2t-node__bar" style={{ background: actor.color }} />
      <div className="a2t-node__row">
        <span className="a2t-node__icon" style={{ color: actor.color }}>{actor.icon}</span>
        <div>
          <div className="a2t-node__title">{data.label}</div>
          <div className="a2t-node__sub">{actor.sub}</div>
        </div>
      </div>
      {data.tokenSummary && (
        <div className="a2t-node__token" style={{ borderColor: actor.color }}>
          {data.tokenSummary}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { actor: ActorNode };

// ─── Animated token edge ─────────────────────────────────────────────────────

function TokenEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, animated, style, markerEnd, data }) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });
  const label = data?.label;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <>
          <path id={`${id}-lp`} d={path} fill="none" stroke="none" />
          <text className="a2t-edge-label">
            <textPath href={`#${id}-lp`} startOffset="50%" textAnchor="middle">{label}</textPath>
          </text>
        </>
      )}
      {animated && (
        <circle r="7" className="a2t-traveling-token" style={{ fill: style?.stroke }}>
          <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}

const edgeTypes = { token: TokenEdge };

// ─── Graph construction ──────────────────────────────────────────────────────

function buildNodes(events, labels) {
  const presentActors = new Set(['user', 'generalist', 'pingone', 'specialist', 'gateway']);
  events.forEach((ev) => {
    const hop = HOPS[ev?.id];
    if (hop) { presentActors.add(hop.from); presentActors.add(hop.to); }
  });
  const actorIds = Object.keys(ACTORS).filter((a) => presentActors.has(a));
  return actorIds.map((actorId, i) => {
    const actor = ACTORS[actorId];
    // The last event delivered TO this actor (or minted by it) scopes its chip.
    const lastScoped = [...events]
      .map((ev, idx) => ({ ev, idx }))
      .filter(({ ev }) => HOPS[ev?.id]?.to === actorId)
      .pop();
    return {
      id: actorId,
      type: 'actor',
      position: { x: i * 300, y: 0 },
      data: {
        actor: actorId,
        label: labels?.[actorId] || actor.label,
        tokenSummary: lastScoped?.ev?.claims?.scope || null,
      },
    };
  });
}

function buildEdges(events) {
  return events.map((ev, i) => {
    const hop = hopFor(ev);
    const isIdentity = IDENTITY_IDS.has(ev?.id);
    return {
      id: `hop-${ev?.id || i}`,
      source: hop.from,
      target: hop.to,
      type: 'token',
      data: { eventIndex: i, label: hop.label, ev },
      style: {
        stroke: statusIsError(ev) ? '#dc2626' : isIdentity ? '#b45309' : '#1d4ed8',
        strokeWidth: 2,
      },
    };
  });
}

// ─── Canvas inner (needs ReactFlow context for zoom) ─────────────────────────

function CanvasInner({ events, labels, playing, activeIndex, stepMs, onStepEnd }) {
  const { zoomIn, zoomOut, zoomTo, getZoom } = useReactFlow();
  const nodes = useMemo(() => buildNodes(events, labels), [events, labels]);
  const baseEdges = useMemo(() => buildEdges(events), [events]);

  const styledEdges = useMemo(
    () =>
      baseEdges.map((edge) => {
        const idx = edge.data?.eventIndex ?? -1;
        const isActive = idx === activeIndex;
        const isPast = idx < activeIndex;
        return {
          ...edge,
          animated: playing && isActive,
          style: {
            ...edge.style,
            opacity: isActive || isPast ? 1 : 0.25,
            strokeWidth: isActive ? 3 : 2,
          },
        };
      }),
    [baseEdges, activeIndex, playing],
  );

  const activeNodes = useMemo(
    () =>
      nodes.map((n) => {
        const activeEdge = baseEdges[activeIndex];
        const touched = activeEdge && (activeEdge.source === n.id || activeEdge.target === n.id);
        const firstTouch = baseEdges.findIndex((e) => e.source === n.id || e.target === n.id);
        const state = touched ? 'active' : firstTouch >= 0 && activeIndex > firstTouch ? 'done' : 'idle';
        return { ...n, data: { ...n.data, state } };
      }),
    [nodes, baseEdges, activeIndex],
  );

  // Advance the stepper when the traveling-token animation completes a lap.
  useEffect(() => {
    if (!playing) return undefined;
    const t = window.setTimeout(() => onStepEnd(), stepMs);
    return () => window.clearTimeout(t);
  }, [playing, activeIndex, stepMs, onStepEnd]);

  const { darkMode } = useThemeOptional();

  return (
    <div className="a2t-canvas" data-testid="a2t-token-flow-canvas">
      <ReactFlow
        nodes={activeNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.3}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
      </ReactFlow>
    </div>
  );
}

// ─── Outer component: stepper + play controls + inspector ───────────────────

export default function A2ATokenFlowDiagram({ tokenEvents, labels }) {
  const events = (Array.isArray(tokenEvents) ? tokenEvents : []).filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);
  const { darkMode } = useThemeOptional();

  useEffect(() => {
    setActiveIndex(0);
    setSelected(null);
    setSimulating(false);
    setPaused(false);
  }, [tokenEvents]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const showStep = useCallback((index) => {
    clearTimer();
    setSimulating(false);
    setPaused(false);
    setActiveIndex(Math.max(0, Math.min(index, events.length - 1)));
  }, [clearTimer, events.length]);

  const playFrom = useCallback((index) => {
    clearTimer();
    setSimulating(true);
    setPaused(false);
    setActiveIndex(index);
    if (index < events.length - 1) {
      timerRef.current = window.setTimeout(() => playFrom(index + 1), stepMs);
    } else {
      timerRef.current = window.setTimeout(() => setSimulating(false), stepMs);
    }
  }, [clearTimer, events.length, stepMs]);

  if (!events.length) return null;

  const activeEvent = events[activeIndex] || null;
  const inspectorEv = selected != null ? events[selected] : activeEvent;

  return (
    <div className="a2t" data-testid="a2t-token-flow-diagram">
      <div className="a2t-controls">
        <DiagramControls
          zoom={null}
          currentStep={activeIndex + 1}
          totalSteps={events.length}
          isSimulating={simulating}
          isPaused={paused}
          onSimulate={() => playFrom(0)}
          onPrev={() => showStep(activeIndex - 1)}
          onPause={() => { clearTimer(); setPaused(true); }}
          onResume={() => {
            setPaused(false);
            if (activeIndex < events.length - 1) {
              timerRef.current = window.setTimeout(() => playFrom(activeIndex + 1), stepMs);
            } else {
              setSimulating(false);
            }
          }}
          onNext={() => showStep(Math.min(activeIndex + 1, events.length - 1))}
          onStop={() => { clearTimer(); setSimulating(false); setPaused(false); }}
          onReset={() => { clearTimer(); setSimulating(false); setPaused(false); setActiveIndex(0); setSelected(null); }}
          stepTimeOptions={STEP_TIME_OPTIONS}
          stepMs={stepMs}
          onSetStepMs={setStepMs}
        />
        <span className="a2t-counter" title={activeEvent?.label || activeEvent?.id}>
          {activeEvent?.label || activeEvent?.id}
        </span>
      </div>

      <div className="a2t-stage">
        <ReactFlowProvider>
          <CanvasInner
            events={events}
            labels={labels}
            playing={simulating && !paused}
            activeIndex={activeIndex}
            stepMs={stepMs}
            onStepEnd={() => {
              if (!simulating || paused) return;
              if (activeIndex < events.length - 1) {
                setActiveIndex((i) => i + 1);
              } else {
                setSimulating(false);
              }
            }}
          />
        </ReactFlowProvider>
      </div>

      {inspectorEv && (
        <aside className="a2t-inspector">
          <div className="a2t-inspector-head">
            <span className="a2t-inspector-title">
              {inspectorEv.label || inspectorEv.id}
            </span>
            {selected != null && (
              <button
                type="button"
                className="a2t-inspector-close"
                onClick={() => setSelected(null)}
                aria-label="Back to live step"
              >
                ✕
              </button>
            )}
          </div>
          {inspectorEv.explanation && (
            <p className="a2t-inspector-note">{inspectorEv.explanation}</p>
          )}
          <pre className="a2t-inspector-json">
            {JSON.stringify(evidenceOf(inspectorEv) || {}, null, 2)}
          </pre>
        </aside>
      )}
    </div>
  );
}
