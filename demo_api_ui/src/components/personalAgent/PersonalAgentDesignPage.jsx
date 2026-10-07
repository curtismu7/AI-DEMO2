// PersonalAgentDesignPage.jsx — one component for both target designs under Diagrams:
//   variant="target"  /personal-agent-design        Agent Gateway only
//   variant="dual"    /personal-agent-dual-gateway  Privilege first, Agent Gateway for the gaps
// The figure is React Flow (StaticFlowDiagram) driven by the shared Play/Step bar. The write-up under it
// has one card per step: what happens, why it is needed, how it secures the AI, and what the original
// design did instead.
import React from "react";
import { Link } from "react-router-dom";
import DiagramStepBar from "../DiagramStepBar";
import StaticFlowDiagram from "../StaticFlowDiagram";
import { edgeCaptions, useDiagramStepper } from "../../hooks/useDiagramStepper";
import { DESIGNS, GROUPS } from "./personalAgentData";
import "./PersonalAgent.css";

export default function PersonalAgentDesignPage({ variant = "target" }) {
  const design = DESIGNS[variant] || DESIGNS.target;
  const other = variant === "dual" ? DESIGNS.target : DESIGNS.dual;
  const stepper = useDiagramStepper(design.edges.length);
  const names = Object.fromEntries(design.nodes.map((n) => [n.id, n.label]));
  const captions = edgeCaptions(design.edges, names);
  const usedGroups = [...new Set(design.nodes.map((n) => n.group))];

  return (
    <main className="pa-page" data-testid={`pa-page-${variant}`}>
      <header className="pa-hero">
        <div className="pa-eyebrow">{design.eyebrow}</div>
        <h1>{design.title}</h1>
        <p>{design.intro}</p>
        <nav className="pa-links" aria-label="Related personal agent pages">
          <Link to="/personal-agent-review">Why the original design was wrong</Link>
          <Link to={other.path}>{other.title}</Link>
        </nav>
      </header>

      <DiagramStepBar stepper={stepper} caption={captions[stepper.step]} testId={`pa-steps-${variant}`} />

      <figure className="pa-figure">
        <StaticFlowDiagram
          NODES={design.nodes}
          EDGES={design.edges}
          GROUPS={GROUPS}
          step={stepper.step}
          testId={`pa-diagram-${variant}`}
          height={design.height}
          ariaLabel={design.ariaLabel}
        />
        <ul className="pa-legend" aria-label="Legend">
          {usedGroups.map((g) => (
            <li key={g}>
              <i className={`pa-sw pa-sw--${g}`} />
              {GROUPS[g].label}
            </li>
          ))}
          <li>
            <i className="pa-sw pa-sw--dashed" />
            another client entering through the same door
          </li>
        </ul>
      </figure>

      <section className="pa-steps" aria-label="Step by step">
        <h2>Step by step</h2>
        <ol className="pa-step-list">
          {design.steps.map((s, i) => {
            const active = stepper.active && s.edges.includes(stepper.step);
            return (
              <li key={s.key} className={`pa-step${active ? " pa-step--active" : ""}`} data-testid={`pa-step-${i + 1}`}>
                <h3>
                  <span className="pa-step-n">{i + 1}</span>
                  {s.title}
                </h3>
                <dl>
                  <div>
                    <dt>What happens</dt>
                    <dd>{s.what}</dd>
                  </div>
                  <div>
                    <dt>Why it is needed</dt>
                    <dd>{s.why}</dd>
                  </div>
                  <div>
                    <dt>How it secures the AI</dt>
                    <dd>{s.security}</dd>
                  </div>
                  <div className="pa-today">
                    <dt>The original design</dt>
                    <dd>{s.today}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="pa-assume" aria-label="Assumptions and open checks">
        <h2>Assumptions and open checks</h2>
        <ul>
          {design.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
