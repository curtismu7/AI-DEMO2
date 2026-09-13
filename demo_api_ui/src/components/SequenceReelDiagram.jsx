// Live lifeline sequence diagram for the dashboard — the Quick Config
// "Sequence view" toggle swaps this in for the movie reel
// (ReelDock/TokenChainFilmstrip). Same data source as the reel
// (tokenChainTraceStore), same derivation helpers (buildTraceSteps via
// getState()) — this only adds a lifeline renderer on top, via
// deriveLifelineSteps. Rendering technique (participant boxes, dashed
// lifelines, arrows with markers) follows SequenceDiagramPage's proven SVG
// approach — including its zoom pattern, reused as-is since this diagram
// renders full-width/stacked (Focus Mode) rather than in a resizable side
// column, so a scale control is the right "make it bigger" affordance, not
// a width-divider drag. Only lanes touched by the current trace so far are
// shown, not a fixed 10-actor cast.
//
// Clicking a step calls onSelectStep(step) so the parent (dashboard) can
// render StepDetailPanel — the same narrative/RFC/request-response/JSON-Form
// detail the reel already shows for this exact step shape — in its own
// full-width row below the diagram.
//
// Color identity: 11 lanes is past a safe categorical hue count, so lanes
// are grouped into 5 validated hue families (see SequenceReelDiagram.css) —
// each lane keeps its own shade, but a family reads as one color group.
// Status (active/done/error) is a SEPARATE encoding layered on top (motion,
// dash, weight) — it never overrides the lane's hue, or "each step is a
// different color" would collapse back into "each status is a color".
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { deriveLifelineSteps, deriveLifelineParticipants } from "../services/tokenChainTrace/deriveLifelineSteps";
import { laneLabel } from "../services/tokenChainTrace/buildTraceSteps";
import "./SequenceReelDiagram.css";

const COL_WIDTH = 140;
const COL_MARGIN = 70;
const ROW_HEIGHT = 56;
const TOP_PAD = 80;
// The lane footer starts this far above the next row slot, which clears the
// last row's note box (it extends 14px either side of the row line).
const FOOTER_RISE = 20;
const FOOTER_PAD = 8;
// Derived, never set independently: a box wider than the column pitch runs
// into its neighbours, which is what a literal 156 against a 130 pitch did.
// 120 clears the widest lane label (HEURISTICS, measured at 95px/15px bold).
const LANE_GAP = 20;
const ACTOR_BOX_W = COL_WIDTH - LANE_GAP;

// An SVG <rect> behind a <text> cannot size itself, so estimate the label's
// advance width: 12px is .srd-note-label's size and ~0.57em is a mixed-case
// sans average. Erring wide only pads the box; erring narrow clips the label.
const NOTE_CHAR_W = 6.8;
const noteBoxWidth = (label) =>
  Math.max(150, String(label ?? "").length * NOTE_CHAR_W + 32);

const ZOOM_MIN = 60;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 130;

// Narration pace for slow mode — deliberately slow, this is for talking over
// a live crowd, not for watching the data arrive.
const SLOW_REVEAL_MS = 2600;
const SLOW_SPEED_OPTIONS = [
  { value: 1000, label: "1s (fast)" },
  { value: 1500, label: "1.5s" },
  { value: 2600, label: "2.6s (default)" },
  { value: 4000, label: "4s" },
  { value: 6000, label: "6s (slow)" },
];

// A step only earns a row once it has actually happened. buildTraceSteps
// returns the whole pipeline for every trace: steps with no evidence yet come
// back "pending", and ones outside this run's path "notinpath" or "skipped".
// This diagram has no styling for either, so drawing them showed a complete
// flow on page load and made each new run look identical to the last.
const HAPPENED = new Set(["done", "active", "error", "waiting"]);
// Rows that exist before any run: the browser step is unconditionally done and
// beginTrace carries sign-in across runs. Neither means a run has started.
const SESSION_STEP_IDS = new Set(["website", "signin"]);

