// Static value-prop page for PingOne DaVinci orchestration -- makes NO live
// DaVinci or BFF calls, so it works even before the console setup in
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md's
// Task 1 is done. Reached from the agent header's More menu when "DaVinci Mode"
// is on (see AIAgent.js). Optional CTA links to the live widget demo (/davinci-login-guide).
//
// Visual design ported from the approved mockup (davinci-explainer-mock.html):
// a breadcrumb "shell" bar, a bordered comparison matrix with a highlighted
// PingOne DaVinci row, and a connected vertical flow chain for the
// orchestration steps. All selectors are scoped under `.davinci-explainer`.
//
// The page used to own its light/dark state: a private palette, its own
// sun/moon toggle and its own `data-theme` attribute seeded from
// `prefers-color-scheme`. The app's theme toggle therefore did nothing here.
// It now follows the app theme like every other page — see the stylesheet,
// which keeps the private variable names and re-points them at --th-* tokens.
import "./DavinciExplainerPage.css";

const COMPARISON_ROWS = [
  {
    platform: "Okta Workflows",
    note: "No-code, but locked to the Okta ecosystem.",
    featured: false,
  },
  {
    platform: "Auth0 Actions",
    note: "Code-based (JavaScript) extensibility, not a visual no-code canvas.",
    featured: false,
  },
  {
    platform: "Microsoft Entra ID Governance",
    note: "Strong only inside the Azure & Microsoft stack.",
    featured: false,
  },
  {
    platform: "PingOne DaVinci",
    note: "Vendor-agnostic — 350+ connectors spanning identity and business/IT systems (Slack, Twilio, ServiceNow, generic HTTP). Visual multi-system branching, flow versioning and A/B testing, SaaS / self-managed / hybrid deployment.",
    featured: true,
  },
];

const ORCHESTRATION_STEPS = [
  {
    title: "PingOne SSO",
    tag: "Identity",
    detail: "Look up the user initiating the transfer.",
    isBranch: false,
  },
  {
    title: "PingOne Protect",
    tag: "Identity",
    detail: "Real-time risk score for this request.",
    isBranch: false,
  },
  {
    title: "Branch on risk",
    tag: null,
    detail: "Low risk permits immediately; medium/high risk continues below.",
    isBranch: true,
  },
  {
    title: "PingOne MFA",
    tag: "Identity",
    detail: "Step-up challenge, run in parallel with the alert below.",
    isBranch: false,
  },
  {
    title: "Generic HTTP connector",
    tag: "Business system",
    detail: "Alerts a fraud queue — a business system, not an identity service.",
    isBranch: false,
  },
  {
    title: "PingOne Authorize",
    tag: "Identity",
    detail: "Final policy decision.",
    isBranch: false,
  },
  {
    title: "Generic HTTP connector",
    tag: "Business system",
    detail: "Writes the result back into this demo's own audit trail.",
    isBranch: false,
  },
];

export default function DavinciExplainerPage() {
  // No theme state, no toggle: the app's own toggle sets data-theme on :root
  // and the stylesheet's --th-* tokens follow it. SunIcon/MoonIcon went with
  // the private toggle; AppShell already provides one in the header.
  return (
    <div className="davinci-explainer">
      <div>
        <p className="eyebrow">PingOne DaVinci</p>
        <h1>Why PingOne DaVinci Orchestration</h1>
        <p className="lede">
          A single-connector policy check proves DaVinci can call an API. It does not show why a
          customer would buy it. The value is orchestrating <em>many</em> connector types &mdash;
          identity and business systems together &mdash; on one visual, no-code canvas.
        </p>

        <section>
          <h2>How this differs from the alternatives</h2>
          <div className="matrix">
            {COMPARISON_ROWS.map((row) => (
              <div className={`matrix-row${row.featured ? " is-featured" : ""}`} key={row.platform}>
                <div className="matrix-cell platform">{row.platform}</div>
                <div className="matrix-cell note">{row.note}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>What this demo&rsquo;s transaction step-up flow chains together</h2>
          <div className="flow">
            {ORCHESTRATION_STEPS.map((step, index) => (
              <div className={`flow-step${step.isBranch ? " is-branch" : ""}`} key={`${step.title}-${index}`}>
                <p className="flow-title">
                  {step.title}
                  {step.tag && <span className="flow-tag">{step.tag}</span>}
                </p>
                <p className="flow-detail">{step.detail}</p>
              </div>
            ))}
          </div>
          <p className="closing">
            None of that chain is a single API call away &mdash; it is exactly the kind of
            cross-system orchestration a customer would otherwise hand-write and maintain
            themselves.
          </p>
        </section>

        <section>
          <div className="cta-row">
            <a className="btn-primary" href="/davinci-login-guide">
              See the live widget login demo
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <p className="cta-note">
              Requires DaVinci console setup. If that&rsquo;s not done yet on this environment,
              the live page explains what&rsquo;s missing.
            </p>
          </div>
        </section>

        <p className="footnote">
          Static content only &mdash; this page makes no live DaVinci or BFF calls, so it works
          for quick demos regardless of console setup state.
        </p>
      </div>
    </div>
  );
}
