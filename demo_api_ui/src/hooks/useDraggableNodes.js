import { useCallback, useMemo, useState } from "react";

/**
 * Makes a ReactFlow diagram whose `nodes` are computed (from props / layout code) draggable.
 *
 * ReactFlow only moves a node when something applies its position change; a computed `nodes`
 * array with no `onNodesChange` ignores every drag. This remembers where the user dropped each
 * node (by id) and lays those positions over the computed nodes. View-only: positions reset on
 * reload, and a node the layout code no longer emits is simply not shown.
 *
 *   const { nodes, onNodesChange } = useDraggableNodes(computedNodes);
 *   <ReactFlow nodes={nodes} onNodesChange={onNodesChange} nodesDraggable ... />
 */
export function useDraggableNodes(computed) {
  const [moved, setMoved] = useState({});
  const nodes = useMemo(
    () => computed.map((n) => (moved[n.id] ? { ...n, position: moved[n.id] } : n)),
    [computed, moved],
  );
  const onNodesChange = useCallback((changes) => {
    const drags = changes.filter((c) => c.type === "position" && c.position);
    if (drags.length) setMoved((m) => Object.assign({}, m, ...drags.map((c) => ({ [c.id]: c.position }))));
  }, []);
  return { nodes, onNodesChange };
}
