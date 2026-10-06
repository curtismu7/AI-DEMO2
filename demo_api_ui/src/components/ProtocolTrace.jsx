import { useState } from "react";
import "./ProtocolTrace.css";

// Shows protocol traffic the BFF captured for a run: each step's request (with a JSON / form-encoded toggle) and
// response, what was decoded from the tokens, and a plain explanation of the step. Every secret was replaced on the
// server before it got here; this component only renders what it is given.
const formEncode = (params) => Object.entries(params || {})
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value))}`)
  .join("&\n");

const pretty = (value) => JSON.stringify(value, null, 2);

function Params({ params }) {
  const [view, setView] = useState("json");
  if (!params || !Object.keys(params).length) return null;
  return (
    <div className="ptrace__params">
      <div className="ptrace__toggle" role="group" aria-label="View the request parameters as">
        <button type="button" aria-pressed={view === "json"} onClick={() => setView("json")}>JSON</button>
        <button type="button" aria-pressed={view === "form"} onClick={() => setView("form")}>Form</button>
      </div>
      <pre className="ptrace__code" data-testid="ptrace-params">{view === "json" ? pretty(params) : formEncode(params)}</pre>
    </div>
  );
}

function Step({ step, index, explain }) {
  const { request, response, claims, note } = step;
  const headers = Object.entries(request?.headers || {});
  const decoded = Object.entries(claims || {}).filter(([, value]) => value);
  return (
    <li className="ptrace__step">
      <h4><span className="ptrace__num">{index + 1}</span>{step.title}</h4>
      {explain && <p className="ptrace__explain">{explain}</p>}
      {request && (
        <div className="ptrace__block">
          <p className="ptrace__label">Request</p>
          <p className="ptrace__line"><strong>{request.method}</strong> <span>{request.url}</span></p>
          {headers.map(([name, value]) => <p className="ptrace__line" key={name}>{name}: {value}</p>)}
          <Params params={request.params} />
        </div>
      )}
      {response && (
        <div className="ptrace__block">
          <p className="ptrace__label">Response</p>
          <p className="ptrace__line"><strong>HTTP {response.status}</strong></p>
          <pre className="ptrace__code">{pretty(response.body)}</pre>
        </div>
      )}
      {decoded.map(([name, value]) => (
        <div className="ptrace__block" key={name}>
          <p className="ptrace__label">Decoded {name === "idToken" ? "ID token claims (who signed in)" : "access token claims"}</p>
          <pre className="ptrace__code">{pretty(value)}</pre>
        </div>
      ))}
      {note && <p className="ptrace__explain">{note}</p>}
    </li>
  );
}

export default function ProtocolTrace({ steps, explain = {} }) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <ol className="ptrace" aria-label="Protocol steps">
      {steps.map((step, index) => <Step key={`${step.id}-${index}`} step={step} index={index} explain={explain[step.id]} />)}
    </ol>
  );
}
