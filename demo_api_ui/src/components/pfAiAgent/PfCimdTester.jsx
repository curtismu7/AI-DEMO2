import { useState } from "react";
import ProtocolTrace from "../ProtocolTrace";
import apiClient from "../../services/apiClient";
import { Card, StatusChip } from "../pingUi";
import { FlowSection, RunStatus, Unavailable } from "./shared";

// CIMD tester after client.dev (stytchauth/client.dev, MIT): the same two sides, run against PingFederate.
// Server: does PingFederate say it takes CIMD clients, and does it sign one in (the CIMD card above runs that).
// Client: is a metadata document right by the draft's rules, and what does PingFederate itself say about
// good and bad documents.

function Findings({ result }) {
  if (!result) return null;
  const items = [...result.errors.map((e) => ({ ...e, kind: "Error" })), ...result.warnings.map((w) => ({ ...w, kind: "Warning" }))];
  return (
    <Card tone={result.valid ? "ok" : "danger"} title={result.valid ? "Valid client ID metadata document" : "Not a valid client ID metadata document"} data-testid="cimd-tester-findings">
      <div className="pu-status-line">
        <StatusChip tone={result.valid ? "ok" : "danger"}>{result.valid ? "Valid" : "Invalid"}</StatusChip>
        <span>Checked: {result.source === "pasted" ? "the pasted document" : result.source}</span>
      </div>
      {items.length > 0 && (
        <ul className="pfai-points">
          {result.errors.map((e) => <li key={`e-${e.path}-${e.message}`}><strong>Error</strong> <code>{e.path}</code> {e.message}</li>)}
          {result.warnings.map((w) => <li key={`w-${w.path}-${w.message}`}><strong>Warning</strong> <code>{w.path}</code> {w.message}</li>)}
        </ul>
      )}
    </Card>
  );
}

const TABS = [["server", "Test PingFederate (server)"], ["client", "Test a document (client)"]];

