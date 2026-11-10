/**
 * UniqueReactFlow — the one way a diagram mounts React Flow.
 *
 * React Flow ids its accessibility nodes (react-flow__node-desc-<id>, react-flow__edge-desc-<id>,
 * react-flow__aria-live-<id>), its dot-grid <pattern> and its edge markers from the `id` prop, which defaults to "1".
 * Two diagrams on one page therefore repeated every one of those ids (duplicate ids in the accessibility tree, and
 * the second diagram's arrows resolving to the first one's marker). This wrapper gives each instance its own id from
 * React's useId, or keeps an `id` the caller passes. Drawing is unchanged.
 *
 * A diagram that also draws its own <marker> or other id'd node calls useFlowUid() once, passes the result as `id`,
 * and builds those ids from it (`${uid}-arrow`), so they are per-instance too. Edge components, which render inside
 * the flow, read the same value with useRfId().
 */
import { useId } from "react";
import { ReactFlow, useStore } from "@xyflow/react";

/** A per-instance id safe in an id attribute and inside url(#...) (useId's colons or underscores are stripped). */
export function useFlowUid() {
  return `rf${useId().replace(/[^A-Za-z0-9]/g, "")}`;
}

/** The id of the React Flow this component renders inside; equals the `id` the diagram passed to UniqueReactFlow. */
export function useRfId() {
  return useStore((s) => s.rfId);
}

export default function UniqueReactFlow({ id, ...props }) {
  const own = useFlowUid();
  return <ReactFlow id={id ?? own} {...props} />;
}
