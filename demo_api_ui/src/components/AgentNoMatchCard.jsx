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
 *
 * Two DIFFERENT failures share this layout, and they must not share wording:
 *
 *  - `reason="no-match"` (default) — nothing matched the request at all.
 *  - `reason="ungrounded"` — Option C. The request DID route and the agent DID
 *    answer; none of that answer could be traced to a tool call, so it is not
 *    shown. Saying "no matching action" here would misdescribe what happened —
 *    the user asked something this vertical does handle — and shipping a
 *    message that isn't true is precisely what this feature exists to prevent.
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

/**
 * "CareConnect (Healthcare)" — the brand keeps the demo immersive, the vertical
 * states what actually scoped the refusal. A vertical whose manifest has no
 * `identity.displayName` falls back to the vertical alone rather than rendering
 * empty parentheses, and a brand identical to the vertical is not repeated.
 */
export function noMatchSubject(verticalId, brandName) {
  const name = verticalDisplayName(verticalId);
  const brand = typeof brandName === "string" ? brandName.trim() : "";
  // No vertical means nothing scoped the refusal, so a brand alone would be a
  // lie about what happened — the caller renders "No vertical is active".
  if (!name) return null;
  if (!brand || brand.toLowerCase() === name.toLowerCase()) return name;
  return `${brand} (${name})`;
}

export default function AgentNoMatchCard({
  verticalId = null,
  brandName = null,
  intentsConsidered,
  closestCandidate,
  droppedCount,
  reason = "no-match",
  suggestions = [],
  onSelect,
}) {
  const name = verticalDisplayName(verticalId);
  const subject = noMatchSubject(verticalId, brandName);
  const ungrounded = reason === "ungrounded";

  // Deliberately says nothing about WHY a statement could not be traced — we
  // know only that it could not be. A cause would have to be guessed, and a
  // guessed explanation is the same class of error as a guessed answer.
  const heading = ungrounded
    ? subject
      ? `No verified answer in ${subject}`
      : "No verified answer"
    : subject
      ? `No matching action in ${subject}`
      : "No vertical is active";

  const why = ungrounded
    ? `The agent answered that request, but none of the answer could be traced back to a tool call${
        name ? ` in ${name}` : ""
      }, so it is not shown. Only statements backed by a real tool result are displayed.`
    : name
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
        {/* Counts what the ROUTER weighed. In the ungrounded case routing
            succeeded, so showing it would point at the wrong failure. */}
        {!ungrounded && typeof intentsConsidered === "number" ? (
          <div className="ba-nomatch-diag-row">
            <dt>Intents considered</dt>
            <dd>{intentsConsidered}</dd>
          </div>
        ) : null}
        {/* The one specific thing we can state without guessing: how many
            statements were dropped. Absent unless the server counted them. */}
        {ungrounded && typeof droppedCount === "number" && droppedCount > 0 ? (
          <div className="ba-nomatch-diag-row">
            <dt>Statements dropped</dt>
            <dd>{droppedCount}</dd>
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
