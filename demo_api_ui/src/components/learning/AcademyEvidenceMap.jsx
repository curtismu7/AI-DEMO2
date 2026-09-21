import { Link } from "react-router-dom";
import "./AcademyEvidenceMap.css";

const MATURITY_STAGES = ["Discover", "Register", "Authenticate", "Authorize", "Govern"];

const PRODUCT_LINKS = Object.freeze({
  PingOne: "/oauth-academy",
  "PingOne Authorize": "/agent-gateway-authorization",
  "Agent Gateway / Broker": "/agent-gateway-inspector",
  MCP: "/mcp-discovery",
  A2A: "/a2a-protocol-learning",
  "PingOne Privilege": "/privilege-mcp-learning",
  "Agent Governance": "/agent-registry",
  "Agent IAM Core": "/oauth-academy",
  "Human approval": "/use-cases/live",
  "MCP Gateway": "/agent-gateway-inspector",
});

function stageState(lesson, stage) {
  return lesson?.maturityStages?.includes(stage) ? "active" : "context";
}

export default function AcademyEvidenceMap({ lesson, evidence = [] }) {
  const evidenceLabels = Array.isArray(evidence)
    ? evidence.map((entry) => (typeof entry === "string" ? entry : entry?.label)).filter(Boolean)
    : [];
  const productRoles = lesson?.productRoles || [];

  return (
    <section className="academy-evidence-map" aria-label="Academy evidence and product map">
      <div className="academy-evidence-map__timeline">
        <div className="academy-evidence-map__heading">
          <div>
            <p className="academy-evidence-map__eyebrow">Evidence and accountability</p>
            <h2>Evidence timeline</h2>
          </div>
          <span>{evidenceLabels.length || lesson?.evidence?.events?.length || 0} evidence categories</span>
        </div>
        <p className="academy-evidence-map__lede">
          Follow the company journey from discovering the agent to proving what it did.
        </p>
        <ol className="academy-evidence-map__stages">
          {MATURITY_STAGES.map((stage, index) => (
            <li key={stage} className={`academy-evidence-map__stage academy-evidence-map__stage--${stageState(lesson, stage)}`}>
              <span className="academy-evidence-map__stage-number">{index + 1}</span>
              <div>
                <strong>{stage}</strong>
                <span>{lesson?.maturityStages?.includes(stage) ? "Lesson focus" : "Context"}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="academy-evidence-map__events" aria-label="Lesson evidence categories">
          {(evidenceLabels.length ? evidenceLabels : lesson?.evidence?.events || []).map((label) => (
            <span className="academy-evidence-map__event" key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="academy-evidence-map__products">
        <div className="academy-evidence-map__heading">
          <div>
            <p className="academy-evidence-map__eyebrow">Architecture ownership</p>
            <h2>Ping product map</h2>
          </div>
          <span>{productRoles.length} roles</span>
        </div>
        <p className="academy-evidence-map__lede">
          Each control point has an owner; the protocol alone does not grant authority.
        </p>
        <ul className="academy-evidence-map__product-list">
          {productRoles.map((role) => (
            <li key={role}>
              {PRODUCT_LINKS[role] ? <Link to={PRODUCT_LINKS[role]}>{role}</Link> : <strong>{role}</strong>}
              <span>{role === "Agent Gateway / Broker" ? "Enforcement boundary" : "Control or evidence role"}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
