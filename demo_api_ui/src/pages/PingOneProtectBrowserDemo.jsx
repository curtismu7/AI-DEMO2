import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useThemeOptional } from "../context/ThemeContext";
import { getSdkClient, isSdkError } from "../lib/oidcSdkClient";
import { collectPingOneSignals } from "../lib/pingOneSignalsSdk";
import { PROTECT_AUTH_FLOW_KEY } from "../lib/protectAuthFlow";
import { completeProtectAuthentication, evaluateProtectAuthentication } from "../services/protectAuthenticationService";
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
  const location = useLocation();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const result = new URLSearchParams(location.search).get("result");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(result === "success" ? "success" : result === "error" ? "callback-error" : "ready");
  const [risk, setRisk] = useState(null);
  const [error, setError] = useState(result === "error" ? "Sign-in did not complete. Run the demo again." : "");

  const statusCopy = useMemo(() => ({
    ready: "Signals are collected only when you run the demo.",
    collecting: "Collecting browser Signals…",
    evaluating: "Evaluating sign-in risk with PingOne Protect…",
    redirecting: risk?.level === "MEDIUM" ? "Medium risk. Continue with PingOne MFA…" : "Low risk. Continue to PingOne sign-in…",
    success: "Sign-in completed successfully.",
    blocked: "Sign-in blocked",
    "callback-error": "Sign-in did not complete",
  })[stage], [risk?.level, stage]);

  const runSignIn = useCallback(async (event) => {
    event.preventDefault();
    const normalizedUser = userId.trim();
    if (!normalizedUser) {
      setError("Enter your PingOne username or email.");
      return;
    }
    setError("");
    setRisk(null);
    setBusy(true);
    let pendingFlowId;
    try {
      setStage("collecting");
      const signalsData = await collectPingOneSignals();
      setStage("evaluating");
      const resultFromProtect = await evaluateProtectAuthentication({ userId: normalizedUser, signalsData });
      setRisk(resultFromProtect);
      if (resultFromProtect.level === "HIGH") {
        setStage("blocked");
        return;
      }
      pendingFlowId = resultFromProtect.flowId;
      const configResponse = await fetch("/api/sdk-demo/config", { headers: { Accept: "application/json" } });
      if (!configResponse.ok) throw new Error("Could not load OIDC demo config (HTTP " + configResponse.status + ")");
      const config = await configResponse.json();
      const client = await getSdkClient();
      if (isSdkError(client)) throw new Error(client.error || "Could not initialize the OIDC client");
      const query = { login_hint: normalizedUser };
      if (resultFromProtect.level === "MEDIUM") {
        query.acr_values = config.stepUpAcrValue || "Multi_Factor";
        query.max_age = "0";
      }
      const url = await client.authorize.url({ query });
      if (typeof url !== "string") throw new Error(url?.error || "Could not start PingOne sign-in");
      sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({ version: 1, flowId: resultFromProtect.flowId, returnTo: popout ? "popout" : "product" }));
      setStage("redirecting");
      window.location.href = url;
    } catch (runError) {
      if (pendingFlowId) await completeProtectAuthentication({ flowId: pendingFlowId, completionStatus: "FAILED" }).catch(() => {});
      try { sessionStorage.removeItem(PROTECT_AUTH_FLOW_KEY); } catch { /* session storage may be disabled */ }
      setStage("ready");
      setError(runError?.message || "Could not run PingOne Protect sign-in.");
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const openPopout = () => {
    const popup = window.open(
      "/protect-auth-demo?popout=1",
      "pingone-protect-auth",
      "popup,width=640,height=820,resizable=yes,scrollbars=yes",
    );
    popup?.focus?.();
    if (!popup) setError("Your browser blocked the pop-out. Allow pop-ups or use this page.");
  };

  const DemoSurface = popout ? "main" : "section";
  return (
    <DemoSurface className={popout ? "p1p-auth p1p-auth--popout" : "p1p-auth"} data-testid="protect-auth-demo" aria-label={popout ? undefined : "PingOne Protect browser sign-in demo"}>
      <header className="p1p-auth__header">
        <div>
          <p className="p1p-auth__eyebrow">PingOne Protect · Browser authentication</p>
          <h2>{popout ? "Risk-based sign-in" : "Run a browser sign-in"}</h2>
          <p>PingOne Signals gathers browser context. The BFF sends it to Protect before the demo starts OIDC.</p>
        </div>
        <div className="p1p-auth__actions">
          <button type="button" className="p1p-auth__icon-button" onClick={toggleDarkMode} aria-label={"Switch to " + (darkMode ? "light" : "dark") + " theme"} title={"Switch to " + (darkMode ? "light" : "dark") + " theme"}>
            <ThemeIcon dark={darkMode} />
          </button>
          {!popout && <button type="button" className="p1p-auth__secondary" aria-label="Open Protect demo pop-out" onClick={openPopout}>Open demo pop-out</button>}
          {popout && <button type="button" className="p1p-auth__secondary" onClick={() => window.close()}>Close window</button>}
        </div>
      </header>

      <div className="p1p-auth__outcomes" aria-label="Risk outcomes">
        <div><strong>Low</strong><span>Continue to sign-in</span></div>
        <div><strong>Medium</strong><span>Require PingOne MFA</span></div>
        <div><strong>High</strong><span>Block sign-in</span></div>
      </div>

      {stage === "success" ? (
        <section className="p1p-auth__result p1p-auth__result--success" role="status">
          <h3>Sign-in successful</h3>
          <p>PingOne authenticated the user after the Protect risk check.</p>
          <button type="button" className="p1p-auth__secondary" onClick={() => { setStage("ready"); setRisk(null); setError(""); }}>Run another sign-in</button>
        </section>
      ) : stage === "blocked" ? (
        <section className="p1p-auth__result p1p-auth__result--blocked" role="alert">
          <h3>Sign-in blocked</h3>
          <p>PingOne Protect returned High risk. The OIDC authorization request was not started.</p>
          <button type="button" className="p1p-auth__secondary" onClick={() => { setStage("ready"); setRisk(null); }}>Try again</button>
        </section>
      ) : (
        <form className="p1p-auth__form" onSubmit={runSignIn}>
          <label htmlFor="p1p-auth-user">PingOne username or email</label>
          <input id="p1p-auth-user" name="userId" autoComplete="username" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy} />
          <button className="p1p-auth__run-chip" type="submit" disabled={busy}>
            {busy ? "Running Protect check…" : "Run PingOne Protect sign-in"}
          </button>
          <p className="p1p-auth__status" role="status">{statusCopy}</p>
          {risk && stage === "redirecting" && <p className="p1p-auth__risk">Protect result: {risk.level}</p>}
          {error && <p className="p1p-auth__error" role="alert">{error}</p>}
        </form>
      )}
      <p className="p1p-auth__note">This demo gates its own OIDC redirect using the Protect result. It does not change the policy on PingOne&rsquo;s hosted authorization service.</p>
    </DemoSurface>
  );
}
