// banking_api_ui/src/components/education/IntentDelegationPanel.js
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

export default function IntentDelegationPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <>
          <p>
            <strong>Intent-bound, constraint-based delegation</strong> is the emerging industry
            pattern for letting AI agents act on a user's behalf — but only within explicit, verifiable
            boundaries set at authorization time.
          </p>
          <p>
            The core problem it solves: how do you give an agent the power to act autonomously across
            many steps while ensuring it cannot exceed what the user actually intended, without
            requiring a human approval popup for every single action (approval bombing)?
          </p>

          <h3>The two failure modes it avoids</h3>
          <ul>
            <li>
              <strong>No control:</strong> agent has broad permissions and can take any action the
              user's token allows — risky, auditable, no bounded scope.
            </li>
            <li>
              <strong>Approval bombing:</strong> agent asks the human to confirm every sub-action —
              breaks autonomy and trains users to click "Allow" without reading.
            </li>
          </ul>

          <h3>The solution: one human intent, many bounded agent actions</h3>
          <p>
            The user expresses an intent once ("pay my electricity bill monthly, up to $200"). That
            intent is encoded into a verifiable, constrained authorization record. The agent can then
            execute autonomously within those constraints — amount, time window, merchant category —
            without asking again, but also without being able to exceed them.
          </p>

          <h3>Four building blocks</h3>
          <ol>
            <li>
              <strong>Intent capture</strong> — the user's goal is recorded in a structured,
              machine-readable form (not just a free-text prompt).
            </li>
            <li>
              <strong>Constraint encoding</strong> — limits (amount caps, time windows, merchant
              restrictions, scope) are embedded in the authorization token or mandate.
            </li>
            <li>
              <strong>Delegation chain</strong> — each hop in the agent pipeline carries proof of
              who delegated what, so any service can verify the authority without trusting the agent
              blindly.
            </li>
            <li>
              <strong>Escalation path</strong> — actions that fall outside the pre-authorized
              constraints trigger a human confirmation step (HITL / CIBA), rather than failing
              silently or executing anyway.
            </li>
          </ol>

          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.HUMAN_IN_LOOP, 'what')}
            >
              See how HITL implements the escalation path in this demo
            </button>
          </p>
        </>
      ),
    },
    {
      id: 'industry',
      label: 'Industry landscape',
      content: (
        <>
          <p>
            Payments, open-banking, and identity vendors are leading commercialization of this
            pattern. The main players:
          </p>

          <h3>Agentic payments — verifiable intent</h3>
          <ul>
            <li>
              <strong>Google Cloud / AP2 (Agent Payments Protocol)</strong> — Open protocol
              stewarded by Google with 60+ organizations (Adyen, American Express, Mastercard,
              PayPal, Salesforce, Worldpay, etc.). Defines Intent / Cart / Payment Mandates with
              time and amount constraints for human-not-present agent payments.
            </li>
            <li>
              <strong>Mastercard — Verifiable Intent</strong> — Framework linking identity, intent,
              and action into a single tamper-evident record, co-developed with Google. Used to
              decide when prior intent is sufficient vs. when additional human confirmation is
              required.
            </li>
            <li>
              <strong>PayPal</strong> — Co-developer and early AP2 implementer, embedding mandates
              into its global payments stack to make agent-driven payments verifiable at scale.
            </li>
            <li>
              <strong>Worldline</strong> — PSP implementing AP2 with detailed support for delegated
              (human-not-present) autonomous agent scenarios.
            </li>
          </ul>

          <h3>Consent verification and delegated limits</h3>
          <ul>
            <li>
              <strong>AffixIO</strong> — Consent verification circuits for agentic payments. Each
              consent record encodes which agents are authorized, spend caps (per-txn / per-period),
              merchant/category restrictions, and validity period. A verification API returns
              eligible/ineligible + cryptographic proof, so one consent covers many payments without
              per-transaction prompts.
            </li>
            <li>
              <strong>Shuttle Global</strong> — Focuses on the social-engineering and approval-fatigue
              problem; pushes architectures where the approval surface is separate from the agent
              and prompts are rare and high-value.
            </li>
          </ul>

          <h3>Open banking and OAuth/OIDC consent for agents</h3>
          <ul>
            <li>
              <strong>Konsentus</strong> — Agentic consent in open banking, modeling delegation via
              policies that encode explicit delegation, constrained inheritance, and visibility of
              downstream authority — aligned with OpenID/OAuth extensions for delegation and policy
              constraints.
            </li>
            <li>
              <strong>Curity</strong> — Time-limited, transaction-bounded consent for AI agents on
              top of OAuth: granular scopes, user-defined amount and time limits for agents, and
              re-consent for high-privilege actions.
            </li>
            <li>
              <strong>Auth0 / Okta</strong> — Driving async human confirmation for agent actions
              using CIBA flows (decoupled authorization with push notifications) — a key pattern for
              out-of-band approvals for sensitive operations without blocking the agent flow.
            </li>
          </ul>

          <h3>Standards bodies</h3>
          <ul>
            <li>
              <strong>AP2 Working Group / ap2-protocol.org</strong> — Open protocol community.
            </li>
            <li>
              <strong>NIST NCCoE</strong> — Exploring intent-bound delegation and AI agent
              authorization in concept papers (HAID submissions).
            </li>
            <li>
              <strong>OpenID Foundation</strong> — Extending OAuth/OpenID for delegated,
              policy-constrained agent authorization.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'in-this-demo',
      label: 'In this demo',
      content: (
        <>
          <p>
            This banking demo implements the intent-bound, constraint-based delegation pattern
            using standard OAuth primitives — no proprietary mandate format required. Here is how
            each building block maps to demo features:
          </p>

          <h3>Constraint encoding — RFC 8693 Token Exchange</h3>
          <p>
            When the AI agent calls a banking tool, the BFF performs an{' '}
            <strong>RFC 8693 token exchange</strong>. The user's broad access token is exchanged
            for a narrower MCP token with a reduced scope (e.g. <code>read</code> for
            read operations, <code>write</code> for writes) and a specific audience bound
            to the MCP server URI. This is constraint encoding in practice: the agent's effective
            authority is cryptographically narrowed at runtime to exactly what the current operation
            requires.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.TOKEN_EXCHANGE, 'why')}
            >
              Explore RFC 8693 Token Exchange
            </button>
          </p>

          <h3>Escalation path — HITL consent challenges</h3>
          <p>
            Transfers above the configurable threshold trigger a{' '}
            <strong>Human-in-the-Loop consent challenge</strong>. The agent cannot proceed until
            the user explicitly approves in the dashboard — matching the "actions outside
            pre-authorized constraints escalate to human" pattern from Mastercard Verifiable Intent
            and AffixIO.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.HUMAN_IN_LOOP, 'what')}
            >
              Explore HITL in this demo
            </button>
          </p>

          <h3>Async approval — CIBA</h3>
          <p>
            For step-up MFA, this demo supports <strong>CIBA (Client-Initiated Backchannel
            Authentication)</strong> — a push notification sent to the user's device for out-of-band
            approval, equivalent to what Auth0/Okta are promoting for sensitive agent operations.
            The agent flow pauses; the user approves on a separate channel; the flow resumes.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.STEP_UP, 'what')}
            >
              Explore Step-up MFA and CIBA
            </button>
          </p>

          <h3>Delegation chain — may_act and act claims</h3>
          <p>
            The RFC 8693 exchanged token carries a <code>may_act</code> claim on the user token
            (authorizing the BFF to act on the user's behalf) and an <code>act</code> claim on the
            MCP token (recording the delegation chain: user → AI agent → MCP service). Any
            downstream service can verify the full chain without trusting the agent's assertions.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.MAY_ACT, 'what')}
            >
              Explore may_act / act claims
            </button>
          </p>

          <h3>Rich intent encoding — RAR (RFC 9396)</h3>
          <p>
            <strong>Rich Authorization Requests</strong> allow the authorization request itself to
            carry structured intent — not just scopes but the specific action type, amount, and
            context. This is the OAuth-native equivalent of AP2's Intent / Cart / Payment Mandate
            objects.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.RAR, 'what')}
            >
              Explore RAR (RFC 9396)
            </button>
          </p>

          <h3>Summary — demo vs industry terms</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em', marginTop: '0.5rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--edu-border, #e2e8f0)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Industry term</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Demo implementation</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Payment mandate / verifiable intent', 'RFC 8693 exchanged MCP token (scope + aud)'],
                ['Spend cap / amount constraint', 'HITL threshold (configurable, server-enforced)'],
                ['Async human confirmation', 'CIBA push + Step-up MFA'],
                ['Delegation chain proof', 'act claim in exchanged token'],
                ['Delegated agent authority', 'may_act claim on user token'],
                ['Rich intent in auth request', 'RAR (RFC 9396) authorization_details'],
                ['Granular scopes', 'read / write / mcp:invoke'],
              ].map(([term, impl]) => (
                <tr key={term} style={{ borderBottom: '1px solid var(--edu-border, #e2e8f0)' }}>
                  <td style={{ padding: '6px 8px' }}>{term}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--edu-accent, #3b5bdb)' }}>{impl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'pingone',
      label: 'PingOne approach',
      content: (
        <>
          <p>
            PingOne provides the identity primitives that underpin intent-bound, constraint-based
            delegation without requiring a proprietary mandate protocol:
          </p>

          <h3>Token Exchange grant (RFC 8693)</h3>
          <p>
            PingOne supports RFC 8693 token exchange natively on AI Agent application types. The
            BFF exchanges the user token for a narrower MCP token, with the resource indicator
            (<code>resource</code> / <code>aud</code>) binding the token to exactly one service.
            Scope narrowing enforces the constraint at the token level — the MCP server can verify
            it cannot be used for anything outside the declared audience.
          </p>

          <h3>PingOne Authorize — policy-driven escalation</h3>
          <p>
            <strong>PingOne Authorize</strong> evaluates access policies at runtime using DaVinci
            flows. This is where the "when does prior intent suffice vs. when does the human need
            to confirm?" decision lives — equivalent to Mastercard's Verifiable Intent decision
            engine. Policies can inspect transaction amount, frequency, merchant, risk signals, and
            ACR values to decide whether to proceed or trigger step-up.
          </p>
          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.PINGONE_AUTHORIZE, 'what')}
            >
              Explore PingOne Authorize
            </button>
          </p>

          <h3>CIBA — decoupled backchannel authentication</h3>
          <p>
            PingOne supports CIBA for out-of-band agent approvals. When an agent action requires
            human confirmation outside the user's current browser session (e.g. a mobile push
            notification), CIBA decouples the authorization from the agent flow — the agent
            waits, the user approves on their device, the token is issued. No browser redirect
            required.
          </p>

          <h3>Rich Authorization Requests (RFC 9396)</h3>
          <p>
            PingOne supports RAR via <code>authorization_details</code> in the authorization
            request. This allows the intent — payment type, amount, payee — to be encoded
            structurally at authorization time, rather than inferred from scopes alone. The
            resulting token carries verifiable intent that downstream services can inspect.
          </p>

          <h3>What PingOne does not yet do (as of 2025)</h3>
          <ul>
            <li>
              Native AP2 mandate format — AP2 is a payments-layer protocol; PingOne provides the
              identity and authorization layer beneath it.
            </li>
            <li>
              Built-in spend-cap enforcement — amount thresholds are implemented at the application
              layer (as in this demo's HITL threshold), not natively in the AS.
            </li>
          </ul>

          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.AGENTIC_MATURITY, 'overview')}
            >
              See PingOne's Agentic Maturity Model
            </button>
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Intent-Bound, Constraint-Based Delegation"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
