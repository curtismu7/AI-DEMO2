import React from "react";
import { useTokenChainOptional } from "../context/TokenChainContext";

/**
 * CibaStepUpFlowPanel — "CIBA Step-Up" tab in ArchitectureTabsPanel.
 *
 * Teaches the high-value-transfer CIBA step-up sequence and shows the live
 * backchannel-granted token event when one occurred this session.
 *
 * Flow (frontend-driven 428 bridge — see the `ciba` skill):
 *   1. User attempts a high-value transfer.
 *   2. Server gate returns 428 { step_up_method: 'ciba', step_up_acr }.
 *   3. Frontend POSTs /api/auth/ciba/initiate (login_hint, binding_message).
 *   4. Frontend polls /api/auth/ciba/poll/:authReqId until approved/denied.
 *   5. On approval the BFF stores tokens server-side and the transfer proceeds.
 */

const STEPS = [
  {
    n: 1,
    actor: "Browser → BFF",
    title: "High-value transfer attempt",
    detail:
      "The user submits a transfer above confirm_threshold_usd while STEP_UP_METHOD=ciba.",
  },
  {
    n: 2,
    actor: "BFF → Browser",
    title: "428 step-up required",
    detail:
      "The gate returns HTTP 428 with body { step_up_method: 'ciba', step_up_acr }. The gate does NOT call cibaService itself — the frontend drives the bridge.",
  },
  {
    n: 3,
    actor: "Browser → BFF → PingOne",
    title: "POST /api/auth/ciba/initiate",
    detail:
      "Frontend sends login_hint + binding_message. The BFF calls PingOne bc-authorize and returns auth_req_id + interval (tokens never reach the browser).",
  },
  {
    n: 4,
    actor: "User (out-of-band)",
    title: "Approve on the bound channel",
    detail:
      "PingOne's device-authentication policy decides the channel (email / SMS / FIDO2 / push). The user approves there.",
  },
  {
    n: 5,
    actor: "Browser → BFF",
    title: "Poll /api/auth/ciba/poll/:authReqId",
    detail:
      "Frontend polls until approved. The BFF stores the granted tokens server-side and sets stepUpVerified for 5 minutes; the transfer then proceeds.",
  },
];

const CHANNELS = [
  { channel: "Email approve-link / OTP", ux: "Approve from inbox", app: "No" },
  { channel: "SMS OTP", ux: "Code via text", app: "No" },
  {
    channel: "FIDO2 / passkey",
    ux: "Touch ID / Windows Hello / platform passkey in browser",
    app: "No",
  },
  {
    channel: "Mobile push",
    ux: "Tap Approve in an app",
    app: "Yes — PingID app (or custom PingOne MFA SDK app)",
  },
];

function CibaStepUpFlowPanel() {
  const tokenChain = useTokenChainOptional();
  const cibaEvents = (tokenChain?.events || []).filter(
    (e) => e?.grantedVia === "ciba",
  );

  return (
    <div className="ciba-stepup-flow">
      <p className="ciba-stepup-intro">
        <strong>CIBA step-up</strong> protects a high-value transfer with an
        out-of-band approval. The flow below is identical regardless of how the
        user approves — only the PingOne device-authentication policy decides the
        channel.
      </p>

      <ol className="ciba-stepup-steps">
        {STEPS.map((s) => (
          <li key={s.n} className="ciba-stepup-step">
            <span className="ciba-stepup-step-actor">{s.actor}</span>
            <span className="ciba-stepup-step-title">{s.title}</span>
            <span className="ciba-stepup-step-detail">{s.detail}</span>
          </li>
        ))}
      </ol>

      <h4 className="ciba-stepup-subhead">Approval channels</h4>
      <table className="ciba-stepup-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>User experience</th>
            <th>Mobile app required?</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((c) => (
            <tr key={c.channel}>
              <td>{c.channel}</td>
              <td>{c.ux}</td>
              <td>{c.app}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ciba-stepup-note">
        There is no pure-browser push for PingOne MFA — push must land in a
        mobile app holding the registered device credential. For an app-free
        demo, use email / SMS / FIDO2. Adding push later is PingOne-config-only.
      </p>

      <h4 className="ciba-stepup-subhead">This session</h4>
      {cibaEvents.length > 0 ? (
        <ul className="ciba-stepup-live">
          {cibaEvents.map((e) => (
            <li key={e.id}>
              <strong>{e.description}</strong>
              {e.scopes?.length ? ` — scopes: ${e.scopes.join(", ")}` : ""}
              {e.timestamp ? ` (${new Date(e.timestamp).toLocaleTimeString()})` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ciba-stepup-empty">
          No CIBA step-up has occurred in this session yet. Trigger a high-value
          transfer (with STEP_UP_METHOD=ciba) to see the backchannel-granted
          token appear here and in the floating token-chain panel.
        </p>
      )}
    </div>
  );
}

export default CibaStepUpFlowPanel;
