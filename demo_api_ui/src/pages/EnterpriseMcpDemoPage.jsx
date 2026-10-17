// demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx
//
// /demo/enterprise-mcp — run the MCP Enterprise-Managed Authorization demo.

import { useCallback, useEffect, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import IdJagPathBar from "../components/IdJagPathBar";
import { diagramLinkProps } from "../utils/diagramLinks";
import IdJagCallPlayer from "../components/IdJagCallPlayer";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { EDU } from "../components/education/educationIds";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useThemeOptional } from "../context/ThemeContext";
import { requestLiveIdJagRun, requestMockIdJagReplay, RUN_MODES } from "../utils/idJagRunMode";
import { openAdminSignIn } from "../utils/signInService";
import "./EnterpriseMcpDemoPage.css";

const DEMO_CHIP = "show my balance";

// One message per failure code from the BFF / launcher: each says what actually went wrong.
const FAILURE_MESSAGES = {
  id_jag_provider_required: (
    <>
      <strong>PingOne is selected.</strong> Live ID-JAG requires PingFederate.
      Select PF with the top-bar P1/PF switch, then run the demo again.
      If the switch requires admin access, <button type="button" className="idjag-admin-signin" onClick={() => openAdminSignIn({ returnTo: "/pingfederate-id-jag/demo" })}>sign in as admin</button> first.
    </>
  ),
  id_jag_provider_mismatch: (
    <>
      <strong>You are signed in with PingFederate, but the shared login provider is set to PingOne.</strong>{" "}
      Select PF with the top-bar P1/PF switch (needs an admin), then run the demo again.
    </>
  ),
  id_jag_intent_lost: (
    <>
      <strong>The sign-in handoff was lost</strong> (it timed out or the server restarted mid-run).
      PingFederate is still selected; run the demo again.
    </>
  ),
  id_jag_return_mismatch: (
    <>
      <strong>The sign-in returned to a different page than the one that started the run.</strong>{" "}
      Run the demo again from this page.
    </>
  ),
};

export default function EnterpriseMcpDemoPage() {
  // The learning-path links need a Router; the page is also rendered bare in unit tests.
  const inRouter = useInRouterContext();
  const [runMode, setRunMode] = useState(null);
  const [failureCode, setFailureCode] = useState(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("error");
    return FAILURE_MESSAGES[code] ? code : null;
  });
  useEffect(() => {
    const onProviderRequired = (event) => {
      setRunMode(null);
      setFailureCode(FAILURE_MESSAGES[event.detail?.code] ? event.detail.code : "id_jag_provider_required");
    };
    window.addEventListener("id-jag-provider-required", onProviderRequired);
    return () => window.removeEventListener("id-jag-provider-required", onProviderRequired);
  }, []);
  // Optional variant on purpose: useEducationUI() THROWS outside its provider,
  // which would take the whole page down anywhere the provider is absent. Null
  // here simply hides the explainer buttons rather than shipping dead controls.
  const edu = useEducationUIOptional();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const handleLiveRun = useCallback(() => {
    setFailureCode(null);
    const intent = requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: DEMO_CHIP,
      returnTo: "/pingfederate-id-jag/demo",
    });
    if (intent) {
      setRunMode(RUN_MODES.LIVE_ID_JAG);
    }
  }, []);
  const handleMockRun = useCallback(() => {
    requestMockIdJagReplay();
    setRunMode(RUN_MODES.MOCK_ID_JAG);
  }, []);

  return (
    <div className="emd-page">

      <header className="emd-header">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="emd-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
        </button>
        <h1>Enterprise-Managed MCP Authorization</h1>
        <p className="emd-sub">
          IT decides centrally which employees reach which MCP servers. The identity provider
          evaluates policy and signs an <strong>ID-JAG</strong>; the MCP authorization server
          redeems it for an access token. No per-server consent screen, and no token at all for
          an employee who is not entitled.
        </p>
      </header>

      {inRouter && typeof window !== "undefined" && window.location.pathname.startsWith("/pingfederate-id-jag") && (
        <IdJagPathBar current="run" />
      )}
      <section className="emd-card">
        <h2>What you are about to see</h2>
        <ol className="emd-steps">
          <li><strong>Policy at the IdP.</strong> Group membership is checked <em>before</em> anything is minted.</li>
          <li><strong>ID-JAG issued.</strong> A signed, single-use grant naming this user, this MCP server, these scopes, and the client it is for.</li>
          <li><strong>ID-JAG redeemed.</strong> The MCP authorization server verifies it against the IdP JWKS and issues its own token. The ID-JAG goes no further.</li>
          <li><strong>The gateway checks that token.</strong> It verifies the signature, applies policy, and forwards it to the MCP server.</li>
          <li><strong>The MCP server runs the tool.</strong> It calls the BFF banking API with the same token. No redirect to an MCP authorize endpoint anywhere in the flow.</li>
        </ol>
        {inRouter && (
          <p className="emd-note">
            After a run, <Link to="/pingfederate-id-jag/implementation" {...diagramLinkProps("/pingfederate-id-jag/implementation")}>See how we built it</Link> shows the real
            claims from your last run next to each step.
          </p>
        )}
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
            onClick={handleLiveRun}
          >
            Run live ID-JAG demo
          </button>
          <button type="button" className="emd-btn" onClick={handleMockRun}>
            Run mock demo
          </button>
        </div>
        {failureCode && (
          <div className="emd-prerequisite" role="alert">{FAILURE_MESSAGES[failureCode]}</div>
        )}
        {runMode === RUN_MODES.LIVE_ID_JAG && (
          <p className="emd-status" role="status">Live PF ID-JAG — PingFederate login required before the agent runs.</p>
        )}
        {runMode === RUN_MODES.MOCK_ID_JAG && (
          <p className="emd-status" role="status">Mock replay — no login or live tokens</p>
        )}
        <p className="emd-note">
          Live PF ID-JAG signs you out, asks for PingFederate login, then runs UC40 with
          “{DEMO_CHIP}”. Mock replay shows a sample flow immediately, even when signed out.
        </p>
      </section>

      <section className="emd-card" aria-labelledby="emd-calls-h">
        <h2 id="emd-calls-h">Every call, in order</h2>
        <p className="emd-note">
          All 19 calls from sign-in to the banking API. Pick the movie reel or the sequence diagram; Play steps
          through them, and the calls that a run records show their real claims.
        </p>
        <IdJagCallPlayer />
      </section>

      <section className="emd-card emd-card--film">
        <h2>Token chain</h2>
        <p className="emd-note">
          The live record of your run. Watch for <code>ID-JAG issued</code> and <code>ID-JAG redeemed</code> in the trace.
          Mock replay shows sample steps; an ordinary exchange is labeled as a stand-in.
        </p>
        <TokenChainFilmstrip />
      </section>
    </div>
  );
}
