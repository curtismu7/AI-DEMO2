// demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx
//
// /demo/enterprise-mcp — run the MCP Enterprise-Managed Authorization demo:
// explain it, arm one flag, send the chip, watch the ID-JAG hops on the movie
// roll, then put the flag back.
//
// Native ID-JAG is configured permanently in docker-compose on both services,
// so this page flips exactly one boolean. See services/enterpriseMcpDemoFlags.js.

import { useCallback, useEffect, useState } from "react";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { EDU } from "../components/education/educationIds";
import { useEducationUIOptional } from "../context/EducationUIContext";
import {
  armEnterpriseMcpDemo,
  resetEnterpriseMcpDemo,
  readEnterpriseMcpDemoState,
} from "../services/enterpriseMcpDemoFlags";
import { notifyError, notifySuccess } from "../utils/appToast";
import "./EnterpriseMcpDemoPage.css";

const DEMO_CHIP = "show my balance";

export default function EnterpriseMcpDemoPage() {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  // Optional variant on purpose: useEducationUI() THROWS outside its provider,
  // which would take the whole page down anywhere the provider is absent. Null
  // here simply hides the explainer buttons rather than shipping dead controls.
  const edu = useEducationUIOptional();
  useEffect(() => {
    let alive = true;
    readEnterpriseMcpDemoState().then((on) => { if (alive) setArmed(on); });
    return () => { alive = false; };
  }, []);

  const handleArm = useCallback(async () => {
    setBusy(true);
    try {
      await armEnterpriseMcpDemo();
      setArmed(true);
      notifySuccess("Enterprise-managed MCP auth is ON — run the scenario below.");
    } catch {
      notifyError("Could not arm the demo. You need to be signed in to change flags.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    setBusy(true);
    try {
      await resetEnterpriseMcpDemo();
      setArmed(false);
      setRan(false);
      notifySuccess("Enterprise-managed MCP auth is OFF again.");
    } catch {
      notifyError("Could not reset the flag. Turn it off in Quick Flags before the next demo.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRun = useCallback(() => {
    // Same mechanism LiveUseCaseWorkbenchPage uses to drive the agent.
    window.dispatchEvent(new CustomEvent("banking-agent-prefill", {
      detail: { message: DEMO_CHIP, autoSend: true },
    }));
    setRan(true);
  }, []);

  return (
    <div className="emd-page">
      {armed && (
        // Standing banner, not just a button state. Silent staleness is the
        // failure mode here: a flag left armed changes how the NEXT demo
        // behaves with nothing on screen to explain why.
        <div className="emd-armed-banner" role="status">
          <span>⚠️ Enterprise-managed MCP auth is ARMED. Reset before running other demos.</span>
          <button type="button" className="emd-btn emd-btn--reset" onClick={handleReset} disabled={busy}>
            Reset now
          </button>
        </div>
      )}

      <header className="emd-header">
        <h1>Enterprise-Managed MCP Authorization</h1>
        <p className="emd-sub">
          IT decides centrally which employees reach which MCP servers. The identity provider
          evaluates policy and signs an <strong>ID-JAG</strong>; the MCP authorization server
          redeems it for an access token. No per-server consent screen, and no token at all for
          an employee who is not entitled.
        </p>
      </header>

      <section className="emd-card">
        <h2>What you are about to see</h2>
        <ol className="emd-steps">
          <li><strong>Policy at the IdP.</strong> Group membership is checked <em>before</em> anything is minted.</li>
          <li><strong>ID-JAG issued.</strong> A signed, single-use grant naming this user, this MCP server, these scopes.</li>
          <li><strong>ID-JAG redeemed.</strong> The MCP authorization server verifies it against the IdP JWKS and issues its own token.</li>
          <li><strong>That token calls the tool.</strong> No redirect to an MCP authorize endpoint anywhere in the flow.</li>
        </ol>
        {edu?.open && (
          <div className="emd-links">
            <button type="button" className="emd-link" onClick={() => edu.open(EDU.ENTERPRISE_MANAGED_AUTH, "overview")}>
              📚 Enterprise-Managed Auth — full explainer
            </button>
            <button type="button" className="emd-link" onClick={() => edu.open(EDU.ID_JAG, "how-it-works")}>
              📚 ID-JAG / Cross-App Access — the grant itself
            </button>
          </div>
        )}
      </section>

      <section className="emd-card">
        <h2>Run it</h2>
        <div className="emd-actions">
          <button
            type="button"
            className="emd-btn emd-btn--primary"
            onClick={handleArm}
            disabled={busy || armed}
          >
            {armed ? "✓ Armed" : "1 — Turn on enterprise-managed auth"}
          </button>
          <button
            type="button"
            className="emd-btn"
            onClick={handleRun}
            disabled={!armed || busy}
            title={armed ? "" : "Arm the demo first"}
          >
            2 — Send “{DEMO_CHIP}”
          </button>
          <button
            type="button"
            className="emd-btn emd-btn--reset"
            onClick={handleReset}
            disabled={busy || (!armed && !ran)}
          >
            3 — Reset when done
          </button>
        </div>
        <p className="emd-note">
          Step 3 turns the flag off — always. It leaves the stack in its default state so the
          next demo behaves normally, whether or not you armed it from this page.
        </p>
      </section>

      <section className="emd-card emd-card--film">
        <h2>Token chain</h2>
        <p className="emd-note">
          Watch for <code>ID-JAG issued</code> and <code>ID-JAG redeemed</code>. With the flag off
          you will see the RFC 8693 exchange instead, labelled as the stand-in.
        </p>
        <TokenChainFilmstrip />
      </section>
    </div>
  );
}
