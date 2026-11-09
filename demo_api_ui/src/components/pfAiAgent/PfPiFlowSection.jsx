import { useState } from "react";
import ProtocolTrace from "../ProtocolTrace";
import apiClient from "../../services/apiClient";
import { Card, KvList, StatusChip } from "../pingUi";
import { FlowSection, RunStatus, TraceSequenceDiagram, actionClass } from "./shared";

// PingFederate's Authentication API: the sign-in as JSON a native or agent client renders itself.
export default function PfPiFlowSection({ lead = false }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function open() {
    if (busy) return;
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
    <FlowSection
      anchor="piflow"
      id="pf-ai-piflow-title"
      kicker="Native sign-in"
      title="Authentication API (pi.flow)"
      lede="The same authorization request, answered as JSON instead of a login page, so an app or agent renders the sign-in itself."
    >
      <Card>
        <KvList
          items={[
            { label: "Request", value: "response_mode=pi.flow" },
            { label: "Answer", value: "status + actions (_links)" },
            { label: "This run", value: "Opens and reads a flow; sends no credential" },
          ]}
        />
        <div className="pu-actions">
          <button className={actionClass(lead)} type="button" onClick={open} aria-disabled={busy ? "true" : undefined}>
            Open a pi.flow at PingFederate
          </button>
        </div>
        <RunStatus tone={busy ? "info" : "ok"} word={busy ? "Running" : result ? "Done" : ""}>
          {busy ? "Opening a flow at PingFederate." : "PingFederate answered with a flow."}
        </RunStatus>
        <p className="pu-note">The app&apos;s own PingFederate sign-in drives this API to the end: password, MFA, then the code.</p>
        {error && (
          <p className="pfai-error" role="alert">
            The flow did not open. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
      </Card>
      {result && (
        <Card tone="ok" title="Proof: what was sent and what came back" data-testid="piflow-proof">
          <div className="pu-status-line"><StatusChip tone="ok">Captured</StatusChip></div>
          <TraceSequenceDiagram steps={result.trace} selfCall testId="piflow-sequence" />
          <ul className="pfai-points">
            <li>PingFederate answered with a flow at status <code>{result.status}</code>, not an HTML page.</li>
            <li>The client may next: {result.actions.filter((a) => a !== "self").map((a) => <code key={a}>{a}</code>)}</li>
          </ul>
          <ProtocolTrace steps={result.trace} />
        </Card>
      )}
    </FlowSection>
  );
}
