import { useState } from "react";
import ProtocolTrace from "../ProtocolTrace";
import apiClient from "../../services/apiClient";
import { TraceSequenceDiagram } from "./shared";

// PingFederate's Authentication API: the sign-in as JSON a native or agent client renders itself.
export default function PfPiFlowSection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      setResult((await apiClient.post("/api/pf-ai-agent/piflow/open")).data);
    } catch (failure) {
      setError({ code: failure?.response?.data?.error || "pf_ai_piflow_failed", detail: failure?.response?.data?.detail || "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pf-ai-agent__flow pf-ai-agent__flow--piflow" aria-labelledby="pf-ai-piflow-title" id="piflow">
      <div className="pf-ai-agent__flow-title">
        <p className="pf-ai-agent__eyebrow">Native sign-in</p>
        <h2 id="pf-ai-piflow-title">Authentication API (pi.flow)</h2>
        <p>The same authorization request, answered as JSON instead of a login page, so an app or agent renders the sign-in itself.</p>
      </div>
      <div className="pf-ai-agent__flow-body">
        <dl className="pf-ai-agent__facts">
          <div><dt>Request</dt><dd>response_mode=pi.flow</dd></div>
          <div><dt>Answer</dt><dd>status + actions (_links)</dd></div>
          <div><dt>This run</dt><dd>Opens and reads a flow; sends no credential</dd></div>
        </dl>
        <button className="pf-ai-agent__action" type="button" onClick={open} disabled={busy}>
          {busy ? "Opening a flow" : "Open a pi.flow at PingFederate"}
        </button>
        <p className="pf-ai-agent__hint">The app&apos;s own PingFederate sign-in drives this API to the end: password, MFA, then the code.</p>
        {error && (
          <p className="pf-ai-agent__error" role="alert">
            The flow did not open. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
        {result && (
          <div className="pf-ai-agent__proof" data-testid="piflow-proof">
            <h3>Proof: what was sent and what came back</h3>
            <TraceSequenceDiagram steps={result.trace} selfCall testId="piflow-sequence" />
            <ul className="pf-ai-agent__proof-points">
              <li>PingFederate answered with a flow at status <code>{result.status}</code>, not an HTML page.</li>
              <li>The client may next: {result.actions.filter((a) => a !== "self").map((a) => <code key={a}>{a}</code>)}</li>
            </ul>
            <ProtocolTrace steps={result.trace} />
          </div>
        )}
      </div>
    </section>
  );
}
