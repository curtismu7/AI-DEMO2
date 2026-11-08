// GatewayStatsPage.jsx — HAProxy's live stats for the MCP gateway load balancer on its own page.
// The same panel the topology page carries at the bottom, given a direct URL (/gateway-stats) and
// a Mission Control link. Served through /api/admin/lb/runtime/stats-view, so the demo's PingOne
// sign-in is the gate and the stats password never reaches the browser.
//
// The page asks the proxy first, so it can say what is wrong instead of showing a blank frame:
// 401 = not signed in, 503 = the server has no stats connection configured.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the
// shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards,
// P5 kv, P7 chips, P9 buttons. Skipped: P6 (not an inspector) and P8 (no diagram). The standalone shell bar
// is not added (the app has its own).
//
// Honesty: nothing on this page is simulated. The frame is HAProxy's own page, fetched through the API
// server. What the PAGE itself checked is one thing only: a separate request to the stats endpoint got HTTP 200.
// The chips and the banner say that and no more: a green chip does not mean the frame loaded (the frame can still
// show the gateway's own error page, which this page cannot read) and it does not mean every gateway is healthy.
//
// A check that never answers ends after CHECK_TIMEOUT_MS in a "Timed out" state, so "Check again" is never stuck.
// The instructions for each state (sign in, set MCPGW_LB_STATS_*) sit inside the role=status region so a screen
// reader hears them with the result.
//
// P9, one primary per view state: "Check again" is the only button and so the one primary in every state
// (checking, reachable, signed out, not configured, error). It stays mounted across states so keyboard focus
// stays on it after a press, and it is aria-disabled (not disabled) while a check is running.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "./common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from "./pingUi";
import "./GatewayStatsPage.css";

const STATS_URL = "/api/admin/lb/runtime/stats-view";
export const CHECK_TIMEOUT_MS = 10000;

// What each state shows. `tone` colours the card edge, `chip` is the word and its tone: green only for what
// the page itself confirmed (the proxy answered 200), warn/danger for a failed check, neutral while unchecked.
const VIEW = {
  checking: {
    tone: "neutral",
    chipTone: "neutral",
    chip: "Checking",
    line: "Checking your sign-in…",
    banner: (
      <>
        <strong>NO DATA YET</strong> — asking the stats proxy whether you can see the gateway stats. Nothing on this page
        is simulated: it shows live HAProxy data or says why it cannot.
      </>
    ),
  },
  ok: {
    tone: "ok",
    chipTone: "ok",
    chip: "Endpoint answered",
    line: "The stats endpoint answered.",
    detail: <>The frame below is the gateway&apos;s own page. If it shows an error, that error is the gateway&apos;s, not this page&apos;s.</>,
    banner: (
      <>
        <strong>THE STATS ENDPOINT ANSWERED</strong> — a separate request to this demo&apos;s API server got HTTP 200. The frame
        below is HAProxy&apos;s own stats page for <code>mcpgw-lb</code>, and this page cannot read what is inside it, so it does
        not claim the frame loaded. It also cannot tell which cluster the server&apos;s stats connection points at, and it does not
        judge node health. Nothing on this page is simulated.
      </>
    ),
  },
  signin: {
    tone: "warn",
    chipTone: "warn",
    chip: "Not signed in",
    line: "Sign in to see the stats.",
    detail: (
      <>
        This page shows live gateway data only to a signed-in demo user. Use <b>Sign In</b> at the top right of the page,
        then come back here and press <b>Check again</b>.
      </>
    ),
    banner: (
      <>
        <strong>NO DATA SHOWN</strong> — the stats are live HAProxy data and are shown only to a signed-in demo user. Nothing
        on this page is simulated, so there are no placeholder numbers while you are signed out.
      </>
    ),
  },
  unconfigured: {
    tone: "warn",
    chipTone: "warn",
    chip: "Not configured",
    line: "The server has no stats connection set up.",
    detail: (
      <>
        Set <code>MCPGW_LB_STATS_URL</code> and <code>MCPGW_LB_STATS_AUTH</code> in the API server&apos;s environment, restart
        it, and press <b>Check again</b>.
      </>
    ),
    banner: (
      <>
        <strong>NO DATA SHOWN</strong> — the API server has no connection to HAProxy&apos;s stats page, so there is nothing
        live to show. Nothing on this page is simulated.
      </>
    ),
  },
  timeout: {
    tone: "danger",
    chipTone: "danger",
    chip: "Timed out",
    line: "The stats proxy did not answer in time.",
    detail: <>No answer came within 10 seconds. Press <b>Check again</b> to try once more.</>,
    banner: (
      <>
        <strong>NO DATA SHOWN</strong> — the stats request timed out, so there is nothing live to show. Nothing on this page is
        simulated.
      </>
    ),
  },
  error: {
    tone: "danger",
    chipTone: "danger",
    chip: "Not loaded",
    line: "The stats could not be loaded.",
    detail: <>The API server did not answer as expected. Try again in a moment.</>,
    banner: (
      <>
        <strong>NO DATA SHOWN</strong> — the stats request failed, so there is nothing live to show. Nothing on this page is
        simulated.
      </>
    ),
  },
};

