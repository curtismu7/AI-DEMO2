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
