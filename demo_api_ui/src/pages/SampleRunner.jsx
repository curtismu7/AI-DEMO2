// Live runner for a sample app, embedded in its SampleAppPage.
//
// Renders the same step objects the upstream samples render as cards. `detail`
// is server-generated template HTML with every interpolated value escaped
// upstream; `body` is always rendered as text.

import { useCallback, useEffect, useState } from "react";

function StepCard({ step }) {
  if (step.divider) return <div className="sr-divider">{step.title}</div>;
  return (
    <div className="sr-card">
      <h4 className={step.ok ? "sr-ok" : "sr-err"}>
        {step.title} {step.ok ? "(ok)" : "(failed)"}
      </h4>
      {step.url ? <div className="sr-url">{step.url}</div> : null}
      {step.detail ? (
        step.rawDetail ? (
          // eslint-disable-next-line react/no-danger
          <div className="sr-detail" dangerouslySetInnerHTML={{ __html: step.detail }} />
        ) : (
          <div className="sr-detail">{step.detail}</div>
        )
      ) : null}
      {step.body ? (
        <details>
          <summary>Show response</summary>
          <pre>{step.body}</pre>
        </details>
      ) : null}
    </div>
  );
}

export default function SampleRunner({ api, writes, runLabel, cleanupLabel }) {
  const [config, setConfig] = useState(null);
  const [steps, setSteps] = useState(null);
  const [running, setRunning] = useState(false);
  const [cleanup, setCleanup] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}/config`)
      .then((r) => r.json())
      .then((d) => !cancelled && setConfig(d))
      .catch(() => !cancelled && setConfig({ configured: false }));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const run = useCallback(async () => {
    setRunning(true);
    setSteps(null);
    try {
      const resp = await fetch(`${api}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanup }),
      });
      const data = await resp.json();
      setSteps(data.steps || []);
    } catch (err) {
      setSteps([{ title: "Request failed", ok: false, detail: err.message }]);
    } finally {
      setRunning(false);
    }
  }, [api, cleanup]);

  const configured = Boolean(config && config.configured);

  return (
    <div className="sr">
      {config && !configured ? (
        <p className="sa-missing">
          The API server has no PingOne worker app configured, so this sample cannot run here.
        </p>
      ) : null}

      {writes ? (
        <label className="sr-cleanup">
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
            disabled={running}
          />
          <span>{cleanupLabel}</span>
        </label>
      ) : null}

      <button type="button" className="sa-btn" onClick={run} disabled={!configured || running}>
        {running ? "Running…" : runLabel}
      </button>

      {config && configured ? (
        <div className="sr-meta">
          Environment <code>{config.envID}</code> · worker <code>{config.clientID}</code>
        </div>
      ) : null}

      {steps ? (
        <div className="sr-steps">
          {steps.map((s, i) => (
            <StepCard key={`${s.title || "divider"}-${i}`} step={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
