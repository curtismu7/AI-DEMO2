import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { protectedActionLabel } from './protectedActionLabel';
import { useLocation } from "react-router-dom";
import apiClient from "../services/apiClient";
import { useVertical } from "../vertical/useVertical";
import PersonalAgentStudioPage from "./PersonalAgentStudioPage";
import DigitalWorkerRunPanel from "./DigitalWorkerRunPanel";
import DigitalWorkerSignIn from "./DigitalWorkerSignIn";
import useConsentPhone from "./useConsentPhone";
// The studio emits workload-agents__* classes styled there; this page mounts the
// studio outside WorkloadAgentsPage, same as PersonalAgentClientWindow does.
import "./WorkloadAgentsPage.css";
import {
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeResizer,
  ConnectionMode,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import ReactFlow from "../components/diagram/UniqueReactFlow";
import "@xyflow/react/dist/style.css";
import ConfirmModal from "../components/ConfirmModal";
import DraggableModal from "../components/DraggableModal";
import DiagramStepBar from "../components/DiagramStepBar";
import { edgeCaptions, markNodes, stepEdges, useDiagramStepper } from "../hooks/useDiagramStepper";
import { notifyError } from "../utils/appToast";
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip } from "../components/pingUi";
import { INITIAL_NODES, INITIAL_EDGES, diagramSignature, parseDiagram } from "./digitalWorkerDiagram";
import "./DigitalWorkerPage.css";

// /digital-worker. Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md). Applied: P2 banner first (what is real, what is a mock, what is only a drawing), P3 frame
// and sections, P4 card (the agent card), P7 chips with a word (sign-in, run state, diagram), P9 buttons.
// Skipped: P5 kv on this file (the studio and the run panel carry the key/value rows), P6 inspector (no inspector on
// this page), P8 (the diagram boxes keep their own fixed pastel fills with dark ink, in both themes, by design).
//
// P9 "exactly one primary per view", per state (the page's own buttons are all secondaries; the primary lives in the
// child that owns the action):
//   Attended tab, signed in      -> the studio's "Run <action>" (becomes "Verify with MFA and run again" at step-up)
//   Attended tab, signed out     -> "Sign in" (the studio is not mounted)
//   Unattended tab, not armed    -> none: the one control is the "Arm the worker" switch, which is a switch, not a button
//   Unattended tab, armed        -> "Fire without a human turn"
//   Unattended tab, run parked   -> "Ask for approval on the phone" (or "Approve" with no amount); Fire drops to secondary
//   Unattended tab, signed out   -> "Sign in"
//   Consent card open (unattended) -> the card owns the primary ("Open mock phone", then "Close"); Fire / Ask / Approve step down
//   Signed-out phone (consent card's sign-in) -> a secondary, so the run's own primary stays the one
//   Edge-label dialog            -> "Save", inside the dialog (a separate surface, so it is its own view)
// The diagram's toolbar and the shared Simulate bar are secondaries (shared .pu-page rule).
//
// The verticals this page can run a workload agent for — mirrors WorkloadAgentsPage's set,
// so an unsupported active vertical (e.g. pingone-admin) still gets a runnable default.
const SUPPORTED_VERTICALS = new Set([
  "banking", "healthcare", "retail", "walbuy", "government",
  "university", "workforce", "sporting-goods", "manufacturing", "investment", "airlines",
]);
// What goes on the consent phone for a use case, read from its own run prompt ("pay $600 tuition"). A prompt
// that names no amount has nothing to approve on a phone, so the caller runs it as before.
function consentSnapshot(uc) {
  const match = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(uc?.runPrompt || "");
  const amount = match ? Number(match[1].replace(/,/g, "")) : 0;
  if (!(amount > 0)) return null;
  return { amount, type: /withdraw/i.test(uc.runPrompt) ? "withdrawal" : "transfer", description: String(uc.runPrompt).slice(0, 80) };
}

