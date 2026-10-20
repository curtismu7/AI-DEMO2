import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ObservabilityDiagramPage.css";
import EmbeddedFlowDiagram from "./EmbeddedFlowDiagram";
import { buildObservabilityDiagram } from "../config/observabilityDiagram";
import PageHeader from './common/PageHeader';

/**
 * ObservabilityDiagramPage — /architecture/observability.
 *
 * The observability demo as a diagram: where each telemetry plane is emitted,
 * which collector stores it, and which surface presents it — plus the two-part
 * demo walkthrough (forensics, then ops). Drawn in the Ping style
 * (EmbeddedFlowDiagram pingStyle, config/observabilityDiagram.js); the page is illustrative by design (it maps the
 * shipped stack, it does not query it live).
 */

// Walkthrough steps that map to a real surface link to it (new tab, so the
// walkthrough page stays open). Grafana is external on the compose stack (its
// own origin on :3000) and same-origin under /grafana in k8s — same split the
// side nav makes for grafanaUrl (AdminSideNav.jsx). The demo/run launcher
// routes through /dashboard with navigate state (AIAgent's use-case launcher
// consumes triggerText + useCaseId); the endpoint arms the use case's flags
// and returns the trigger text, so the chip runs as soon as the dashboard
// dock opens.
const GRAFANA_BASE = typeof window !== "undefined"
  && ["localhost", "127.0.0.1", "local.ping-devops.com"].includes(window.location.hostname)
  ? "http://localhost:3000"
  : "/grafana";
const GRAFANA_DASHBOARD = `${GRAFANA_BASE}/d/ai-demo-agent-observability/agent-observability-overview`;

const WALKTHROUGH = [
  {
    part: "Part 1 · Forensics — every action attributable",
    tone: "part1",
    steps: [
      { n: "1", title: "Sign in as customer", sub: "unified sign-in, device-first" },
      { n: "2", title: "Chip: “show my balance”", sub: "UC20 trigger → PERMIT", href: "/dashboard", launch: { useCaseId: "audit-trail", label: "Run UC20 — show my balance" } },
      { n: "3", title: "Evidence panels", sub: "Token Chain + Activity — act chain stamped", href: "/monitoring/token-chain" },
      { n: "4", title: "Transaction Trace", sub: "reconstruct any hop, incl. failures", href: "/transaction-trace" },
    ],
  },
  {
    part: "Part 2 · Ops — agent traffic is just a monitored service",
    tone: "part2",
    steps: [
      { n: "5", title: "Grafana overview", sub: "agent-observability dashboard, SSO in", href: GRAFANA_DASHBOARD, external: true },
      { n: "6", title: "Run UC6 → DENY", sub: "“transfer $2500 from checking to savings”", href: "/dashboard", launch: { useCaseId: "authz-denied", label: "Run UC6 — transfer $2500" } },
      { n: "7", title: "Panels react", sub: "DENY counters move within ~30s", href: GRAFANA_DASHBOARD, external: true },
      { n: "8", title: "Alert rules page", sub: "explained: ratios, not counts — 401s are normal", href: `${GRAFANA_BASE}/alerting/list`, external: true },
    ],
  },
];

