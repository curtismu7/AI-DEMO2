import { useState } from "react";
import JsonPane from "./shared/JsonPane";
import "./ProtocolTrace.css";

// Shows protocol traffic the BFF captured for a run: each step's request (with a JSON / form-encoded toggle) and
// response, what was decoded from the tokens, and a plain explanation of the step. Every secret was replaced on the
// server before it got here; this component only renders what it is given.
const formEncode = (params) => Object.entries(params || {})
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value))}`)
  .join("&\n");

// What each kind of decoded thing is, so the reader knows why it is shown.
const CLAIM_LABELS = {
  idToken: "ID token claims (who signed in)",
  accessToken: "access token claims",
  idJagHeader: "ID-JAG header (typ marks it as an ID-JAG)",
  idJag: "ID-JAG claims (the signed assertion PingFederate issued)",
  downstreamAccessToken: "third-party access token claims",
};

// The own toggle picks the wire encoding (a JSON body or a form-encoded body). The JSON encoding is the shared pane, which has
// its own Form | JSON switch, so the buttons here are named for the encoding to stay apart from it.
function Params({ params, label }) {
  const [view, setView] = useState("json");
  if (!params || !Object.keys(params).length) return null;
  return (
    <div className="ptrace__params">
      <div className="ptrace__toggle" role="group" aria-label="View the request parameters as">
        <button type="button" aria-pressed={view === "json"} onClick={() => setView("json")}>As JSON body</button>
        <button type="button" aria-pressed={view === "form"} onClick={() => setView("form")}>As form-encoded body</button>
      </div>
      {view === "json"
        ? <div className="ptrace__pane"><JsonPane value={params} label={label} testId="ptrace-params" hot={["authorization_details", "request_uri"]} /></div>
        : <pre className="ptrace__code" data-testid="ptrace-params">{formEncode(params)}</pre>}
    </div>
  );
}

function Step({ step, index, explain, context }) {
  const prefix = context ? `${context}, ` : "";
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
          <Params params={request.params} label={`${prefix}Step ${index + 1} request parameters`} />
        </div>
      )}
      {response && (
        <div className="ptrace__block">
          <p className="ptrace__label">Response</p>
          <p className="ptrace__line"><strong>HTTP {response.status}</strong></p>
          <div className="ptrace__pane"><JsonPane value={response.body} label={`${prefix}Step ${index + 1} response body`} hot={["request_uri", "id_token", "refresh_token"]} /></div>
        </div>
      )}
      {decoded.map(([name, value]) => (
        <div className="ptrace__block" key={name}>
          <p className="ptrace__label">Decoded {CLAIM_LABELS[name] || name}</p>
          <div className="ptrace__pane"><JsonPane value={value} label={`${prefix}Step ${index + 1} decoded ${CLAIM_LABELS[name] || name}`} hot={["typ", "authorization_details"]} /></div>
        </div>
      ))}
      {note && <p className="ptrace__explain">{note}</p>}
    </li>
  );
}

// `context` (optional) names this trace, e.g. its section, and leads every pane name so two traces on one page stay apart.
export default function ProtocolTrace({ steps, explain = {}, context }) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <ol className="ptrace" aria-label="Protocol steps">
      {steps.map((step, index) => <Step key={`${step.id}-${index}`} step={step} index={index} explain={explain[step.id]} context={context} />)}
    </ol>
  );
}
