import { useEffect, useState } from "react";
import "./TokenCards.css";

const text = (value) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));
const words = (value) => text(value).split(/[\s,]+/).filter(Boolean);
const short = (value) => (text(value).length > 12 ? `${text(value).slice(0, 4)}…${text(value).slice(-4)}` : text(value));
const clock = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour12: false });

// What each claim means, shown on hover. Plain language: the audience is someone watching a demo.
const GLOSS = {
  iss: "Who issued the token",
  sub: "Who the token is about",
  name: "The signed-in customer",
  aud: "Which service the token is for",
  scope: "What the token allows",
  client: "The application the token was issued to",
  "act.sub": "Delegation: the agent acting on the customer's behalf (RFC 8693)",
  acr: "How strongly the customer authenticated at sign-in",
};

// The last event with this id that actually carries decoded claims.
function lastWithClaims(events, ids) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (ids.includes(events[i]?.id) && events[i].claims) return events[i];
  }
  return null;
}

// Authored copy, one line per token type: the only text here that is not read from the run.
const META = {
  user: { title: "User token", lead: "Proves who the customer is.", rest: "Issued by PingOne at sign-in; the BFF holds it, the browser never sees it.", via: ["Issued at sign-in", "PingOne"] },
  actor: { title: "Actor token", lead: "Proves which agent is acting.", rest: "The agent app's own credential, minted for this call. It says nothing about the customer.", via: ["client_credentials"] },
  exchanged: { title: "Exchanged token", lead: "Carries both, in one hop.", rest: "The gateway swapped the user token for this one; downstream services see the customer and the agent acting for them.", via: ["RFC 8693 token exchange"] },
};

function build(key, event, rows, extra = {}) {
  if (!event) return { key, ...META[key], present: false };
  const c = event.claims;
  const hidden = Array.isArray(event.hiddenClaims) ? event.hiddenClaims : [];
  return {
    key,
    ...META[key],
    present: true,
    issued: Number(c.iat) || null,
    expires: Number(c.exp) || null,
    rows: rows.filter((row) => row.value),
    alg: event.alg || event.jwtFullDecode?.header?.alg || "",
    jti: c.jti || "",
    hidden,
    decoded: event.jwtFullDecode || null,
    claims: c,
    ...extra,
  };
}

/**
 * The three tokens a delegated call carries, read from the run's token events: the user's token, the agent's
 * actor token, and the exchanged token that carries both (RFC 8693 `act`). A token the run never issued comes
 * back with present:false, never with invented claims.
 */
export function pickTokenCards(events) {
  const list = Array.isArray(events) ? events : [];
  const user = lastWithClaims(list, ["user-token"]);
  const actor = lastWithClaims(list, ["two-ex-agent-actor"]);
  const exchanged = lastWithClaims(list, ["two-ex-final-token", "exchanged-token", "two-ex-exchange1"]);
  const uc = user?.claims || {};
  const ac = actor?.claims || {};
  const ec = exchanged?.claims || {};
  const who = [uc.name, uc.email || uc.preferred_username].filter(Boolean).join(" · ");
  const authn = uc.acr ? `${uc.acr}${/multi|mfa/i.test(uc.acr) ? " ✓ MFA" : ""}${uc.auth_time ? ` · auth_time ${clock(uc.auth_time)}` : ""}` : "";
  const from = words(uc.scope).length;
  const to = words(ec.scope).length;
  return [
    build("user", user, [
      { label: "iss", value: text(uc.iss) }, { label: "sub", value: text(uc.sub) }, { label: "name", value: who },
      { label: "aud", value: text(uc.aud) }, { label: "scope", value: text(uc.scope), chips: words(uc.scope) }, { label: "acr", value: authn },
    ]),
    build("actor", actor, [
      { label: "iss", value: text(ac.iss) }, { label: "client", value: text(ac.client_id || ac.sub) },
      { label: "aud", value: text(ac.aud) }, { label: "scope", value: text(ac.scope), chips: words(ac.scope) },
    ]),
    build("exchanged", exchanged, [
      { label: "iss", value: text(ec.iss) }, { label: "sub", value: text(ec.sub) }, { label: "act.sub", value: text(ec.act?.sub) },
      { label: "aud", value: text(ec.aud) }, { label: "scope", value: text(ec.scope), chips: words(ec.scope) },
    ], {
      chain: ec.act?.sub ? { customer: [text(ec.sub), uc.name].filter(Boolean).join(" · "), agent: text(ec.act.sub), narrowed: from && to && to < from ? `Scope narrowed ${from} → ${to}` : "" } : null,
    }),
  ];
}

/** The BFF's own intent token (not issued by PingOne), or null when the run minted none. */
export function pickIntentToken(events) {
  const event = lastWithClaims(Array.isArray(events) ? events : [], ["intent-token"]);
  if (!event) return null;
  const c = event.claims;
  const confidence = Number(c.confidence);
  return {
    intent: text(c.intent), vertical: text(c.vertical), tools: text(c.permitted_tools), promptHash: short(c.prompt_hash),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  };
}

/** True when the run issued at least one token the cards can describe (so they have something real to show). */
export function hasTokenCards(events) {
  return pickTokenCards(events).some((card) => card.present) || pickIntentToken(events) !== null;
}

