import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

export default function IntentAuthStandardsPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const tabs = [
    {
      id: 'rfc-foundations',
      label: 'RFC Foundations',
      content: (
        <>
          <p>
            Intent-based authorization in AI financial systems is built on a foundation of
            open RFCs and IETF standards. These standards define how delegated authority, scopes,
            and user intent travel through multi-hop authentication chains.
          </p>

          <h3>RFC 8693: OAuth 2.0 Token Exchange</h3>
          <p>
            The cornerstone standard for delegated AI agent authorization. RFC 8693 defines two patterns:
          </p>
          <ul>
            <li>
              <strong>Impersonation</strong> — Subject token alone; the intermediate service is invisible
              in the new token. Weaker pattern, used for simple proxies.
            </li>
            <li>
              <strong>Delegation</strong> — Subject token + actor token; the new token includes an <code>act</code> claim
              recording who is acting on behalf of whom. Enables full audit trail and policy enforcement.
            </li>
          </ul>
          <p>
            <a href="https://tools.ietf.org/html/rfc8693" target="_blank" rel="noopener noreferrer">
              RFC 8693 — OAuth 2.0 Token Exchange (ietf.org)
            </a>
          </p>

          <h3>Key JWT Claims for Delegation</h3>
          <ul>
            <li>
              <code>act</code> — The actor (AI agent) performing the action. Nested <code>act</code> claims
              enable multi-hop delegation: user → agent1 → agent2 → service.
            </li>
            <li>
              <code>may_act</code> — Who is authorized to act. Enforced at the authorization server
              as a policy constraint. Enables revocation: remove an agent from <code>may_act</code>, all its tokens become invalid.
            </li>
          </ul>

          <h3>RFC 9396: Rich Authorization Requests (RAR)</h3>
          <p>
            Defines <code>authorization_details</code> — a structured way to encode intent in the
            authorization request itself. Instead of broad scopes (<code>read</code>, <code>write</code>),
            RAR lets the client request specific actions with context:
          </p>
          <pre className="edu-code">{`{
  authorization_details: [
    {
      type: "payment",
      actions: ["initiate", "approve"],
      amount: "2000.50",
      currency: "USD",
      recipient: "merchant-123",
      time_window: "2026-05-31T00:00:00Z/2026-06-30T23:59:59Z"
    }
  ]
}`}</pre>
          <p>
            The resulting token carries verifiable intent that downstream services can inspect
            without trusting the agent's assertions.
          </p>
          <p>
            <a href="https://tools.ietf.org/html/rfc9396" target="_blank" rel="noopener noreferrer">
              RFC 9396 — Rich Authorization Requests (ietf.org)
            </a>
          </p>

          <h3>Identity Chaining & Act Claims (Drafts)</h3>
          <p>
            Emerging drafts (e.g., <code>oauth-identity-chaining</code>) define how nested
            <code>act</code> claims chain across multiple agents. Each hop adds an <code>act</code> record:
          </p>
          <pre className="edu-code">{`// Token at agent2
{
  "sub": "user-123",
  "act": {
    "sub": "agent1-id",
    "act": {
      "sub": "bff-service"
    }
  }
}
`}</pre>
          <p>
            This enables downstream services to verify the full delegation chain and enforce
            policies per hop.
          </p>

          <div className="edu-info-box">
            <strong>In this demo:</strong> The BFF performs RFC 8693 token exchange for MCP tool calls.
            The user's token is exchanged for a narrower MCP token with reduced scope and
            <code>act</code> claim recording the agent's delegation. See the Token Exchange panel for details.
          </div>

          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.TOKEN_EXCHANGE, 'why')}
            >
              Explore RFC 8693 Token Exchange in this demo
            </button>
          </p>
        </>
      ),
    },

    {
      id: 'industry',
      label: 'Industry Standards',
      content: (
        <>
          <p>
            The banking and payments industry is converging on intent-based authorization standards
            for agentic AI. Three major initiatives are shaping 2025–2026:
          </p>

          <h3>Mastercard Verifiable Intent (2026)</h3>
          <p>
            A payment network authentication layer that establishes and documents the human authorization
            behind AI agent transactions. Mastercard Verifiable Intent:
          </p>
          <ul>
            <li>
              Issues <strong>tokenized spending mandates</strong> cryptographically linked to user-approved
              intent (what the agent can do, up to what amount, for how long).
            </li>
            <li>
              Enforces <strong>selective disclosure</strong> — each party in a transaction receives
              only the minimum information needed (merchant doesn't see the user's spending caps,
              only proof that this transaction is authorized).
            </li>
            <li>
              Integrates with <strong>risk scoring</strong> — the mandate itself carries a risk
              classification (low / medium / high) used to decide whether step-up MFA is needed.
            </li>
          </ul>
          <p>
            <a href="https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html" target="_blank" rel="noopener noreferrer">
              Mastercard Verifiable Intent (2026)
            </a>
          </p>

          <h3>Google Agent Payments Protocol (AP2)</h3>
          <p>
            An open standard for AI agent commerce, announced September 2025 with 60+ launch partners
            (American Express, PayPal, Coinbase, Salesforce, Worldpay, and others). AP2 defines every
            agent purchase as three W3C Verifiable Credentials:
          </p>
          <ol>
            <li>
              <strong>Intent Mandate</strong> — what the user wants (e.g., "Book a flight under $800 on Delta or United").
            </li>
            <li>
              <strong>Cart Mandate</strong> — what the agent assembled (specific flights, prices, taxes).
            </li>
            <li>
              <strong>Payment Mandate</strong> — what the merchant or payment network will charge
              (final amount, fees, settlement info).
            </li>
          </ol>
          <p>
            Each mandate is cryptographically signed, so any intermediary can verify the chain
            of intent → assembled cart → final payment without trusting the agent or merchant.
          </p>
          <p>
            <a href="https://eco.com/support/en/articles/15192002-ap2-protocol-explained-google-s-agentic-commerce-standard-2026" target="_blank" rel="noopener noreferrer">
              AP2 Protocol Explained (Google)
            </a>
          </p>

          <h3>Know Your Agent (KYA) Framework (2026)</h3>
          <p>
            A cross-industry framework for establishing and verifying AI agent identity, authority,
            and auditability. KYA combines four pillars:
          </p>
          <ul>
            <li>
              <strong>Agent identity passport</strong> — Verifiable proof that this agent is legitimate
              (not a spoofed bot). Uses DID, signed certificates, or cryptographic key binding.
            </li>
            <li>
              <strong>Authority binding</strong> — Explicit proof that the user authorized this specific agent
              to act on their behalf (consent record, mandate, signed grant).
            </li>
            <li>
              <strong>Runtime controls</strong> — Policy constraints enforced during execution (spending caps,
              rate limits, category restrictions, time windows).
            </li>
            <li>
              <strong>Tamper-evident audit</strong> — Cryptographic proof of every action taken, timestamped
              and signed, enabling dispute resolution and regulatory compliance.
            </li>
          </ul>
          <p>
            Implemented by: Experian Agent Trust, Worldpay + Trulioo, and others.
          </p>
          <p>
            <a href="https://www.trulioo.com/resources/white-papers/know-your-agent-an-identity-framework-for-trusted-agentic-commerce" target="_blank" rel="noopener noreferrer">
              Know Your Agent: An Identity Framework (Trulioo)
            </a>
          </p>

          <h3>FIDO Alliance — Agentic Commerce Standards (April 2026)</h3>
          <p>
            The FIDO Alliance announced a new Agentic Authentication Technical Working Group to develop
            interoperable standards for agent-initiated transactions and trusted interactions. Drawing
            from AP2 (Google) and Verifiable Intent (Mastercard) contributions, FIDO is building the
            cryptographic foundations for agent identity and authorization across industries.
          </p>
          <p>
            <a href="https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/" target="_blank" rel="noopener noreferrer">
              FIDO Alliance Agentic Commerce Initiative
            </a>
          </p>

          <div className="edu-info-box--warning">
            <strong>Note:</strong> This demo does not yet implement AP2 mandates or KYA identity binding —
            these are enhanced patterns that layer on top of the RFC 8693 foundation. See the Enhancements tab.
          </div>
        </>
      ),
    },

    {
      id: 'confidence-scoring',
      label: 'Confidence Scoring',
      content: (
        <>
          <p>
            Intent-based authorization gates actions on three independent confidence dimensions.
            Understanding each is key to designing safe agent boundaries.
          </p>

          <h3>Three Dimensions of Confidence</h3>

          <h4>1. Intent Confidence (0–1 score)</h4>
          <p>
            <strong>Question:</strong> How certain is the agent that it correctly understood what the user wants?
          </p>
          <ul>
            <li><strong>Source:</strong> NLP model confidence, semantic similarity, user history patterns.</li>
            <li><strong>High (≥0.9):</strong> Clear user request, unambiguous intent, strong semantic match.</li>
            <li><strong>Medium (0.7–0.89):</strong> Reasonable interpretation, some ambiguity, low-confidence NLP.</li>
            <li><strong>Low (&lt;0.7):</strong> Unclear request, competing interpretations, noisy input.</li>
          </ul>

          <h4>2. Risk Confidence (0–1 score)</h4>
          <p>
            <strong>Question:</strong> What is the fraud, compliance, or operational risk of this specific transaction?
          </p>
          <ul>
            <li><strong>Factors:</strong> Amount, merchant, geo-location, time-of-day, device, account history.</li>
            <li><strong>Sources:</strong> Risk models, rule engines, continuous ML learning on transactions.</li>
            <li><strong>High confidence = low risk:</strong> Normal amount, familiar merchant, recognized device.</li>
            <li><strong>Low confidence = high risk:</strong> Unusual amount, new merchant, impossible location, suspicious patterns.</li>
          </ul>

          <h4>3. Authority Confidence (0–1 score)</h4>
          <p>
            <strong>Question:</strong> Did the user actually authorize this agent to do this?
          </p>
          <ul>
            <li><strong>Source:</strong> KYA binding, mandate verification, cryptographic proof of consent.</li>
            <li><strong>High:</strong> Explicit recent consent (mandate), signed grant, user enrolled the agent.</li>
            <li><strong>Medium:</strong> Consent from general OAuth scope, inferred from previous actions.</li>
            <li><strong>Low:</strong> Stale consent, no explicit mandate, agent is new to the user.</li>
          </ul>

          <h3>Decision Logic: How Confidence Maps to Action</h3>
          <table className="edu-table">
            <thead>
              <tr>
                <th>Intent Conf.</th>
                <th>Risk Conf.</th>
                <th>Authority Conf.</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>High (≥0.9)</td>
                <td>High (≥0.8)</td>
                <td>High (≥0.9)</td>
                <td>✅ <strong>PERMIT</strong> — proceed automatically</td>
              </tr>
              <tr>
                <td>High</td>
                <td>High</td>
                <td>Medium</td>
                <td>⚠️ <strong>REQUIRE CONSENT</strong> — low authority confidence</td>
              </tr>
              <tr>
                <td>High</td>
                <td>Medium</td>
                <td>High</td>
                <td>⚠️ <strong>REQUIRE CONSENT</strong> — medium risk score</td>
              </tr>
              <tr>
                <td>Medium</td>
                <td>Any</td>
                <td>Any</td>
                <td>⚠️ <strong>REQUIRE CONSENT</strong> — intent ambiguous, escalate to human</td>
              </tr>
              <tr>
                <td>Low (&lt;0.7)</td>
                <td>High amount (≥$maxThreshold)</td>
                <td>Any</td>
                <td>❌ <strong>DENY</strong> — low intent + high amount = too risky</td>
              </tr>
              <tr>
                <td>Low</td>
                <td>Low amount (&lt;$maxThreshold)</td>
                <td>Any</td>
                <td>⚠️ <strong>REQUIRE CONSENT</strong> — let human judge low-confidence request</td>
              </tr>
            </tbody>
          </table>

          <h3>Threshold Configuration</h3>
          <p>
            Different institutions set different thresholds based on their risk tolerance:
          </p>
          <ul>
            <li><strong>Conservative (banks, brokerages):</strong> Intent ≥ 0.85, require consent for any Risk &lt; 0.8.</li>
            <li><strong>Moderate (fintech, e-commerce):</strong> Intent ≥ 0.7, require consent for Risk &lt; 0.5.</li>
            <li><strong>Permissive (low-value actions):</strong> Intent ≥ 0.5, permit if Risk &lt; 0.3.</li>
          </ul>

          <div className="edu-info-box">
            <strong>In this demo:</strong> See the "Our Implementation" tab to learn how
            <code>intentAuthService.js</code> enforces these thresholds with configurable
            <code>intent_min_confidence</code> and
            <code>intent_max_amount_low_confidence</code> settings.
          </div>
        </>
      ),
    },

    {
      id: 'our-code',
      label: 'Our Implementation',
      content: (
        <>
          <p>
            This banking demo implements intent-based authorization using standard OAuth primitives
            (RFC 8693 token exchange) and configurable authorization rules. Here is how each industry
            concept maps to demo code:
          </p>

          <h3>Code Architecture</h3>
          <ul>
            <li>
              <strong>Feature flag:</strong> <code>ff_intent_authorization_enabled</code> (configStore,
              default: false). Allows disabling the feature without code changes.
            </li>
            <li>
              <strong>Intent extraction:</strong> Tool name → intent label (e.g., <code>create_transfer</code> → <code>transfer</code>).
              Happens in <code>agentInvokeRoute.js</code> after agent execution.
            </li>
            <li>
              <strong>Authorization decision:</strong> <code>intentAuthService.evaluateIntentAuthorization()</code> — evaluates
              intent + confidence + amount against configurable rules.
            </li>
            <li>
              <strong>HTTP responses:</strong> 200 (permit), 428 (require consent), 403 (deny).
            </li>
            <li>
              <strong>Audit logging:</strong> Every decision logged via <code>appEventService.logEvent('intent_auth')</code>.
              Visible in admin event feed (<code>/api/app-events</code>).
            </li>
          </ul>

          <h3>Configuration Fields (configStore)</h3>
          <table className="edu-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Default</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>ff_intent_authorization_enabled</code></td>
                <td>boolean</td>
                <td><code>false</code></td>
                <td>Enable intent-auth checks (gates operations if true)</td>
              </tr>
              <tr>
                <td><code>intent_min_confidence</code></td>
                <td>0–1</td>
                <td><code>0.7</code></td>
                <td>Minimum confidence to proceed without escalation</td>
              </tr>
              <tr>
                <td><code>intent_requires_consent</code></td>
                <td>CSV</td>
                <td><code>transfer</code></td>
                <td>Comma-separated list of intents requiring HITL consent</td>
              </tr>
              <tr>
                <td><code>intent_max_amount_low_confidence</code></td>
                <td>USD</td>
                <td><code>100</code></td>
                <td>Block transfers &gt; this amount if confidence &lt; min_confidence</td>
              </tr>
            </tbody>
          </table>

          <h3>Demo vs. Industry Standards (Alignment)</h3>
          <table className="edu-table">
            <thead>
              <tr>
                <th>Industry Standard</th>
                <th>Demo Implementation</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pre-execution intent gating</td>
                <td>✅ Intent extracted from prompt BEFORE agent runs tools</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Heuristic confidence scoring</td>
                <td>✅ Confidence 0–1 based on NL match quality</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Risk dimension (fraud/velocity)</td>
                <td>✅ Risk score computed from amount + velocity</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Authority binding (delegation scope)</td>
                <td>✅ Authority score checks agent authorization</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>RFC 8693 delegation (<code>act</code> claim)</td>
                <td>✅ Token exchange with <code>act</code> claim</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Intent normalization</td>
                <td>✅ trim() + toLowerCase()</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Amount-based blocking</td>
                <td>✅ Configurable thresholds</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Consent-required intent list</td>
                <td>✅ Configurable comma-separated field</td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Structured audit log</td>
                <td>✅ <code>appEventService.logEvent('intent_auth')</code></td>
                <td>✅ Implemented</td>
              </tr>
              <tr>
                <td>Cryptographic mandate (AP2/Verifiable Intent)</td>
                <td>❌ Not implemented</td>
                <td>🔄 Future</td>
              </tr>
              <tr>
                <td>W3C Verifiable Credentials</td>
                <td>❌ Not implemented</td>
                <td>🔄 Future</td>
              </tr>
              <tr>
                <td>KYA full agent identity passport</td>
                <td>⚠️ Partial (authority score only)</td>
                <td>🔄 Future</td>
              </tr>
              <tr>
                <td>Multi-hop <code>act</code> chain</td>
                <td>Single-hop delegation only</td>
                <td>🔄 Future</td>
              </tr>
            </tbody>
          </table>

          <h3>What Changed: Three Critical Gaps Fixed</h3>
          <div className="edu-info-box">
            <strong>✅ Real Confidence Scoring:</strong> Heuristic NL parser now returns confidence 0–1 based on match quality:
            <ul style={{ marginTop: "0.5rem" }}>
              <li>Exact phrase match: 0.95 (e.g., "transfer $100 from checking to savings")</li>
              <li>Partial params: 0.75–0.85 (e.g., "show balance")</li>
              <li>Single keyword: 0.60–0.65 (e.g., just "transfer")</li>
              <li>Unknown: 0.30</li>
            </ul>
          </div>

          <div className="edu-info-box">
            <strong>✅ Pre-Execution Intent Gating:</strong> Intent is now extracted from the <strong>prompt</strong> BEFORE the agent runs tools. This means:
            <ul style={{ marginTop: "0.5rem" }}>
              <li>Denied intents reject immediately (403) — agent never runs</li>
              <li>Consent-required intents gate before execution (428)</li>
              <li>No write operations execute until intent is approved</li>
            </ul>
          </div>

          <div className="edu-info-box">
            <strong>✅ Risk &amp; Authority Dimensions:</strong> Intent gate now evaluates three independent dimensions:
            <ul style={{ marginTop: "0.5rem" }}>
              <li><strong>Intent Confidence:</strong> NL parse accuracy (0–1)</li>
              <li><strong>Risk Score:</strong> Fraud indicators — amount, velocity, account type (0–1)</li>
              <li><strong>Authority Binding:</strong> Is the agent authorized for this user/scope? (0–1)</li>
            </ul>
            <strong>Decision Logic:</strong> High confidence + low risk + full authority = permit. Borderline cases = consent required.
          </div>

          <p>
            <button
              type="button"
              className="edu-link-btn"
              onClick={() => open(EDU.INTENT_DELEGATION, 'in-this-demo')}
            >
              See how delegation works in this demo
            </button>
          </p>
        </>
      ),
    },

    {
      id: 'enhancements',
      label: 'Enhancements',
      content: (
        <>
          <p>
            The current implementation covers the core pattern. The next level of maturity requires
            five enhancements to align fully with industry standards:
          </p>

          <h3>1. Real Confidence Scores from LLM</h3>
          <p>
            <strong>Current state:</strong> Hardcoded constants (0.95 / 0.7).
          </p>
          <p>
            <strong>Enhancement:</strong> LangGraph agent and heuristic path both return an explicit
            <code>confidence</code> field in the response payload. The value should reflect the model's
            actual confidence in the intent extraction (0–1).
          </p>
          <p>
            <strong>Benefit:</strong> The <code>intent_min_confidence</code> threshold becomes a real
            gate tied to model output, enabling dynamic escalation based on what the model actually knows.
          </p>
          <pre className="edu-code">{`// Agent response (ideal)
{
  "message": "...",
  "intent": "transfer",
  "confidence": 0.87,  // from model
  "toolsCalled": ["create_transfer"],
  "amount": 1500
}
`}</pre>

          <h3>2. W3C Verifiable Credentials for Mandates</h3>
          <p>
            <strong>Current state:</strong> Configurable rules in configStore (comma-separated strings).
          </p>
          <p>
            <strong>Enhancement:</strong> Encode user spending mandates as W3C Verifiable Credentials.
            Each mandate is a signed JSON-LD document specifying:
          </p>
          <ul>
            <li>User identity (holder)</li>
            <li>Agent identity (authorized actor)</li>
            <li>Scope (e.g., transfer up to $5,000/month to trusted merchants only)</li>
            <li>Expiration (e.g., valid until 2026-12-31)</li>
            <li>Signature (issuer's cryptographic proof)</li>
          </ul>
          <p>
            <strong>Benefit:</strong> Mandates are portable, portable across institutions, and verifiable
            offline. Matches AP2 and Mastercard Verifiable Intent patterns.
          </p>

          <h3>3. Know Your Agent (KYA) Identity Binding</h3>
          <p>
            <strong>Current state:</strong> No agent identity tracking. Decisions don't record which agent acted.
          </p>
          <p>
            <strong>Enhancement:</strong> Register each agent instance with a verifiable identity (DID,
            signed certificate, or cryptographic key binding). Every intent auth decision logs the agent's
            identity. Enables agent-level revocation and audit trails.
          </p>
          <pre className="edu-code">{`// Intent auth decision (enhanced)
{
  agent_id: "did:key:z6MkhaXgBZDvotDkL5257faWLpa6CBu1...",
  agent_name: "LangChain-Agent-v1.2",
  user_id: "user-123",
  intent: "transfer",
  confidence: 0.87,
  decision: "permit"
}
`}</pre>
          <p>
            <strong>Benefit:</strong> Full audit trail per agent, enables KYA compliance, supports agent
            lifecycle management (revoke, upgrade, sunset).
          </p>

          <h3>4. Explicit Amount Extraction from Agent Response</h3>
          <p>
            <strong>Current state:</strong> Amount inferred from <code>agentResponse.amount || agentResponse.hitl_threshold_usd</code>.
          </p>
          <p>
            <strong>Enhancement:</strong> Agent explicitly returns <code>transaction_amount</code> in every
            response. No guessing, no fallbacks — the amount is a first-class field.
          </p>
          <p>
            <strong>Benefit:</strong> Removes ambiguity, enables precise amount-based gating, makes audit
            trails clear.
          </p>

          <h3>5. Multi-Hop Delegation Audit Trail</h3>
          <p>
            <strong>Current state:</strong> Single-hop delegation only (user → agent → service). The
            <code>act</code> claim records the immediate agent, not the full chain if the agent spawns
            sub-agents.
          </p>
          <p>
            <strong>Enhancement:</strong> When an agent spawns a sub-agent, each hop adds a nested
            <code>act</code> claim. The token carries the full delegation chain.
          </p>
          <pre className="edu-code">{`// Multi-hop delegation (user → agent1 → agent2 → service)
{
  "sub": "user-123",
  "act": {
    "sub": "agent1-id",
    "act": {
      "sub": "agent2-id"
    }
  }
}
`}</pre>
          <p>
            <strong>Benefit:</strong> Supports agentic teams, enables per-hop policies, full compliance
            and audit visibility.
          </p>

          <div className="edu-info-box">
            <strong>Roadmap:</strong> These enhancements are sequenced by dependency and complexity.
            Start with real confidence scores + amount extraction, then KYA binding, then W3C VCs,
            then multi-hop chains.
          </div>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Intent Authorization & Industry Standards"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
