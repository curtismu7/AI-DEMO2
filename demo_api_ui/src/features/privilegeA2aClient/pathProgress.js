// The header's request path, as five fixed segments. Each trace event the run produces lands on one of them.
export const PATH_STEPS = ['Main agent', 'Agent Privilege', 'Worker agent', 'Agent Privilege', 'MCP tools'];

/** Which segment a trace entry belongs to, or -1 when it says nothing about the path (session line, errors). */
export function stepIndexFor(entry) {
  switch (entry?.kind) {
    case 'model': return entry.fromKey === 'analyst' ? 2 : 0; // the worker's model, else the main agent's
    case 'delegate': return 1; // main agent -> gateway -> worker
    case 'mcp-call': return 3; // worker -> gateway -> MCP
    case 'mcp-result': return 4; // MCP answered
    case 'result': return 0; // the worker's answer is back with the main agent
    default: return -1;
  }
}

/**
 * Where a run has got to. `reached` is the furthest segment touched, so segments the run passes straight
 * through (Heuristics has no model step) still count as done. `active` is the segment of the latest event
 * while the run is going, else null.
 */
export function pathProgress(trace, busy) {
  let reached = -1;
  let latest = -1;
  for (const entry of trace) {
    const index = stepIndexFor(entry);
    if (index < 0) continue;
    reached = Math.max(reached, index);
    latest = index;
  }
  return { reached, active: busy && latest >= 0 ? latest : null };
}