const MODES = [
  { id: "attended", label: "Attended", hint: "you ask" },
  { id: "unattended", label: "Unattended", hint: "it starts itself" },
];
const DEFAULT_VERTICAL = "banking"; // uc38's canonical run here: the wire transfer with step-up MFA and HITL

export default function DigitalWorkerPage() {
  const location = useLocation();
  const { activeId } = useVertical();
  const params = new URLSearchParams(location.search);
  const vertical = params.get("vertical") || (SUPPORTED_VERTICALS.has(activeId) ? activeId : DEFAULT_VERTICAL);

  // Scenario loading mirrors WorkloadAgentsPage: the vertical choices arrive from
  // /api/verticals/list, the protected-action use case (UC38) resolves per vertical, and the studio
  // only mounts once both are in hand. The studio's own "Run <action>" button is the
  // one way to start the run; mounting never fires it (its runNonce stays 0).
  const [catalog, setCatalog] = useState({ vertical: null, useCase: null });
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false); // the wall answered 401: not an error, an invitation
  const [panelNeedsSignIn, setPanelNeedsSignIn] = useState(false); // the unattended panel's flag read answered 401
  const signedOut = needsSignIn || panelNeedsSignIn;

  // One consent phone for the page, shared by the attended Run button and the unattended panel (the server
  // keeps a single pending mock request per session).
  const { ask: askConsent, host: consentHost, open: consentOpen } = useConsentPhone();
  const consentGate = useCallback(async (uc) => {
    const snapshot = consentSnapshot(uc);
    if (!snapshot) return true;
    return (await askConsent(snapshot, `${uc.id}: ${uc.runPrompt}`)) === "approved";
  }, [askConsent]);
  const [mode, setMode] = useState("attended");

  useEffect(() => {
    let live = true;
    // Pinned mirror of WorkloadAgentsPage's loading order. This page has no vertical
    // picker, so the payload has no consumer here — the server 400s an unknown
    // vertical on the use-case fetch below, and that alert is the real guard.
    apiClient.get("/api/verticals/list")
      .catch((err) => {
        if (!live) return;
        if (err?.response?.status === 401) setNeedsSignIn(true);
        else setError("Vertical choices could not be loaded.");
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setCatalog({ vertical: null, useCase: null });
    setError("");
    setNeedsSignIn(false);
    apiClient.get(`/api/use-cases/UC38?vertical=${encodeURIComponent(vertical)}`)
      .then(({ data }) => { if (live) setCatalog({ vertical, useCase: data.useCase }); })
      .catch((err) => {
        if (!live) return;
        if (err?.response?.status === 401) setNeedsSignIn(true);
        else setError("The governed run could not be loaded for this vertical.");
      });
    return () => { live = false; };
  }, [vertical]);

  const cases = catalog.vertical === vertical ? catalog : {};
  const selected = cases.useCase;


  // The attended studio is tall; a plain hash link would also push a router entry.
  const jumpToDiagram = (ev) => {
    ev.preventDefault();
    document.getElementById("dw-diagram")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // Built here, not inside the studio's tag: the pattern check reads a tag's attributes up to the first ">".
  const reelEmpty = <p className="dw-reel-empty">Run it to see each hop's token here.</p>;
  const jumpLink = (
    <a href="#dw-diagram" className="dw-page__jump" onClick={jumpToDiagram}>Jump to the diagram ↓</a>
  );

  return (
    <PingPage className="dw-page">
      <SimBanner data-testid="dw-banner">
        <strong>SERVER RUNS, MOCK PHONE, DRAWN DIAGRAM</strong> —{" "}
        {/* The one sentence that depends on what the page has actually seen. It is a live region from first render, so a
            401 arriving later or a tab switch is announced. */}
        <span role="status" data-testid="dw-banner-state">
          {signedOut
            ? "the server answered 401, so you are not signed in and nothing has run from this page yet. Sign in first; after that, runs call this app's own server with your session."
            : mode === "unattended"
              ? "Fire calls this app's own server, and the worker's gates and token events are what that server returned for that run."
              : "Run calls this app's own server with your session, and the gates and token events are what that server returned for that run. Open client window opens a simulated look-alike client, not a real one."}
        </span>{" "}
        The approval phone is a mock: it never sends a real push or text. The diagram at the bottom is a drawing: Simulate only
        animates it, nothing on it is called, and your edits stay in this browser.
      </SimBanner>
      <PageHeader
        eyebrow="Agents & Governance"
        title="Digital Worker"
        summary="An assistant answers questions. A worker takes action — it holds delegated identity, spends it across tools, and every action is governed."
      />
      <PageFrame>
        {/* The agent comes first: both modes stay mounted (hidden, not unmounted) so the
            arm state and any run in progress survive a tab switch. */}
        <Section
          id="dw-agent-h"
          kicker="1 · Run the worker"
          title="Digital worker agent"
          lede={<>Attended: you ask and a mock phone approves. Unattended: the worker starts itself. {jumpLink}</>}
        >
          <Card className="dw-agent">
            <div className="dw-tabs" role="tablist" aria-label="How the worker runs">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  id={`dw-tab-${m.id}`}
                  aria-selected={mode === m.id}
                  aria-controls={`dw-pane-${m.id}`}
                  className="dw-tab"
                  onClick={() => setMode(m.id)}
                >
                  {m.label}<span className="dw-tab__hint">{m.hint}</span>
                </button>
              ))}
            </div>

            {consentHost}

            <div role="tabpanel" id="dw-pane-attended" aria-labelledby="dw-tab-attended" hidden={mode !== "attended"} className="dw-agent__pane">
              <p className="pu-note dw-agent__intro">{selected ? `${protectedActionLabel(selected)[0].toUpperCase()}${protectedActionLabel(selected).slice(1)}` : "Protected action"} with step-up MFA and human approval</p>
              {needsSignIn ? <DigitalWorkerSignIn what="run the governed worker" /> : error && (
                <p role="alert" className="pu-status-line dw-run-task__error"><StatusChip tone="danger">Failed</StatusChip>{error}</p>
              )}
              {selected ? (
                <PersonalAgentStudioPage key={`${vertical}:UC38`} scenario={selected} vertical={vertical} consentGate={consentGate} reelEmptyState={reelEmpty} />
              ) : !error && !needsSignIn && (
                <p role="status" className="pu-status-line"><StatusChip>Loading</StatusChip>Loading the governed run…</p>
              )}
            </div>

            <div role="tabpanel" id="dw-pane-unattended" aria-labelledby="dw-tab-unattended" hidden={mode !== "unattended"} className="dw-agent__pane">
              <DigitalWorkerRunPanel onAskConsent={askConsent} consentOpen={consentOpen} onNeedsSignIn={setPanelNeedsSignIn} />
            </div>
          </Card>
        </Section>

        <Section
          id="dw-diagram"
          kicker="2 · The architecture"
          title="How it works"
          lede="Reference drawing of both runs: who holds which token, and where the approval happens."
        >
          <p className="pu-status-line"><StatusChip>Drawing</StatusChip>Nothing here is called live. Simulate walks the arrows in order; it does not run anything.</p>
          <div className="dw-page__canvas">
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// ── The diagram: everything below is the editable canvas (React Flow). It sits after the page so the page's banner is
// the first element in this file's markup. ──
// Digital Worker: editable architecture diagram. Double-click a box or zone to rename it, double-click
// an arrow to relabel it, select + Delete to remove, drag to move. Edits autosave to this browser only.
// Bump the version when the built-in layout changes, so browsers holding an older saved copy pick it up.
const STORE = "digital-worker-diagram-v3";
const SIDES = [["t", Position.Top], ["r", Position.Right], ["b", Position.Bottom], ["l", Position.Left]];

function Handles() {
  return SIDES.map(([id, pos]) => <Handle key={id} id={id} type="source" position={pos} />);
}

function useLabelEdit(id, label) {
  const { setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label);
  const commit = () => {
    setEditing(false);
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n)));
  };
  const start = () => { setText(label); setEditing(true); };
  return { editing, text, setText, commit, start };
}

