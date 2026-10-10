// DemoMapPage.jsx — /demo-map: the one page that shows every demo surface and
// how it connects. Each mission-control group row lists its demo steps (live
// runs), each step's use-case diagram, the inspectors that show the evidence,
// the architecture diagrams, and the Learning Hub topics that teach the concept.
// Built on missionControlCatalog (the same data DemoStepsDropdown reads), so
// the map cannot drift from the dropdown without the catalog drift test firing.
import React from "react";
import { Link } from "react-router-dom";
import { MISSION_CONTROL_CATALOG } from "../config/missionControlCatalog";
import { getConfig, useCaseDiagramPath } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import "./DemoMapPage.css";

export default function DemoMapPage() {
  const live = MISSION_CONTROL_CATALOG.filter((g) => g.status !== "planned");
  const planned = MISSION_CONTROL_CATALOG.filter((g) => g.status === "planned");

  const stepCell = (ucId) => {
    const guide = DEMO_STEP_GUIDES[ucId];
    const diagrammed = Boolean(getConfig(ucId));
    return (
      <span key={ucId} className="demo-map__step">
        <span className="demo-map__step-num">{demoStepNumber(ucId) ?? "—"}</span>
        <Link to={`/use-cases#${ucId}`} title="Run this step live">
          {guide?.title || ucId}
        </Link>
        {diagrammed && (
          <Link
            className="demo-map__step-diagram"
            to={useCaseDiagramPath(ucId)}
            title="Open the use-case diagram"
          >
            ◱
          </Link>
        )}
      </span>
    );
  };

  return (
    <div className="demo-map">
      <header className="demo-map__header">
        <div className="demo-map__eyebrow">Mission Control · demo steps · diagrams · learning</div>
        <h1>Demo map</h1>
        <p className="demo-map__lede">
          Every demo surface in one view: what runs, what shows the evidence,
          what draws the picture, and what teaches the concept. Steps link to
          the live run, ◱ links to the step's diagram, inspectors and diagrams
          link out, learning topics open the Hub.
        </p>
        <div className="demo-map__legend">
          <span><b>Step links</b> → /use-cases#UCxx (live run)</span>
          <span><b>◱</b> → use-case diagram</span>
          <span><b>Inspectors</b> → evidence pages</span>
          <span><b>Diagrams</b> → architecture pages</span>
          <span><b>Learning</b> → /learning topics</span>
        </div>
      </header>

      <div className="demo-map__grid">
        {live.map((group) => (
          <section key={group.id} className="demo-map__group">
            <h2 className="demo-map__group-title">
              {group.shortLabel || group.label}
              <span className="demo-map__product">{group.product}</span>
            </h2>
            <p className="demo-map__group-desc">{group.description}</p>

            {group.useCaseIds?.length > 0 && (
              <div className="demo-map__row">
                <span className="demo-map__row-label">Demo steps</span>
                <span className="demo-map__row-value">
                  {group.useCaseIds.map(stepCell)}
                </span>
              </div>
            )}

            {group.inspectors?.length > 0 && (
              <div className="demo-map__row">
                <span className="demo-map__row-label">Inspectors</span>
                <span className="demo-map__row-value">
                  {group.inspectors.map((l) => (
                    <a key={l.href + l.label} href={l.href}>{l.label}</a>
                  ))}
                </span>
              </div>
            )}

            {group.diagrams?.length > 0 && (
              <div className="demo-map__row">
                <span className="demo-map__row-label">Diagrams</span>
                <span className="demo-map__row-value">
                  {group.diagrams.map((l) => (
                    <a key={l.href + l.label} href={l.href}>{l.label}</a>
                  ))}
                </span>
              </div>
            )}

            {group.learning?.length > 0 && (
              <div className="demo-map__row">
                <span className="demo-map__row-label">Learning</span>
                <span className="demo-map__row-value">
                  {group.learning.map((t) => (
                    <Link key={t.label} to="/learning">{t.label}</Link>
                  ))}
                </span>
              </div>
            )}
          </section>
        ))}
      </div>

      {planned.length > 0 && (
        <section className="demo-map__planned">
          <h2>Planned lanes</h2>
          {planned.map((group) => (
            <p key={group.id}>
              <b>{group.shortLabel || group.label}</b> — {group.plannedReason}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
