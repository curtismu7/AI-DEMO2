import { useCallback, useMemo, useState } from "react";

/**
 * Makes a ReactFlow diagram whose `nodes` are computed (from props / layout code) draggable.
 *
 * ReactFlow only moves a node when something applies its position change; a computed `nodes`
 * array with no `onNodesChange` ignores every drag. This remembers where the user dropped each
 * node (by id) and lays those positions over the computed nodes. View-only: positions reset on
 * reload, and a node the layout code no longer emits is simply not shown.
 *
 * `carry(node, nodes)` is optional: return the ids of nodes that travel with `node` when it is
 * dragged (a group / zone / band backdrop carrying the boxes sitting on it).
 *
 *   const { nodes, onNodesChange } = useDraggableNodes(computedNodes, carry);
 *   <ReactFlow nodes={nodes} onNodesChange={onNodesChange} nodesDraggable ... />
 */
export function useDraggableNodes(computed, carry) {
  const [moved, setMoved] = useState({});
  const nodes = useMemo(
    () => computed.map((n) => (moved[n.id] ? { ...n, position: moved[n.id] } : n)),
    [computed, moved],
  );
  const onNodesChange = useCallback(
    (changes) => {
      const drags = changes.filter((c) => c.type === "position" && c.position);
      if (!drags.length) return;
      const next = {};
      for (const c of drags) {
        next[c.id] = c.position;
        const node = carry && nodes.find((n) => n.id === c.id);
        if (!node) continue;
        const dx = c.position.x - node.position.x;
        const dy = c.position.y - node.position.y;
        for (const id of carry(node, nodes)) {
          const m = nodes.find((n) => n.id === id);
          if (m && !next[id]) next[id] = { x: m.position.x + dx, y: m.position.y + dy };
        }
      }
      setMoved((m) => ({ ...m, ...next }));
    },
    [nodes, carry],
  );
  return { nodes, onNodesChange };
}
