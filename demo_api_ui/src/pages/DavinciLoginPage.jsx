import { useCallback, useEffect, useState } from "react";
import { getDavinciClient, isSdkError } from "../lib/davinciWidgetClient";

// DaVinci Widget login sandbox (/davinci-login). Demonstrates the risk-adaptive,
// two-version DaVinci login flow via @forgerock/davinci-client — separate from
// and does not touch the protected BFF redirect login (routes/oauth.js). See
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.

export default function DavinciLoginPage() {
  const [status, setStatus] = useState("loading"); // loading | collecting | error | done
  const [node, setNode] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const client = await getDavinciClient();
      // OIDC replay protection: the BFF binds a nonce to this session and
      // /api/davinci-login/callback verifies the ID token echoes it. The SDK
      // merges StartOptions.query into the /authorize URL.
      const nonceRes = await fetch("/api/davinci-login/nonce", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!nonceRes.ok) throw new Error(`Could not start a login flow (HTTP ${nonceRes.status})`);
      const { nonce } = await nonceRes.json();
      const result = await client.start({ query: { nonce } });
      if (isSdkError(result)) throw new Error(result.error || "Could not start the DaVinci flow");
      setNode(result);
      setStatus("collecting");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    start();
    fetch("/api/davinci-demo/config", { headers: { Accept: "application/json" } })
      .then((res) => res.json())
      .then((cfg) => setFlowVersion(cfg.flowVersion || null))
      .catch(() => setFlowVersion(null));
  }, [start]);

  const handleFieldChange = (key, value) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const client = await getDavinciClient();
      for (const collector of node?.collectors || []) {
        if (fieldValues[collector.name] !== undefined) {
          collector.setValue(fieldValues[collector.name]);
        }
      }
      const result = await client.next(node);
      if (isSdkError(result)) throw new Error(result.error || "The DaVinci flow rejected this step");
      if (result.status === "success") {
        setStatus("done");
      } else {
        setNode(result);
        setFieldValues({});
        setStatus("collecting");
      }
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, [node, fieldValues]);

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 20px", font: "14px/1.5 -apple-system,sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>DaVinci Widget Login</h1>
      {flowVersion && <p style={{ color: "#6b7280", fontSize: 12 }}>Flow version: {flowVersion}</p>}

      {error && <div style={{ color: "#c5302a", marginBottom: 12 }}>{error}</div>}

      {status === "loading" && <p>Loading…</p>}

      {status === "collecting" && node && (
        <div>
          {(node.collectors || []).map((collector) => (
            <div key={collector.name} style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4 }}>{collector.label || collector.name}</label>
              <input
                type={collector.type === "PasswordCollector" ? "password" : "text"}
                value={fieldValues[collector.name] || ""}
                onChange={(e) => handleFieldChange(collector.name, e.target.value)}
              />
            </div>
          ))}
          <button type="button" onClick={handleSubmit}>Continue</button>
        </div>
      )}

      {status === "done" && <p>Signed in.</p>}

      {status === "error" && (
        <button type="button" onClick={start}>Retry</button>
      )}
    </div>
  );
}
