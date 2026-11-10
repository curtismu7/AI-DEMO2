// DiagramsIndexPage.jsx — /diagrams: one page that links every diagram. List lives in config/diagramsIndex.js.
//
// Honesty: this page is an index. It runs nothing, calls no service and simulates nothing; each card is a link to
// a diagram page, and that page says whether its data is live or sample. The banner says so.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame and sections, P4 cards. Skipped: P5 kv and P7 chips (an
// index has no values or statuses to report) and P9 (no action; every control is a link, so there is no primary
// button in any state). One <main> only: the app shell owns it.
//
// Each card is a list item with an h3 that holds the one real link; page CSS stretches that link over the card so
// the whole card is clickable, while the keyboard stop and the accessible name stay the diagram title.

import React from "react";
import { Link } from "react-router-dom";
import { DIAGRAMS_INDEX, DIAGRAMS_MORE } from "../../config/diagramsIndex";
import "./DiagramsIndexPage.css";
import PageHeader from "../common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card } from "../pingUi";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const count = (items) => `${items.length} ${items.length === 1 ? "diagram" : "diagrams"}`;

export default function DiagramsIndexPage() {
  return (
    <PingPage className="diagrams-index" data-testid="diagrams-index-page">
      <SimBanner data-testid="diagrams-index-banner">
        This page is an index of links. Nothing on it runs, calls PingOne or any other service, or is simulated; each
        card only opens a diagram page. Whether a diagram shows live or sample data is stated on that page, and where
        the blurb below says &quot;Sample data&quot; or &quot;Simulated&quot; that is true of the diagram.
        The list is fixed in the app and kept in step with the side nav by a test.
      </SimBanner>
      <PageHeader
        eyebrow="Diagrams"
        title="All diagrams"
        summary="Every architecture, token and flow diagram in the demo. Most have a Play and Step bar to walk through the arrows."
      />
      <PageFrame>
        {DIAGRAMS_INDEX.map((s) => (
          <Section key={s.section} id={`di-${slug(s.section)}`} kicker={count(s.items)} title={s.section}>
            <Cards items={s.items} />
          </Section>
        ))}
        <Section id="di-more" kicker={count(DIAGRAMS_MORE)} title="More diagrams">
          <Cards items={DIAGRAMS_MORE} />
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// Declared after the page so the pattern check, which reads the file top to bottom, meets the banner first.
function Cards({ items }) {
  return (
    <ul className="pu-card-grid di-grid">
      {items.map((d) => (
        <li key={d.path}>
          <Card className="di-card">
            <h3 className="pu-h3 di-title">
              <Link to={d.path}>{d.title}</Link>
            </h3>
            <p className="pu-note di-blurb">{d.blurb}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
