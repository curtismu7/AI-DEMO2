import { useCallback, useMemo, useState } from "react";
import { useThemeOptional } from "../context/ThemeContext";
import { collectPingOneSignals } from "../lib/pingOneSignalsSdk";
import { evaluateProtectBrowserRisk } from "../services/protectAuthenticationService";
import "./PingOneProtectBrowserDemo.css";

function ThemeIcon({ dark }) {
  return dark ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

export default function PingOneProtectBrowserDemo({ popout = false }) {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("ready");
  const [risk, setRisk] = useState(null);
  const [error, setError] = useState("");

  const statusCopy = useMemo(() => ({
    ready: "Signals are collected only when you run an evaluation.",
    collecting: "Collecting browser Signals…",
    evaluating: "Sending Signals to PingOne Protect…",
    complete: "Protect returned a risk evaluation.",
  })[stage], [stage]);

  const runEvaluation = useCallback(async (event) => {
    event.preventDefault();
    const normalizedUser = userId.trim();
    if (!normalizedUser) {
      setError("Enter a username or email to evaluate.");
      return;
    }
    setError("");
    setRisk(null);
    setBusy(true);
    try {
      setStage("collecting");
      const signalsData = await collectPingOneSignals();
      setStage("evaluating");
      const result = await evaluateProtectBrowserRisk({ userId: normalizedUser, signalsData });
      setRisk(result);
      setStage("complete");
    } catch (runError) {
      setStage("ready");
      setError(runError?.message || "Could not evaluate this browser with PingOne Protect.");
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const openPopout = () => {
    const popup = window.open(
      "/protect-auth-demo/popout",
      "pingone-protect-auth",
      "popup,width=640,height=820,resizable=yes,scrollbars=yes",
    );
    popup?.focus?.();
    if (!popup) setError("Your browser blocked the pop-out. Allow pop-ups or use this page.");
  };

  const DemoSurface = popout ? "main" : "section";
  return (
    <DemoSurface className={popout ? "p1p-auth p1p-auth--popout" : "p1p-auth"} data-testid="protect-auth-demo" aria-label={popout ? undefined : "PingOne Protect browser evaluation demo"}>
      <header className="p1p-auth__header">
        <div>
          <p className="p1p-auth__eyebrow">PingOne Protect · Browser risk evaluation</p>
          <h2>Evaluate browser risk</h2>
          <p>PingOne Signals collects browser context. The BFF sends the payload to PingOne Protect and returns the risk response. This page does not sign in a user or run an agent action.</p>
        </div>
        <div className="p1p-auth__actions">
          <button type="button" className="p1p-auth__icon-button" onClick={toggleDarkMode} aria-label={"Switch to " + (darkMode ? "light" : "dark") + " theme"} title={"Switch to " + (darkMode ? "light" : "dark") + " theme"}>
            <ThemeIcon dark={darkMode} />
          </button>
          {!popout && <button type="button" className="p1p-auth__secondary" aria-label="Open Protect demo pop-out" onClick={openPopout}>Open demo pop-out</button>}
          {popout && <button type="button" className="p1p-auth__secondary" onClick={() => window.close()}>Close window</button>}
        </div>
      </header>

      <div className="p1p-auth__outcomes" aria-label="Risk levels">
        <div><strong>Low</strong><span>Lower evaluated risk</span></div>
        <div><strong>Medium</strong><span>Elevated evaluated risk</span></div>
        <div><strong>High</strong><span>Higher evaluated risk</span></div>
      </div>

      <form className="p1p-auth__form" onSubmit={runEvaluation}>
        <label htmlFor="p1p-auth-user">Username or email to evaluate</label>
        <input id="p1p-auth-user" name="userId" autoComplete="username" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy} />
        <button className="p1p-auth__run-chip" type="submit" disabled={busy}>
          {busy ? "Running Protect evaluation…" : "Run PingOne Protect evaluation"}
        </button>
        <p className="p1p-auth__status" role="status">{statusCopy}</p>
        {error && <p className="p1p-auth__error" role="alert">{error}</p>}
      </form>

      {risk && <section className="p1p-auth__result" role="region" aria-label="Protect risk evaluation response" aria-live="polite">
        <h3>Protect evaluation response</h3>
        <dl className="p1p-auth__response">
          <div><dt>Risk level</dt><dd>{risk.level}</dd></div>
          <div><dt>Recommended action</dt><dd>{risk.recommendedAction || "Not returned"}</dd></div>
          {risk.botDetection?.level && <div><dt>Bot detection level</dt><dd>{risk.botDetection.level}</dd></div>}
          {risk.botDetection?.status && <div><dt>Bot detection status</dt><dd>{risk.botDetection.status}</dd></div>}
          {risk.botDetection?.detectedRuleId && <div><dt>Detected rule</dt><dd>{risk.botDetection.detectedRuleId}</dd></div>}
        </dl>
        <button type="button" className="p1p-auth__secondary" onClick={() => { setStage("ready"); setRisk(null); setError(""); }}>Run another evaluation</button>
      </section>}
      <p className="p1p-auth__note">The raw Signals payload stays out of the page response and URL. No OIDC redirect or agent invocation is started.</p>
    </DemoSurface>
  );
}
