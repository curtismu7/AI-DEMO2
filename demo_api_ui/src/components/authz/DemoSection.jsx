import "./DemoSection.css";

export default function DemoSection({ id, number, title, concept, docHref, open, onToggle, children }) {
  return (
    <section className={`demo-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="demo-section-header"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="demo-section-num">{number}</span>
        <span className="demo-section-title">{title}</span>
        <span className="demo-section-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="demo-section-body">
          <p className="demo-section-concept">{concept}</p>
          {docHref ? (
            <a className="demo-section-doc" href={docHref} target="_blank" rel="noreferrer">
              Learn more ↗
            </a>
          ) : null}
          <div className="demo-section-demo">{children}</div>
        </div>
      ) : null}
    </section>
  );
}
