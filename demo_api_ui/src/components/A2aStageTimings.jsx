// Per-stage latency of a live A2A delegation (decision -> coordinator -> specialist),
// from the orchestrator's `timings` (totalMs is exactly the sum of the stages).
// Renders nothing for the recorded replay, which carries no timings.
import React from 'react';

export default function A2aStageTimings({ timings }) {
  if (!timings?.stages?.length) return null;
  return (
    <ul className="a2l-facts" aria-label="Stage timings">
      {timings.stages.map((s) => (
        <li key={s.stage}>
          <b>{s.stage}</b> <code>{s.agent}</code> <span className="a2l-meta">{s.ms} ms</span>
        </li>
      ))}
      <li><b>total</b> <span className="a2l-meta">{timings.totalMs} ms</span></li>
    </ul>
  );
}
