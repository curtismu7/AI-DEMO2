import "./TokenCards.css";

const text = (value) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));

// The last event with this id that actually carries decoded claims.
function lastWithClaims(events, ids) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (ids.includes(events[i]?.id) && events[i].claims) return events[i];
  }
  return null;
}

/**
 * The three tokens a delegated call carries, read from the run's token events: the user's token,
 * the agent's actor token, and the exchanged token that carries both (RFC 8693 `act`). A token
 * the run never issued comes back as `null`, never as invented claims.
 */
export function pickTokenCards(events) {
  const list = Array.isArray(events) ? events : [];
  const user = lastWithClaims(list, ["user-token"]);
  const actor = lastWithClaims(list, ["two-ex-agent-actor"]);
  const exchanged = lastWithClaims(list, ["two-ex-final-token", "exchanged-token", "two-ex-exchange1"]);
  const rows = (pairs) => pairs.map(([k, v]) => [k, text(v)]).filter(([, v]) => v);
  return [
    { key: "user", title: "User token", data: user && rows([["sub", user.claims.sub], ["aud", user.claims.aud], ["scope", user.claims.scope]]) },
    { key: "actor", title: "Actor token", data: actor && rows([["client", actor.claims.client_id || actor.claims.sub], ["aud", actor.claims.aud], ["scope", actor.claims.scope]]) },
    { key: "exchanged", title: "Exchanged token", data: exchanged && rows([["sub", exchanged.claims.sub], ["act.sub", exchanged.claims.act?.sub], ["aud", exchanged.claims.aud], ["scope", exchanged.claims.scope]]) },
  ];
}

/** True when the run issued at least one of the three tokens (so the cards have something real to show). */
export function hasTokenCards(events) {
  return pickTokenCards(events).some((card) => card.data && card.data.length);
}

/** Three colour-coded token cards for the Token Chain panel; null when the run issued none of them. */
export default function TokenCards({ events }) {
  const cards = pickTokenCards(events);
  if (!hasTokenCards(events)) return null;
  return (
    <div className="token-cards" role="group" aria-label="Tokens in this request">
      {cards.map((card) => (
        <article key={card.key} className={`token-cards__card token-cards__card--${card.key}`}>
          <h4>{card.title}</h4>
          {card.data && card.data.length ? (
            <dl>
              {card.data.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          ) : (
            <p className="token-cards__none">Not issued in this run</p>
          )}
        </article>
      ))}
    </div>
  );
}
