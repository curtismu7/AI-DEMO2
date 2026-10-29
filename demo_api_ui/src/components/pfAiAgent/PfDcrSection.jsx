import { useState } from "react";
import ProtocolTrace from "../ProtocolTrace";
import apiClient from "../../services/apiClient";
import { FeatureStatus, TraceSequenceDiagram } from "./shared";

// The four BFF calls, in order. Each one also shows what PingFederate refuses.
const STEPS = [
  { path: "initial-token", label: "Getting an initial access token" },
  { path: "register", label: "Registering a client" },
  { path: "token", label: "Using the new client" },
  { path: "delete", label: "Deleting the client" },
];

const EXPLAIN = {
  "initial-access-token": "A client that is allowed to register others gets a token with the dcr:register scope. PingFederate is set to refuse any registration without one.",
  "register-anonymous": "The same registration with no token, to show PingFederate refusing it.",
  register: "RFC 7591: the client describes itself (name, grant types, scope) and PingFederate answers with a client_id, a secret and a registration access token. The BFF keeps the secret and the registration token; the page sees them redacted.",
  "client-token": "The new client uses its own credentials at the token endpoint, for the scope it registered for.",
  "client-token-forbidden": "PingFederate's DCR settings limit a self-registered client to read scopes, so a write scope is refused.",
  delete: "RFC 7592: the client deletes its own registration with its registration access token. No administrator is involved.",
  "deleted-token": "The deleted client's credentials no longer work.",
};

function proofPoints(result) {
  const points = [];
  if (result.anonymousRefused) points.push("PingFederate refused the registration that carried no initial access token.");
  if (result.clientId) points.push(`PingFederate registered client ${result.clientId} and issued it a token for accounts:read.`);
  if (result.forbiddenRefused) points.push("It refused the same client a write scope its registration does not allow.");
  if (result.deletedRefused) points.push("After the client deleted itself, its credentials were refused.");
  return points;
}

export default function PfDcrSection({ ready }) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    if (!ready || busy) return;
    setError(null);
    setResult(null);
    const collected = {};
    try {
      for (const step of STEPS) {
        setBusy(step.label);
        const response = await apiClient.post(`/api/pf-ai-agent/dcr/${step.path}`);
        Object.assign(collected, response.data);
      }
      setResult(collected);
    } catch (failure) {
      setError({
        code: failure?.response?.data?.error || "pf_ai_dcr_failed",
        detail: failure?.response?.data?.detail || "",
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="pf-ai-agent__flow pf-ai-agent__flow--dcr" aria-labelledby="pf-ai-dcr-title" id="dcr">
      <div className="pf-ai-agent__flow-title">
        <p className="pf-ai-agent__eyebrow">Client enrolment</p>
        <h2 id="pf-ai-dcr-title">Dynamic client registration</h2>
        <p>An agent enrols itself as an OAuth client at PingFederate, uses it, and deletes it when done.</p>
        <FeatureStatus ready={ready} />
      </div>
      <div className="pf-ai-agent__flow-body">
        <dl className="pf-ai-agent__facts">
          <div><dt>Standards</dt><dd>RFC 7591 register · RFC 7592 manage</dd></div>
          <div><dt>Gate</dt><dd>Initial access token (scope dcr:register)</dd></div>
          <div><dt>New client may get</dt><dd>openid, profile, email, accounts:read</dd></div>
        </dl>
        {ready
          ? (
            <button className="pf-ai-agent__action" type="button" onClick={run} disabled={Boolean(busy)}>
              {busy || "Register, use and delete a client"}
            </button>
          )
          : <span className="pf-ai-agent__disabled-action">Enable PF dynamic client registration to run this</span>}
        {error && (
          <p className="pf-ai-agent__error" role="alert">
            The registration run stopped. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
        {result && (
          <div className="pf-ai-agent__proof" data-testid="dcr-proof">
            <h3>Proof: what was sent and what came back</h3>
            <TraceSequenceDiagram steps={result.trace} selfCall testId="dcr-sequence" />
            <ul className="pf-ai-agent__proof-points">
              {proofPoints(result).map((point) => <li key={point}>{point}</li>)}
            </ul>
            <ProtocolTrace steps={result.trace} explain={EXPLAIN} />
          </div>
        )}
      </div>
    </section>
  );
}