function LabelEditor({ edit }) {
  return (
    <textarea
      className="dw-edit nodrag nowheel"
      aria-label="Label"
      value={edit.text}
      onChange={(ev) => edit.setText(ev.target.value)}
      onBlur={edit.commit}
      onKeyDown={(ev) => {
        if (ev.key === "Escape" || (ev.key === "Enter" && !ev.shiftKey)) { ev.preventDefault(); edit.commit(); }
      }}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
    />
  );
}

function BoxNode({ id, data, selected }) {
  const edit = useLabelEdit(id, data.label);
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={30} minHeight={20} />
      <div className={`dw-box dw-kind--${data.kind}${data.vertical ? " dw-box--vertical" : ""}`} onDoubleClick={edit.start}>
        {edit.editing ? <LabelEditor edit={edit} /> : data.label}
      </div>
      <Handles />
    </>
  );
}

function ZoneNode({ id, data, selected }) {
  const edit = useLabelEdit(id, data.label);
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={60} />
      <div className={`dw-zone dw-kind--${data.kind}`} onDoubleClick={edit.start}>
        <div className={`dw-zone__label${data.bottom ? " dw-zone__label--bottom" : ""}`}>
          {edit.editing ? <LabelEditor edit={edit} /> : data.label}
        </div>
      </div>
      <Handles />
    </>
  );
}

