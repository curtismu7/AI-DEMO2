import { Link } from "react-router-dom";
import { useEducationUIOptional } from "../../context/EducationUIContext";
import "./RelatedLearningRail.css";

function ResourceList({ children, label }) {
  return (
    <div className="academy-learning-rail__group">
      <h3>{label}</h3>
      <ul>{children}</ul>
    </div>
  );
}

export default function RelatedLearningRail({
  id,
  educationLinks = [],
  appLinks = [],
  externalLinks = [],
}) {
  const education = useEducationUIOptional();
  const headingId = `${id}-related-learning-title`;

  return (
    <section className="academy-learning-rail" aria-labelledby={headingId}>
      <header className="academy-learning-rail__intro">
        <p>Keep learning</p>
        <h2 id={headingId}>Move from the story to the proof.</h2>
        <span>Open the matching explanation, run it in this app, or check the source standard.</span>
      </header>
      <div className="academy-learning-rail__resources">
        <ResourceList label="Education Hub">
          {educationLinks.map((resource) => (
            <li key={resource.panelId}>
              <button
                type="button"
                onClick={() => education?.open(resource.panelId, resource.tabId)}
                aria-label={resource.ariaLabel}
              >
                <strong>{resource.label}</strong>
                <span>{resource.detail}</span>
              </button>
            </li>
          ))}
        </ResourceList>
        <ResourceList label="In this app">
          {appLinks.map((resource) => (
            <li key={resource.to}>
              <Link to={resource.to} aria-label={resource.ariaLabel}>
                <strong>{resource.label}</strong>
                <span>{resource.detail}</span>
              </Link>
            </li>
          ))}
        </ResourceList>
        <ResourceList label="Official references">
          {externalLinks.map((resource) => (
            <li key={resource.href}>
              <a
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={resource.ariaLabel}
              >
                <strong>{resource.label}</strong>
                <span>{resource.detail}</span>
              </a>
            </li>
          ))}
        </ResourceList>
      </div>
    </section>
  );
}
