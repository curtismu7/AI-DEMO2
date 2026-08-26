// M2M Client Credentials sample page.
//
// A faithful reproduction of ping-rocks/devdocs-sample-apps m2m-credentials,
// wired to this demo's PingOne worker app. The workflow runs server-side in
// demo_api_server/routes/m2mSample.js — the client secret never reaches the
// browser. This component only renders the step cards the BFF returns.
//
// The step objects come from our own BFF, which builds `detail` from a fixed
// set of templates and escapes every interpolated value before it is sent. The
// `body` field is rendered as text, never as HTML.

import { useCallback, useEffect, useState } from "react";
import "./M2mCredentialsSamplePage.css";

const API = "/api/m2m-sample";

function StepCard({ step }) {
  if (step.divider) {
    return <div className="m2m-divider">{step.title}</div>;
  }

  return (
    <div className="m2m-card">
      <h3 className={step.ok ? "m2m-ok" : "m2m-err"}>
        {step.title} {step.ok ? "(ok)" : "(failed)"}
      </h3>
      {step.url ? <div className="m2m-url">{step.url}</div> : null}
      {step.detail ? (
        step.rawDetail ? (
          // Server-generated template HTML with every value escaped upstream.
          // eslint-disable-next-line react/no-danger
          <div dangerouslySetInnerHTML={{ __html: step.detail }} />
        ) : (
          <div>{step.detail}</div>
        )
      ) : null}
      {step.body ? (
        <details open={!step.collapsed}>
          <summary>Show response</summary>
          <pre>{step.body}</pre>
        </details>
      ) : null}
    </div>
  );
}

export default function M2mCredentialsSamplePage() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [steps, setSteps] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/config`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err) => {
        if (!cancelled) setConfigError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (protect) => {
    setRunning(true);
    setSteps(null);
    try {
      const resp = await fetch(`${API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protect }),
      });
      const data = await resp.json();
      setSteps(data.steps || []);
    } catch (err) {
      setSteps([
        { title: "Request failed", ok: false, detail: err.message },
      ]);
    } finally {
      setRunning(false);
    }
  }, []);

  const protectAvailable = Boolean(config && config.protectAvailable);
  const configured = Boolean(config && config.configured);

  return (
    <div className="m2m-sample">
      <div className="m2m-sample-header">
        <img src="/branding/ping-logo.svg" alt="Ping Identity" />
      </div>

      <div className="m2m-sample-body">
        <h2>OAuth 2.0 Client Credentials (M2M)</h2>
        <p>
          This sample walks through the OAuth 2.0 <strong>client_credentials</strong>{" "}
          grant. There is no user, no browser redirect, and no PKCE. The client
          authenticates directly with the PingOne token endpoint using its own
          credentials and receives an access token.
        </p>

        {configError ? (
          <p className="m2m-note">
            Could not load configuration: {configError}
          </p>
        ) : null}

        {config && !configured ? (
          <p className="m2m-note">
            <strong>Note:</strong> the API server has no PingOne worker app
            configured. Set <code>PINGONE_ENVIRONMENT_ID</code>,{" "}
            <code>PINGONE_WORKER_CLIENT_ID</code> and{" "}
            <code>PINGONE_WORKER_CLIENT_SECRET</code>, then restart to run this
            sample.
          </p>
        ) : null}

        {steps === null ? (
          <>
            <p>Choose how to run the flow:</p>
            <table className="m2m-choices">
              <tbody>
                <tr>
                  <td>
                    <h3>Basic</h3>
                    <p>
                      Token request, signature verification, claim validation,
                      then a direct PingOne management API call.
                    </p>
                    <button
                      type="button"
                      onClick={() => run(false)}
                      disabled={!configured || running}
                    >
                      Run basic flow
                    </button>
                  </td>
                  <td>
                    <h3>With PingOne Protect</h3>
                    <p>
                      The same flow, but each management API call is gated on a
                      Protect risk evaluation. Run twice — once as a trusted
                      caller, once from a Tor exit node.
                    </p>
                    <button
                      type="button"
                      onClick={() => run(true)}
                      disabled={!configured || !protectAvailable || running}
                    >
                      Run with PingOne Protect
                    </button>
                    {config && configured && !protectAvailable ? (
                      <p className="m2m-note">
                        No readable risk policy set — PingOne Protect may not be
                        licensed on this environment.
                      </p>
                    ) : null}
                  </td>
                </tr>
              </tbody>
            </table>

            {config && configured ? (
              <div className="m2m-meta">
                Environment <code>{config.envID}</code>
                <br />
                Worker client <code>{config.clientID}</code>
                <br />
                {config.policySet ? (
                  <>
                    Risk policy set <code>{config.policySet.name}</code> (
                    <code>{config.policySet.id}</code>) — used as-is, nothing is
                    created.
                  </>
                ) : (
                  "No risk policy set resolved."
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {running ? <p className="m2m-running">Running workflow…</p> : null}

        {steps !== null ? (
          <>
            {steps.map((step, i) => (
              <StepCard key={`${step.title || "divider"}-${i}`} step={step} />
            ))}
            <div className="m2m-back">
              <button type="button" onClick={() => setSteps(null)} disabled={running}>
                Back to start
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
