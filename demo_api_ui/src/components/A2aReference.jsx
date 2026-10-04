import { A2A_REFERENCE } from "../config/a2aReference";

// Reference card for the A2A protocol: the spec, the interfaces agents can use
// with each other, and which of those this demo implements.
export default function A2aReference() {
  return (
    <section data-testid="a2a-reference">
      <h3>A2A reference</h3>
      <p className="page-guide__demo">
        Based on the A2A specification {A2A_REFERENCE.specVersion}. Sources: {A2A_REFERENCE.sources.join(", ")}.
      </p>
      {A2A_REFERENCE.sections.map((s) => (
        <div key={s.heading} className="page-guide__lesson">
          <h4>{s.heading}</h4>
          <ul>
            {s.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
