import React, { useState } from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import { useMermaidRender } from "../hooks/useMermaidRender";
import DavinciLoginWidget from "./DavinciLoginWidget";
import "./DavinciLoginGuidePage.css";

const GUIDE_SECTIONS = [
  { id: "try-it", label: "Try It Live", icon: "\u{1F511}" },
  { id: "overview", label: "Overview", icon: "\u{1F4D6}" },
  { id: "how-it-works", label: "How It Works", icon: "⚙️" },
  { id: "flow", label: "The Flow", icon: "\u{1F310}" },
  { id: "api", label: "API Reference", icon: "\u{1F4C4}" },
  { id: "security", label: "Security", icon: "\u{1F510}" },
  { id: "troubleshooting", label: "Troubleshooting", icon: "\u{1F527}" },
  { id: "repo", label: "In This Repo", icon: "\u{1F4DA}" },
];

// The exact hop-by-hop sequence: routes/davinciLogin.js's /sdk-token and
// /widget-session, plus the widget's skRenderScreen success path in
// DavinciLoginWidget.jsx. Kept as one static source rather than reusing
// ProtocolPlayground's flowSpec/buildSequenceSource — this diagram is fixed,
// not driven by a live run, so the smaller direct mermaid source is enough.
const FLOW_SOURCE = `sequenceDiagram
    autonumber
    participant B as Browser
    participant W as DaVinci Widget
    participant BFF as BFF (/api/davinci-login)
    participant DV as DaVinci Orchestrate API
    participant P1 as PingOne

    B->>BFF: POST /sdk-token
    BFF->>BFF: arm single-use nonce (session)
    BFF->>DV: POST /company/:id/sdktoken { nonce }
    DV-->>BFF: access_token (SDK token)
    BFF-->>B: accessToken (widget config)
    B->>W: skRenderScreen(config)
    W->>DV: flow's own screens (sign-on, welcome, success)
    DV->>P1: Return Success Response (Widget Flows)
    P1-->>W: id_token (echoes nonce), access_token
    W-->>B: successCallback(id_token, access_token)
    B->>BFF: POST /widget-session { idToken, accessToken }
    BFF->>P1: fetch JWKS, verify both signatures
    BFF->>BFF: check nonce, audiences, same subject
    BFF->>BFF: look up existing user, regenerate session
    BFF-->>B: { ok: true }
    B->>B: load /davinci-login/confirmed`;

