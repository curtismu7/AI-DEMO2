// DemoMapPage.jsx — /demo-map: the one page that shows every demo surface and
// how it connects. Each mission-control group row lists its demo steps,
// each step's use-case diagram, the inspectors that show the evidence,
// the architecture diagrams, and the Learning Hub topics that teach the concept.
// Built on missionControlCatalog (the same data DemoStepsDropdown reads), so
// the map cannot drift from the dropdown without the catalog drift test firing.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips.
// Skipped: P6 (no inspector) and P8 (no diagram on this page).
// P9: this page has no buttons, only links, and one view state, so it carries no primary
// button. Adding one would be an invented action: every link opens another page.
import React from "react";
import { Link } from "react-router-dom";
import { MISSION_CONTROL_CATALOG } from "../config/missionControlCatalog";
import { DEMO_MAP_ROWS } from "../config/demoMapRows";
import { getConfig, useCaseDiagramPath } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import PageHeader from "./common/PageHeader";
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from "./pingUi";
import "./DemoMapPage.css";

const KEY = [
  { label: "Step links", value: "Open the step in the use-case launcher (/use-cases#UCxx)." },
  { label: "Diagram link (◱)", value: "Open that step's use-case diagram." },
  { label: "Inspectors", value: "Open the pages that show the evidence." },
  { label: "Diagrams", value: "Open the architecture pages." },
  { label: "Learning", value: "Open the topic in the Learning Hub (/learning)." },
];

export default function DemoMapPage() {
  const live = MISSION_CONTROL_CATALOG.filter((g) => g.status !== "planned");
  const planned = MISSION_CONTROL_CATALOG.filter((g) => g.status === "planned");

  const stepCell = (ucId, lane) => {
    const guide = DEMO_STEP_GUIDES[ucId];
    const title = guide?.title || ucId;
    const diagrammed = Boolean(getConfig(ucId));
    return (
      <li key={ucId} className="demo-map__step">
        <span className="demo-map__step-num">{demoStepNumber(ucId) ?? "—"}</span>
        <Link to={`/use-cases#${ucId}`} title="Open this step in the launcher" aria-label={`${title} (${lane})`}>
          {title}
        </Link>
        {diagrammed && (
          <Link
            className="demo-map__step-diagram"
            to={useCaseDiagramPath(ucId)}
            title="Open the use-case diagram"
            aria-label={`Use-case diagram: ${title} (${lane})`}
          >
            ◱
          </Link>
        )}
      </li>
    );
  };

  const linkList = (links, lane) =>
    links.map((l) => (
      <li key={l.href + l.label}>
        <a href={l.href} aria-label={`${l.label} (${lane})`}>{l.label}</a>
      </li>
    ));

  const rows = (group) => {
    const out = [];
    const lane = group.shortLabel || group.label;
    if (group.useCaseIds?.length > 0) {
      out.push({
        label: "Demo steps",
        value: <ul className="demo-map__links">{group.useCaseIds.map((id) => stepCell(id, lane))}</ul>,
      });
    }
    if (group.inspectors?.length > 0) {
      out.push({ label: "Inspectors", value: <ul className="demo-map__links">{linkList(group.inspectors, lane)}</ul> });
    }
    if (group.diagrams?.length > 0) {
      out.push({ label: "Diagrams", value: <ul className="demo-map__links">{linkList(group.diagrams, lane)}</ul> });
    }
    if (group.learning?.length > 0) {
      out.push({
        label: "Learning",
        value: (
          <ul className="demo-map__links">
            {group.learning.map((t) => (
              <li key={t.label}>
                <Link to="/learning" aria-label={`${t.label} (${lane})`}>{t.label}</Link>
              </li>
            ))}
          </ul>
        ),
      });
    }
    return out;
  };

  return (
    <PingPage className="demo-map">
      <SimBanner data-testid="demo-map-banner">
        <strong>NAVIGATION MAP</strong> &mdash; links only. Nothing here runs or checks a status;
        each link opens the page that does the work.
      </SimBanner>
      <PageHeader
        eyebrow="Mission Control · demo steps · diagrams · learning"
        title="Demo map"
        summary="Every demo surface in one view: what runs, what shows the evidence, what draws the picture, and what teaches the concept."
      />

      <PageFrame>
        <Section id="demo-map-key" kicker="1 · Key" title="How to read the map">
          <Card tone="neutral">
            <KvList items={KEY} />
          </Card>
        </Section>

        <Section
          id="demo-map-products"
          kicker="2 · Agents and products"
          title="Agent demos and Ping products"
          lede="The Personal Agent demo, the Digital Worker agent, and one row for each Ping product, with the pages that show each."
        >
          <CardGrid>
            {DEMO_MAP_ROWS.map((row) => (
              <Card key={row.id} data-testid={`demo-map-row-${row.id}`}>
                <h3 className="pu-h3">{row.title}</h3>
                <p className="pu-note demo-map__desc">{row.summary}</p>
                <ul className="demo-map__links">
                  {row.pages.map((pg) => (
                    <li key={pg.path}>
                      <Link to={pg.path} aria-label={`${pg.label} (${row.title})`}>{pg.label}</Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section
          id="demo-map-lanes"
          kicker="3 · Lanes"
          title="Demo lanes"
          lede="One card per Mission Control lane, as recorded in the catalog."
        >
          <CardGrid>
            {live.map((group) => (
              <Card key={group.id} data-testid={`demo-map-lane-${group.id}`}>
                <h3 className="pu-h3">{group.shortLabel || group.label}</h3>
                <p className="pu-status-line">
                  <StatusChip>{group.product}</StatusChip>
                </p>
                <p className="pu-note demo-map__desc">{group.description}</p>
                <KvList items={rows(group)} />
              </Card>
            ))}
          </CardGrid>
        </Section>

        {planned.length > 0 && (
          <Section
            id="demo-map-planned"
            kicker="4 · Planned"
            title="Planned lanes"
            lede="Not built yet: these have no steps to open."
          >
            <CardGrid>
              {planned.map((group) => (
                <Card key={group.id} tone="neutral">
                  <h3 className="pu-h3">{group.shortLabel || group.label}</h3>
                  <p className="pu-status-line">
                    <StatusChip>Planned</StatusChip>
                  </p>
                  <p className="pu-note">{group.plannedReason}</p>
                </Card>
              ))}
            </CardGrid>
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}
