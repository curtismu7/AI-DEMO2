// Standalone sample URLs — the PingOne sample pages with none of this demo
// around them.
//
// The same pages are already reachable at /samples/*, but those render inside
// AppShell, so they arrive wrapped in the demo's TopNav, side nav and agent
// dock. That is the wrong frame for showing a sample to someone at Ping, or
// for screen-sharing one: the surrounding app is not what is being explained.
//
// So these routes skip AppShell entirely rather than hiding its parts with a
// flag — a `?bare=1` on the existing route would leave every one of AppShell's
// children mounted and one CSS rule away from reappearing.
//
// What is deliberately NOT dropped: ThemeContext stamps data-theme on :root and
// sits above the router, so the --th-* tokens still resolve here and dark mode
// keeps working. Nothing about the chrome was carrying the theme.

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { SAMPLE_APPS, getSampleApp } from "../data/sampleApps";
import SampleAppPage from "./SampleAppPage";
import M2mCredentialsSamplePage from "./M2mCredentialsSamplePage";
import "./StandaloneSamples.css";

// Samples whose "open the live runner" button has a standalone twin. Only the
// M2M runner is a page of its own; the other runners are embedded in their
// sample page and need no separate route.
const STANDALONE_RUNNERS = {
  "m2m-credentials": "/standalone/runner/m2m",
};

// The tab name follows the sample, not the demo. index.html titles the page
// "PingOne AI IAM Core", which is the wrong name to hand someone along with a
// link to one sample. Restored on unmount so navigating back into the app does
// not leave a sample's title behind.
function useStandaloneTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

// A thin bar so a shared link has somewhere to go next. This is the whole of
// the chrome — no app nav, no agent, no session state.
function StandaloneShell({ children, current }) {
  return (
    <div className="st-root">
      <header className="st-bar">
        <Link className="st-brand" to="/standalone">
          PingOne sample apps
        </Link>
        <nav className="st-links">
          {SAMPLE_APPS.map((a) => (
            <Link
              key={a.id}
              to={`/standalone/${a.id}`}
              className={a.id === current ? "st-link st-on" : "st-link"}
            >
              {a.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="st-main">{children}</main>
    </div>
  );
}

// /standalone — an entry point worth sharing, so a link lands somewhere that
// explains itself rather than on whichever sample was picked first.
export function StandaloneIndex() {
  useStandaloneTitle("PingOne sample apps");
  return (
    <StandaloneShell>
      <div className="st-index">
        <h1>PingOne sample apps</h1>
        <p className="st-lede">
          Four use cases, each implemented in Go, Node.js, Python, React and Angular.
          Every page shows what the sample teaches and the code that does it, and
          three of them run live against a real PingOne environment.
        </p>
        <div className="st-cards">
          {SAMPLE_APPS.map((a) => (
            <Link key={a.id} className="st-card" to={`/standalone/${a.id}`}>
              <h2>{a.label}</h2>
              <p>{a.tagline}</p>
              <span className="st-card-meta">
                {a.runnable === "full"
                  ? "runs end-to-end"
                  : "runs live, needs a real inbox"}
                {a.writes ? " · creates tenant resources" : " · read-only"}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </StandaloneShell>
  );
}

// /standalone/:sampleId — one route rather than one export per sample, so a
// sample added to sampleApps.js is reachable here without touching routing.
export function StandaloneSample() {
  const { sampleId } = useParams();
  const app = getSampleApp(sampleId);
  // Hooks run before the unknown-sample return below, so this cannot sit inside
  // the happy path.
  useStandaloneTitle(
    app ? `${app.label} — PingOne sample app` : "PingOne sample apps",
  );

  if (!app) {
    return (
      <StandaloneShell>
        <div className="st-index">
          <h1>Unknown sample</h1>
          <p className="st-lede">
            No sample app is registered under “{sampleId}”.
          </p>
          <Link className="st-back" to="/standalone">
            See the four samples
          </Link>
        </div>
      </StandaloneShell>
    );
  }

  return (
    <StandaloneShell current={sampleId}>
      {/* Keep the runner link inside /standalone, or the one button on the
          page drops the reader back into the demo it was meant to omit.
          Keyed by id rather than by "has a runnerHref": a future sample with a
          runnerHref pointing somewhere else would otherwise be sent silently to
          the M2M runner. Without a standalone twin it falls through to its own
          link, which is wrong-but-visible rather than wrong-and-quiet. */}
      <SampleAppPage
        sampleId={sampleId}
        runnerHref={STANDALONE_RUNNERS[sampleId]}
      />
    </StandaloneShell>
  );
}

// /standalone/runner/m2m — the verbatim M2M runner, which is its own page
// rather than a SampleAppPage, so it needs its own standalone route for the
// link above to have somewhere to land.
export function StandaloneRunnerShell() {
  return (
    <StandaloneShell current="m2m-credentials">
      <M2mCredentialsSamplePage />
    </StandaloneShell>
  );
}

export default StandaloneSample;
