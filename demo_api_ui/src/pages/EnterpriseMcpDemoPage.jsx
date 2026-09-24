// demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx
//
// /demo/enterprise-mcp — run the MCP Enterprise-Managed Authorization demo.

import { useCallback, useEffect, useState } from "react";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { EDU } from "../components/education/educationIds";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useThemeOptional } from "../context/ThemeContext";
import { requestLiveIdJagRun, requestMockIdJagReplay, RUN_MODES } from "../utils/idJagRunMode";
import "./EnterpriseMcpDemoPage.css";

const DEMO_CHIP = "show my balance";

export default function EnterpriseMcpDemoPage() {
  const [runMode, setRunMode] = useState(null);
  const [providerRequired, setProviderRequired] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "id_jag_provider_required"
  );
  useEffect(() => {
    const onProviderRequired = () => {
      setRunMode(null);
      setProviderRequired(true);
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
    setProviderRequired(false);
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
            onClick={handleLiveRun}
          >
            Run live ID-JAG demo
          </button>
          <button type="button" className="emd-btn" onClick={handleMockRun}>
            Run mock demo
          </button>
        </div>
        {providerRequired && (
          <div className="emd-prerequisite" role="alert">
            <strong>PingOne is selected.</strong> Live ID-JAG requires PingFederate.
            Select PF with the top-bar P1/PF switch, then run the demo again.
            If the switch requires admin access, <a href="/api/auth/oauth/login?return_to=%2Fpingfederate-id-jag%2Fdemo">sign in as admin</a> first.
          </div>
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

      <section className="emd-card emd-card--film">
        <h2>Token chain</h2>
        <p className="emd-note">
          Watch for <code>ID-JAG issued</code> and <code>ID-JAG redeemed</code> in the trace.
          Mock replay shows sample steps; an ordinary exchange is labeled as a stand-in.
        </p>
        <TokenChainFilmstrip />
      </section>
    </div>
  );
}
