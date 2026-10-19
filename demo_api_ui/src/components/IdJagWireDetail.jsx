import "./IdJagCallPlayer.css";

const KIND_LABEL = { rfc: "RFC", spec: "spec", emerging: "emerging" };

// The request on the wire, the MOCK tokens in play and the standards behind one call (pfIdJagStandards.js).
export default function IdJagWireDetail({ detail, testPrefix = "idjag-call" }) {
  if (!detail) return null;
  return (
    <div className="ijc-wire" data-testid={`${testPrefix}-wire`}>
      {detail.form && (
        <section>
          <h4>Request on the wire</h4>
          <pre className="ijc-code">{detail.form}</pre>
        </section>
      )}
      {(detail.tokens || []).map((t) => (
        <section key={t.note}>
          <h4>{t.note} <span className="ijc-mock">MOCK, teaching values only</span></h4>
          <pre className="ijc-code">{JSON.stringify({ ...(t.header ? { header: t.header } : {}), claims: t.claims }, null, 2)}</pre>
        </section>
      ))}
      {detail.refs?.length > 0 && (
        <section className="ijc-refs" data-testid={`${testPrefix}-refs`}>
          <h4>Standards behind this call</h4>
          <ul>
            {detail.refs.map((r) => (
              <li key={r.id}>
                <span className={`ijc-ref ijc-ref--${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                <strong>{r.id}</strong> {r.title}
              </li>
            ))}
          </ul>
          <p className="ijc-refs__note">Emerging items are drafts or in-progress work; their status can change.</p>
        </section>
      )}
    </div>
  );
}
