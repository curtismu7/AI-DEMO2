// Adapts the reel's lane-per-step model (buildTraceSteps output) into
// lifeline arrows for SequenceReelDiagram. Each step only carries its own
// lane (e.g. "BROWSER", "MCP") — a lifeline needs a from/to pair per hop, so
// an arrow's "from" is inferred as the previous step's lane. A step whose
// lane matches the previous one (or the very first step, with no previous
// lane) has nothing to draw an arrow from, so it renders as a note anchored
// on its own lane instead — the same note/arrow distinction SequenceDiagramPage
// already uses for its canned scenarios.

export function deriveLifelineSteps(steps) {
  const result = [];
  let prevLane = null;
  for (const step of steps || []) {
    if (!step || !step.lane) continue;
    if (prevLane && prevLane !== step.lane) {
      result.push({
        id: step.id,
        type: "arrow",
        from: prevLane,
        to: step.lane,
        label: step.title,
        status: step.status,
      });
    } else {
      result.push({
        id: step.id,
        type: "note",
        lane: step.lane,
        label: step.title,
        status: step.status,
      });
    }
    prevLane = step.lane;
  }
  return result;
}

/** Ordered, de-duplicated lanes in first-seen order — only lanes touched so far. */
export function deriveLifelineParticipants(lifelineSteps) {
  const seen = new Set();
  const participants = [];
  for (const step of lifelineSteps || []) {
    const lanes = step.type === "arrow" ? [step.from, step.to] : [step.lane];
    for (const lane of lanes) {
      if (!seen.has(lane)) {
        seen.add(lane);
        participants.push(lane);
      }
    }
  }
  return participants;
}
