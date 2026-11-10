import { useContext, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import OboEvidenceCard from "../components/obo/OboEvidenceCard";
import useOboLive from "../components/obo/useOboLive";
import OboStepWire from "../components/obo/OboStepWire";
import { VerticalContext } from "../vertical/VerticalProvider";
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import "./OboDemoPage.css";

// On-behalf-of demo. The BFF runs RFC 8693 delegation for the signed-in user and returns, for this
// in-app run only, a step trace with token-free facts plus (when it captured them) the real
// request/response and the caller's own raw tokens, which this page renders; client secrets arrive
// already masked. Layout follows /privilege-a2a: the run and, under it, the step details on the left, the trace on
// the right, so a click on a trace line changes the details right beside it (on a phone the cards stack and the page
// brings the details into view without moving keyboard focus).
//
// Honesty: nothing on this page is simulated. "Run the delegation" is a real RFC 8693 exchange at PingOne for the
// signed-in session; there is no mock mode (an environment without the demo configured answers 503 and the page shows
// that error, it never fakes a trace). "Live from Claude" shows only calls Claude Code really made to this app's MCP
// endpoint. useOboLive exposes events only (no connection state), so the page never claims the stream is connected.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// P9 "one primary per view": "Run the delegation" is the primary in EVERY state (idle, running, verified, not
// verified, failed, error, after Reset). While a run is in flight it takes aria-disabled (not disabled) so keyboard
// focus stays on it. Reset is always a secondary; when there is nothing to clear it is aria-disabled too, with the
// reason shown. `embedded` is the Personal Agent Studio "Delegation proof" tab: the studio already owns the page
// title and the page scroll, so the title band is left out and the page's own 100vh floor is lifted (CSS); everything
// else, including the banner and the one primary, is the same. The seven trace lines are selectors, not actions; they are page-styled rows, never primaries.
const SHORT = (sha) => (sha ? `sha256 ${String(sha).slice(0, 8)} (hash only)` : "-");
const AUD = (aud) => [].concat(aud || []).join(", ") || "-";
const SCOPES = (s) => (s ? `${s.count} scope${s.count === 1 ? "" : "s"}${s.sample?.length ? ` (${s.sample.join(" ")}${s.count > s.sample.length ? " …" : ""})` : ""}` : "-");
const MINUTES = (m) => (m == null ? "-" : `${m} min`);

const STEPS = {
  1: { title: "You are signed in", route: "browser → BFF session",
    why: "Your session holds a PingOne access token. The BFF reads it server-side and uses it as the subject of the exchange. It is shown here because it is your own token; over MCP the model never receives it.",
    rows: (f) => [["sub", f.sub], ["client_id", f.client_id], ["aud", AUD(f.aud)], ["scope", SCOPES(f.scope)], ["expires in", MINUTES(f.expiresInMin)], ["token", SHORT(f.sha)]] },
  2: { title: "Agent gets its own identity", route: "BFF → PingOne /as/token (client credentials)",
    why: "The AI Agent app proves who the agent is with its own credentials. This becomes the actor in the exchange.",
    rows: (f) => [["grant_type", "client_credentials"], ["client_id", f.client_id], ["scope", f.scope], ["actor token", SHORT(f.sha)], ["expires in", MINUTES(f.expiresInMin)]] },
  3: { title: "Token exchange (RFC 8693)", route: "BFF → PingOne /as/token",
    why: "The Token Exchanger app trades your token plus the agent token for one delegated token.",
    rows: (f) => [["grant_type", f.grant_type], ["subject_token", `your token · ${SHORT(f.subjectSha)}`], ["actor_token", `agent token · ${SHORT(f.actorSha)}`], ["audience", f.audience], ["scope", f.scope], ["authenticated as", `Token Exchanger · ${f.exchanger}`]] },
  4: { title: "Delegated token: what changed", route: "PingOne → BFF",
    why: "Your identity is kept, the agent is recorded as the actor, and the audience and scope are narrowed." },
  5: { title: "Downstream accepts the delegated token", route: "BFF → downstream API",
    why: "The downstream API only accepts a token with the right audience and an act claim.",
    rows: (f) => [["request", "GET /api/obo/downstream"], ["Authorization", "delegated token"], ["response", `${f.status}`]] },
  6: { title: "Downstream refuses your own token", route: "BFF → downstream API",
    why: "The same call with your original token is refused: only the delegated token carries the agent.",
    rows: (f) => [["request", "GET /api/obo/downstream"], ["Authorization", "your token"], ["response", `${f.status}`]] },
  7: { title: "No token reached the model", route: "BFF → MCP result / live event",
    why: "The MCP result text and the Claude live event are scanned for token text. This page shows tokens because you are the signed-in user who ran the exchange; the model never receives them.",
    rows: (f) => [["scanned", "MCP result text and live event evidence"], ["token patterns found", f.leak ? "yes" : "0"]] },
};
const STEP_IDS = [1, 2, 3, 4, 5, 6, 7];
// Who refused a failed hop, from the step itself (steps 2-3 are PingOne's token endpoint, 5-6 the downstream API).
const REFUSER = { 2: "PingOne refused this step.", 3: "PingOne refused this step.", 5: "The downstream API refused this step.", 6: "The downstream API refused this step." };
// The word each trace line shows (P7: a chip always carries its word) and the chip tone for it.
const LABEL = { idle: "not run", run: "running", pass: "ok", fail: "failed", skip: "skipped" };
const TONE = { idle: "neutral", run: "info", pass: "ok", fail: "danger", skip: "neutral" };

function Table({ rows }) {
  return <KvList items={rows.map(([k, v]) => ({ label: k, value: v == null ? "-" : String(v), mono: true }))} />;
}

export default function OboDemoPage({ embedded = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { ok, steps, checks, failedStep, error }
  const [selected, setSelected] = useState(null);
  // A short announcement for a trace line the person picked (the details card itself is not a live region).
  const [picked, setPicked] = useState("");
  const detailsRef = useRef(null);
  // Reset hides the live calls already on screen. Matching on the event's own identity (not a clock
  // comparison) so a reconnect that replays the hub buffer cannot bring them back.
  const [dismissed, setDismissed] = useState(() => new Set());
  const runSeq = useRef(0);
  const liveAll = useOboLive(true);
  const liveKey = (e) => `${e.ts}|${e.delegated?.sha}`;
  const live = liveAll.filter((e) => !dismissed.has(liveKey(e)));
  const lastDate = live[0]?.ts ? new Date(live[0].ts) : null;
  const canReset = busy || Boolean(result) || Boolean(error) || live.length > 0;
  const lastCall = lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate.toLocaleTimeString() : null;

  function reset() {
    if (!canReset) return; // aria-disabled keeps focus on the button; the click is ignored
    runSeq.current += 1; // a response still in flight belongs to the page being cleared
    setBusy(false);
    setError("");
    setResult(null);
    setSelected(null);
    setPicked("");
    setDismissed(new Set(liveAll.map(liveKey)));
  }

  // A different vertical is a different demo: start the page over.
  const verticalId = useContext(VerticalContext)?.activeId ?? null;
  const lastVertical = useRef(verticalId);
  useEffect(() => {
    if (lastVertical.current === verticalId) return;
    lastVertical.current = verticalId;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticalId]);

  async function run() {
    if (busy) return; // aria-disabled keeps focus on the button; the click is ignored
    const seq = ++runSeq.current;
    setBusy(true);
    setError("");
    setResult(null);
    setSelected(null);
    setPicked("");
    try {
      const response = await apiClient.post("/api/obo/run");
      if (seq !== runSeq.current) return;
      setResult({ ok: true, steps: response.data.steps || [], checks: response.data.checks || [] });
      setSelected(4);
    } catch (err) {
      if (seq !== runSeq.current) return;
      const data = err?.response?.data || {};
      if (Array.isArray(data.steps)) {
        setResult({ ok: false, steps: data.steps, checks: [], failedStep: data.failedStep, error: data.error });
        setSelected(data.failedStep || null);
      } else {
        setError(data.message || data.error || "The OBO run failed.");
      }
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }

  const byId = Object.fromEntries((result?.steps || []).map((s) => [s.id, s]));
  const statusOf = (id) => (busy ? "run" : byId[id]?.status || "idle");
  const totalMs = (result?.steps || []).reduce((sum, s) => sum + (s.ms || 0), 0);
  const passed = (result?.checks || []).filter((c) => c.pass).length;
  const checkCount = result?.checks?.length || 0;
  const who = result?.ok ? {
    sub: byId[1]?.facts?.sub, agent: byId[2]?.facts?.client_id, exchanger: byId[3]?.facts?.exchanger, target: `${byId[3]?.facts?.audience} · scope ${byId[3]?.facts?.scope}`,
  } : null;

  // One status for the run, always mounted so a screen reader hears the change. Green only where the page itself
  // counted the checks the BFF returned; a failed or errored run is a neutral-to-red "Failed", never "requested".
  let status;
  let cardTone;
  if (busy) status = { tone: "neutral", word: "Running", text: "Running the exchange…" };
  else if (result?.ok && checkCount > 0 && passed === checkCount) {
    status = { tone: "ok", word: "Verified", text: `Delegation verified: ${passed} of ${checkCount} checks passed. Done in ${(totalMs / 1000).toFixed(1)} s` };
    cardTone = "ok";
  } else if (result?.ok && checkCount > 0) {
    status = { tone: "danger", word: "Not verified", text: `Delegation not verified: ${passed} of ${checkCount} checks passed. Done in ${(totalMs / 1000).toFixed(1)} s` };
    cardTone = "danger";
  } else if (result?.ok) status = { tone: "neutral", word: "No checks", text: `The run returned no checks to count. Done in ${(totalMs / 1000).toFixed(1)} s` };
  else if (result) {
    status = { tone: "danger", word: "Failed", text: `The exchange failed${result.failedStep ? ` at step ${result.failedStep}` : ""}` };
    cardTone = "danger";
  } else if (error) {
    status = { tone: "danger", word: "Failed", text: "The run did not complete." };
    cardTone = "danger";
  } else status = { tone: "neutral", word: "Not run", text: "Not run yet" };

  function pick(id) {
    setSelected(id);
    setPicked(`Showing step ${id}: ${STEPS[id].title}`);
    // Bring the details into view if they are off screen (phone widths); never moves focus.
    detailsRef.current?.scrollIntoView?.({ block: "nearest" });
  }

  function renderDetails() {
    if (!selected) return <p className="pu-note pu-empty">Select a line in the trace to see what happened at that step.</p>;
    const info = STEPS[selected];
    const step = byId[selected];
    const st = statusOf(selected);
    let body;
    if (st === "run") body = <p className="pu-note pu-empty">The run is in progress.</p>;
    else if (!step || st === "idle") body = <p className="pu-note pu-empty">This step has not run yet. Press “Run the delegation”.</p>;
    else if (st === "skip") body = <p className="pu-note pu-empty">Skipped because step {result.failedStep} failed.</p>;
    else if (st === "fail" && step.facts?.error) {
      body = (
        <>
          <div className="obo-demo__why"><StatusChip tone="danger">Refused</StatusChip> <b>Why it failed.</b> {REFUSER[selected] || "This step failed."}{selected === 3 && /subject_token/.test(step.facts.description || "") ? " It did not accept the signed-in token as the input to the exchange: the token may be expired, or its client may not be trusted by the tenant's exchange policy. Sign in again and retry." : ""}</div>
          <Table rows={[["error", step.facts.error], ["description", step.facts.description], ["http status", step.facts.httpStatus]]} />
        </>
      );
    } else if (selected === 4) body = <><p className="pu-note">{info.why}</p><DeltaTable facts={step.facts} /></>;
    else body = <><p className="pu-note">{info.why}</p><Table rows={info.rows(step.facts)} /></>;
    return (
      <>
        <h4 className="pu-h3">{selected}. {info.title}</h4>
        <p className="pu-note pu-mono">{info.route}{st === "pass" && step?.ms ? ` · ${step.ms} ms` : ""}</p>
        {body}
        {step && st !== "idle" && st !== "skip" && st !== "run" ? <OboStepWire step={step} /> : null}
      </>
    );
  }

  return (
    <PingPage className={`obo-demo${embedded ? " obo-demo--embedded" : ""}`}>
      <SimBanner data-testid="obo-banner">
        <strong>REAL EXCHANGE</strong> — nothing on this page is simulated. &quot;Run the delegation&quot; makes a real
        RFC 8693 token exchange at PingOne for your signed-in session, and every line of the trace is what PingOne and the
        downstream API actually answered. There is no mock mode: if this environment is not set up for the demo the run
        stops with an error instead of showing made-up results. Tokens appear here because they are yours; over MCP the model
        never receives them. &quot;Live from Claude&quot; lists only calls Claude Code really made to this app&apos;s MCP endpoint.
      </SimBanner>
      {embedded ? null : (
        <PageHeader
          eyebrow="Security · Delegation"
          title="Personal Agent User delegation (OBO)"
          summary="Watch an agent act for you: seven hops from your session to a delegated token, each with its real request and response."
        />
      )}
      <PageFrame>
        <Section
          id="obo-run-h"
          kicker="1 · Run it"
          title="Run the delegation"
          lede={(
            <>
              An agent acts for you through RFC 8693 delegation. The exchange keeps your identity (<code>sub</code>),
              records the agent as <code>act</code>, and issues a token the downstream API accepts. Your own token is
              refused there. Over MCP the model never sees either token; this page shows them so you can follow each hop.{" "}
              <a href="/architecture/obo-flow.html" target="_blank" rel="noopener noreferrer">View the flow diagram (opens in a new tab)</a>
            </>
          )}
        >
          <CardGrid>
            <div className="obo-demo__col">
            <Card title="Run" tone={cardTone} data-testid="obo-run-card">
              {who ? (
                <KvList
                  items={[
                    { label: "Signed in as", value: who.sub, mono: true },
                    { label: "Agent (actor)", value: who.agent, mono: true },
                    { label: "Exchanger", value: who.exchanger, mono: true },
                    { label: "Target", value: who.target, mono: true },
                  ]}
                />
              ) : null}
              <div className="pu-actions">
                <button type="button" className="pu-btn pu-btn--primary" aria-disabled={busy ? "true" : undefined} onClick={run} data-testid="obo-run">
                  Run the delegation
                </button>
                <button type="button" className="pu-btn" aria-disabled={canReset ? undefined : "true"} onClick={reset}
                  aria-describedby={canReset ? undefined : "obo-reset-why"}>
                  Reset
                </button>
              </div>
              {canReset ? null : <p id="obo-reset-why" className="pu-note">Reset is available after a run or a live call.</p>}
              <div className="pu-status-line obo-demo__status" role="status" data-testid="obo-status">
                <StatusChip tone={status.tone}>{status.word}</StatusChip>
                <span>{status.text}</span>
              </div>
              {error ? <p role="alert" className="obo-demo__error">{error}</p> : null}
              {result?.checks?.length ? (
                <ul className="obo-demo__checks" aria-label="Delegation checks">
                  {result.checks.map((check) => (
                    <li key={check.id}><StatusChip tone={check.pass ? "ok" : "danger"}>{check.pass ? "PASS" : "FAIL"}</StatusChip><span>{check.label}</span></li>
                  ))}
                </ul>
              ) : null}
            </Card>
            <Card title="Step details" tone="neutral" data-testid="obo-details">
              <p role="status" className="obo-demo__sr" data-testid="obo-picked">{picked}</p>
              <div ref={detailsRef}>{renderDetails()}</div>
            </Card>
            </div>
            <Card title="Trace" tone="neutral" data-testid="obo-trace-card">
              <ol className="obo-demo__trace" aria-label="Delegation trace">
                {STEP_IDS.map((id) => {
                  const st = statusOf(id);
                  const ms = byId[id]?.ms;
                  return (
                    <li key={id}>
                      <button type="button" className="obo-demo__line" aria-current={selected === id ? "true" : undefined} onClick={() => pick(id)}>
                        <span className="obo-demo__num">{id}</span>
                        <span><span className="obo-demo__line-title">{STEPS[id].title}</span><span className="obo-demo__line-route">{STEPS[id].route}</span></span>
                        <span className="obo-demo__meta"><StatusChip tone={TONE[st]}>{LABEL[st]}</StatusChip>{st === "pass" && ms ? `${ms} ms` : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="pu-note">Each line is one hop. Select a line to see the real request, the real response and the tokens. Client secrets are always masked.</p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="obo-claude-h" kicker="2 · Or from Claude Code" title="Run it from Claude Code">
          <Card tone="neutral">
            <p className="pu-note">Same delegation, with Claude as the OAuth client. Claude sees claims and status codes, never a token.</p>
            <ol className="obo-demo__steps">
              <li>Register the endpoint once:
                <pre className="obo-demo__code">{`claude mcp add --transport http obo-demo ${window.location.origin}/api/obo/mcp \\
  --client-id c8392dc4-2d82-4e49-92a8-79a78401faf5 --callback-port 7465`}</pre></li>
              <li>In <code>claude</code>, run <code>/permissions</code> and allow <code>mcp__obo-demo__act_on_my_behalf</code>. Without it the auto-mode classifier blocks the call.</li>
              <li>Run <code>/mcp</code>, choose <code>obo-demo</code> and sign in to PingOne as the demo user.</li>
              <li>Prompt: <pre className="obo-demo__code">Call the act_on_my_behalf tool and show me its result.</pre></li>
              <li>Expect <code>acting_for</code> (the user), <code>acted_by</code> (the agent client_id), <code>downstream</code> delegated 200 and own token 401, and seven checks all <code>pass: true</code>.</li>
            </ol>
          </Card>
        </Section>

        <Section id="obo-live-h" kicker="3 · What Claude did" title="Live from Claude">
          <Card tone={live.length ? "live" : "neutral"} data-testid="obo-live">
            <p className="pu-status-line" role="status" data-testid="obo-live-status">
              <StatusChip tone={live.length ? "info" : "neutral"}>{live.length ? "Received" : "Waiting"}</StatusChip>
              <span>{live.length ? (lastCall ? `Last call at ${lastCall}` : "A call arrived; its time is unknown.") : "Waiting for Claude to call the tool…"}</span>
            </p>
            {live.length ? <OboEvidenceCard evidence={live[0]} checksLabel="Live delegation checks" /> : null}
          </Card>
        </Section>

        <p className="pu-note">
          Limits: the BFF, which is the MCP server here, briefly holds your token to run the exchange, so
          &quot;the agent&quot; means the model. Live events work with a single BFF replica.
        </p>
      </PageFrame>
    </PingPage>
  );
}

// Below the page so the pattern check reads the banner (P2) before any markup of its own.
function DeltaTable({ facts }) {
  const i = facts.inbound || {};
  const d = facts.delegated || {};
  const rows = [
    ["sub", facts.subSame ? "same" : "differs", d.sub, facts.subSame],
    ["aud", AUD(i.aud), AUD(d.aud)],
    ["scope", SCOPES(i.scope), d.scope],
    ["act", "(none)", d.act ? JSON.stringify(d.act) : "(none)"],
    ["token", SHORT(i.sha), SHORT(d.sha)],
  ];
  return (
    <table className="obo-demo__table">
      <thead><tr><th scope="col">Claim</th><th scope="col">Your token</th><th scope="col">Delegated</th></tr></thead>
      <tbody>{rows.map(([k, before, after, same]) => (
        <tr key={k}><th scope="row">{k}</th><td>{k === "sub" ? d.sub : before}</td><td className={k === "sub" ? (same ? "obo-demo__good" : "obo-demo__bad") : "obo-demo__diff"}>{k === "sub" ? (same ? `${after} (same)` : after) : after}</td></tr>
      ))}</tbody>
    </table>
  );
}
