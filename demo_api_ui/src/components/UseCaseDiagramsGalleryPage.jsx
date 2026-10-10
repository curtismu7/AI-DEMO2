// UseCaseDiagramsGalleryPage.jsx — /use-case-diagrams: every registered
// use-case diagram, deep-linkable. Title/what import from demoStepGuides so
// the gallery reads like the demo script.
import React from "react";
import { Link } from "react-router-dom";
import { CONFIGS } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import "./UseCaseDiagramPage.css";

const TONE_CLASS = { ok: "ucd-pill--ok", warn: "ucd-pill--warn", err: "ucd-pill--err", info: "ucd-pill--info" };

export default function UseCaseDiagramsGalleryPage() {
  return (
    <main className="ucd-page ucd-gallery" data-testid="ucd-gallery">
      <header className="ucd-head">
        <h1>Use-case diagrams</h1>
        <p>
          One walkthrough per demo step: play it, pause it, walk the arrows. For the
          whole demo — steps, inspectors, diagrams, learning topics on one page — open the{' '}
          <Link to="/demo-map" className="ucd-cue">Demo Map</Link>.
        </p>
      </header>
      <ul className="ucd-gallery__grid">
        {CONFIGS.map((c) => {
          const g = DEMO_STEP_GUIDES[c.id];
          return (
            <li key={c.id}>
              <Link className="ucd-card" to={`/use-case-diagrams/${c.id}`}>
                <span className="ucd-card__top">
                  <b>{demoStepNumber(c.id)}</b>
                  <span className={`ucd-pill ${TONE_CLASS[c.result.tone]}`}>{c.result.label}</span>
                </span>
                <span className="ucd-card__title">{g?.title || c.id}</span>
                <span className="ucd-card__what">{g?.what || ""}</span>
              </Link>
              <Link className="ucd-card__run" to={`/use-cases#${c.id}`}>
                Run this step ↗
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