const nodeTypes = { box: BoxNode, zone: ZoneNode };

const arrow = { type: MarkerType.ArrowClosed };
const styleEdge = ({ bidirectional, accent, ...e }) => ({
  ...e,
  type: "smoothstep",
  markerEnd: arrow,
  ...(bidirectional ? { markerStart: arrow } : {}),
  className: accent ? "dw-edge--accent" : undefined,
  labelBgStyle: { fillOpacity: 0.9 },
});

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s?.nodes && s?.edges) return s;
  } catch { /* private window or bad JSON: fall back to the starting layout */ }
  return { nodes: INITIAL_NODES, edges: INITIAL_EDGES.map(styleEdge) };
}

function Canvas() {
  const init = useMemo(load, []);
  const [nodes, setNodes] = useState(init.nodes);
  const [edges, setEdges] = useState(init.edges);
  const { fitView } = useReactFlow();
  // Simulate walks the arrows in their stored order; only the drawn copies are styled, so edits and undo are untouched.
  const stepper = useDiagramStepper(edges.length);
  const hot = edges[stepper.step];
  const captions = edgeCaptions(edges, Object.fromEntries(nodes.map((n) => [n.id, n.data?.label])));

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ nodes, edges })); } catch { /* storage unavailable */ }
  }, [nodes, edges]);

  // Undo: whenever the diagram's content changes, remember the state before it. Changes arriving
  // within 400 ms of each other (a drag, a resize) count as one step, so Undo moves back one gesture.
  const history = useRef([]);
  const last = useRef({ nodes, edges, sig: diagramSignature(nodes, edges), at: 0, skip: false });
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    const prev = last.current;
    const sig = diagramSignature(nodes, edges);
    if (sig !== prev.sig) {
      const now = Date.now();
      if (prev.skip) prev.skip = false;
      else if (now - prev.at > 400) {
        history.current.push({ nodes: prev.nodes, edges: prev.edges });
        if (history.current.length > 50) history.current.shift();
        setCanUndo(true);
      }
      prev.at = now;
    }
    Object.assign(prev, { nodes, edges, sig });
  }, [nodes, edges]);
  const undo = useCallback(() => {
    const step = history.current.pop();
    if (!step) return;
    last.current.skip = true;
    setNodes(step.nodes);
    setEdges(step.edges);
    setCanUndo(history.current.length > 0);
  }, []);
  useEffect(() => {
    const onKey = (ev) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.shiftKey || ev.key.toLowerCase() !== "z") return;
      if (ev.target.closest?.("input, textarea")) return; // let text fields undo their own typing
      ev.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const onNodesChange = useCallback((c) => setNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c) => setEdges((es) => applyEdgeChanges(c, es)), []);
  const onConnect = useCallback((c) => setEdges((es) => addEdge(styleEdge({ ...c, label: "" }), es)), []);
  const [edgeEdit, setEdgeEdit] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const onEdgeDoubleClick = useCallback((_, edge) => setEdgeEdit({ id: edge.id, text: edge.label || "" }), []);
  const saveEdge = () => {
    setEdges((es) => es.map((x) => (x.id === edgeEdit.id ? { ...x, label: edgeEdit.text } : x)));
    setEdgeEdit(null);
  };

  // The edge-label dialog's own primary. It renders in the dialog (a portal outside the page), so it keeps the app's
  // fixed-token .btn-primary rather than .pu-btn.
  const edgeFooter = <button type="button" className="btn btn-primary" onClick={saveEdge}>Save</button>;

  const addBox = () => setNodes((ns) => [...ns, {
    id: `n${Date.now()}`, type: "box", position: { x: 100, y: 100 },
    style: { width: 120, height: 50 }, data: { label: "New box", kind: "blue" },
  }]);
  const reset = () => {
    setConfirmReset(false);
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES.map(styleEdge));
    setTimeout(() => fitView(), 50);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: "application/json" }));
    a.download = "digital-worker-diagram.json";
    a.click();
  };

  const fileInput = useRef(null);
  const loadFile = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow loading the same file twice
    if (!file) return;
    try {
      const d = parseDiagram(await file.text());
      setNodes(d.nodes);
      setEdges(d.edges);
      setTimeout(() => fitView(), 50);
    } catch (err) {
      notifyError(err.message);
    }
  };

  return (
    <>
      <div className="dw-bar">
        <button type="button" className="pu-btn" onClick={addBox}>+ Add box</button>
        {/* aria-disabled, not disabled: Undoing the last step must not drop keyboard focus to the page body. */}
        <button type="button" className="pu-btn" onClick={undo} aria-disabled={canUndo ? undefined : "true"}>Undo</button>
        <button type="button" className="pu-btn" onClick={download}>Download JSON</button>
        <button type="button" className="pu-btn" onClick={() => fileInput.current.click()}>Load JSON</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Load diagram JSON" onChange={loadFile} />
        <button type="button" className="pu-btn" onClick={() => setConfirmReset(true)}>Reset diagram</button>
        <span className="dw-bar__hint">Double-click a box or arrow to rename. Delete removes the selection. Ctrl/Cmd+Z undoes. Drag a dot to connect. Autosaves in this browser.</span>
        <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId="dw-steps" />
      </div>
      <ReactFlow
        nodes={hot ? markNodes(nodes, [hot.source, hot.target]) : nodes}
        edges={stepEdges(edges, stepper.step)}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodesDraggable
        onEdgeDoubleClick={onEdgeDoubleClick}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={["Backspace", "Delete"]}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        fitView
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <ConfirmModal
        isOpen={confirmReset}
        title="Reset diagram"
        message="Discard all edits and restore the original diagram?"
        confirmLabel="Reset"
        danger
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <DraggableModal
        isOpen={!!edgeEdit}
        onClose={() => setEdgeEdit(null)}
        title="Arrow label"
        footer={edgeFooter}
        defaultWidth={380}
        defaultHeight={200}
        minWidth={380}
        storageKey={null}
      >
        <div className="dm-scroll">
          <input
            className="dw-edge-input"
            aria-label="Arrow label"
            value={edgeEdit?.text ?? ""}
            onChange={(ev) => setEdgeEdit({ ...edgeEdit, text: ev.target.value })}
            onKeyDown={(ev) => { if (ev.key === "Enter") saveEdge(); }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </div>
      </DraggableModal>
    </>
  );
}
