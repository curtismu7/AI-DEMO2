import { useState } from "react";
import ProtocolTrace from "../ProtocolTrace";
import apiClient from "../../services/apiClient";

// CIMD tester after client.dev (stytchauth/client.dev, MIT): the same two sides, run against PingFederate.
// Server: does PingFederate say it takes CIMD clients, and does it sign one in (the CIMD card above runs that).
// Client: is a metadata document right by the draft's rules, and what does PingFederate itself say about
// good and bad documents.

function Findings({ result }) {
  if (!result) return null;
  return (
    <div className="pf-ai-agent__result" role="status" data-testid="cimd-tester-findings">
      <h3>{result.valid ? "Valid client ID metadata document" : "Not a valid client ID metadata document"}</h3>
      <p className="pf-ai-agent__hint">Checked: {result.source === "pasted" ? "the pasted document" : result.source}</p>
      {[...result.errors.map((e) => ({ ...e, kind: "Error" })), ...result.warnings.map((w) => ({ ...w, kind: "Warning" }))].length > 0 && (
        <ul className="pf-ai-agent__proof-points">
          {result.errors.map((e) => <li key={`e-${e.path}-${e.message}`}><strong>Error</strong> <code>{e.path}</code> {e.message}</li>)}
          {result.warnings.map((w) => <li key={`w-${w.path}-${w.message}`}><strong>Warning</strong> <code>{w.path}</code> {w.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function PfCimdTester({ ready }) {
  const [tab, setTab] = useState("server");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [server, setServer] = useState(null);
  const [client, setClient] = useState(null);
  const [probe, setProbe] = useState(null);
  const [pasted, setPasted] = useState("");

  async function call(label, path, body, set) {
    setBusy(label);
    setError(null);
    try {
      set((await apiClient.post(`/api/pf-ai-agent/cimd/tester/${path}`, body)).data);
    } catch (failure) {
      setError({ code: failure?.response?.data?.error || "pf_ai_cimd_tester_failed", detail: failure?.response?.data?.detail || "" });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="pf-ai-agent__flow pf-ai-agent__flow--cimd-tester" aria-labelledby="pf-ai-cimd-tester-title" id="cimd-tester">
      <div className="pf-ai-agent__flow-title">
        <p className="pf-ai-agent__eyebrow">Client identity · tester</p>
        <h2 id="pf-ai-cimd-tester-title">CIMD tester</h2>
        <p>
          Both sides of client ID metadata documents, against PingFederate. After{" "}
          <a href="https://client.dev" target="_blank" rel="noopener noreferrer">client.dev</a> (MIT).
        </p>
      </div>
      <div className="pf-ai-agent__flow-body">
        <div className="pf-ai-agent__tabs" role="tablist" aria-label="CIMD tester side">
          {[["server", "Test PingFederate (server)"], ["client", "Test a document (client)"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {!ready && <span className="pf-ai-agent__disabled-action">Enable PF CIMD to run the tester</span>}

        {ready && tab === "server" && (
          <div role="tabpanel" aria-label="Test PingFederate">
            <p className="pf-ai-agent__hint">
              Step 1 reads PingFederate&apos;s discovery document. Step 2 is a real sign-in with this app&apos;s document URL as
              the client_id: authorization code with PKCE, no client secret (the CIMD card above).
            </p>
            <button className="pf-ai-agent__action" type="button" disabled={Boolean(busy)} onClick={() => call("Reading discovery", "server", {}, setServer)}>
              {busy === "Reading discovery" ? busy : "1. Check PingFederate discovery"}
            </button>
            <a className="pf-ai-agent__secondary-action" href="/api/pf-ai-agent/cimd/start">2. Sign in with CIMD</a>
            {server && (
              <div className="pf-ai-agent__result" role="status" data-testid="cimd-tester-server">
                <h3>PingFederate at {server.issuer}</h3>
                <ul className="pf-ai-agent__proof-points">
                  {server.checks.map((c) => (
                    <li key={c.name}><strong>{c.ok ? "Pass" : "Fail"}</strong> {c.name} <code>{JSON.stringify(c.value)}</code></li>
                  ))}
                </ul>
                <ProtocolTrace steps={server.trace} />
              </div>
            )}
          </div>
        )}

        {ready && tab === "client" && (
          <div role="tabpanel" aria-label="Test a document">
            <button className="pf-ai-agent__action" type="button" disabled={Boolean(busy)} onClick={() => call("Checking", "client", {}, setClient)}>
              Check this app&apos;s document
            </button>
            <label className="pf-ai-agent__field">
              <span>Or paste a document (JSON, nothing is fetched)</span>
              <textarea rows={6} value={pasted} onChange={(event) => setPasted(event.target.value)} spellCheck={false} />
            </label>
            <button className="pf-ai-agent__secondary-action" type="button" disabled={Boolean(busy) || !pasted.trim()} onClick={() => call("Checking", "client", { document: pasted }, setClient)}>
              Check the pasted document
            </button>
            <Findings result={client} />
            <h3>What does PingFederate say?</h3>
            <p className="pf-ai-agent__hint">
              The BFF sends PingFederate one authorization request per case and reads back its answer: its sign-in page,
              or its error. The bad documents are served by this app at URLs PingFederate&apos;s CIMD policies allow.
            </p>
            <button className="pf-ai-agent__action" type="button" disabled={Boolean(busy)} onClick={() => call("Asking PingFederate", "probe", {}, setProbe)}>
              {busy === "Asking PingFederate" ? busy : "Ask PingFederate about good and bad documents"}
            </button>
            {probe && (
              <div className="pf-ai-agent__proof" data-testid="cimd-tester-probe">
                <table className="pf-ai-agent__probe-table">
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
                <ProtocolTrace steps={probe.results.map((r) => r.trace)} />
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="pf-ai-agent__error" role="alert">
            The tester stopped. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
      </div>
    </section>
  );
}
