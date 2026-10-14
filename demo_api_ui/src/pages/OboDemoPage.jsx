import { useState } from "react";
import apiClient from "../services/apiClient";
import "./OboDemoPage.css";

// On-behalf-of demo: the BFF runs RFC 8693 delegation for the signed-in user and returns
// evidence only. No token is shown here; the page renders the checks and hashes.
export default function OboDemoPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post("/api/obo/run");
      setEvidence(response.data);
    } catch (err) {
      setEvidence(null);
      setError(err?.response?.data?.error || "The OBO run failed.");
    } finally {
      setBusy(false);
    }
  }

  const checks = evidence?.checks || [];
  return (
    <div className="obo-demo">
      <h1 className="obo-demo__title">On behalf of the user</h1>
      <p className="obo-demo__lede">
        An agent acts for you through RFC 8693 delegation. The exchange keeps your identity (<code>sub</code>),
        records the agent as <code>act</code>, and issues a token the downstream API accepts. Your own token is
        refused there. The model never sees either token.
      </p>
      <button type="button" className="obo-demo__run" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run the delegation"}
      </button>
      {error ? <p role="alert" className="obo-demo__error">{error}</p> : null}
      {checks.length > 0 ? (
        <ul className="obo-demo__checks" aria-label="Delegation checks">
          {checks.map((check) => (
            <li key={check.id} className={check.pass ? "obo-demo__check obo-demo__check--pass" : "obo-demo__check obo-demo__check--fail"}>
              <span className="obo-demo__verdict">{check.pass ? "PASS" : "FAIL"}</span> {check.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
