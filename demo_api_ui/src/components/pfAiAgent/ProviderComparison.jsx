import { Card } from "../pingUi";
import { FlowSection } from "./shared";

// The PingOne / PingFederate comparison table: static text, no state.
const PROVIDER_COMPARISONS = [
  {
    capability: "AI identity and lifecycle",
    pingOne: (
      <>
        Agent IAM Core manages first-class agent identities, owners, credentials, lifecycle, and resource access. This is the P1 identity baseline. See{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html" target="_blank" rel="noreferrer">PingOne AI Agents</a>.
      </>
    ),
    pingFederate: (
      <>
        This page identifies its OAuth client through CIMD. The BFF publishes the metadata document and PF retrieves it during authorization. It does not create an Agent IAM Core-managed identity or owner record.
      </>
    ),
  },
  {
    capability: "Delegation and downstream access",
    pingOne: (
      <>
        The P1 agent flow uses RFC 8693 delegation: a user subject and agent actor produce a scoped PingOne token. PingOne supports standard token exchange;{" "}
        <a href="https://docs.pingidentity.com/pingone/use_cases/p1_oauth_2_token_exchange.html" target="_blank" rel="noreferrer">see the product flow</a>.
      </>
    ),
    pingFederate: (
      <>
        The BFF sends the session token to PF for an ID-JAG, verifies its signature, issuer, audience, and scope, then redeems it at a third-party authorization server for that server&apos;s access token. Both hops stay server-side.
      </>
    ),
  },
  {
    capability: "PAR and transaction intent (RAR)",
    pingOne: (
      <>
        Agent IAM Core identities can require PAR. The separate P1 Intent Binding demo pushes RAR details with PAR; its Gateway checks the intent and PingOne Authorize supplies the live policy decision.{" "}
        <a href="/intent-binding-learning">Open that P1 flow</a>.
      </>
    ),
    pingFederate: (
      <>
        This path pushes <code>banking_transaction</code> details through PF PAR. The custom processor checks the user, requested action and scope, mapped accounts, currency, and transaction limit.
      </>
    ),
  },
  {
    capability: "Human approval and agent audit",
    pingOne: (
      <>
        Agent IAM Core supports CIBA for human approval and records AI agent identity changes and activity for audit. See{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html" target="_blank" rel="noreferrer">AI Agent capabilities</a> and{" "}
        <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agent_logging.html" target="_blank" rel="noreferrer">AI agent auditing</a>.
      </>
    ),
    pingFederate: (
      <>
        PF supports CIBA as a general OAuth flow, but this page does not connect CIBA to an AI-agent identity or approval step. See{" "}
        <a href="https://docs.pingidentity.com/pingfederate/13.0/introduction_to_pingfederate/pf_ciba_by_ping.html" target="_blank" rel="noreferrer">PF CIBA</a>.
      </>
    ),
  },
];

export default function ProviderComparison() {
  return (
    <FlowSection
      id="pf-ai-agent-comparison-title"
      kicker="Provider comparison"
      title="Product and implementation differences"
      lede="PingOne Agent IAM Core is our P1 identity and delegation baseline. The P1 Intent Binding route is a separate demo; this page adds a separate PF path."
    >
      <div className="pfai-comparison" role="table" aria-label="Configured PingOne and PingFederate AI flow comparison">
        <div className="pfai-comparison__header" role="rowgroup">
          <div role="row">
            <span role="columnheader">Capability</span>
            <span role="columnheader">PingOne / Agent IAM Core</span>
            <span role="columnheader">PingFederate / this page</span>
          </div>
        </div>
        <div role="rowgroup">
          {PROVIDER_COMPARISONS.map((row) => (
            <article className="pfai-comparison__row" role="row" key={row.capability}>
              <h3 role="rowheader">{row.capability}</h3>
              <div className="pfai-comparison__cell" role="cell">
                <span className="pfai-comparison__label">PingOne / Agent IAM Core</span>
                <p>{row.pingOne}</p>
              </div>
              <div className="pfai-comparison__cell pfai-comparison__cell--pf" role="cell">
                <span className="pfai-comparison__label">PingFederate / this page</span>
                <p>{row.pingFederate}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <Card tone="neutral" className="pfai-shared-note">
        <p><strong>PAR and standard RFC 8693 token exchange are supported by PingOne too.</strong>{" "}
        They are not PF-only product features. The implementation difference here is that PF issues an ID-JAG and a separate authorization server redeems it; PingOne&apos;s Agent IAM Core lane exchanges at PingOne. CIMD and the custom PF RAR processor are also part of this PF page.</p>
        <span className="pfai-links">
          <a href="https://docs.pingidentity.com/pingone/applications/p1_pushed_authorization_request.html" target="_blank" rel="noreferrer">PingOne PAR docs</a>
          <a href="https://docs.pingidentity.com/pingone/ai_agents/p1_managing_ai_agents.html" target="_blank" rel="noreferrer">PingOne AI identity configuration</a>
          <a href="https://docs.pingidentity.com/pingfederate/13.1/release_notes/pf_release_notes_131.html" target="_blank" rel="noreferrer">PF 13.1 AI-related OAuth features</a>
          <a href="https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_config_oauth_rar.html" target="_blank" rel="noreferrer">PF RAR processor setup</a>
        </span>
      </Card>
    </FlowSection>
  );
}

