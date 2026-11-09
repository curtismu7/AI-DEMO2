import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { EDU } from "../components/education/educationIds";
import SignInPrompt from "../components/SignInPrompt";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import "./IntentBindingLearningPage.css";
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList } from '../components/pingUi';

/**
 * Intent Binding learning page demonstrating PAR (Pushed Authorization Request).
 * Shows how authorization details are pre-submitted to PingOne via PAR endpoint,
 * then referenced during token exchange via request_uri. Layout: static pipeline
 * header, then permanent PERMIT | DRIFT split for side-by-side outcome comparison.
 *
 * Honesty (what is real on this page): the pipeline, payload and flow are the lesson and never
 * change. A Run is real only in Live mode, where the BFF pushes the payload to PingOne's PAR
 * endpoint and shows the request_uri PingOne returns. PingOne stores that request without checking
 * the amount (routes/intentBinding.js): the $100 cap check is this app's own. With Live mode off,
 * a Run calls the local RAR simulator and makes no PAR push. The banner and the note under the flow
 * name the engine that is actually selected.
 *
 * Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
 * docs/ping-ui-primitives.md): P2 banner, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
 * P9 "exactly one primary per view", decided per state:
 *   - nothing run yet: "Run" in Within the grant (the lesson starts with the allowed request);
 *   - Within the grant has a result, Drifts past the grant has none: "Run" in Drifts past the grant;
 *   - both have a result: "Run" in Within the grant again (start over);
 *   - a Run came back 401: no Run is primary, the sign-in strip's Sign in button is the one action.
 * Everything else (Prev/Play/Next, frame chips, Back to Dashboard) is a secondary. A Run that is in
 * flight takes aria-disabled, not disabled, so keyboard focus stays on it.
 */
const PAR_CAP = 100;
const PAR_PAYLOAD = { type: "banking_transaction", tool: "create_transfer", amount: PAR_CAP, payee: "acme-utilities" };

const PIPELINE_STEPS = [
  { num: 1, title: "Declare intent", detail: "Customer authorizes: pay Acme Utilities, up to $100." },
  { num: 2, title: "Push to PAR endpoint", detail: "Authorization details pre-submitted to PingOne via RFC 9126." },
  { num: 3, title: "Receive request_uri", detail: "PingOne returns a reference URI for this authorization context." },
  { num: 4, title: "Token exchange with request_uri", detail: "Agent uses request_uri in token exchange; the requested amount is checked against the declared cap." },
];

