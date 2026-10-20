/**
 * A2AArchitecturePage.jsx — /architecture/a2a
 *
 * The UC2/UC2.5 delegation flow in the shared Ping style: the same DELEGATION_DIAGRAM
 * config and Figure as /a2a-architecture (movable boxes, Simulate, Reset, speed control).
 * Click a box or an arrow for the request, MOCK tokens and standards for that step.
 */
import Figure from "./a2aArchitecture/A2aDiagramFigure";
import { DELEGATION_DIAGRAM } from "../config/a2aArchitectureDiagram";
import "./A2AArchitecturePage.css";
import PageHeader from './common/PageHeader';

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
  { vertical: "walbuy", specialist: "(alias → retail)", tool: "shares Purchase Specialist" },
];

export default function A2AArchitecturePage() {
  return (
    <div className="a2a-arch-page">
      <PageHeader className="a2a-arch-header" eyebrow="UC2 / UC2.5" title="A2A Delegation — Architecture" summary={<>Two layers share the name &ldquo;A2A&rdquo;. The identity layer is a
          nested RFC 8693 <code>act</code> chain approved by PingOne Authorize.
          The wire protocol layer is Agent Card discovery plus JSON-RPC{" "}
          <code>SendMessage</code> over a separate PingOne bearer. The A2A
          protocol runs only in UC2/UC2.5 — never on ordinary agent runs.</>} />

      <section className="a2a-arch-card a2a-arch-card--wide">
        <h2>Delegation flow — step through it</h2>
        <p className="a2a-arch-note">
          Press <strong>Simulate</strong> to play the flow, or step with{" "}
          <strong>Next / Prev</strong>. Drag a box to tidy the layout; the
          arrows re-route around it. Click a box or an arrow to inspect the
          request, the MOCK tokens and the standards for that hop.
        </p>
        <Figure
          config={DELEGATION_DIAGRAM}
          testId="a2a-arch-diagram"
          stepsTestId="a2a-arch-steps"
          ariaLabel="Delegation flow. The browser asks the generalist. The generalist exchanges the user token at PingOne for a delegated token and sends it to the specialist over the A2A wire. The specialist exchanges it for a nested-act token, calls the MCP gateway, which asks PingOne Authorize to decide, and the result returns as data only."
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