function CodeBlock({ title, children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="dlg-code">
      {title && <div className="dlg-code-title">{title}</div>}
      <pre>
        <code>{children}</code>
      </pre>
      <button type="button" className="dlg-code-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TableBlock({ headers, rows }) {
  return (
    <div className="dlg-table-wrap">
      <table className="dlg-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="dlg-section">
      <h2 className="dlg-section-title">{title}</h2>
      {children}
    </section>
  );
}

function FlowDiagram() {
  const { containerRef, error } = useMermaidRender(FLOW_SOURCE, {
    securityLevel: "strict",
    sequence: { useMaxWidth: true, wrap: false },
  });
  return (
    <figure className="dlg-mermaid">
      {error ? (
        <p className="dlg-mermaid-error">{error}</p>
      ) : (
        <div className="dlg-mermaid-canvas" ref={containerRef} />
      )}
    </figure>
  );
}

export default function DavinciLoginGuidePage() {
  const [activeSection, setActiveSection] = useState("try-it");
  const { size: navWidth, handleProps: navHandleProps } = useDividerDrag({
    min: 180,
    max: 400,
    initial: 220,
    storageKey: "dlg-sidebar-width",
  });

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="dlg-page">
      <header className="dlg-header">
        <h1>DaVinci Widget</h1>
        <p className="dlg-subtitle">
          Try the live widget below, then see how it actually works — the real
          request/response shapes, the hop-by-hop flow, and where it lives in this repo.
        </p>
      </header>

      <div className="dlg-layout" style={{ "--dlg-nav-w": `${navWidth}px` }}>
        <nav className="dlg-sidebar">
          {GUIDE_SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={`dlg-nav-item ${activeSection === s.id ? "dlg-nav-item--active" : ""}`}
              onClick={() => scrollTo(s.id)}
            >
              <span className="dlg-nav-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="divider-drag-handle" aria-label="Resize section navigation" {...navHandleProps} />

        <main className="dlg-content">
          {/* ─── Try It Live ─── */}
          <Section id="try-it" title="Try It Live">
            <p>
              The widget below runs the real DaVinci flow end-to-end against this demo&apos;s
              PingOne environment. On success it signs you in as an existing demo user — see{" "}
              <a href="#security">Security</a> for what that means.
            </p>
            <DavinciLoginWidget />
          </Section>

          {/* ─── Overview ─── */}
          <Section id="overview" title="Overview">
            <p>
              The widget above renders a DaVinci flow&apos;s own screens in-page via the hosted{" "}
              <code>davinci.js</code> script and its <code>skRenderScreen</code> call — it is a
              widget integration, <strong>not</strong> the <code>@forgerock/davinci-client</code>{" "}
              SDK. That SDK approach was tried and abandoned; some older docs in this repo still
              describe it and are stale.
            </p>
            <div className="dlg-callout dlg-callout--info">
              <strong>Separate from the protected admin login.</strong> This flow never touches{" "}
              <code>routes/oauth.js</code> (admin login, auto-creates accounts) — it mirrors{" "}
              <code>routes/oauthUser.js</code>&apos;s end-user callback instead, and only signs in an{" "}
              <strong>existing</strong> demo user.
            </div>
            <h3>Why it exists</h3>
            <ul>
              <li>Demonstrates a DaVinci-orchestrated sign-on without leaving the app</li>
              <li>Still ends in a normal BFF session, holding PingOne-issued tokens for the Demo API</li>
              <li>Lets a flow author add steps (MFA, risk checks) without any BFF code changes</li>
            </ul>
          </Section>

          {/* ─── How It Works ─── */}
          <Section id="how-it-works" title="How It Works">
            <p>
              The flow ends with the PingOne Authentication connector&apos;s{" "}
              <strong>Return Success Response (Widget Flows)</strong>, which creates the PingOne session
              and returns OIDC tokens straight to the page. The page hands them to the BFF, which
              verifies them before signing anyone in. There is no <code>/authorize</code> redirect:
              the PingOne session cookie set during the widget&apos;s cross-site calls never reaches
              one, so a redirect would land on PingOne&apos;s hosted sign-on page instead.
            </p>
            <ol>
              <li>
                Page loads, calls <code>POST /api/davinci-login/sdk-token</code>. The BFF arms a
                single-use nonce on the session, passes it to the flow as a parameter, mints a DaVinci
                SDK token, and returns the widget config.
              </li>
              <li>
                The widget script renders the flow&apos;s own screens (sign-on, MFA, whatever the flow
                declares) in the page&apos;s container via <code>skRenderScreen</code>.
              </li>
              <li>
                On success the flow&apos;s final node returns an <code>id_token</code> (carrying the
                nonce from step 1) and an <code>access_token</code> for the Demo API to the
                widget&apos;s <code>successCallback</code>.
              </li>
              <li>
                <code>POST /api/davinci-login/widget-session</code> verifies both signatures against
                PingOne&apos;s JWKS, checks the nonce (single-use, deleted before any check), that the
                ID token was issued to this app and the access token for this API, and that both name
                the same user. It then looks up an <strong>existing</strong> demo user, regenerates the
                session, and signs in; the page loads <code>/davinci-login/confirmed</code>.
              </li>
            </ol>
          </Section>

          {/* ─── The Flow ─── */}
          <Section id="flow" title="The Flow">
            <p>Every hop from the initial request to a signed-in session:</p>
            <FlowDiagram />
          </Section>

          {/* ─── API Reference ─── */}
          <Section id="api" title="API Reference">
            <h3>POST /api/davinci-login/sdk-token</h3>
            <p>Mints a DaVinci SDK token for one widget run. <code>username</code> is optional.</p>
            <CodeBlock title="Request">
{`{
  "username": "alice"   // optional — flow's Sign On screen collects it otherwise
}`}
            </CodeBlock>
            <CodeBlock title="Response 200">
{`{
  "accessToken": "eyJhbGciOi...",   // DaVinci SDK token, NOT a PingOne access token
  "companyId": "...",
  "policyId": "...",
  "flowVersion": "v1",
  "apiRoot": "https://auth.pingone.com/"
}`}
            </CodeBlock>
            <CodeBlock title="Response 503 — davinci_not_configured">
{`{
  "error": "davinci_not_configured",
  "message": "DaVinci login is not configured — missing: PINGONE_DAVINCI_API_KEY (vault)."
}`}
            </CodeBlock>

            <h3>POST /api/davinci-login/widget-session</h3>
            <p>Signs in with the tokens the flow&apos;s final node returned to the widget.</p>
            <CodeBlock title="Request">
{`{
  "idToken": "eyJhbGciOi...",      // from successCallback's id_token
  "accessToken": "eyJhbGciOi..."   // from successCallback's access_token
}`}
            </CodeBlock>
            <CodeBlock title="Response 200">
{`{ "ok": true }`}
            </CodeBlock>
            <TableBlock
              headers={["Status", "error", "Cause"]}
              rows={[
                ["401", "nonce_missing", "No login flow was armed in this session"],
                ["401", "token_unverified", "A signature did not verify against PingOne's JWKS"],
                ["401", "nonce_mismatch", "ID token's nonce doesn't match — possible replay"],
                ["401", "audience_mismatch", "ID token not issued to this app, or access token not for this API"],
                ["401", "subject_mismatch", "The two tokens name different users"],
                ["404", "user_not_found", "No demo user exists for the authenticated username"],
              ]}
            />
          </Section>

          {/* ─── Security ─── */}
          <Section id="security" title="Security">
            <ul>
              <li>
                <strong>API key never reaches the browser.</strong> The DaVinci API key is a vaulted
                secret used only server-side to mint the SDK token.
              </li>
              <li>
                <strong>Nonce is single-use.</strong> Read-and-deleted from the session before any
                token check, so a failed attempt can&apos;t retry against the same value.
              </li>
              <li>
                <strong>Tokens are verified, not trusted.</strong> They pass through the browser, so
                the BFF checks both signatures against PingOne&apos;s JWKS (never introspection alone),
                the audiences, and that both name the same user.
              </li>
              <li>
                <strong>Existing users only.</strong> Unlike the admin OAuth route, this never
                auto-creates or auto-admins an account from an arbitrary DaVinci login.
              </li>
              <li>
                <strong>Session regeneration.</strong> The session is regenerated before storing
                credentials, to prevent session fixation.
              </li>
            </ul>
          </Section>

          {/* ─── Troubleshooting ─── */}
          <Section id="troubleshooting" title="Troubleshooting">
            <TableBlock
              headers={["Symptom", "Cause", "Fix"]}
              rows={[
                [
                  "503 davinci_not_configured",
                  "Missing PINGONE_DAVINCI_LOGIN_COMPANY_ID / POLICY_ID (.env) or PINGONE_DAVINCI_API_KEY (vault)",
                  "Set the missing value the error message names",
                ],
                [
                  "401 nonce_missing on /widget-session",
                  "No /sdk-token call happened first in this session (or the session didn't persist)",
                  "Restart the sign-in using the Try It Live section above",
                ],
                [
                  "401 nonce_mismatch on /widget-session",
                  "ID token's nonce doesn't match what was armed — possible replay, or the flow's final node lost its nonce claim",
                  "Restart the sign-in; if it repeats, check the flow's Return Success Response (Widget Flows) node",
                ],
                [
                  "401 audience_mismatch on /widget-session",
                  "The flow's final node issues tokens for a different app, or without the Demo API scopes",
                  "Point the node at the app the BFF signs in with, and request the Demo API scopes",
                ],
                [
                  "404 user_not_found on /widget-session",
                  "The username DaVinci authenticated has no matching demo user in dataStore",
                  "Use a username that exists in the demo user data, or create one first",
                ],
              ]}
            />
          </Section>

          {/* ─── In This Repo ─── */}
          <Section id="repo" title="In This Repo">
            <TableBlock
              headers={["File", "Purpose"]}
              rows={[
                ["demo_api_ui/src/pages/DavinciLoginWidget.jsx", "Renders the widget via skRenderScreen; handles successCallback/errorCallback"],
                ["demo_api_ui/src/lib/davinciWidgetClient.js", "Loads the davinci.js script tag; fetches widget config and posts the flow's tokens to the BFF"],
                ["demo_api_server/routes/davinciLogin.js", "sdk-token + widget-session routes — nonce arming and token verification"],
                ["demo_api_server/config/davinci.js", "companyId / policyId / API key config"],
              ]}
            />
          </Section>
        </main>
      </div>
    </div>
  );
}
