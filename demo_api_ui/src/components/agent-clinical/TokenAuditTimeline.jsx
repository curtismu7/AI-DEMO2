import { useTokenChainOptional } from '../../context/TokenChainContext';
import { resolveStatusVisual } from '../TokenChainDisplay';

/**
 * TokenAuditTimeline — Phase 3d: the live token chain in clinical styling.
 *
 * Renders TokenChainContext events (set by bankingAgentService after each
 * MCP tool call — { id, label, status, explanation?, specRef? }) as the
 * .ac-tstep card rail. Status buckets come from TokenChainDisplay's
 * resolveStatusVisual so this stays in lockstep with the main chain UI:
 * active/exchanged → done, acquiring/waiting → pending, anything else → error.
 *
 * Renders a quiet explainer before the first agent action instead of fake
 * static cards — real data only.
 */
export default function TokenAuditTimeline() {
  const ctx = useTokenChainOptional();
  const events = ctx?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="ac-tstep-empty">
        No token activity yet. Ask the agent something on the left — each
        token in the RFC 8693 exchange chain appears here as it is minted.
      </div>
    );
  }

  return (
    <>
      {events.map((ev, i) => {
        const { bucket, label: statusLabel } = resolveStatusVisual(ev.status);
        const mod =
          bucket === 'active' || bucket === 'exchanged'
            ? 'done'
            : bucket === 'acquiring' || bucket === 'waiting'
              ? 'pending'
              : 'error';
        return (
          <div key={ev.id ? `${ev.id}-${i}` : `step-${i}`} className={`ac-tstep ac-tstep--${mod}`}>
            <div className="ac-tstep-card">
              <div className="ac-tstep-row1">
                <span className="ac-tstep-role">{statusLabel}</span>
                {ev.specRef && <span className="ac-tstep-rfc">{ev.specRef}</span>}
              </div>
              <div className="ac-tstep-name">{ev.label || ev.id || `Step ${i + 1}`}</div>
              {ev.explanation && <div className="ac-tstep-sub">{ev.explanation}</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}
