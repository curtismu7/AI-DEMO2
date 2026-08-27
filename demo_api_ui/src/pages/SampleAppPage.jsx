// One page per PingOne sample app: what it teaches, and the code that does it,
// in whichever of the five stacks the reader cares about.
//
// Content comes from two generated/curated sources:
//   data/sampleApps.js    what the sample is, needs, and cannot do
//   data/sampleCode.json  95 extracted snippets (19 sections x 5 stacks)
//
// Code is rendered as text inside <pre><code>, never as HTML.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { STACKS, getSampleApp } from "../data/sampleApps";
import sampleCode from "../data/sampleCode.json";
import SampleRunner from "./SampleRunner";
import "./SampleAppPage.css";

const STACK_STORAGE_KEY = "sample_app_stack";

function readStoredStack() {
  try {
    const v = window.localStorage.getItem(STACK_STORAGE_KEY);
    return STACKS.some((s) => s.id === v) ? v : "js";
  } catch (_) {
    return "js";
  }
}

// The annotations use `backticks` for inline code; render those without
// dangerouslySetInnerHTML.
function Annotated({ text }) {
  const parts = String(text).split(/(`[^`]+`)/g);
  return (
    <p className="sa-note">
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

export default function SampleAppPage({ sampleId }) {
  const app = getSampleApp(sampleId);
  const [stack, setStack] = useState(readStoredStack);

  const sections = useMemo(
    () => (sampleCode[sampleId] ? sampleCode[sampleId].sections : []),
    [sampleId]
  );

  function chooseStack(id) {
    setStack(id);
    try {
      window.localStorage.setItem(STACK_STORAGE_KEY, id);
    } catch (_) {
      /* private window — the picker still works for this session */
    }
  }

  if (!app) {
    return (
      <div className="sa-page">
        <h1>Unknown sample</h1>
        <p className="sa-tagline">No sample app is registered under “{sampleId}”.</p>
      </div>
    );
  }

  return (
    <div className="sa-page">
      <header className="sa-head">
        <div className="sa-eyebrow">PingOne sample app</div>
        <h1>{app.label}</h1>
        <p className="sa-tagline">{app.tagline}</p>
        <p className="sa-summary">{app.summary}</p>

        <div className="sa-facts">
          <span className="sa-fact">
            <b>Stacks</b>Go · Node · Python · React · Angular
          </span>
          <span className="sa-fact">
            <b>Worker roles</b>
            {app.roles.join(" + ")}
          </span>
          <span className={`sa-fact${app.writes ? " sa-warn" : ""}`}>
            <b>Tenant</b>
            {app.writes ? "creates resources" : "read-only"}
          </span>
          <span className={`sa-fact${app.runnable === "partial" ? " sa-warn" : ""}`}>
            <b>Unattended</b>
            {app.runnable === "full" ? "runs end-to-end" : "needs a real inbox"}
          </span>
        </div>
      </header>

      <section className="sa-panel">
        <h2>What this sample teaches</h2>
        <ul>
          {app.teaches.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="sa-panel">
        <h2>Before you run it</h2>
        <ul>
          <li>
            Assign these roles to your worker app: <b>{app.roles.join(" + ")}</b>. {app.rolesNote}
          </li>
          <li>{app.runNote}</li>
          <li>
            Run <code>./setup.sh</code> from the stack directory, then start the app. For{" "}
            <code>react</code> and <code>angular</code>, run <code>setup.sh</code> from the stack
            root — not from <code>client/</code> or <code>server/</code>.
          </li>
        </ul>
      </section>

      <div className="sa-stackbar">
        <span className="sa-stackbar-label">Show code in</span>
        {STACKS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sa-stack-btn"
            aria-pressed={stack === s.id}
            onClick={() => chooseStack(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sections.map((sec) => {
        const snippet = sec.code[stack];
        return (
          <section className="sa-section" key={sec.id}>
            <div className="sa-section-head">
              <h3>{sec.title}</h3>
              {snippet ? (
                <span className="sa-file">
                  {snippet.file}:{snippet.line}
                </span>
              ) : null}
            </div>
            <Annotated text={sec.note} />
            {snippet ? (
              <pre className="sa-code">
                <code>{snippet.code}</code>
              </pre>
            ) : (
              <p className="sa-missing">
                No extract available for this stack.
              </p>
            )}
          </section>
        );
      })}

      <section className="sa-run">
        <h2>Run it</h2>
        <p>{app.runNote}</p>
        {app.runnerApi ? (
          <SampleRunner
            api={app.runnerApi}
            sample={app.id}
            runLabel={app.runLabel || "Run the workflow"}
            cleanupLabel={app.cleanupLabel}
          />
        ) : app.runnerHref ? (
          <Link className="sa-btn" to={app.runnerHref}>
            Open the live runner
          </Link>
        ) : (
          <p className="sa-missing">
            No live runner is wired into the demo for this sample — it cannot finish without a real
            inbox to receive the one-time code. Clone the sample repo and run it locally with the
            commands above.
          </p>
        )}
      </section>
    </div>
  );
}
