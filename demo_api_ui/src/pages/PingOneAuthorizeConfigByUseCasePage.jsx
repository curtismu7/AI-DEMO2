import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import './PingOneAuthorizeConfigByUseCasePage.css';

/**
 * Explainer: the PingOne Authorize trust framework this demo provisions,
 * grouped by use case. Claims mirror snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json
 * (generated — do not hand-edit) and demo_api_server/services/pingOneAuthorizeService.js.
 */

const SECTIONS = [
  {
    id: 'how-decisions-work',
    name: 'How a decision happens',
    body: 'The BFF and the MCP gateway are policy enforcement points: they assemble a set of Trust Framework attributes from the live request and POST them to a PingOne Authorize decision endpoint, which returns PERMIT, DENY, or INDETERMINATE (normalized to DENY — #1310) plus obligations. Two endpoints are provisioned: a transaction endpoint and an MCP first-tool endpoint, each bound to its policy. A bulk variant (≤20 items per call) fails closed to DENY on any response-length mismatch. Obligations are classified mutually-exclusively, highest gate wins: DENY > step-up > HITL/consent.',
    refs: 'demo_api_server/services/pingOneAuthorizeService.js — _postDecisionEndpoint (L482-514), bulk (L516-664), INDETERMINATE→DENY (#1310)',
    useCases: ['UC1', 'UC6', 'UC7', 'UC8'],
  },
];

const POLICIES = [
  {
    id: 'txn',
    name: 'AI Demo Transaction Authorization',
    gate: 'Runs when the request is NOT an MCP tool decision (NOT IsMcpFirstToolRequest).',
    rules: [
      { uc: 'UC6', rule: 'Deny Large Transactions', detail: 'Amount > $2,000 → DENY (IsLargeTransaction).' },
      { uc: 'UC7', rule: 'Require Step-Up MFA', detail: 'Amount > $500 AND transfer/withdrawal AND no MFA → PERMIT + step-up obligation (RequiresStepUp).' },
      { uc: 'UC8', rule: 'Require Consent for Mid-Value', detail: 'Amount > $250 → PERMIT + transaction-consent obligation (IsConsentTransaction).' },
      { uc: 'UC22-adjacent', rule: 'Deny Unattended Agent Without a Mandate', detail: 'Autonomous agent with zero mandate → DENY (IsAutonomousWithoutMandate).' },
      { uc: 'UC22', rule: 'Require CIBA Approval Over the Standing Mandate', detail: 'Autonomous, amount > mandate → PERMIT + CIBA obligation (IsAutonomousOverMandate).' },
      { uc: '—', rule: 'Permit Standard Transactions', detail: 'Catch-all PERMIT. All denies evaluate first (DenyOverrides).' },
    ],
  },
  {
    id: 'mcp',
    name: 'AI Demo MCP Delegation Authorization',
    gate: 'Runs when DecisionContext is an MCP context (IsMcpFirstToolRequest). 19 rules: all denies, then one permit.',
    rules: [
      { uc: 'UC5/UC11', rule: 'Invalid Token Audience', detail: 'TokenAudience not in the generated MCP audience set → DENY (HasValidMcpAudience).' },
      { uc: 'UC13', rule: 'Invalid Actor Chain', detail: 'ActClientId not one of the 38 registered chain identities → DENY (HasValidActorChain).' },
      { uc: 'UC2.5', rule: 'Invalid A2A Generalist', detail: 'NestedActClientId must equal the registered generalist → DENY (HasValidA2aGeneralist).' },
      { uc: 'UC8', rule: 'Require HITL Consent', detail: 'Tool on the consent-gated list and HitlApproved ≠ true → PERMIT + HITL obligation. A verified HITL receipt retry discharges it — but MUST NOT discharge step-up MFA.' },
      { uc: 'UC7', rule: 'Require Step-Up', detail: 'Tool on the step-up list and no MFA → PERMIT + step-up obligation; the BFF answers HTTP 428 (RequiresMcpStepUp).' },
      { uc: 'UC21', rule: 'Tier Tool Not Allowed / Tier Amount Exceeded', detail: 'Standard tier blocked from restricted tools; per-tier amount ceilings ($2,000 Standard, $50,000 PrivateBanking).' },
      { uc: 'UC9', rule: 'Not In Required Group', detail: 'RequiredGroup set and InRequiredGroup false → DENY (GroupMembershipFailed). The DSL has no array-contains, so the BFF pre-resolves group membership.' },
      { uc: 'UC14b', rule: 'Deny RAR Amount Overage', detail: 'Amount above the RFC 9396 authorization-detail ceiling → DENY (RarAmountExceeded).' },
      { uc: 'UC12-adjacent', rule: 'Audience Targets Upstream', detail: 'Introspected aud targets an upstream resource — anti-bypass (D-05) → DENY (TokenAudTargetsUpstream).' },
      { uc: 'UC10', rule: 'Resource Owner Mismatch', detail: 'ResourceOwnerId set and different from UserId → DENY (ResourceOwnerMismatch; statement says "NNP-3/UC10").' },
      { uc: 'UC15', rule: 'Intent Token Invalid / Tool Mismatch', detail: 'Gateway-validated intent-token facts; tamper-class errors fail closed (IntentTokenTampered, IntentToolMismatch).' },
      { uc: 'UC9A/21', rule: 'Admin Role Not Permitted', detail: 'UserRole admin on a write tool → restriction input; no permit branch (AdminRoleOnWriteTool).' },
      { uc: 'UC16', rule: 'Invalid Signing Key', detail: 'TokenKidKnown explicitly false → DENY. Default is true (fail-open) so a JWKS outage cannot mass-deny — the JWKS outage path itself fails closed at the gateway (UC29).' },
      { uc: 'UC16b', rule: 'No User Consent / Consent Mismatch', detail: 'may_act absent, or MayActSub ≠ actor → DENY (UserConsentMissing, UserConsentMismatch).' },
      { uc: '—', rule: 'MCP Permit Valid Tool Invocation', detail: 'Catch-all PERMIT after every deny.' },
    ],
  },
  {
    id: 'intent',
    name: 'Agent Intent Governance',
    gate: 'Inert unless DecisionContext is IntentGovernance or IntentEnforce is true.',
    rules: [
      { uc: 'UC-MUSE', rule: 'Conditional denies', detail: 'No grant, expired grant, grant not user-consented, action drift, payee drift, amount drift → DENY. Defaults fail closed: Expired=true, MaxAmount=0.' },
      { uc: 'UC-MUSE', rule: 'Re-consent on Semantic Drift', detail: 'Drift score > 0.5 → PERMIT + RECONSENT obligation (SemanticDriftSuspected).' },
      { uc: 'UC-MUSE', rule: 'Within Grant', detail: 'Everything inside the grant → PERMIT.' },
    ],
  },
];

