// demo_api_ui/src/components/TraceTrustPanel.jsx
// DPoP + RAR trust posture for TokenChainTraceRail (current-call story).
import React from "react";
import { deriveTrustPosture } from "../utils/tokenChainTrust";

/**
 * Renders sender-constraint (DPoP) and intent-binding (RAR) posture.
 * @param {{ events?: Array<object>|null }} props
 */
export default function TraceTrustPanel({ events = null }) {
  const { jkt, details, dpopBound, rarScoped } = deriveTrustPosture(events);

  return (
    <div className="tctr-trust" data-testid="trace-trust-panel">
      <p>
        Why this call can be trusted — sender-constraint (DPoP) and intent (RAR)
        posture for the current chain.
      </p>
      <div className={`tctr-trust__row ${dpopBound ? "tctr-trust__row--ok" : "tctr-trust__row--off"}`}>
        <span className="tctr-trust__badge">{dpopBound ? "BOUND" : "not set"}</span>
        <div>
          <strong>Sender-constrained (DPoP · RFC 9449)</strong>
          {dpopBound ? (
            <div>
              Token bound to key <code>{jkt.slice(0, 16)}…</code> via <code>cnf.jkt</code>.
              A stolen bearer is useless without the private key; a DPoP proof is
              verified on each hop.
            </div>
          ) : (
            <div>
              No DPoP binding on this call yet. With <code>ff_dpop</code> on, the
              delegated token is sender-constrained after the next tool call.
            </div>
          )}
        </div>
      </div>
      <div className={`tctr-trust__row ${rarScoped ? "tctr-trust__row--ok" : "tctr-trust__row--off"}`}>
        <span className="tctr-trust__badge">{rarScoped ? "SCOPED" : "not set"}</span>
        <div>
          <strong>Intent-bound (RAR · RFC 9396)</strong>
          {details ? (
            <div>
              Authorized for <code>{details.tool || (details.actions || []).join(", ") || "action"}</code>
              {details.amount != null ? <> up to <code>{details.amount}{details.currency ? ` ${details.currency}` : ""}</code></> : null}
              {details.payee ? <> to <code>{details.payee}</code></> : null}.
              The gateway enforces the actual call is a subset of this grant.
            </div>
          ) : rarScoped ? (
            <div>
              RAR intent binding evidence is present on this chain (verified or grant armed).
              Expand pipeline steps for the Intent Binding Check detail.
            </div>
          ) : (
            <div>
              No <code>authorization_details</code> on this call yet. With{" "}
              <code>ff_rar</code> on, the agent is bound to a specific action
              instead of a broad scope.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
