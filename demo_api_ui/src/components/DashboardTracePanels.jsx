import React, { useEffect, useState } from "react";
import {
  DETAIL_PANE_MIN_HEIGHT,
  DETAIL_PANE_MAX_VIEWPORT_RATIO,
} from "../utils/detailPaneResize";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { runTraceChip } from "./dashboardFrameStatus";
import { StatusChip } from "./pingUi";

// Moved out of UserDashboardPing2026.js unchanged, so that file holds the Ping UI frame only.

export function DetailPaneResizeHandle({ height, onMouseDown, onKeyDown }) {
  return (
    <div
      className="ud-detail-pane-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize step details pane"
      aria-orientation="horizontal"
      aria-valuemin={DETAIL_PANE_MIN_HEIGHT}
      aria-valuemax={Math.max(DETAIL_PANE_MIN_HEIGHT, Math.round(window.innerHeight * DETAIL_PANE_MAX_VIEWPORT_RATIO))}
      aria-valuenow={Math.round(height)}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    >
      <span className="ud-detail-pane-resize-grip" aria-hidden="true" />
    </div>
  );
}

/**
 * The run-trace chip, read from the same trace store the sequence diagram reads (read-only subscribe). The wording is
 * decided by runTraceChip; `baselineRunId` is the run already in the store when this page mounted.
 */
function useRunTraceStatus(baselineRunId) {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  return runTraceChip(snap?.trace, baselineRunId);
}

/** Labelled card around the run trace (sequence diagram). The diagram itself is unchanged. */
export function RunTraceCard({ children, baselineRunId }) {
  const status = useRunTraceStatus(baselineRunId);
  return (
    <section className="udp-card udp-trace" aria-labelledby="udp-trace-h" data-testid="dashboard-run-trace">
      <div className="udp-card__head">
        <h2 id="udp-trace-h" className="udp-card__title">Run trace</h2>
        <StatusChip tone={status.tone}>{status.word}</StatusChip>
      </div>
      {children}
    </section>
  );
}