// Every button here is a secondary: the page's one primary lives on the first runnable flow (see the page).
// A busy button takes aria-disabled so keyboard focus stays on it while the call runs.
export default function PfCimdTester({ ready, checked = true }) {
  const [tab, setTab] = useState("server");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState(null);
  const [server, setServer] = useState(null);
  const [client, setClient] = useState(null);
  const [probe, setProbe] = useState(null);
  const [pasted, setPasted] = useState("");

  async function call(label, path, body, set, finished) {
    if (busy) return;
    setBusy(label);
    setDone("");
    setError(null);
    try {
      set((await apiClient.post(`/api/pf-ai-agent/cimd/tester/${path}`, body)).data);
      setDone(finished);
    } catch (failure) {
      setError({ code: failure?.response?.data?.error || "pf_ai_cimd_tester_failed", detail: failure?.response?.data?.detail || "" });
    } finally {
      setBusy("");
    }
  }

  const disabled = (extra = false) => (busy || extra ? "true" : undefined);

  return (
    <FlowSection
      anchor="cimd-tester"
      id="pf-ai-cimd-tester-title"
      kicker="Client identity · tester"
      title="CIMD tester"
      lede={<>Both sides of client ID metadata documents, against PingFederate. After <a href="https://client.dev" target="_blank" rel="noopener noreferrer">client.dev</a> (MIT).</>}
    >
      <Card>
        <div className="pfai-tabs" role="tablist" aria-label="CIMD tester side">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="pu-btn pfai-tab" onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {!ready && <Unavailable checked={checked}>Enable PF CIMD to run the tester</Unavailable>}

        {ready && tab === "server" && (
          <div role="tabpanel" aria-label="Test PingFederate">
            <p className="pu-note">
              Step 1 reads PingFederate&apos;s discovery document. Step 2 is a real sign-in with this app&apos;s document URL as
              the client_id: authorization code with PKCE, no client secret (the CIMD card above).
            </p>
            <div className="pu-actions">
              <button className="pu-btn" type="button" aria-disabled={disabled()} onClick={() => call("Reading discovery", "server", {}, setServer, "Read PingFederate's discovery document.")}>
                1. Check PingFederate discovery
              </button>
              <a className="pu-btn" href="/api/pf-ai-agent/cimd/start">2. Sign in with CIMD</a>
            </div>
          </div>
        )}

        {ready && tab === "client" && (
          <div role="tabpanel" aria-label="Test a document">
            <div className="pu-actions">
              <button className="pu-btn" type="button" aria-disabled={disabled()} onClick={() => call("Checking", "client", {}, setClient, "Checked this app's document.")}>
                Check this app&apos;s document
              </button>
            </div>
            <label className="pfai-field">
              <span>Or paste a document (JSON, nothing is fetched)</span>
              <textarea rows={6} value={pasted} onChange={(event) => setPasted(event.target.value)} spellCheck={false} />
            </label>
            <div className="pu-actions">
              <button className="pu-btn" type="button" aria-disabled={disabled(!pasted.trim())} onClick={() => { if (pasted.trim()) call("Checking", "client", { document: pasted }, setClient, "Checked the pasted document."); }}>
                Check the pasted document
              </button>
            </div>
            {!pasted.trim() && <p className="pu-note">Paste a document above to check it.</p>}
            <h3 className="pu-h3 pfai-sub">What does PingFederate say?</h3>
            <p className="pu-note">
              The BFF sends PingFederate one authorization request per case and reads back its answer: its sign-in page,
              or its error. The bad documents are served by this app at URLs PingFederate&apos;s CIMD policies allow.
            </p>
            <div className="pu-actions">
              <button className="pu-btn" type="button" aria-disabled={disabled()} onClick={() => call("Asking PingFederate", "probe", {}, setProbe, "PingFederate answered each case.")}>
                Ask PingFederate about good and bad documents
              </button>
            </div>
          </div>
        )}

        <RunStatus tone={busy ? "info" : "ok"} word={busy ? "Running" : done ? "Done" : ""}>
          {busy ? `${busy}.` : done}
        </RunStatus>

        {error && (
          <p className="pfai-error" role="alert">
            The tester stopped. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
      </Card>

      {ready && tab === "server" && server && (
        <Card tone={server.checks.every((c) => c.ok) ? "ok" : "warn"} title={`PingFederate at ${server.issuer}`} data-testid="cimd-tester-server">
          <div className="pu-status-line">
            <StatusChip tone={server.checks.every((c) => c.ok) ? "ok" : "warn"}>{server.checks.every((c) => c.ok) ? "All checks passed" : "Some checks failed"}</StatusChip>
          </div>
          <ul className="pfai-points">
            {server.checks.map((c) => (
              <li key={c.name}><strong>{c.ok ? "Pass" : "Fail"}</strong> {c.name} <code>{JSON.stringify(c.value)}</code></li>
            ))}
          </ul>
          <ProtocolTrace steps={server.trace} />
        </Card>
      )}

      {ready && tab === "client" && <Findings result={client} />}

      {ready && tab === "client" && probe && (
        <Card tone={probe.results.every((r) => r.asExpected) ? "ok" : "warn"} title="What PingFederate said, case by case" data-testid="cimd-tester-probe">
          <div className="pu-status-line">
            <StatusChip tone={probe.results.every((r) => r.asExpected) ? "ok" : "warn"}>
              {probe.results.every((r) => r.asExpected) ? "All as expected" : "Some not as expected"}
            </StatusChip>
          </div>
          <div className="pfai-table-wrap">
            <table className="pfai-probe-table">
              <thead><tr><th>Case</th><th>Expected</th><th>PingFederate said</th><th>As expected</th></tr></thead>
              <tbody>
                {probe.results.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td>{r.expect === "accept" ? "Accept" : "Refuse"}</td>
                    <td>{r.pfSays}</td>
                    <td>{r.asExpected ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ProtocolTrace steps={probe.results.map((r) => r.trace)} />
        </Card>
      )}
    </FlowSection>
  );
}
