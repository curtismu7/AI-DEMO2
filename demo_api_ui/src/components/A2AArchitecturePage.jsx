/**
 * A2AArchitecturePage.jsx — /architecture/a2a
 *
 * Interactive React Flow walkthrough of the UC2/UC2.5 A2A delegation flow,
 * built on A2ATokenFlowDiagram (the same stepper/animated-token canvas the
 * /a2a-protocol-learning page uses). Steps advance with play/pause/stepper
 * controls; clicking an edge or step shows the real claims / request /
 * response JSON in the inspector below the canvas.
 *
 * The dataset is a teaching walkthrough (a2aArchitectureWalkthrough.js), not a
 * live run — the learning page owns the live/recorded run.
 */
import A2ATokenFlowDiagram from "./A2ATokenFlowDiagram";
import {
  A2A_ARCH_WALKTHROUGH_EVENTS,
  A2A_ARCH_WALKTHROUGH_LABELS,
} from "./a2aArchitectureWalkthrough";
import "./A2AArchitecturePage.css";

const SPECIALISTS = [
  { vertical: "banking", specialist: "Investment Advisor", tool: "get_portfolio_summary + 3 more" },
  { vertical: "healthcare", specialist: "Records Specialist", tool: "sensitive_patient_records" },
  { vertical: "retail", specialist: "Purchase History Specialist", tool: "sensitive_order_history" },
  { vertical: "sporting-goods", specialist: "Membership Specialist", tool: "sensitive_membership_details" },
  { vertical: "workforce", specialist: "Payroll Specialist", tool: "sensitive_payroll_details" },
  { vertical: "government", specialist: "Tax Records Specialist", tool: "sensitive_tax_record" },
  { vertical: "university", specialist: "Financial Aid Specialist", tool: "sensitive_student_finance" },
  { vertical: "manufacturing", specialist: "Supplier Contract Specialist", tool: "sensitive_supplier_contract" },
  { vertical: "investment", specialist: "Holdings Specialist", tool: "sensitive_holdings" },
  { vertical: "airlines", specialist: "Passenger Records Specialist", tool: "sensitive_passenger_record" },
  { vertical: "admin", specialist: "Identity Verification Specialist", tool: "sensitive_customer_identity" },
  { vertical: "abercrombie-fitch", specialist: "(alias → retail)", tool: "shares Purchase Specialist" },
];

export default function A2AArchitecturePage() {
  return (
    <div className="a2a-arch-page">
      <header className="a2a-arch-header">
        <span className="a2a-arch-eyebrow">UC2 / UC2.5</span>
        <h1>A2A Delegation — Architecture</h1>
        <p className="a2a-arch-subtitle">
          Two layers share the name &ldquo;A2A&rdquo;. The identity layer is a
          nested RFC 8693 <code>act</code> chain approved by PingOne Authorize.
          The wire protocol layer is Agent Card discovery plus JSON-RPC{" "}
          <code>SendMessage</code> over a separate PingOne bearer. The A2A
          protocol runs only in UC2/UC2.5 — never on ordinary agent runs.
        </p>
      </header>

      <section className="a2a-arch-card a2a-arch-card--wide">
        <h2>Delegation flow — step through it</h2>
        <p className="a2a-arch-note">
          Press <strong>Simulate</strong> to play the flow, or step with{" "}
          <strong>Next / Prev</strong>. The animated dot is the credential
          crossing that hop — amber for the identity plane (RFC 8693), blue for
          the A2A wire protocol. Click any edge to inspect the actual token
          claims, exchange request, or JSON-RPC message in the panel below.
        </p>
        <A2ATokenFlowDiagram
          tokenEvents={A2A_ARCH_WALKTHROUGH_EVENTS}
          labels={A2A_ARCH_WALKTHROUGH_LABELS}
        />
      </section>

      <section className="a2a-arch-card">
        <h2>Key distinction</h2>
        <p className="a2a-arch-note">
          The wire hop carries the <strong>Exchange #1 delegated token</strong>{" "}
          (<code>sub</code>: the user, <code>act</code>: the generalist) — not a{" "}
          <code>client_credentials</code> token, which would prove no user. The
          specialist performs Exchange #2 (the nested-act MCP token) itself,
          after the hop arrives.
        </p>
        <p className="a2a-arch-note">
          Card: <code>GET /a2a/specialists/:vertical/.well-known/agent-card.json</code>{" "}
          · JSON-RPC: <code>POST /a2a/specialists/:vertical</code> (requires{" "}
          <code>Authorization: Bearer</code> + <code>A2A-Version: 1.0</code>)
        </p>
      </section>

      <section className="a2a-arch-card">
        <h2>Specialist registry</h2>
        <p className="a2a-arch-note">
          Single source of truth:{" "}
          <code>demo_api_server/config/a2aSpecialists.js</code>. Scopes come from{" "}
          <code>scope-topology.json</code>, not the registry.
        </p>
        <table className="a2a-arch-table">
          <thead>
            <tr>
              <th>Vertical</th>
              <th>Specialist</th>
              <th>Tool(s)</th>
            </tr>
          </thead>
          <tbody>
            {SPECIALISTS.map((s) => (
              <tr key={s.vertical}>
                <td>{s.vertical}</td>
                <td>{s.specialist}</td>
                <td>{s.tool}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
