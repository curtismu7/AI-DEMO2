import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./OboSwapDiagram.css";

export const NODES = [
  { id: "claude", position: { x: 0, y: 80 }, data: { label: "Claude (OAuth client)" }, className: "obo-node" },
  { id: "mcp", position: { x: 280, y: 80 }, data: { label: "OBO MCP endpoint (BFF)" }, className: "obo-node" },
  { id: "p1", position: { x: 560, y: 0 }, data: { label: "PingOne" }, className: "obo-node" },
  { id: "api", position: { x: 560, y: 160 }, data: { label: "Downstream API" }, className: "obo-node" },
  { id: "denied", position: { x: 560, y: 300 }, data: { label: "Refused: 401" }, className: "obo-node obo-node--denied" },
];

export const EDGES = [
  { id: "e1", source: "claude", target: "mcp", label: "1. user token (aud: gateway)" },
  { id: "e2", source: "mcp", target: "p1", label: "2. RFC 8693 exchange: subject = user, actor = AI Agent" },
  { id: "e3", source: "p1", target: "mcp", label: "3. delegated token: sub = user, act = { client_id }", animated: true },
  { id: "e4", source: "mcp", target: "api", label: "4. delegated token only" },
  { id: "e5", source: "mcp", target: "denied", label: "your own token replayed here (401)", className: "obo-edge--refused" },
];

export default function OboSwapDiagram() {
  return (
    <div className="obo-diagram" role="group" aria-label="Token swap diagram: the user token is exchanged for a delegated token that only the downstream API accepts">
      <ReactFlowProvider>
        <ReactFlow
          nodes={NODES}
          edges={EDGES}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
