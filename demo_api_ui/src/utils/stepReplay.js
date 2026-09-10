/**
 * Pure helpers for the AgentFlowDiagramPanel step timeline — actor swimlane
 * derivation and play/pause advance, kept out of the component so they're
 * testable without React/context.
 */

/** Ordered, deduped list of actors referenced by any step (first appearance wins). */
export function deriveActorLane(steps) {
  const seen = new Set();
  const lane = [];
  for (const step of steps) {
    for (const actor of [step.actor, step.toActor]) {
      if (actor && !seen.has(actor)) {
        seen.add(actor);
        lane.push(actor);
      }
    }
  }
  return lane;
}

/** Next index for autoplay — stops (done: true) at the last step instead of overrunning. */
export function nextPlayIndex(current, total) {
  const atEnd = current >= total - 1;
  return { index: atEnd ? current : current + 1, done: atEnd };
}

/**
 * Lane positions and per-step row geometry for the sequence-diagram lifelines.
 * A step with no toActor (or toActor === actor) is a "self" row — the actor
 * talking to itself (e.g. "BFF mints PKCE — server-side") — rendered as a
 * loop next to its lifeline rather than a cross-lane arrow. `dimmed` marks
 * steps after the active (scrubbed-to) index, so the diagram can fade in
 * step-by-step like the replay control walks through it.
 */
export function buildSequenceLayout(steps, activeIndex) {
  const lane = deriveActorLane(steps);
  const laneIndex = new Map(lane.map((actor, i) => [actor, i]));

  const rows = steps.map((step, index) => {
    const fromIdx = step.actor != null && laneIndex.has(step.actor) ? laneIndex.get(step.actor) : null;
    const rawToIdx = step.toActor != null && laneIndex.has(step.toActor) ? laneIndex.get(step.toActor) : null;
    const isSelf = fromIdx != null && (rawToIdx == null || rawToIdx === fromIdx);
    return {
      index,
      fromIdx,
      toIdx: fromIdx == null ? null : isSelf ? fromIdx : rawToIdx,
      isSelf,
      highlighted: index === activeIndex,
      dimmed: index > activeIndex,
    };
  });

  return { lane, rows };
}
