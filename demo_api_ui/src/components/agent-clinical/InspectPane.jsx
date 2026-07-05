import ActivityLogPanel from '../ActivityLogPanel';

/**
 * InspectPane — Phase 4: session inspection under the Inspect tab.
 *
 * Wraps the existing ActivityLogPanel (live SSE stream from
 * /api/app-events/stream with category / use-case filter pills, severity
 * badges and expandable metadata rows). Only the clinical chrome is new —
 * the panel's data layer (useActivityLog) is reused untouched, per plan
 * step 4.1 (docs/superpowers/plans/2026-05-28-agent-ui-clinical-split.md).
 *
 * The pane is mounted only while the Inspect tab is active, so `enabled`
 * is constant: the event stream connects on tab enter and disconnects on
 * tab leave via the hook's own cleanup.
 */
export default function InspectPane() {
  return (
    <div className="ac-inspect">
      <header className="ac-inspect-head">
        <div className="ac-eyebrow ac-eyebrow--small">Inspect · session</div>
        <h1 className="ac-inspect-h1">
          What the agent <i>did</i>
        </h1>
        <p className="ac-inspect-sub">
          Live activity stream for this demo session — token exchanges, MCP
          calls, agent reasoning and policy decisions as they happen.
        </p>
      </header>
      <div className="ac-inspect-body">
        <ActivityLogPanel enabled />
      </div>
    </div>
  );
}
