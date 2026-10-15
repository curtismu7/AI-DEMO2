import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
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
import "@xyflow/react/dist/style.css";
import ConfirmModal from "../components/ConfirmModal";
import DraggableModal from "../components/DraggableModal";
import { INITIAL_NODES, INITIAL_EDGES } from "./digitalWorkerDiagram";
import "./DigitalWorkerPage.css";

// Digital Worker: editable architecture diagram. Double-click a box or zone to rename it, double-click
// an arrow to relabel it, select + Delete to remove, drag to move. Edits autosave to this browser only.
const STORE = "digital-worker-diagram-v1";
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

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ nodes, edges })); } catch { /* storage unavailable */ }
  }, [nodes, edges]);

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

  return (
    <>
      <div className="dw-bar">
        <button type="button" onClick={addBox}>+ Add box</button>
        <button type="button" onClick={download}>Download JSON</button>
        <button type="button" onClick={() => setConfirmReset(true)}>Reset</button>
        <span>Double-click a box or arrow to rename. Delete removes the selection. Drag a dot to connect. Autosaves in this browser.</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
        footer={<button type="button" className="btn btn-primary" onClick={saveEdge}>Save</button>}
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

export default function DigitalWorkerPage() {
  return (
    <div className="dw-page">
      <h1 className="dw-page__title">Digital Worker</h1>
      <div className="dw-page__canvas">
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
