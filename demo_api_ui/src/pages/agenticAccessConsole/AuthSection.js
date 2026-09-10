import React from "react";

export default function AuthSection() {
  return (
    <div>
      <p className="aac-section-intro">
        Sign-in is <code>authorization_code</code> + PKCE (S256) against PingOne.
        Passkey/WebAuthn rp.id is the <strong>parent</strong> domain{" "}
        <code>ping-devops.com</code> (deliberate, so subdomains share one
        registration), with redirect URIs under{" "}
        <code>https://local.ping-devops.com:4000</code>. First-time sign-in uses
        PingOne's hosted form; returning users can use a bound passkey.
      </p>

      <div className="aac-section-block">
        <h3>Step-up MFA</h3>
        <div className="aac-card">
          <div className="aac-card-body">
            <code>acr_values=Multi_Factor</code> is checked in{" "}
            <code>middleware/auth.js</code>, surfaced as HTTP 428 with{" "}
            <code>{'{"error":"mcp_step_up_required","acr_values":"Multi_Factor"}'}</code>{" "}
            (RFC 9470 framing) — the same condition as the "Require Step-Up MFA
            for High-Value Transfers" rule on the P1AZ Policies tab.
          </div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Session</h3>
        <div className="aac-card">
          <div className="aac-card-body">
            <code>connect.sid</code> cookie (httpOnly, 24h) plus a secondary signed{" "}
            <code>_auth</code> restore cookie.
          </div>
        </div>
      </div>

      <div className="aac-section-block">
        <h3>Three approval mechanisms, one shared session flag</h3>
        <p className="aac-card-sub" style={{ marginBottom: 10 }}>
          All three converge on <code>req.session.hitlVerified</code>.
        </p>
        <div className="aac-grid-3">
          <div className="aac-card">
            <div className="aac-card-title">Consent challenge</div>
            <div className="aac-card-sub">BFF, express-session</div>
            <div className="aac-card-body">
              States: pending → otp_pending → confirmed.
            </div>
          </div>
          <div className="aac-card">
            <div className="aac-card-title">demo_hitl_service</div>
            <div className="aac-card-sub">Separate microservice</div>
            <div className="aac-card-body">
              <code>/challenges</code> + receipt verification. Used for
              MCP-tool-call-level agent approval.
            </div>
          </div>
          <div className="aac-card">
            <div className="aac-card-title">CIBA</div>
            <div className="aac-card-sub">PingOne <code>/as/bc-authorize</code></div>
            <div className="aac-card-body">
              Documented fallback to an in-process simulated service when
              unreachable — <code>ciba_failover_mode=fallback_simulated</code> is
              the default.
            </div>
          </div>
        </div>
        <p className="aac-note">
          🔐 All three write the same session flag, so a page checking HITL status
          cannot tell which mechanism satisfied it — that is by design, not a gap.
        </p>
      </div>
    </div>
  );
}
