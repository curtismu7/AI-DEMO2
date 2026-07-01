import JsonField from "../shared/JsonField";
import "./AnnotatedResult.css";

const BADGE_CLASS = {
  PERMIT: "ar-badge ar-permit",
  DENY: "ar-badge ar-deny",
  INDETERMINATE: "ar-badge ar-indeterminate",
};

function StatementList({ items, title }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="ar-statements">
      <div className="ar-statements-title">{title}</div>
      <ul>
        {items.map((s, idx) => (
          <li key={`${s.type}-${idx}`}>
            <span className="ar-stmt-type">{s.type}</span> — {s.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnnotatedResult({ result }) {
  if (!result) return null;
  const decision = result.decision || result.effect || "INDETERMINATE";
  const trace = result.trace || {};
  return (
    <div className="annotated-result">
      <div className="ar-header">
        <span className={BADGE_CLASS[decision] || "ar-badge"}>{decision}</span>
        {result.engine ? <span className="ar-engine">engine: {result.engine}</span> : null}
      </div>

      <div className="ar-trace">
        <div className="ar-trace-row"><span className="ar-k">Policy set</span><span className="ar-v">{trace.policySet}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Rule</span><span className="ar-v">{trace.rule}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Condition</span><span className="ar-v ar-mono">{trace.condition}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Effect</span><span className="ar-v">{trace.effect || decision}</span></div>
      </div>

      <StatementList items={result.obligations} title="Obligations (enforced)" />
      <StatementList items={result.statements} title="Statements / advice" />

      {result.output !== undefined ? (
        <div className="ar-output">
          <div className="ar-statements-title">Filtered payload</div>
          <pre className="ar-mono">{JSON.stringify(result.output, null, 2)}</pre>
        </div>
      ) : null}

      <JsonField
        label="Raw decision JSON"
        value={{ raw: result.raw, pingoneRequest: result.pingoneRequest, pingoneResponse: result.pingoneResponse }}
      />
    </div>
  );
}