// The proxy's answer, as the page saw it.
const ANSWER = {
  checking: "waiting for the proxy",
  ok: "200, stats page returned",
  signin: "401, not signed in",
  unconfigured: "503, stats connection not set up",
  timeout: "no answer within 10 seconds",
  error: "no usable answer (network error or an unexpected status)",
};

export default function GatewayStatsPage() {
  const [state, setState] = useState("checking"); // checking | ok | signin | unconfigured | timeout | error
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setState("checking");
    // The timer ends the check even when fetch never settles (it also aborts the request).
    const timer = setTimeout(() => {
      if (!live) return;
      live = false;
      controller.abort();
      setState("timeout");
    }, CHECK_TIMEOUT_MS);
    fetch(STATS_URL, { credentials: "same-origin", signal: controller.signal })
      .then((res) => {
        if (!live) return;
        if (res.ok) setState("ok");
        else if (res.status === 401) setState("signin");
        else if (res.status === 503) setState("unconfigured");
        else setState("error");
      })
      .catch(() => { if (live) setState("error"); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  const checking = state === "checking";
  // aria-disabled keeps the button focusable while a check runs; a second press during it does nothing.
  const recheck = useCallback(() => {
    if (checking) return;
    setAttempt((n) => n + 1);
  }, [checking]);

  const view = VIEW[state];

  return (
    <PingPage className="gws-page">
      <SimBanner data-testid="gws-banner">{view.banner}</SimBanner>
      <PageHeader
        className="gws-hero"
        eyebrow="Monitoring · MCP gateway load balancer"
        title="Gateway stats"
        summary={
          <>
            HAProxy&apos;s built-in stats for <code>mcpgw-lb</code>: node health, sessions and traffic per gateway. HAProxy
            refreshes the page itself (every 5s in the shipped helm config). Shown to any signed-in demo user; there is no
            separate stats password.
          </>
        }
      />
      <PageFrame>
        <Section id="gws-connection" kicker="1 · Connection" title="Can this page reach the stats?">
          <Card tone={view.tone} title="Stats proxy" data-testid="gws-connection-card">
            <div role="status" data-testid="gws-status">
              <div className="pu-status-line">
                <StatusChip tone={view.chipTone}>{view.chip}</StatusChip>
                <strong>{view.line}</strong>
              </div>
              {view.detail ? <p className="pu-note">{view.detail}</p> : null}
            </div>
            <KvList
              items={[
                { label: "Asked", value: STATS_URL, mono: true },
                { label: "Proxy replied", value: ANSWER[state] },
                { label: "Gate", value: "The demo's PingOne sign-in (any signed-in user)" },
              ]}
            />
            <div className="pu-actions">
              <button
                type="button"
                className="pu-btn pu-btn--primary"
                data-testid="gws-check-again"
                aria-disabled={checking ? "true" : undefined}
                onClick={recheck}
              >
                Check again
              </button>
            </div>
          </Card>
        </Section>
        {state === "ok" && (
          <Section id="gws-stats" kicker="2 · Live stats" title="HAProxy stats for mcpgw-lb">
            <Card tone="live" data-testid="gws-frame-card">
              <p className="pu-status-line">
                <StatusChip tone="info">Gateway&apos;s own page</StatusChip>
                <span>The frame is HAProxy&apos;s own page, so it uses HAProxy&apos;s styling, not the app theme.</span>
              </p>
              <iframe title="HAProxy LB stats" src={STATS_URL} className="gws-page__frame" />
            </Card>
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}
