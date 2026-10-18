// DiagramsIndexPage.jsx — /diagrams: one page that links every diagram. List lives in config/diagramsIndex.js.
import React from "react";
import { Link } from "react-router-dom";
import { DIAGRAMS_INDEX, DIAGRAMS_MORE } from "../../config/diagramsIndex";
import "../personalAgent/PersonalAgent.css";
import "./DiagramsIndexPage.css";
import PageHeader from '../common/PageHeader';

function Cards({ items }) {
  return (
    <ul className="di-grid">
      {items.map((d) => (
        <li key={d.path}>
          <Link className="di-card" to={d.path}>
            <span className="di-title">{d.title}</span>
            <span className="di-blurb">{d.blurb}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function DiagramsIndexPage() {
  return (
    <main className="pa-page" data-testid="diagrams-index-page">
      <PageHeader className="pa-hero" eyebrow="Diagrams" title="All diagrams" summary="Every architecture, token and flow diagram in the demo. Most have a Play and Step bar to walk through the arrows." />
      {DIAGRAMS_INDEX.map((s) => (
        <section key={s.section} aria-label={s.section}>
          <h2>{s.section}</h2>
          <Cards items={s.items} />
        </section>
      ))}
      <section aria-label="More diagrams">
        <h2>More diagrams</h2>
        <Cards items={DIAGRAMS_MORE} />
      </section>
    </main>
  );
}
