// Static value-prop page for PingOne DaVinci orchestration -- makes NO live
// DaVinci or BFF calls, so it works even before the console setup in
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md's
// Task 1 is done. Reached from the agent header's More menu when "DaVinci Mode"
// is on (see AIAgent.js). Optional CTA links to the live widget demo (/davinci-login).
//
// Visual design ported from the approved mockup (davinci-explainer-mock.html):
// a breadcrumb "shell" bar, a bordered comparison matrix with a highlighted
// PingOne DaVinci row, a connected vertical flow chain for the orchestration
// steps, and a self-contained sun/moon theme toggle. All selectors below are
// scoped under `.davinci-explainer` so this page's light/dark state never
// leaks into the rest of the app.
import { useState } from "react";

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

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function DavinciExplainerPage() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });
  const isDark = theme === "dark";

  return (
    <div className="davinci-explainer" data-theme={theme}>
      <style>{DAVINCI_EXPLAINER_CSS}</style>

      <div className="shell-topbar">
        <span className="shell-brand">Banking Demo</span>
        <span className="shell-crumb">
          Agent Dashboard <span className="sep">&rsaquo;</span> More <span className="sep">&rsaquo;</span> DaVinci Orchestration
        </span>
        <span className="shell-pill">DaVinci Mode</span>
        <button
          type="button"
          className="theme-toggle"
          aria-label="Toggle light and dark mode"
          title="Toggle light and dark mode"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          <span className="knob" aria-hidden="true">
            {isDark ? <SunIcon /> : <MoonIcon />}
          </span>
        </button>
      </div>

      <main>
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
            <a className="btn-primary" href="/davinci-login">
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
      </main>
    </div>
  );
}

const DAVINCI_EXPLAINER_CSS = `
.davinci-explainer {
  --bg: #f6f7fb;
  --surface: #ffffff;
  --surface-2: #eef0f7;
  --border: #dde1ea;
  --text: #12172b;
  --text-muted: #5b6478;
  --text-faint: #8891a8;
  --accent: #3949ab;
  --accent-ink: #ffffff;
  --accent-soft: #e7e9fa;
  --mono-tint: #f2f3f8;
  --shadow: 0 1px 2px rgba(18, 23, 43, 0.04), 0 8px 24px rgba(18, 23, 43, 0.06);

  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  min-height: 100%;
}

@media (prefers-color-scheme: dark) {
  .davinci-explainer:not([data-theme="light"]) {
    --bg: #0d1220;
    --surface: #141a2c;
    --surface-2: #1a2138;
    --border: #262f4a;
    --text: #e8ecf7;
    --text-muted: #9aa4c4;
    --text-faint: #6c7592;
    --accent: #8b98f5;
    --accent-ink: #0d1220;
    --accent-soft: #212a4a;
    --mono-tint: #171e33;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.35);
  }
}

.davinci-explainer[data-theme="dark"] {
  --bg: #0d1220;
  --surface: #141a2c;
  --surface-2: #1a2138;
  --border: #262f4a;
  --text: #e8ecf7;
  --text-muted: #9aa4c4;
  --text-faint: #6c7592;
  --accent: #8b98f5;
  --accent-ink: #0d1220;
  --accent-soft: #212a4a;
  --mono-tint: #171e33;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.35);
}

.davinci-explainer * { box-sizing: border-box; }

.davinci-explainer .shell-topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.davinci-explainer .shell-brand {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: -0.01em;
}
.davinci-explainer .shell-crumb {
  color: var(--text-faint);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.davinci-explainer .shell-crumb .sep { opacity: 0.6; }
.davinci-explainer .shell-pill {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 4px 10px;
}

.davinci-explainer main {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}

.davinci-explainer .eyebrow {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 14px;
}

.davinci-explainer h1 {
  font-size: 30px;
  line-height: 1.18;
  letter-spacing: -0.015em;
  margin: 0 0 16px;
  font-weight: 700;
}

.davinci-explainer .lede {
  font-size: 16.5px;
  line-height: 1.6;
  color: var(--text-muted);
  max-width: 62ch;
  margin: 0 0 40px;
}
.davinci-explainer .lede em { color: var(--text); font-style: normal; font-weight: 600; }

.davinci-explainer h2 {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin: 0 0 18px;
  padding-top: 4px;
}

.davinci-explainer section + section { margin-top: 44px; }

.davinci-explainer .matrix {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.davinci-explainer .matrix-row {
  display: grid;
  grid-template-columns: 190px 1fr;
  gap: 0;
}
.davinci-explainer .matrix-row + .matrix-row { border-top: 1px solid var(--border); }
.davinci-explainer .matrix-row.is-featured { background: var(--accent-soft); }
.davinci-explainer .matrix-cell { padding: 16px 18px; }
.davinci-explainer .matrix-cell.platform {
  font-weight: 600;
  font-size: 13.5px;
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border);
  color: var(--text);
}
.davinci-explainer .matrix-row.is-featured .matrix-cell.platform { color: var(--accent); }
.davinci-explainer .matrix-cell.note {
  font-size: 13.5px;
  color: var(--text-muted);
  line-height: 1.55;
}
.davinci-explainer .matrix-row.is-featured .matrix-cell.note { color: var(--text); }

.davinci-explainer .flow {
  position: relative;
  padding-left: 34px;
}
.davinci-explainer .flow::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 8px;
  bottom: 8px;
  width: 1.5px;
  background-image: repeating-linear-gradient(
    to bottom,
    var(--border) 0,
    var(--border) 4px,
    transparent 4px,
    transparent 9px
  );
}
.davinci-explainer .flow-step { position: relative; padding: 0 0 26px; }
.davinci-explainer .flow-step:last-child { padding-bottom: 0; }
.davinci-explainer .flow-step::before {
  content: "";
  position: absolute;
  left: -34px;
  top: 3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
}
.davinci-explainer .flow-step.is-branch::before { border-color: var(--text-faint); }
.davinci-explainer .flow-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 3px;
}
.davinci-explainer .flow-detail { font-size: 13px; color: var(--text-muted); }
.davinci-explainer .flow-tag {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: var(--mono-tint);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 6px;
  margin-left: 8px;
  vertical-align: 1px;
}

.davinci-explainer .closing {
  font-size: 14.5px;
  color: var(--text-muted);
  margin-top: 22px;
  padding: 16px 18px;
  background: var(--surface-2);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.davinci-explainer .cta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.davinci-explainer .btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
  font-size: 13.5px;
  padding: 11px 18px;
  border-radius: 8px;
  text-decoration: none;
  border: 1px solid transparent;
}
.davinci-explainer .btn-primary svg { flex-shrink: 0; }
.davinci-explainer .cta-note { font-size: 12.5px; color: var(--text-faint); max-width: 34ch; margin: 0; }

.davinci-explainer .footnote {
  margin-top: 56px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-faint);
}

@media (max-width: 560px) {
  .davinci-explainer .matrix-row { grid-template-columns: 1fr; }
  .davinci-explainer .matrix-cell.platform { border-right: none; border-bottom: 1px solid var(--border); }
}

.davinci-explainer .theme-toggle {
  margin-left: 10px;
  position: relative;
  width: 46px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.davinci-explainer .theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.davinci-explainer .theme-toggle .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-ink);
  transition: transform 0.18s ease;
}
.davinci-explainer[data-theme="dark"] .theme-toggle .knob { transform: translateX(20px); }
.davinci-explainer .theme-toggle svg { width: 11px; height: 11px; }
`;
