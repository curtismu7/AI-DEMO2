import EducationDrawer from '../shared/EducationDrawer';

const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <>
          <p>
            <strong>AuthZEN</strong> is an OpenID Foundation working group developing a standardized
            API for authorization — often described as the "OpenID Connect of authorization." It
            creates a common, interoperable interface between the two core components of modern
            fine-grained access control:
          </p>
          <ul>
            <li>
              <strong>Policy Enforcement Points (PEPs)</strong> — the applications and gateways that
              need to ask "can this principal do this action?"
            </li>
            <li>
              <strong>Policy Decision Points (PDPs)</strong> — the authorization engines that evaluate
              policy and return a decision.
            </li>
          </ul>
          <p>
            Before AuthZEN, every PDP vendor had a proprietary API. Applications were locked to a
            specific engine. AuthZEN eliminates that coupling by defining a standard JSON-based
            request/response format that any conforming PEP and PDP can use — regardless of the
            underlying policy language (OPA/Rego, XACML, ALFA, graph-based models).
          </p>
          <h3>The problem it solves</h3>
          <p>
            Authorization has historically been "fractured" — either baked into application code,
            embedded as coarse scopes in OAuth 2.0 tokens, or implemented with bespoke proprietary
            calls to a single vendor's engine. This makes authorization hard to audit, hard to change,
            and hard to reuse across services.
          </p>
          <p>
            AuthZEN moves the decision out of the application and into a dedicated, swappable policy
            engine — and standardizes the wire protocol so that decision can come from anywhere.
          </p>
        </>
      ),
    },
    {
      id: 'api',
      label: 'AuthZEN API 1.0',
      content: (
        <>
          <p>
            The AuthZEN working group published the <strong>AuthZEN API 1.0</strong> specification: a
            JSON-based HTTP API that standardizes how a PEP asks a PDP for an authorization decision.
          </p>
          <h3>Core request structure</h3>
          <p>
            A PEP sends a structured access request containing three key elements:
          </p>
          <ul>
            <li>
              <strong>Subject</strong> — who is making the request (user, service, agent identity)
            </li>
            <li>
              <strong>Resource</strong> — what is being accessed (object, endpoint, document)
            </li>
            <li>
              <strong>Action</strong> — what operation is being attempted (read, write, transfer, delete)
            </li>
          </ul>
          <p>
            The PDP evaluates its policy against these inputs and returns a simple, structured
            decision: <code>permit</code> or <code>deny</code>, optionally with obligations or
            contextual advice.
          </p>
          <h3>Interoperability in practice</h3>
          <p>
            Because the API is standardized, a frontend application (PEP) can switch from an
            OPA-based engine to a XACML engine or a PingOne Authorize instance without changing
            any application code — only the PDP endpoint changes. This is the same portability
            OpenID Connect brought to authentication.
          </p>
          <h3>Example: Git-based policy engine</h3>
          <p>
            One concrete use case from the working group: a Git-based policy engine (policies stored
            as code in a repository) exposes an AuthZEN-compliant API. Any AuthZEN-conformant
            application can query it for decisions without writing engine-specific integration code.
          </p>
        </>
      ),
    },
    {
      id: 'relevance',
      label: 'AI Agents & Policy-as-Code',
      content: (
        <>
          <p>
            AuthZEN is especially relevant for AI agent systems where authorization decisions need
            to be dynamic, context-aware, and auditable — far beyond what static OAuth scopes can
            express.
          </p>
          <h3>Why static scopes are not enough for agents</h3>
          <p>
            An OAuth access token with <code>write</code> grants broad permission. But an
            AI agent performing a transfer on a user's behalf needs fine-grained decisions: is this
            specific transfer, for this amount, to this recipient, at this time, within the user's
            authorized mandate? That is an authorization question — not an authentication question —
            and it requires a PDP.
          </p>
          <h3>Policy-as-Code</h3>
          <p>
            AuthZEN enables a <strong>Policy-as-Code</strong> approach: policies are written in a
            human-readable language (Rego, ALFA, Cedar), stored in version control, reviewed like
            code, and deployed to a PDP. The PEP (the agent or gateway) calls the PDP at runtime
            for every sensitive decision. Changes to policy are tracked, testable, and reversible.
          </p>
          <h3>Integration with this demo</h3>
          <p>
            PingOne Authorize acts as an AuthZEN-compatible PDP in this architecture. The BFF
            (Policy Enforcement Point) can call PingOne Authorize to evaluate whether an agent's
            proposed action is within the scope of the user's delegated consent — combining RFC 8693
            token exchange with fine-grained policy evaluation.
          </p>
          <h3>Reducing vendor lock-in</h3>
          <p>
            Organizations adopting AuthZEN are not locked to any single authorization vendor.
            They can run OPA internally for low-latency decisions, use a SaaS PDP for complex
            entitlement graphs, and still have all their PEPs use the same standard API.
          </p>
        </>
      ),
    },
    {
      id: 'links',
      label: 'Resources',
      content: (
        <>
          <h3>OpenID Foundation — AuthZEN Working Group</h3>
          <p>
            The AuthZEN Working Group focuses on specific areas of authorization interoperability:
            documenting common authorization patterns, defining standard mechanisms and formats for
            communication between authorization components, and recommending best practices for
            secure applications.
          </p>
          <ul>
            <li>
              <a href="https://openid.net/wg/authzen/" target="_blank" rel="noopener noreferrer">
                AuthZEN Working Group — OpenID Foundation
              </a>
            </li>
            <li>
              <a href="https://openid.github.io/authzen/" target="_blank" rel="noopener noreferrer">
                AuthZEN API 1.0 Specification
              </a>
            </li>
            <li>
              <a href="https://github.com/openid/authzen" target="_blank" rel="noopener noreferrer">
                AuthZEN Repository (GitHub)
              </a>
            </li>
          </ul>
          <h3>Related standards in this demo</h3>
          <ul>
            <li>RFC 8693 — OAuth 2.0 Token Exchange (delegation chain)</li>
            <li>RFC 9396 — Rich Authorization Requests (fine-grained consent)</li>
            <li>PingOne Authorize — PDP used in this demo's banking flows</li>
          </ul>
        </>
      ),
    },
  ];

export default function AuthZenPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="AuthZEN — Standardized Authorization API"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
