// demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx
//
// /demo/enterprise-mcp — run the MCP Enterprise-Managed Authorization demo.
// UC40 travels with this run only; the BFF applies and discards its policy
// context without changing shared feature flags or login configuration.

import { useCallback, useState } from "react";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { EDU } from "../components/education/educationIds";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useThemeOptional } from "../context/ThemeContext";
import "./EnterpriseMcpDemoPage.css";

const DEMO_CHIP = "show my balance";

export default function EnterpriseMcpDemoPage() {
  const [ran, setRan] = useState(false);
  // Optional variant on purpose: useEducationUI() THROWS outside its provider,
  // which would take the whole page down anywhere the provider is absent. Null
  // here simply hides the explainer buttons rather than shipping dead controls.
  const edu = useEducationUIOptional();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const handleRun = useCallback(() => {
    // Same mechanism LiveUseCaseWorkbenchPage uses to drive the agent.
    window.dispatchEvent(new CustomEvent("banking-agent-prefill", {
      detail: { message: DEMO_CHIP, autoSend: true, useCaseId: "enterprise-managed-mcp-authorization" },
    }));
    setRan(true);
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
            onClick={handleRun}
          >
            {ran ? "Run again" : `Run “${DEMO_CHIP}”`}
          </button>
        </div>
        <p className="emd-note">
          This run carries the UC40 identity and requires a PingFederate login. Policy and
          ID-JAG handling are selected for this run and discarded when it ends; ordinary demo
          steps keep using the selected PingOne or PingFederate login mode.
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
