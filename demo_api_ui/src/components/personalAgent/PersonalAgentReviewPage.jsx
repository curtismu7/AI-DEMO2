// PersonalAgentReviewPage.jsx — /personal-agent-review
// Why the original personal-agent design was wrong, finding by finding, judged against the five
// controls an enterprise review treats as non-negotiable. Linked from both design pages. The figure is
// React Flow with the findings pinned to the nodes that carry them.
import React from "react";
import { Link } from "react-router-dom";
import StaticFlowDiagram from "../StaticFlowDiagram";
import {
  DESIGNS,
  DONE_WELL,
  FINDINGS,
  ORIGINAL_EDGES,
  ORIGINAL_NODES,
  REVIEW_GROUPS,
  SCORECARD,
  SEVERITY,
} from "./personalAgentData";
import "./PersonalAgent.css";
import PageHeader from '../common/PageHeader';

const VERDICT = { fail: "Fails", partial: "Partly met" };

export default function PersonalAgentReviewPage() {
  const counts = FINDINGS.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
  return (
    <main className="pa-page" data-testid="pa-review">
      <PageHeader className="pa-hero" eyebrow="Personal agent · design review" title="Why the original design was wrong" summary={<>The original assistant is a sound product shape: payment stays on the airline site and the facade guards
          every cart change. As an architecture for an agent that holds a member&apos;s authority, it is an
          impersonation design. The AI acts as the traveller with the traveller&apos;s whole session, and nothing in
          the chain tells the airline an agent rather than the member is calling. {FINDINGS.length} findings follow:{" "}
          {counts.critical || 0} critical, {counts.high || 0} high and {counts.medium || 0} medium.</>}>
        <p className="pa-caveat">
          This is a review of a diagram, not of code. Each finding says what the picture shows or leaves out. Confirm
          each one against the implementation before acting on it.
        </p>
        <nav className="pa-links" aria-label="Where the findings are fixed">
          <Link to={DESIGNS.target.path}>{DESIGNS.target.title}</Link>
          <Link to={DESIGNS.dual.path}>{DESIGNS.dual.title}</Link>
        </nav>
      </PageHeader>

      <section aria-label="Scorecard against the five controls">
        <h2>Scorecard against the five non-negotiable controls</h2>
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th scope="col">Control</th>
                <th scope="col">Original design</th>
                <th scope="col">Why</th>
                <th scope="col">Findings</th>
              </tr>
            </thead>
            <tbody>
              {SCORECARD.map((row) => (
                <tr key={row.control}>
                  <th scope="row">{row.control}</th>
                  <td>
                    <span className={`pa-verdict pa-verdict--${row.original}`}>{VERDICT[row.original]}</span>
                  </td>
                  <td>{row.note}</td>
                  <td>{row.findings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <figure className="pa-figure">
        <h2>The original design, with the findings pinned</h2>
        <StaticFlowDiagram
          NODES={ORIGINAL_NODES}
          EDGES={ORIGINAL_EDGES}
          GROUPS={REVIEW_GROUPS}
          step={-1}
          testId="pa-review-diagram"
          height={560}
          ariaLabel="The original design. Ping issues a sign-in token to the hosted chat agent, which calls the MCP server with the same token. The MCP server turns it into a full member session and calls the facade. Other AI apps reach the same tools directly. Findings F1 to F10 are pinned to the nodes that carry them."
        />
        <ul className="pa-legend" aria-label="Legend">
          {Object.entries(REVIEW_GROUPS).map(([key, g]) => (
            <li key={key}>
              <i className={`pa-sw pa-sw--${key}`} />
              {g.label}
            </li>
          ))}
        </ul>
      </figure>

      <section className="pa-findings" aria-label="Findings">
        <h2>Findings</h2>
        <ol className="pa-finding-list">
          {FINDINGS.map((f) => (
            <li key={f.id} className={`pa-finding pa-finding--${f.severity}`} data-testid={`pa-finding-${f.id}`}>
              <h3>
                <span className="pa-id">{f.id}</span>
                {f.title}
                <span className={`pa-sev pa-sev--${f.severity}`}>{SEVERITY[f.severity]}</span>
              </h3>
              <dl>
                <div>
                  <dt>What the diagram shows</dt>
                  <dd>{f.shows}</dd>
                </div>
                <div>
                  <dt>Why it is a hole</dt>
                  <dd>{f.hole}</dd>
                </div>
                <div>
                  <dt>How it gets exploited</dt>
                  <dd>{f.attack}</dd>
                </div>
                <div>
                  <dt>Best practice</dt>
                  <dd>
                    <ul>
                      {f.practice.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div className="pa-today">
                  <dt>Where it is fixed</dt>
                  <dd>
                    {f.fix} {f.steps} in the <Link to={DESIGNS.target.path}>target design</Link> and the{" "}
                    <Link to={DESIGNS.dual.path}>dual gateway design</Link>.
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="pa-assume" aria-label="What the original did well">
        <h2>What the original did well</h2>
        <ul>
          {DONE_WELL.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