export default function ObservabilityDiagramPage() {
  const [view, setView] = useState("flow");
  const [plane, setPlane] = useState("all");
  const [launching, setLaunching] = useState(null);
  const navigate = useNavigate();
  const diagram = useMemo(() => buildObservabilityDiagram(plane), [plane]);
  const onPlane = useCallback((p) => setPlane(p), []);

  // Demo-step launcher: arm the use case's flags + trigger on the BFF, then
  // land on /dashboard with the launcher state AIAgent already consumes
  // (same shape AiAttacksPanel's catalog runner navigates with).
  const onLaunch = useCallback(async (step) => {
    if (launching) return;
    setLaunching(step.n);
    let triggerText = "";
    try {
      const res = await fetch("/api/use-cases/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ useCaseId: step.launch.useCaseId, vertical: "banking" }),
      });
      if (res.ok) {
        const data = await res.json();
        triggerText = data.triggerText || "";
      }
    } catch {
      // Fall through: the dashboard chip still runs from the plain trigger text.
    }
    navigate("/dashboard", {
      state: { useCaseId: step.launch.useCaseId, triggerText: triggerText || step.launch.label, type: "chip", vertical: "banking" },
    });
  }, [launching, navigate]);

  return (
    <div className="obs-page">
      <PageHeader className="obs-header" eyebrow="Observability demo" title="Agent telemetry, end to end" summary={<>What each service emits, which collector stores it, and which surface presents it —
            then the demo story that walks the same path.</>}
        actions={<>        <span className="obs-mock-chip" title="The diagram maps the shipped stack; it does not query it live.">
          ILLUSTRATIVE — maps the shipped stack
        </span>
        </>} />

      <div className="obs-tabs" role="tablist" aria-label="Diagram view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "flow"}
          className={view === "flow" ? "is-current" : ""}
          onClick={() => setView("flow")}
        >
          Telemetry data flow
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "walk"}
          className={view === "walk" ? "is-current" : ""}
          onClick={() => setView("walk")}
        >
          Demo walkthrough
        </button>
      </div>

      {view === "flow" ? (
        <>
          <div className="obs-planes" role="group" aria-label="Show a telemetry plane">
            <button type="button" aria-pressed={plane === "all"} onClick={() => onPlane("all")}>
              All planes
            </button>
            <button type="button" aria-pressed={plane === "metrics"} onClick={() => onPlane("metrics")}>
              <i className="obs-plane-dot obs-plane-dot--metrics" /> Metrics
            </button>
            <button type="button" aria-pressed={plane === "traces"} onClick={() => onPlane("traces")}>
              <i className="obs-plane-dot obs-plane-dot--traces" /> Traces
            </button>
            <button type="button" aria-pressed={plane === "logs"} onClick={() => onPlane("logs")}>
              <i className="obs-plane-dot obs-plane-dot--logs" /> Logs
            </button>
          </div>
          {/* keyed by plane: switching plane redraws the diagram and starts the walk over */}
          <EmbeddedFlowDiagram
            key={plane}
            config={diagram}
            title="Telemetry data flow"
            lede="Follow the numbered arrows: what each service emits, which collector stores it, and which surface presents it. Boxes move; Simulate walks the arrows; click a box or a card for the request on the wire and the standards behind it."
            ariaLabel="Telemetry data flow"
            diagramLabel="Telemetry data flow diagram"
            testId="obs-flow"
            pingStyle
          />
          <div className="obs-planes-note">
            The demo runs this for real: docker-compose profiles <code>observability</code> and
            <code> tracing</code> stand up every node here. The Grafana dashboard is
            <code> agent-observability-overview</code>; the presenter runbook is
            <code> docs/runbooks/observability-demo.md</code>.
          </div>
        </>
      ) : (
        <div className="obs-walk">
          {WALKTHROUGH.map((part) => (
            <section key={part.part} className={`obs-walk__part obs-walk__part--${part.tone}`}>
              <h2>{part.part}</h2>
              <ol>
                {part.steps.map((s) => {
                  const body = (
                    <>
                      <span className="obs-walk__num">
                        {s.n}
                        {s.href && <span className="obs-walk__arrow" aria-hidden="true"> ↗</span>}
                      </span>
                      <strong>{s.title}</strong>
                      <span className="obs-walk__sub">{s.sub}</span>
                      {s.launch && (
                        <span className="obs-walk__cta">{launching === s.n ? "Arming…" : "Run it"}</span>
                      )}
                    </>
                  );
                  const cls = `obs-walk__step${s.href ? " obs-walk__step--link" : ""}`;
                  if (s.launch) {
                    return (
                      <li key={s.n}>
                        <button type="button" className={cls} onClick={() => onLaunch(s)} disabled={launching === s.n}>
                          {body}
                        </button>
                      </li>
                    );
                  }
                  if (s.href) {
                    return (
                      <li key={s.n}>
                        <a className={cls} href={s.href} target="_blank" rel="noopener noreferrer">
                          {body}
                        </a>
                      </li>
                    );
                  }
                  return <li key={s.n}><div className={cls}>{body}</div></li>;
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
