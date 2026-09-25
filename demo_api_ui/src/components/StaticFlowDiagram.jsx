/**
 * StaticFlowDiagram — dependency-free SVG canvas for fixed-layout token flows.
 *
 * Props:
 *   NODES        [{ id, group, label, sub?: string[], x, y }]
 *   EDGES        [[srcId, tgtId, label?, opts?]] — opts: { dashed, color }
 *   GROUPS       { key: { label, bg } }
 *   selectedPath key of the currently highlighted path (dims others)
 *   onNodeClick  (node) => void — node = { id, data }
 *   testId       data-testid for the wrapper
 *   height       canvas height in px (nodes sit on a 640-tall grid by default)
 *
 * Deliberately NOT React Flow: these diagrams are static, hand-laid-out
 * teaching graphs; plain SVG keeps them deterministic and cheap.
 */
import "./StaticFlowDiagram.css";

const NODE_W = 210;
const NODE_H_BASE = 44;
const NODE_H_PER_SUB = 15;

export default function StaticFlowDiagram({
  NODES,
  EDGES,
  GROUPS,
  selectedPath = null,
  onNodeClick = () => {},
  testId = "static-flow-diagram",
  height = 640,
}) {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  const nodeH = (n) => NODE_H_BASE + (n.sub ? n.sub.length * NODE_H_PER_SUB : 0);
  const nodeCenter = (n) => ({ cx: n.x + NODE_W / 2, cy: n.y + nodeH(n) / 2 });
  const edgeActive = (e) => {
    const opts = e[3] || {};
    const nodeFor = (id) => byId.get(id) || {};
    return selectedPath && (nodeFor(e[0]).path === selectedPath || nodeFor(e[1]).path === selectedPath || opts.path === selectedPath);
  };

  return (
    <div className="sfd" data-testid={testId}>
      <svg
        className="sfd-canvas"
        role="img"
        viewBox={`0 0 ${Math.max(760, ...NODES.map((n) => n.x + NODE_W + 40))} ${Math.max(height, ...NODES.map((n) => n.y + nodeH(n) + 40))}`}
      >
        {EDGES.map(([src, tgt, label, opts = {}], i) => {
          const a = byId.get(src);
          const b = byId.get(tgt);
          if (!a || !b) return null;
          const ac = nodeCenter(a);
          const bc = nodeCenter(b);
          const active = edgeActive([src, tgt, label, opts]);
          const dimmed = selectedPath && !active;
          const stroke = opts.color || "var(--sfd-edge, #64748b)";
          const x1 = src === tgt ? ac.cx : (a.x < b.x ? a.x + NODE_W : a.x);
          const y1 = src === tgt ? ac.cy : ac.cy;
          const x2 = src === tgt ? bc.cx : (a.x < b.x ? b.x : b.x + NODE_W);
          const y2 = bc.cy;
          const d = src === tgt
            ? `M ${a.x + NODE_W} ${y1} C ${a.x + NODE_W + 60} ${y1}, ${a.x + NODE_W + 60} ${y1 + 30}, ${a.x + NODE_W} ${y1 + 30}`
            : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
          const midX = src === tgt ? a.x + NODE_W + 55 : (x1 + x2) / 2;
          const midY = src === tgt ? y1 + 15 : (y1 + y2) / 2 - 6;
          return (
            <g key={`${src}->${tgt}:${label || ""}:${i}`} className={dimmed ? "sfd-edge dimmed" : "sfd-edge"}>
              <path d={d} fill="none" stroke={stroke} strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={opts.dashed ? "5 4" : undefined}
                markerEnd="url(#sfd-arrow)" />
              {label && (
                <text className="sfd-edge-label" x={midX} y={midY} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}
        <defs>
          <marker id="sfd-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sfd-edge, #64748b)" />
          </marker>
        </defs>
        {NODES.map((n) => {
          const g = GROUPS[n.group] || {};
          const active = selectedPath && (n.path === selectedPath);
          const dimmed = selectedPath && n.path && !active;
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}
              className={dimmed ? "sfd-node dimmed" : "sfd-node"}
              onClick={() => onNodeClick({ id: n.id, data: n })}
              style={{ cursor: "pointer" }}
              data-testid={`${testId}-node-${n.id}`}>
              <rect width={NODE_W} height={nodeH(n)} rx="8"
                className="sfd-node-box"
                style={{ stroke: g.bg || "var(--sfd-edge, #64748b)" }} />
              <rect width="5" height={nodeH(n)} rx="2.5" fill={g.bg || "var(--sfd-edge, #64748b)"} />
              <text className="sfd-node-label" x="14" y="18">{n.label}</text>
              {(n.sub || []).map((s, si) => (
                <text key={si} className="sfd-node-sub" x="14" y={34 + si * NODE_H_PER_SUB}>{s}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
