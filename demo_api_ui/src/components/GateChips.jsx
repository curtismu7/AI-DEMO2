import "./GateChips.css";

const STATUS_LABEL = { permit: "Passed", deny: "Denied", checking: "Checking…", waiting: "Waiting" };

/**
 * The request's three security gates as chips (MFA, gateway token validation, PingOne
 * Authorize). Takes the same `gates` array the studio's SecurityRail reads, so the chips and the
 * rail can never disagree: { id, name, desc, status: 'waiting' | 'checking' | 'permit' | 'deny' }.
 */
export default function GateChips({ gates = [], className = "" }) {
  return (
    <ol className={`gate-chips ${className}`.trim()} aria-label="Security gates">
      {gates.map((gate, index) => (
        <li key={gate.id} className={`gate-chips__chip gate-chips__chip--${gate.status}`}>
          <small>Gate {index + 1}</small>
          <strong>{gate.name}</strong>
          <span className="gate-chips__status">
            {gate.status === "permit" ? <span aria-hidden="true">✓ </span> : null}
            {STATUS_LABEL[gate.status] || STATUS_LABEL.waiting}
          </span>
        </li>
      ))}
    </ol>
  );
}
