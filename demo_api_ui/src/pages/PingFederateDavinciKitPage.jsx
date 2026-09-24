import { useEffect, useState } from "react";
import "./PingFederateDavinciKitPage.css";

const PF_LOGIN = "/api/auth/oauth/user/pf-davinci/login";

export default function PingFederateDavinciKitPage() {
  const [pfStatus, setPfStatus] = useState(null);
  const [checkingPfStatus, setCheckingPfStatus] = useState(true);
  const signInFailed = new URLSearchParams(window.location.search).get("pf_davinci") === "error";
  const hasPfSession = pfStatus?.authenticated === true;
  const pfLoginConfigured = pfStatus?.configured === true;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/oauth/user/pf-davinci/status", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => {
        if (active) setPfStatus(status);
      })
      .catch(() => {
        if (active) setPfStatus(null);
      })
      .finally(() => {
        if (active) setCheckingPfStatus(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <main className="pf-davinci-page">
      <header className="pf-davinci-hero">
        <div className="pf-davinci-hero-copy">
          <p className="pf-davinci-kicker">PingFederate integration</p>
          <h1>DaVinci Integration Kit</h1>
          <p className="pf-davinci-lede">
            Run the DaVinci flow through PingFederate&rsquo;s installed default Integration Kit.
            The kit runs in the PF authentication policy, so start with a fresh PF sign-in.
          </p>
        </div>
        <aside className={`pf-davinci-session ${hasPfSession ? "is-ready" : "is-blocked"}`} aria-live="polite">
          <strong>{hasPfSession ? "PingFederate session detected" : "PingFederate sign-in required"}</strong>
          <p>
            {checkingPfStatus
              ? "Checking the dedicated PingFederate sign-in."
              : !pfLoginConfigured
                ? "PingFederate sign-in is unavailable. Ask the demo administrator to check the dedicated PF client."
                : hasPfSession
                  ? "This browser completed PingFederate authentication for the DaVinci kit."
                  : "Sign in through PingFederate first. A PingOne session does not count for this demo."}
          </p>
          {signInFailed && <p role="alert">PingFederate sign-in did not complete. Try again or check the PF logs.</p>}
          {pfLoginConfigured && (
            <a className="pf-davinci-run" href={PF_LOGIN}>
              {hasPfSession ? "Run PF sign-in again" : "Sign in with PingFederate"}
            </a>
          )}
        </aside>
      </header>

      <section className="pf-davinci-section" aria-labelledby="pf-davinci-flow-title">
        <div className="pf-davinci-section-heading">
          <p className="pf-davinci-kicker">Live flow</p>
          <h2 id="pf-davinci-flow-title">What happens during sign-in</h2>
        </div>
        <ol className="pf-davinci-sequence">
          <li><span>1</span><strong>Application</strong><small>Redirects the user to the configured OIDC issuer.</small></li>
          <li><span>2</span><strong>PingFederate</strong><small>Applies the authentication policy containing the DaVinci IdP Adapter.</small></li>
          <li><span>3</span><strong>DaVinci</strong><small>The Integration Kit starts its configured flow and returns attributes.</small></li>
          <li><span>4</span><strong>Application</strong><small>Receives the authorization response and establishes its session.</small></li>
        </ol>
        <p className="pf-davinci-note">
          The run link starts a fresh sign-in through the dedicated PF client. Its authentication
          policy must include the installed DaVinci IdP Adapter. Other PingOne demos keep their own sign-in.
        </p>
      </section>

      <section className="pf-davinci-section" aria-labelledby="pf-davinci-modes-title">
        <div className="pf-davinci-section-heading">
          <p className="pf-davinci-kicker">Adapter modes</p>
          <h2 id="pf-davinci-modes-title">Choose how PF presents the flow</h2>
        </div>
        <div className="pf-davinci-modes">
          <article>
            <h3>Widget mode</h3>
            <p>Shows DaVinci&rsquo;s interactive screens inside the adapter&rsquo;s PingFederate template.</p>
            <p>Use it when the flow needs to collect information or guide the user through a challenge.</p>
          </article>
          <article>
            <h3>API mode</h3>
            <p>Runs the flow without displaying DaVinci UI and returns results for PF policy decisions.</p>
            <p>Use it when PF controls the interaction and only needs flow data or decisions.</p>
          </article>
        </div>
      </section>

      <section className="pf-davinci-section pf-davinci-setup" aria-labelledby="pf-davinci-setup-title">
        <div className="pf-davinci-section-heading">
          <p className="pf-davinci-kicker">PF administrator</p>
          <h2 id="pf-davinci-setup-title">Check the installed adapter</h2>
        </div>
        <ol>
          <li>Confirm the PingOne DaVinci IdP Adapter is installed on every PF engine node.</li>
          <li>Check the adapter instance uses the intended DaVinci company, policy, and flow mode.</li>
          <li>Map PF request attributes into the flow and map returned attributes into the PF policy contract.</li>
          <li>Confirm the PF authentication policy invokes that adapter for this OIDC client.</li>
          <li>Review PF engine logs and DaVinci execution history after a sign-in attempt.</li>
        </ol>
        <h3>Troubleshoot a failed run</h3>
        <ul>
          <li>Check that the adapter&rsquo;s company and policy belong together and that the selected flow is published.</li>
          <li>Verify the configured DaVinci region URLs for API, authentication, and widget traffic.</li>
          <li>For widget mode, allow the DaVinci widget origins in the PF page Content Security Policy.</li>
          <li>After a kit upgrade, review customizations and deploy the same kit version to every PF engine node.</li>
        </ul>
        <p>
          For DaVinci SDK and widget examples that run directly in the browser, return to the{" "}
          <a href="/davinci-sdk">DaVinci SDK master page</a>.
        </p>
        <nav className="pf-davinci-sources" aria-label="Ping documentation">
          <a href="https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik.html" target="_blank" rel="noreferrer">Integration Kit guide</a>
          <a href="https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_deploying_the_integration_files.html" target="_blank" rel="noreferrer">Deploying the kit</a>
          <a href="https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_overview_of_the_sso_flow.html" target="_blank" rel="noreferrer">SSO flow overview</a>
          <a href="https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_p1_davinci_idp_adapter_settings_reference.html" target="_blank" rel="noreferrer">Adapter settings</a>
          <a href="https://docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_how_to_implement_a_flow.html" target="_blank" rel="noreferrer">DaVinci integration methods</a>
        </nav>
      </section>
    </main>
  );
}