export default function PingOneAuthorizeConfigByUseCasePage() {
  return (
    <main className="p1azconfig" data-testid="pingone-authorize-config-by-use-case">
      <PageHeader
        eyebrow="PingOne Authorize · what we configured"
        title="P1AZ config by use case"
        summary="The trust framework this demo provisions in PingOne Authorize: the attributes, the conditions, and the three policies — mapped to the use cases they enforce. The committed snapshot is generated from scope-topology.json and the banking manifests; never hand-edit it."
        actions={
          <Link className="p1azconfig__secondary" to="/pingone-authorize">
            P1AZ Inspector
          </Link>
        }
      />

      {SECTIONS.map((s) => (
        <section key={s.id} className="p1azconfig__section">
          <h2>{s.name}</h2>
          <p>{s.body}</p>
          <p className="p1azconfig__ref">
            <span aria-hidden="true">🔍</span> <code>{s.refs}</code>
          </p>
        </section>
      ))}

      {POLICIES.map((p) => (
        <section key={p.id} className="p1azconfig__policy" aria-labelledby={`p1az-${p.id}`}>
          <h2 id={`p1az-${p.id}`}>{p.name}</h2>
          <p className="p1azconfig__why">{p.gate}</p>
          <table className="p1azconfig__table">
            <thead>
              <tr>
                <th scope="col">Use case</th>
                <th scope="col">Rule</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {p.rules.map((r) => (
                <tr key={r.rule}>
                  <td>{r.uc}</td>
                  <td className="p1azconfig__rule">{r.rule}</td>
                  <td>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="p1azconfig__section">
        <h2>Generated conditions — where the config really comes from</h2>
        <p>
          Most conditions are generated by <code>snapshots/gen-authorize-snapshot.js</code> from
          upstream sources: the MCP audience set and the HITL/step-up tool lists from{' '}
          <code>scope-topology.json</code>, the 38-member actor chain from environment client ids,
          and the tier ceilings from the banking manifests. Hand-authored conditions are the
          amount/consent/step-up bands and the intent-governance rules. Six drift test suites pin
          the generated output: audience set-semantics, actor-chain growth-only, tier ceilings
          equal to the manifest, byte-identical output when extra audiences are unset, a version
          freeze (PingOne silently skips unchanged versions on import), and the request contract
          (every attribute a condition reads must have a default or be sent by every PEP).
        </p>
        <p className="p1azconfig__ref">
          <span aria-hidden="true">🔍</span>{' '}
          <code>snapshots/authorizeSnapshot*.test.js, snapshots/p1azRequestContract.js</code>
        </p>
      </section>

      <section className="p1azconfig__section p1azconfig__caveats">
        <h2>Deliberately not modeled in cloud policy</h2>
        <p>
          Temporal exp/iat/nbf checks, per-tool scope membership (the DSL has no set-contains),
          the RAR payee allow-list, multi-audience detection, and group-to-tier flattening are
          enforced at the PEP (BFF/gateway) or in the mock authz server — not in PingOne
          Authorize policy. See <code>snapshots/gen-authorize-snapshot.js</code> header comments.
        </p>
      </section>
    </main>
  );
}
