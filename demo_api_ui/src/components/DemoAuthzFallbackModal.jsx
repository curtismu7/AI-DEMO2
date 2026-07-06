import React from "react";
import DraggableModal from "./DraggableModal";
import "./DemoAuthzFallbackModal.css";

/**
 * Shown once per session when authorization decisions fall back to the local
 * demo authorize server (PingOne Authorize / the discovery path was unreachable).
 *
 * `detail` (optional) carries the per-decision fallback signal emitted by the
 * BFF (services/transactionAuthorizationService + mcpToolAuthorizationService):
 *   { attemptedEngine, failoverMode, effectiveAction, error, path, tool? }
 * When present it's rendered as a debug panel so the operator can see exactly
 * which call failed and why — the "this should help debug" requirement.
 */
const EFFECTIVE_ACTION_LABEL = {
  fell_back_to_simulated: "Fell back to the demo (simulated) authorize engine",
  denied: "Transaction denied (strict PingOne — no fallback)",
  permitted: "Permitted by failover policy (fail-open)",
};

export default function DemoAuthzFallbackModal({ open, onClose, detail = null }) {
  if (!open) return null;
  return (
    <DraggableModal title="Using the demo authorize server" isOpen={open} onClose={onClose} footer={null}>
      <div className="demo-authz-fallback">
        <p className="demo-authz-fallback__body">
          PingOne Authorize was unreachable, so authorization decisions are being
          handled by the local demo authorize server. Functionality is unaffected;
          decisions may differ from production policy.
        </p>
        {detail && (
          <dl className="demo-authz-fallback__detail">
            <div className="demo-authz-fallback__row">
              <dt>Path</dt>
              <dd>{detail.path === "mcp" ? `Agent / MCP tool${detail.tool ? ` (${detail.tool})` : ""}` : "Transaction"}</dd>
            </div>
            <div className="demo-authz-fallback__row">
              <dt>Failover action</dt>
              <dd>{EFFECTIVE_ACTION_LABEL[detail.effectiveAction] || detail.effectiveAction || "—"}</dd>
            </div>
            {detail.failoverMode && (
              <div className="demo-authz-fallback__row">
                <dt>Failover mode</dt>
                <dd>{detail.failoverMode}</dd>
              </div>
            )}
            {detail.error && (
              <div className="demo-authz-fallback__row">
                <dt>PingOne error</dt>
                <dd className="demo-authz-fallback__err">{detail.error}</dd>
              </div>
            )}
            {detail.autoDisabledGroupPolicy && (
              <div className="demo-authz-fallback__row">
                <dt>Auto-fix applied</dt>
                <dd>
                  Turned off <code>ff_authorize_group_policy</code> because PingOne rejected
                  the UserGroups parameter. Re-enable it in Admin → Feature Flags only
                  after your live PingOne policy is updated.
                </dd>
              </div>
            )}
          </dl>
        )}
        <button type="button" className="demo-authz-fallback__ok" onClick={onClose}>
          Got it
        </button>
      </div>
    </DraggableModal>
  );
}