function useColumnRun(action, defaultAmount) {
  const [amount, setAmount] = useState(defaultAmount);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  // What this result was run with. The reel and the result chips read it, so editing the amount or flipping
  // Live mode afterwards cannot rewrite what was actually sent.
  const [ran, setRan] = useState(null);
  const [error, setError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const run = async (live) => {
    if (loading) return; // aria-disabled keeps focus on the button; the click is ignored
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    setResult(null);
    setRan(null);
    try {
      const res = await fetch("/api/demo/intent-binding/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestedAmount: Number(amount), live }),
      });
      const data = await res.json();
      if (res.status === 401) {
        // The page is declared `public` in auth-requirements.json and renders for
        // everyone, but /api/demo/intent-binding/run is behind the bearer gate, so
        // a signed-out visitor can press Run and get "authentication_required".
        // Standing rule: show the page and ASK — never surface a raw 401.
        setNeedsAuth(true);
      } else if (!res.ok) {
        setError(data.reason || data.error || "Request failed");
      } else {
        setResult(data);
        setRan({ amount: Number(amount), live });
        // Hand the run to the live trace so the dashboard's sequence view draws
        // it: the PAR push and request_uri on a live run, the intent check on
        // either. Display-only — never break the page over it.
        try {
          tokenChainTraceStore.beginTrace({ prompt: `Intent binding: ${action} $${Number(amount)}${live ? " (live PAR)" : ""}` });
          tokenChainTraceStore.ingestTokenEvents(Array.isArray(data.tokenChainEvents) ? data.tokenChainEvents : []);
          tokenChainTraceStore.completeTrace(data.status === 200);
        } catch (_) { /* display-only */ }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { amount, setAmount, loading, result, ran, error, needsAuth, run };
}

const REEL_FRAME_MS = 1400;

/**
 * One frame per hop of the exchange this run actually made. A live run replays
 * the real PAR push the BFF performed (parRequest/parResponse); a simulated run
 * never touches PingOne, so it replays the call this page itself made.
 */
export function buildReelFrames(result, sentBody) {
  if (!result) return [];
  const permit = result.status === 200;
  if (!result.parRequest) {
    return [
      {
        chip: "Request",
        side: "request",
        title: "Request — POST /api/demo/intent-binding/run",
        caption: "Simulated mode — the decision is made by the local engine, no PAR push to PingOne.",
        body: sentBody,
      },
      {
        chip: "Response",
        side: permit ? "permit" : "deny",
        title: `Response — HTTP ${result.status}`,
        caption: result.reason || "",
        body: result,
      },
    ];
  }
  const failed = Boolean(result.parResponse && result.parResponse.error);
  return [
    {
      chip: "Request",
      side: "request",
      title: `Request — POST ${result.parRequest.url}`,
      caption: "Authorization details pushed to PingOne (PAR, RFC 9126 + RAR, RFC 9396).",
      body: result.parRequest,
    },
    {
      chip: "Response",
      side: failed ? "deny" : "response",
      title: failed ? "Response — PAR push rejected" : "Response — request_uri issued",
      caption: failed
        ? "PingOne refused the pushed request; nothing was bound."
        : "PingOne stored the request and returned a reference to it. The amount is not checked here.",
      body: result.parResponse,
    },
    {
      chip: "Decision",
      side: permit ? "permit" : "deny",
      title: permit ? "Decision — PERMIT" : `Decision — DENY (${result.errorCode})`,
      caption: result.reason || "",
      body: { status: result.status, errorCode: result.errorCode, requestUri: result.requestUri },
    },
  ];
}

const FLOW_STEPS = [
  { key: "user", tone: "info", title: "User declares", sub: "Intent: $100" },
  { key: "par", tone: "neutral", title: "Push to PAR endpoint", sub: "(auth payload)" },
  { key: "uri", tone: "neutral", title: "Receive request_uri", sub: "(reference ID)" },
  { key: "exchange", tone: "ok", title: "Token exchange with request_uri", sub: "(via Agent Gateway)" },
  { key: "decide", tone: "warn", title: "Amount check", sub: "Compares the amount to the declared cap → PERMIT / DENY" },
];

export default function IntentBindingLearningPage() {
  // Default ON: the real PAR push to PingOne is the intended demo path. Off uses the local RAR simulator
  // and makes no call to PingOne PAR (routes/intentBinding.js). The banner and notes follow this flag.
  const [live, setLive] = useState(true);
  const navigate = useNavigate();
  const permitCol = useColumnRun("permit", 80);
  const driftCol = useColumnRun("drift", 500);
  const edu = useEducationUIOptional();

  // P9 primary, one per state (see the header comment). A 401 hands the one action to the sign-in strip.
  const signInOffered = permitCol.needsAuth || driftCol.needsAuth;
  const permitDone = Boolean(permitCol.result);
  const driftDone = Boolean(driftCol.result);
  let nextKind = null;
  if (!signInOffered) nextKind = permitDone && !driftDone ? "drift" : "permit";

  return (
    <PingPage className="intent-binding-page">
      <SimBanner data-testid="ib-banner">
        {live ? (
          <>
            <strong>LIVE PAR</strong> — Run pushes the authorization details to PingOne&apos;s real PAR endpoint and
            shows the request_uri PingOne returns. PingOne stores the request without checking the amount; the
            ${PAR_CAP} cap check is made by this app&apos;s backend, not by PingOne. Run needs a signed-in session and
            the AI Agent Actor credentials; without them it reports the error and decides nothing. The pipeline
            and flow below are the lesson, not a recording.
          </>
        ) : (
          <>
            <strong>SIMULATED</strong> — Live mode is off. Run calls this app&apos;s local RAR simulator: no PAR push is
            made, PingOne issues no request_uri, and the simulator decides PERMIT or DENY from the amount and
            the ${PAR_CAP} cap. Run needs a signed-in session. The pipeline and flow below are the lesson, not a
            recording.
          </>
        )}
      </SimBanner>
      <PageHeader className="ib-header-band" back={{ to: "/dashboard", label: "Back to Dashboard" }} eyebrow="Learning · Intent Binding" title="Watch an agent's intent get checked, step by step" summary="Every transfer an agent makes runs this pipeline. In Live mode the same authorization payload is pushed to PingOne via PAR (RFC 9126), then referenced below in two requests — one within the agent's declared authority, one past it." />

      <PageFrame>
        <Section
          id="ib-pipeline-h"
          kicker="1 · The pipeline"
          title="Four steps from intent to decision"
          lede="The pipeline every agent transfer follows. This is the lesson: each Run below exercises it for one request."
        >
          <div className="pu-card-grid ib-pipeline">
            {PIPELINE_STEPS.map((step) => (
              <Card key={step.num} title={`Step ${step.num} · ${step.title}`} className="ib-step" data-testid={`ib-step-${step.num}`}>
                <p className="pu-note">{step.detail}</p>
              </Card>
            ))}
          </div>
          <div id="par">
            <Card tone="neutral" title="RAR authorization_details (RFC 9396), pushed via PAR (RFC 9126)" data-testid="ib-grant">
              <pre className="ib-grant-json">{JSON.stringify(PAR_PAYLOAD, null, 2)}</pre>
            </Card>
          </div>
        </Section>

        <div id="rar">
          <Section
            id="ib-flow-h"
            kicker="2 · The flow"
            title="PAR + RAR flow through the system"
            lede="Five hops, left to right. In a Run, the last hop is made by the engine named in the banner."
          >
            <Card tone="neutral" data-testid="ib-flow">
              <ol className="ib-flow" aria-label="PAR + RAR flow">
                {FLOW_STEPS.map((hop) => (
                  <li key={hop.key} className={`ib-flow-box ib-flow-box--${hop.tone}`}>
                    <strong>{hop.title}</strong>
                    <span>{hop.sub}</span>
                  </li>
                ))}
              </ol>
              <p className="pu-note" data-testid="ib-flow-note">
                {live
                  ? "In Live runs the amount check is made by this app's backend; the PAR push to PingOne does not check the amount."
                  : "In Simulated runs the amount check is made by the local simulator; nothing is pushed to PingOne."}
              </p>
            </Card>
          </Section>

          <Section
            id="ib-run-h"
            kicker="3 · Try it"
            title="One grant, two requests"
            lede="Run each request and compare the outcomes. The reel replays the exchange for the run you just made."
          >
            <Card tone={live ? "live" : "neutral"} title="How the decision is made" data-testid="ib-mode">
              <p className="pu-status-line">
                <StatusChip tone={live ? "info" : "neutral"}>{live ? "Live" : "Simulated"}</StatusChip>
                {live
                  ? "Run pushes the authorization details to PingOne's PAR endpoint."
                  : "Run uses the local simulator and makes no call to PingOne PAR."}
              </p>
              <label className="ib-live-toggle">
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} data-testid="ib-live-toggle" />
                Live mode — push the authorization details to PingOne&apos;s PAR endpoint instead of using the simulator
              </label>
            </Card>
            <div className="pu-card-grid ib-split">
              <IntentBindingColumn
                kind="permit"
                title="Within the grant"
                expected="permit"
                col={permitCol}
                live={live}
                isNext={nextKind === "permit"}
              />
              <IntentBindingColumn
                kind="drift"
                title="Drifts past the grant"
                expected="deny"
                col={driftCol}
                live={live}
                isNext={nextKind === "drift"}
              />
            </div>
          </Section>
        </div>

        <p className="pu-note ib-edu-link">
          PAR (RFC 9126) is how the request travels; RAR (RFC 9396) is what it means. See the{" "}
          <button type="button" className="ib-link-btn" onClick={() => edu && edu.open(EDU.PAR, "what")}>
            PAR education panel
          </button>{" "}or the{" "}
          <button type="button" className="ib-link-btn" onClick={() => edu && edu.open(EDU.RAR, "what")}>
            RAR education panel
          </button>.
        </p>

        <div className="pu-actions">
          <button type="button" className="pu-btn" onClick={() => navigate("/dashboard")} data-testid="ib-back-bottom">
            Back to Dashboard
          </button>
        </div>
      </PageFrame>
    </PingPage>
  );
}

function RunReel({ kind, result, action, amount, live }) {
  const frames = React.useMemo(
    () => buildReelFrames(result, { action, requestedAmount: Number(amount), live }),
    [result, action, amount, live],
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = frames.length - 1;

  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [frames]);

  useEffect(() => {
    if (!playing || index >= last) {
      if (playing && index >= last) setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setIndex((n) => n + 1), REEL_FRAME_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);

  if (!frames.length) return null;
  const frame = frames[index];
  // Prev and Next are aria-disabled at the ends, not disabled: pressing Next on the last frame from the keyboard
  // must not drop focus to the page body.
  const atStart = index === 0;
  const atEnd = index === last;

  return (
    <div className="ib-reel" data-testid={`ib-reel-${kind}`}>
      <div className="ib-reel-head">
        <strong>Reel</strong>
        <span className="ib-reel-count">
          {index + 1} / {frames.length}
        </span>
        <div className="ib-reel-ctrls">
          <button
            type="button"
            className="pu-btn"
            aria-disabled={atStart ? "true" : undefined}
            onClick={() => { if (atStart) return; setPlaying(false); setIndex((n) => Math.max(0, n - 1)); }}
          >
            Prev
          </button>
          <button
            type="button"
            className="pu-btn"
            onClick={() => {
              if (index >= last) { setIndex(0); setPlaying(true); } else { setPlaying((p) => !p); }
            }}
          >
            {index >= last ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="pu-btn"
            aria-disabled={atEnd ? "true" : undefined}
            onClick={() => { if (atEnd) return; setPlaying(false); setIndex((n) => Math.min(last, n + 1)); }}
          >
            Next
          </button>
        </div>
      </div>
      <ol className="ib-reel-strip">
        {frames.map((f, n) => (
          <li key={f.chip}>
            <button
              type="button"
              aria-label={`Frame ${n + 1}: ${f.chip}`}
              aria-current={n === index}
              className={n === index ? "pu-btn is-active" : "pu-btn"}
              onClick={() => { setPlaying(false); setIndex(n); }}
            >
              {f.chip}
            </button>
          </li>
        ))}
      </ol>
      {/* Announced when the visitor steps the reel, silent while it auto-plays (a frame every 1.4 s would be noise). */}
      <div
        className={`ib-reel-frame ib-reel-frame--${frame.side}`}
        role="group"
        aria-label="Reel frame"
        aria-live={playing ? "off" : "polite"}
      >
        <div className="ib-reel-title">{frame.title}</div>
        {frame.caption ? <p className="ib-reel-caption">{frame.caption}</p> : null}
        <pre className="ib-reel-json">{JSON.stringify(frame.body, null, 2)}</pre>
      </div>
    </div>
  );
}

/** Words for the run's result chips. The engine word comes from what the server says the run used, never from the toggle. */
function runEngine(result) {
  return result.live === true
    ? { tone: "info", word: "Live PAR push" }
    : { tone: "neutral", word: "Simulated" };
}

function IntentBindingColumn({ kind, title, expected, col, live, isNext }) {
  const amount = Number(col.amount);
  const within = amount <= PAR_CAP;
  const permit = col.result && col.result.status === 200;
  const run = () => col.run(live);
  return (
    <Card
      tone={kind === "permit" ? "ok" : "danger"}
      className={`ib-col ib-col--${kind}`}
      data-testid={`ib-col-${kind}`}
    >
      <div className="ib-col-head">
        <h3 className="pu-h3">{title}</h3>
        <StatusChip tone={kind === "permit" ? "ok" : "danger"}>{`Expected: ${expected}`}</StatusChip>
      </div>
      <KvList items={[{ label: "Requested", value: `$${col.amount}` }]} />
      <p className="ib-rationale">
        {within
          ? `$${col.amount} is within the $${PAR_CAP} cap. Steps 3-4 complete and the request matches the declared intent.`
          : `$${col.amount} exceeds the $${PAR_CAP} cap. Step 4 stops the chain — the transfer never reaches the account.`}
      </p>
      <div className="ib-controls">
        <label className="ib-amount-field">
          <span className="pu-label">Amount</span>
          <input
            className="pu-select ib-amount-input"
            type="number"
            value={col.amount}
            onChange={(e) => col.setAmount(e.target.value)}
            min={1}
          />
        </label>
        <button
          type="button"
          className={isNext ? "pu-btn pu-btn--primary" : "pu-btn"}
          aria-label={`Run ${kind}`}
          aria-disabled={col.loading ? "true" : undefined}
          onClick={run}
          data-testid={`ib-run-${kind}`}
        >
          {col.loading ? "Running…" : "Run"}
        </button>
      </div>
      {col.needsAuth ? (
        <SignInPrompt
          variant="strip"
          message={live
            ? "Running the live decision needs a signed-in session — the PAR push is made on your behalf."
            : "Running the simulated decision needs a signed-in session."}
        />
      ) : null}
      {/* One persistent live region per column: a run's outcome is announced where focus already is (the Run button). */}
      <div className="ib-result" role="status" data-testid={`ib-result-${kind}`}>
        {col.loading ? <p className="pu-status-line"><StatusChip>Running</StatusChip>Waiting for the decision.</p> : null}
        {col.error ? (
          <div className="ib-status ib-status--error">
            <p className="pu-status-line"><StatusChip tone="danger">Error</StatusChip>{col.error}</p>
          </div>
        ) : null}
        {col.result ? (
          <div className={`ib-status ib-status--${permit ? "permit" : "deny"}`}>
            <p className="pu-status-line">
              <StatusChip tone={permit ? "ok" : "danger"}>{permit ? "PERMIT" : `DENY (${col.result.errorCode})`}</StatusChip>
              <StatusChip tone={runEngine(col.result).tone}>{runEngine(col.result).word}</StatusChip>
            </p>
            <ul>
              {(col.result.tokenChainEvents || []).map((ev) => (
                <li key={ev.id}>
                  <strong>{ev.label}</strong> — {ev.status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {col.result && col.ran ? (
        <RunReel kind={kind} result={col.result} action={kind} amount={col.ran.amount} live={col.ran.live} />
      ) : null}
    </Card>
  );
}