/** "expires in 4m 30s" and a lifetime bar, ticking once a second; "expired" once it is. */
function Countdown({ issued, expires }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expires) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expires]);
  if (!expires) return null;
  const left = Math.max(0, Math.floor(expires - now / 1000));
  const lifetime = issued ? Math.max(1, expires - issued) : null;
  return (
    <div className="token-cards__life">
      <div className="token-cards__times">
        {issued ? <span>issued {clock(issued)}</span> : <span />}
        <span>expires {clock(expires)}</span>
      </div>
      {lifetime ? (
        <div className="token-cards__bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (left / lifetime) * 100)}%` }} /></div>
      ) : null}
      <span className={left ? "token-cards__left" : "token-cards__left token-cards__left--gone"} aria-live="off">
        {left ? `expires in ${Math.floor(left / 60)}m ${left % 60}s` : "expired"}
      </span>
    </div>
  );
}

function Detail({ card }) {
  const copy = () => { try { navigator.clipboard?.writeText(JSON.stringify(card.claims, null, 2)); } catch (_e) { /* clipboard blocked */ } };
  return (
    <>
      <p className="token-cards__why"><strong>{card.lead}</strong> {card.rest}</p>
      <div className="token-cards__chips">{card.via.map((chip) => <span key={chip}>{chip}</span>)}</div>
      <Countdown issued={card.issued} expires={card.expires} />
      {card.chain ? (
        <div className="token-cards__chain">
          <div><b>Customer</b>{card.chain.customer}</div>
          <div><b>Acting</b>act.sub {card.chain.agent}</div>
          {card.chain.narrowed ? <div className="token-cards__narrow">{card.chain.narrowed}</div> : null}
        </div>
      ) : null}
      <dl>
        {card.rows.map((row) => (
          <div key={row.label}>
            <dt title={GLOSS[row.label]}>{row.label}</dt>
            <dd>{row.chips && row.chips.length ? row.chips.map((chip) => <span className="token-cards__scope" key={chip}>{chip}</span>) : row.value}</dd>
          </div>
        ))}
      </dl>
      {card.decoded ? (
        <details className="token-cards__raw">
          <summary>Decoded JWT</summary>
          <pre>{JSON.stringify(card.decoded, null, 2)}</pre>
        </details>
      ) : null}
      <div className="token-cards__foot">
        <span>{[card.alg && `alg ${card.alg}`, card.jti && `jti ${short(card.jti)}`].filter(Boolean).join(" · ")}</span>
        {card.hidden.length ? <span className="token-cards__hidden" title={card.hidden.join(", ")}>{card.hidden.length} claims hidden by policy</span> : null}
        <button type="button" onClick={copy}>Copy claims</button>
      </div>
    </>
  );
}

function Intent({ intent }) {
  return (
    <div className="token-cards__intent">
      <strong>Intent token <small>minted by the BFF, not PingOne</small></strong>
      {intent.intent ? <span><i>intent</i>{intent.intent}</span> : null}
      {intent.vertical ? <span><i>vertical</i>{intent.vertical}</span> : null}
      {intent.tools ? <span><i>tools allowed</i>{intent.tools}</span> : null}
      {intent.promptHash ? <span><i>prompt_hash</i>{intent.promptHash}</span> : null}
      {intent.confidence !== null ? (
        <span className="token-cards__meter"><i>confidence</i>{intent.confidence.toFixed(2)}<b aria-hidden="true"><em style={{ width: `${intent.confidence * 100}%` }} /></b></span>
      ) : null}
    </div>
  );
}

/**
 * The Token Chain panel's token view, built from the run's real token events. variant="cards": three colour-coded
 * cards side by side (stacked layout). variant="rows": one expandable row per token (cockpit). Null when the run
 * issued none of them.
 */
export default function TokenCards({ events, variant = "cards" }) {
  if (!hasTokenCards(events)) return null;
  const cards = pickTokenCards(events);
  const intent = pickIntentToken(events);
  return (
    <div className={`token-cards token-cards--${variant}`} role="group" aria-label="Tokens in this request">
      {variant === "cards" ? (
        <div className="token-cards__relation" aria-hidden="true">
          <span className="token-cards__node token-cards__node--user">User token</span><em>+</em>
          <span className="token-cards__node token-cards__node--actor">Actor token</span><em>→ RFC 8693 exchange →</em>
          <span className="token-cards__node token-cards__node--exchanged">Exchanged token</span>
        </div>
      ) : null}
      <div className="token-cards__list">
        {cards.map((card) => (variant === "rows" ? (
          <details key={card.key} className={`token-cards__card token-cards__card--${card.key}`} open={card.key === "user" && card.present}>
            <summary>
              <span className="token-cards__dot" aria-hidden="true" />
              <h4>{card.title}<small>{card.lead}</small></h4>
              {card.present && card.expires ? <Countdown issued={card.issued} expires={card.expires} /> : null}
            </summary>
            <div className="token-cards__body">{card.present ? <Detail card={card} /> : <p className="token-cards__none">Not issued in this run</p>}</div>
          </details>
        ) : (
          <article key={card.key} className={`token-cards__card token-cards__card--${card.key}`}>
            <h4>{card.title}</h4>
            <div className="token-cards__body">{card.present ? <Detail card={card} /> : <p className="token-cards__none">Not issued in this run</p>}</div>
          </article>
        )))}
      </div>
      {intent ? <Intent intent={intent} /> : null}
    </div>
  );
}
