import DraggableModal from "./DraggableModal";
import "./ControlPlaneDemoGuideModal.css";

// Admin-only walkthrough for presenting the kill-switch instance-vs-full
// scope feature. Rendered by ControlPlaneRoster only when user.role ===
// "admin" — a customer-role login never sees this button or its content.
export default function ControlPlaneDemoGuideModal({ isOpen, onClose }) {
  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Demo Guide — Kill Switch Scope"
      defaultWidth={560}
      defaultHeight={620}
      storageKey="control-plane-demo-guide-modal"
      minWidth={380}
      minHeight={320}
    >
      <div className="dm-scroll cpg-body">
        <p className="cpg-lead">
          Visible to admins only. Walks through demoing the instance-only vs.
          full-identity kill-switch scope on the live agent row below.
        </p>

        <h4>Quick demo (single browser, ~1 min)</h4>
        <ol className="cpg-steps">
          <li>
            Sign in at <code>local.ping-devops.com:4000</code> (passkeys need
            that host — <code>api.ping.demo</code> won't work).
          </li>
          <li>Go to <code>/ai-control-plane</code>. The live row is the real agent with real PingOne revocation; the other rows are simulated.</li>
          <li>Click <strong>STOP</strong> on the live row to open the confirm modal.</li>
          <li>
            Point out the scope choice: <strong>This instance only
            (recommended)</strong> is selected by default, vs.
            <strong> This agent's entire identity</strong>. Narrate the
            tradeoff — instance-only stops just this caller; full also
            disables the PingOne application, blocking new tokens for every
            user of that client.
          </li>
          <li>
            Confirm with instance-only. The modal flips to a result
            checklist: token revoked, user disabled, <code>app_disable:
            Skipped — instance-only scope</code>, session invalidated, audit
            logged. That skip line is the payoff — it proves the blast
            radius stayed contained.
          </li>
          <li>
            Click Done. Say out loud: your own session just died too (the
            kill switch always destroys the caller's session) — you'll need
            to sign back in regardless of which scope you picked.
          </li>
        </ol>

        <h4>Fuller proof (~5 min, needs a 2nd browser/incognito + 2nd demo user)</h4>
        <ol className="cpg-steps">
          <li>Open incognito, sign in as a second demo user, confirm their agent chip/tool call works.</li>
          <li>Back in browser 1, stop the live agent with <strong>instance-only</strong>.</li>
          <li>Switch to incognito — the second user's agent still works (their token and the app are untouched).</li>
          <li>Sign back into browser 1, stop again — this time with <strong>entire identity</strong>.</li>
          <li>Switch to incognito and retry — now it fails (app disabled at PingOne, no new tokens for anyone). That's the contrast: same button, deliberately chosen blast radius.</li>
          <li>Click <strong>Re-enable</strong> on the live row to restore the app before wrapping up.</li>
        </ol>

        <h4>Bonus beat</h4>
        <p className="cpg-bonus">
          Open the Forensic Audit Dashboard afterward — both kill events show
          up with a <code>state_snapshot_id</code>, tying the "audit-friendly"
          claim to something visible.
        </p>
      </div>
    </DraggableModal>
  );
}
