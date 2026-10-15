import "./OboEvidenceCard.css";

const show = (v) => (v == null ? "n/a" : typeof v === "object" ? JSON.stringify(v) : String(v));
const aud = (v) => (Array.isArray(v) ? v.join(", ") : show(v));

function Claim({ name, value }) {
  return (
    <div className="obo-card__row">
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// User token vs delegated token, claims and hashes only. Never renders a raw token.
export default function OboEvidenceCard({ evidence, checksLabel = "Delegation checks" }) {
  const { inbound, delegated, downstream, checks = [] } = evidence || {};
  return (
    <div className="obo-card">
      {inbound && delegated ? (
        <div className="obo-card__pair">
          <section className="obo-card__col" aria-label="Your token">
            <h3 className="obo-card__heading">Your token</h3>
            <dl>
              <Claim name="audience" value={aud(inbound.aud)} />
              <Claim name="scope" value={show(inbound.scope)} />
              <Claim name="client" value={show(inbound.client_id)} />
              <Claim name="hash" value={show(inbound.sha)} />
            </dl>
          </section>
          <section className="obo-card__col" aria-label="Delegated token">
            <h3 className="obo-card__heading">Delegated token</h3>
            <dl>
              <Claim name="sub" value={show(delegated.sub)} />
              <Claim name="act" value={show(delegated.act)} />
              <Claim name="audience" value={aud(delegated.aud)} />
              <Claim name="scope" value={show(delegated.scope)} />
              <Claim name="hash" value={show(delegated.sha)} />
            </dl>
          </section>
        </div>
      ) : null}
      {downstream ? (
        <p className="obo-card__downstream" data-testid="obo-downstream">
          Downstream API: delegated: {show(downstream.delegated)}, your token: {show(downstream.userToken)}
        </p>
      ) : null}
      {checks.length > 0 ? (
        <ul className="obo-card__checks" aria-label={checksLabel}>
          {checks.map((c) => (
            <li key={c.id} className={c.pass ? "obo-card__check obo-card__check--pass" : "obo-card__check obo-card__check--fail"}>
              <span className="obo-card__verdict">{c.pass ? "PASS" : "FAIL"}</span> {c.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
