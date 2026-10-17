import { Link } from "react-router-dom";
import { diagramLinkProps } from "../utils/diagramLinks";
import "./IdJagPathBar.css";

// The four ID-JAG pages, in the order a newcomer should visit them.
export const ID_JAG_PATH = [
  { key: "explain", label: "Explain it", to: "/pingfederate-id-jag" },
  { key: "run", label: "Run it", to: "/pingfederate-id-jag/demo" },
  { key: "protocol", label: "See the protocol", to: "/pingfederate-id-jag/diagram" },
  { key: "build", label: "See how we built it", to: "/pingfederate-id-jag/implementation" },
  { key: "play", label: "Try and validate it", to: "/pingfederate-id-jag/playground" },
];

export default function IdJagPathBar({ current }) {
  const index = ID_JAG_PATH.findIndex((s) => s.key === current);
  const prev = index > 0 ? ID_JAG_PATH[index - 1] : null;
  const next = index >= 0 && index < ID_JAG_PATH.length - 1 ? ID_JAG_PATH[index + 1] : null;
  return (
    <nav className="idjag-path" aria-label="ID-JAG learning path" data-testid="idjag-path">
      <ol className="idjag-path__stops">
        {ID_JAG_PATH.map((stop, i) => (
          <li key={stop.key} className={stop.key === current ? "is-current" : ""}>
            <Link to={stop.to} {...diagramLinkProps(stop.to)} aria-current={stop.key === current ? "step" : undefined}>
              <span className="idjag-path__num">{i + 1}</span>
              {stop.label}
            </Link>
          </li>
        ))}
      </ol>
      <div className="idjag-path__nav">
        {prev && <Link className="idjag-path__btn" to={prev.to} {...diagramLinkProps(prev.to)}>Back: {prev.label}</Link>}
        {next && <Link className="idjag-path__btn idjag-path__btn--next" to={next.to} {...diagramLinkProps(next.to)}>Next: {next.label}</Link>}
      </div>
    </nav>
  );
}
