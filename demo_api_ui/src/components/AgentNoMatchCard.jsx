import React from "react";
import "./AgentNoMatchCard.css";

/**
 * Renders the BFF's structured no-match result (GET /api/fallback/chips) so a
 * prompt that routed nowhere fails visibly instead of silently.
 *
 * The server resolves to one vertical or to none — never to a substitute — so
 * every suggestion here belongs to the active vertical. Fields are rendered
 * only when the server actually sent them: `closestCandidate` is deliberately
 * absent from the server payload (the parser is an ordered regex cascade with
 * no score), so it stays hidden rather than being invented.
 */

/** "sporting-goods" → "Sporting Goods". The server sends only the id. */
export function verticalDisplayName(verticalId) {
  if (!verticalId) return null;
  return String(verticalId)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function AgentNoMatchCard({
  verticalId = null,
  intentsConsidered,
  closestCandidate,
  suggestions = [],
  onSelect,
}) {
  const name = verticalDisplayName(verticalId);
  const heading = name
    ? `No matching action in ${name}`
    : "No vertical is active";
  const why = name
    ? `${name} has no action for that request, and the agent will not answer it using another vertical's data.`
    : "No vertical is active, so there was nothing to match that request against. Choose a vertical and ask again.";

  return (
    <div className="ba-nomatch-card">
      <div className="ba-nomatch-head">
        <span aria-hidden="true">⚠️</span> {heading}
      </div>
      <p className="ba-nomatch-why">{why}</p>

      <dl className="ba-nomatch-diag">
        {verticalId ? (
          <div className="ba-nomatch-diag-row">
            <dt>Vertical</dt>
            <dd>{verticalId}</dd>
          </div>
        ) : null}
        {typeof intentsConsidered === "number" ? (
          <div className="ba-nomatch-diag-row">
            <dt>Intents considered</dt>
            <dd>{intentsConsidered}</dd>
          </div>
        ) : null}
        {closestCandidate ? (
          <div className="ba-nomatch-diag-row">
            <dt>Closest candidate</dt>
            <dd>{closestCandidate}</dd>
          </div>
        ) : null}
      </dl>

      {suggestions.length > 0 ? (
        <div className="ba-nomatch-suggest">
          <div className="ba-nomatch-suggest-label">
            {name ? `Try one of these ${name} actions:` : "Try one of these:"}
          </div>
          <div className="ba-nomatch-chips">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ba-nomatch-chip"
                title={s.message || s.label}
                onClick={() => onSelect?.(s)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