function laneClass(lane) {
  return `srd-lane-${String(lane || "").toLowerCase()}`;
}

export default function SequenceReelDiagram({ onSelectStep, selectedStepId, slowMode, onToggleSlowMode }) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);

  const [zoomLevel, setZoomLevel] = useState(ZOOM_DEFAULT);
  const handleZoom = useCallback(
    (delta) => setZoomLevel((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev + delta))),
    [],
  );
  const resetZoom = useCallback(() => setZoomLevel(ZOOM_DEFAULT), []);

  const [slowRevealMs, setSlowRevealMs] = useState(SLOW_REVEAL_MS);

  const allLifelineSteps = useMemo(() => {
    const happened = (snap.steps || []).filter((step) => HAPPENED.has(step.status));
    if (!happened.some((step) => !SESSION_STEP_IDS.has(step.id))) return [];
    return deriveLifelineSteps(happened);
  }, [snap.steps]);
  const runId = snap.trace?.runId ?? null;
  const traceFinished = snap.trace?.outcome === "ok" || snap.trace?.outcome === "error";

  // Slow mode: reveal one step at a time on a timer instead of the full set
  // arriving instantly. Real steps keep arriving at full speed underneath —
  // this only paces what's drawn.
  const [revealedCount, setRevealedCount] = useState(allLifelineSteps.length);
  const [playing, setPlaying] = useState(false);
  // A narration is something the presenter started. Slow mode alone is not
  // one: it is restored from localStorage, so it is already on at page load.
  const [narrating, setNarrating] = useState(false);
  const totalSteps = allLifelineSteps.length;

  // Not narrating: everything that has happened is visible as it arrives.
  useEffect(() => {
    if (!slowMode || !narrating) setRevealedCount(totalSteps);
  }, [slowMode, narrating, totalSteps]);

  // Start a narration on an observed change only — slow mode being switched on,
  // or a new run beginning while it is on — never merely on mount, which
  // replayed the last trace every time the page loaded. Compared against the
  // previous value rather than a "skip the first run" ref: StrictMode
  // double-invokes effects and silently defeats those.
  const prevSlowRef = useRef(slowMode);
  const prevRunRef = useRef(runId);
  useEffect(() => {
    const turnedOn = slowMode && !prevSlowRef.current;
    const newRun = slowMode && runId != null && runId !== prevRunRef.current;
    prevSlowRef.current = slowMode;
    prevRunRef.current = runId;
    if (!slowMode) {
      setNarrating(false);
      return;
    }
    if (turnedOn || newRun) {
      setNarrating(true);
      setRevealedCount(0);
      setPlaying(true);
    }
  }, [slowMode, runId]);

  // The timer only runs while playing, so Pause, Prev and Next all hold the
  // reveal where the presenter put it. It re-arms when a live run adds steps.
  useEffect(() => {
    if (!slowMode || !playing || revealedCount >= totalSteps) return;
    const timer = setTimeout(() => setRevealedCount((prev) => prev + 1), slowRevealMs);
    return () => clearTimeout(timer);
  }, [slowMode, playing, revealedCount, totalSteps, slowRevealMs]);

  // Halt at the end of a FINISHED run. Catching up with a run that is still
  // going is not the end: the pace outruns the server, and halting there would
  // stop the narration mid-flow until the presenter pressed Play.
  useEffect(() => {
    if (slowMode && playing && traceFinished && totalSteps > 0 && revealedCount >= totalSteps) setPlaying(false);
  }, [slowMode, playing, traceFinished, revealedCount, totalSteps]);

  const goToStep = useCallback(
    (n) => {
      setNarrating(true);
      setPlaying(false);
      setRevealedCount(Math.max(0, Math.min(totalSteps, n)));
    },
    [totalSteps],
  );

  const togglePlay = useCallback(() => {
    setNarrating(true);
    // At the end with nothing playing, Play means "run it again".
    if (revealedCount >= totalSteps && !playing) {
      setRevealedCount(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [revealedCount, totalSteps, playing]);

  const lifelineSteps = slowMode && narrating ? allLifelineSteps.slice(0, revealedCount) : allLifelineSteps;
  // Cast comes from the whole trace, not the revealed slice: deriving it from
  // the slice re-flows every column each time a step introduces a new lane, so
  // the reveal jitters sideways instead of drawing one arrow into a fixed set
  // of lifelines.
  const participants = useMemo(() => deriveLifelineParticipants(allLifelineSteps), [allLifelineSteps]);

  const stepsById = useMemo(() => {
    const map = new Map();
    for (const step of snap.steps || []) map.set(step.id, step);
    return map;
  }, [snap.steps]);

  const selectStep = useCallback(
    (id) => {
      if (typeof onSelectStep !== "function") return;
      const fullStep = stepsById.get(id);
      if (fullStep) onSelectStep(fullStep);
    },
    [onSelectStep, stepsById],
  );

  // Keep the currently-executing step in view as the diagram grows — the
  // whole point of a live narration surface is that the audience never has
  // to hunt for where things are. Falls back to the newest step when
  // nothing is explicitly "active" (e.g. the run just finished).
  const activeStepRef = useRef(null);
  const activeStepId = useMemo(() => {
    const active = [...lifelineSteps].reverse().find((s) => s.status === "active");
    return active ? active.id : lifelineSteps[lifelineSteps.length - 1]?.id;
  }, [lifelineSteps]);
  const followFooter = activeStepId != null && activeStepId === lifelineSteps[lifelineSteps.length - 1]?.id;
  useEffect(() => {
    const el = activeStepRef.current;
    // Deliberately not scrollIntoView: it scrolls every scrollable ancestor on
    // BOTH axes, and .srd-scroll is overflow-x:auto. An arrow step spans two
    // lanes, so bringing a late one into view drags the diagram sideways and
    // pushes the first lanes off-screen — the cast should stay put and only
    // the vertical follow is wanted. This reproduces `block: "nearest"` (move
    // the minimum, do nothing when already visible) and never touches
    // scrollLeft.
    const scroller = el?.closest(".srd-root");
    if (!el || !scroller) return;
    const step = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    // The control rows are pinned over the scroller's top and bottom edges, so
    // the visible band is between them. Measuring against the scroller alone
    // parked the newest step underneath the bottom row.
    const topRow = scroller.querySelector(".srd-toolbar--top")?.getBoundingClientRect();
    const bottomRow = scroller.querySelector(".srd-toolbar--bottom")?.getBoundingClientRect();
    const bandTop = topRow ? Math.max(view.top, topRow.bottom) : view.top;
    const bandBottom = bottomRow ? Math.min(view.bottom, bottomRow.top) : view.bottom;
    // Following the newest row, the lane footer sits just under it — keep it in
    // view too, or the lane names are off-screen exactly while narrating. Not for
    // a mid-trace active step: the footer is then far below, and chasing it would
    // push the step itself out of view.
    const footer = followFooter
      ? scroller.querySelector(".srd-actor-box--footer")?.getBoundingClientRect()
      : null;
    const wantBottom = footer ? Math.max(step.bottom, footer.bottom) : step.bottom;
    const delta =
      step.top < bandTop ? step.top - bandTop
      : wantBottom > bandBottom ? wantBottom - bandBottom
      : 0;
    if (delta) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
  }, [activeStepId, followFooter]);

  // Horizontal follow, slow mode only: while narrating, the step being revealed
  // should stay on screen even once the reveal walks past the fold. Off, the
  // diagram stays anchored at the first lane — opening a finished trace should
  // show the cast from the start, not drop the viewer mid-diagram.
  //
  // Gated on slowMode (observed state), NOT a useRef "skip the first run" guard:
  // StrictMode double-invokes effects and silently defeats those.
  useEffect(() => {
    if (!slowMode) return;
    const el = activeStepRef.current;
    const box = el?.closest(".srd-scroll");
    if (!el || !box) return;
    const step = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    const pad = 24;
    let delta = 0;
    if (step.width > view.width) {
      // An arrow spanning more lanes than fit on screen: centre it, rather than
      // jam one end against an edge and hide the other.
      delta = step.left + step.width / 2 - (view.left + view.width / 2);
    } else if (step.left < view.left + pad) {
      delta = step.left - view.left - pad;
    } else if (step.right > view.right - pad) {
      delta = step.right - view.right + pad;
    }
    if (delta) box.scrollTo({ left: box.scrollLeft + delta, behavior: "smooth" });
  }, [activeStepId, slowMode]);

  // Keyed on the trace, not the revealed slice: a slow-mode reveal sits at zero
  // revealed steps for one tick, and bailing to the placeholder there would
  // unmount the toolbar — including the button to turn slow mode back off.
  if (!allLifelineSteps.length) {
    return (
      <div className="srd-empty">
        Run an agent request to populate the sequence diagram.
      </div>
    );
  }

  // Boxes centre on their lane, so the outermost lanes need half a box of
  // clearance or the viewBox crops them. Measured over the whole trace so the
  // canvas width — and therefore the zoom scale — holds still during a reveal.
  const maxNoteHalf = allLifelineSteps.reduce(
    (m, s) => (s.type === "note" ? Math.max(m, noteBoxWidth(s.label) / 2) : m),
    0,
  );
  const pad = Math.max(COL_MARGIN, ACTOR_BOX_W / 2, maxNoteHalf) + 8;
  const colX = (lane) => pad + participants.indexOf(lane) * COL_WIDTH;
  const width = pad * 2 + Math.max(participants.length - 1, 0) * COL_WIDTH;
  const footerY = TOP_PAD + lifelineSteps.length * ROW_HEIGHT - FOOTER_RISE;
  const height = footerY + 48 + FOOTER_PAD;

  // Rendered above and below the diagram: during a narration the presenter is
  // looking at the bottom of a tall reveal, and reaching back to the top row to
  // press Next defeats the point.
  const toolbar = (position) => (
    <div className={`srd-toolbar srd-toolbar--${position}`}>
      <button type="button" className="srd-zoom-btn" onClick={() => handleZoom(-ZOOM_STEP)} title="Zoom out">
        −
      </button>
      <button type="button" className="srd-zoom-reset" onClick={resetZoom} title="Reset zoom">
        {zoomLevel}%
      </button>
      <button type="button" className="srd-zoom-btn" onClick={() => handleZoom(ZOOM_STEP)} title="Zoom in">
        +
      </button>
      {onToggleSlowMode && (
        <button
          type="button"
          className={`srd-slow-btn ${slowMode ? "srd-slow-btn--active" : ""}`}
          onClick={onToggleSlowMode}
          title={slowMode ? "Turn off slow mode" : "Turn on slow mode for narration"}
        >
          Slow
        </button>
      )}
      {slowMode && (
        <>
          <button
            type="button"
            className="srd-step-btn"
            onClick={() => goToStep(revealedCount - 1)}
            disabled={revealedCount <= 0}
            title="Previous step"
          >
            Prev
          </button>
          <button
            type="button"
            className="srd-step-btn srd-step-btn--play"
            onClick={togglePlay}
            title={
              revealedCount >= totalSteps && !playing
                ? "Replay from the first step"
                : playing
                  ? "Pause the reveal"
                  : "Resume the reveal"
            }
          >
            {revealedCount >= totalSteps && !playing ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="srd-step-btn"
            onClick={() => goToStep(revealedCount + 1)}
            disabled={revealedCount >= totalSteps}
            title="Next step"
          >
            Next
          </button>
          <select
            className="srd-speed-select"
            value={slowRevealMs}
            onChange={(e) => setSlowRevealMs(Number(e.target.value))}
            title="Adjust pace of step revelation"
          >
            {SLOW_SPEED_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="srd-slow-badge" title="Steps are revealing slowly for narration">
            Slow mode — {Math.min(revealedCount, totalSteps)}/{totalSteps}
          </span>
        </>
      )}
    </div>
  );

  return (
    <div className="srd-root">
      {toolbar("top")}
      <div className="srd-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="srd-svg"
          style={{ width: `${(width * zoomLevel) / 100}px` }}
          role="img"
          aria-label="Live sequence diagram of this session's token chain"
        >
          {participants.map((lane) => {
            const x = colX(lane);
            return (
              <g key={lane} className={laneClass(lane)}>
                <rect x={x - ACTOR_BOX_W / 2} y="4" width={ACTOR_BOX_W} height="48" rx="8" className="srd-actor-box" />
                <text x={x} y="34" textAnchor="middle" className="srd-actor-label">
                  {laneLabel(lane)}
                </text>
                <line x1={x} y1="52" x2={x} y2={footerY} className="srd-lifeline" />
                {/* The cast again at the foot of the lifelines: during a tall
                    reveal the view sits at the bottom, where the top row is
                    long out of sight. Rides just under the newest row. */}
                <rect
                  x={x - ACTOR_BOX_W / 2}
                  y={footerY}
                  width={ACTOR_BOX_W}
                  height="48"
                  rx="8"
                  className="srd-actor-box srd-actor-box--footer"
                />
                <text x={x} y={footerY + 30} textAnchor="middle" className="srd-actor-label srd-actor-label--footer">
                  {laneLabel(lane)}
                </text>
              </g>
            );
          })}
          {lifelineSteps.map((step, idx) => {
            const y = TOP_PAD + idx * ROW_HEIGHT;
            const statusClass = `srd-status-${step.status || "pending"}`;
            const isSelected = step.id === selectedStepId;
            const isActive = step.status === "active";
            const stepLaneClass = laneClass(step.type === "note" ? step.lane : step.to);
            const groupClass = `${statusClass} ${stepLaneClass}${isSelected ? " srd-selected" : ""}`;
            const setStepRef = (el) => {
              if (step.id === activeStepId) activeStepRef.current = el;
            };
            if (step.type === "note") {
              const x = colX(step.lane);
              const noteW = noteBoxWidth(step.label);
              return (
                <g
                  key={step.id}
                  ref={setStepRef}
                  className={groupClass}
                  onClick={() => selectStep(step.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectStep(step.id)}
                >
                  <rect x={x - noteW / 2} y={y - 14} width={noteW} height="28" rx="5" className="srd-note-box" />
                  <text x={x} y={y + 5} textAnchor="middle" className="srd-note-label">
                    {step.label}
                  </text>
                  {isActive && <circle cx={x} cy={y} r="6" className="srd-active-pulse" />}
                </g>
              );
            }
            const fromX = colX(step.from);
            const toX = colX(step.to);
            return (
              <g
                key={step.id}
                ref={setStepRef}
                className={groupClass}
                onClick={() => selectStep(step.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectStep(step.id)}
              >
                <line
                  x1={fromX}
                  y1={y}
                  x2={toX}
                  y2={y}
                  className="srd-arrow"
                  markerEnd={`url(#srd-arrowhead-${String(step.to || "").toLowerCase()})`}
                />
                <text x={(fromX + toX) / 2} y={y - 5} textAnchor="middle" className="srd-arrow-label">
                  {step.label}
                </text>
                {isActive && (
                  <circle r="4" className="srd-active-dot">
                    <animateMotion path={`M ${fromX},${y} L ${toX},${y}`} dur="1.4s" repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })}
          <defs>
            {participants.map((p) => p.toLowerCase()).map((lane) => (
              <marker
                key={lane}
                id={`srd-arrowhead-${lane}`}
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,7 L8,3.5 z" className={`srd-arrowhead-fill srd-lane-${lane}`} />
              </marker>
            ))}
          </defs>
        </svg>
      </div>
      {toolbar("bottom")}
    </div>
  );
}
