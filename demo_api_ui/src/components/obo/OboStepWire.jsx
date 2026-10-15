import "./OboStepWire.css";

const pretty = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
const form = (b) => (b && typeof b === "object" ? Object.entries(b).map(([k, v]) => `${k}=${v}`).join("\n&") : pretty(b));
const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch (_e) { /* no clipboard in this context */ } };

function Block({ label, text }) {
  if (!text) return null;
  return (
    <div className="obo-wire__block">
      <div className="obo-wire__label">
        <span>{label}</span>
        <button type="button" className="obo-wire__copy" aria-label={`Copy ${label}`} onClick={() => copy(text)}>Copy</button>
      </div>
      <pre className="obo-wire__pre">{text}</pre>
    </div>
  );
}

// The real request/response and tokens of one hop. Client secrets arrive already masked from the BFF.
export default function OboStepWire({ step }) {
  const wire = step?.wire;
  const tokens = step?.tokens || [];
  if (!wire && tokens.length === 0) return null;
  return (
    <div className="obo-wire">
      {wire ? (
        <>
          <section aria-label="Request">
            <h4 className="obo-wire__h">Request</h4>
            <p className="obo-wire__line">{wire.request?.method} {wire.request?.url}</p>
            <Block label="Request headers" text={pretty(wire.request?.headers)} />
            <Block label="Request body" text={form(wire.request?.body)} />
          </section>
          <section aria-label="Response">
            <h4 className="obo-wire__h">Response</h4>
            <p className="obo-wire__line">HTTP {wire.response?.status}</p>
            <Block label="Response body" text={pretty(wire.response?.body)} />
          </section>
        </>
      ) : null}
      {tokens.map((tk) => (
        <section key={tk.role} aria-label={tk.label}>
          <h4 className="obo-wire__h">{tk.label}</h4>
          <Block label={`${tk.label} (raw)`} text={tk.raw} />
          {tk.decoded ? (
            <>
              <Block label={`${tk.label} decoded header`} text={pretty(tk.decoded.header)} />
              <Block label={`${tk.label} decoded payload`} text={pretty(tk.decoded.payload)} />
            </>
          ) : <p className="obo-wire__line">Could not decode this token.</p>}
        </section>
      ))}
    </div>
  );
}
