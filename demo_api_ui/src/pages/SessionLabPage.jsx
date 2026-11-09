// /session-lab: a REAL half and a SIMULATED half, kept apart.
//
// Real (read-only): the BFF's own session (GET /api/auth/oauth/user/status) and the claims in the tokens it
// holds (GET /api/auth/oauth/user/token-claims). The page needs a signed-in session; the route shows the
// sign-in prompt when there is none, and if the session ends while the page is open the real section says so.
// Simulated: a pretend PingOne session and clock in this browser tab, driven by config/sessionLabModel.js. It
// never calls PingOne. The PingOne cookie lives on the PingOne host, so this page cannot show it.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// P9 "one primary per view", decided per state of the simulated session:
//   - no session (start, after Reset, after Delete session): "Sign in with password", the step that creates one;
//   - a session exists (live or idle-expired): "Check", the step that reads it.
// Every other button is a secondary. The primary changes class on the same element, so focus is never dropped.

import { useEffect, useId, useReducer, useState } from "react";
import apiClient from "../services/apiClient";
import PageHeader from "../components/common/PageHeader";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import { SESSION_LAB_DIAGRAM } from "../config/sessionLabDiagram";
import { METHODS, DEFAULT_IDLE_MIN, initial, report, revoke, advance, check, isLive } from "../config/sessionLabModel";
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import "./SessionLabPage.css";

export default function SessionLabPage() {
  const real = useRealSession();
  return (
    <PingPage className="session-lab-page">
      <SimBanner data-testid="session-lab-banner">
        <strong>{REAL_LEAD[real.phase]}</strong> — {REAL_HEAD[real.phase]} The section &quot;Change a session&quot; is simulated: a pretend
        session and clock in this browser tab, and nothing there calls PingOne. The PingOne session cookie sits on PingOne&apos;s host, so this page cannot read it.
      </SimBanner>
      <PageHeader
        eyebrow="Sessions"
        title="Session Lab"
        summary="One PingOne session holds a last sign-on time for each method. A flow's Return Success Response writes them; Check Session reads them."
      />
      <PageFrame>
        <Section id="sl-real" kicker="1 · Real" title="Your real session" lede="What this app's BFF holds for you right now, read-only.">
          <RealSession real={real} />
        </Section>
        <Section id="sl-model" kicker="2 · The model" title="How a flow and a session meet">
          <EmbeddedFlowDiagram
            config={SESSION_LAB_DIAGRAM}
            title="Where the flow writes and Check Session reads"
            lede="Return Success Response writes the session; Check Session reads it. Neither one detects methods."
            ariaLabel="PingOne session flow"
            testId="session-lab-diagram"
            pingStyle
          />
        </Section>
        <Section id="sl-mock" kicker="3 · Simulated" title="Change a session (simulated)" lede="Write a session the way a flow would, move the clock, then ask Check Session what it sees.">
          <MockLab />
        </Section>
      </PageFrame>
    </PingPage>
  );
}

const MIN = (ms) => {
  if (ms == null) return "-";
  const m = Math.round((ms - Date.now()) / 60000);
  return m < 0 ? "expired" : `${m} min from now`;
};
const WHEN = (sec) => (sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-");
const text = (v) => (v == null || v === "" ? "-" : String(v));

// What the real section knows: loading, unavailable (status request failed), signedOut, or read.
function useRealSession() {
  const [state, setState] = useState({ phase: "loading" });
  useEffect(() => {
    let live = true;
    Promise.allSettled([apiClient.get("/api/auth/oauth/user/status"), apiClient.get("/api/auth/oauth/user/token-claims")])
      .then(([st, cl]) => {
        if (!live) return;
        const status = st.status === "fulfilled" ? st.value.data : null;
        const claims = cl.status === "fulfilled" ? cl.value.data : null;
        if (!status) setState({ phase: "unavailable" });
        else if (!status.authenticated) setState({ phase: "signedOut" });
        else setState({ phase: "read", status, claims, partial: [st, cl].some((r) => r.status === "rejected") });
      });
    return () => { live = false; };
  }, []);
  return state;
}

const REAL_LEAD = {
  loading: "READING YOUR SESSION",
  read: "REAL AND SIMULATED",
  unavailable: "NO REAL SESSION READ",
  signedOut: "NO REAL SESSION READ",
};

const REAL_HEAD = {
  loading: "Reading your session from this app's BFF now.",
  read: "The first section is real: your BFF session and the claims in the tokens it holds, read just now and read-only.",
  unavailable: "The first section could not read your session (the status request failed), so it shows nothing real.",
  signedOut: "You are not signed in, so the first section has no session to show. This page needs a signed-in session.",
};

function RealSession({ real }) {
  const { phase, status, claims, partial } = real;
  let chip;
  let line;
  if (phase === "loading") { chip = ["neutral", "Reading"]; line = "Reading your session from the BFF."; }
  else if (phase === "unavailable") { chip = ["danger", "Unavailable"]; line = "Could not read your session (the status request failed)."; }
  else if (phase === "signedOut") { chip = ["warn", "Not signed in"]; line = "There is no session to show. Sign in, then reopen this page."; }
  else if (partial) { chip = ["warn", "Partly read"]; line = "One of the two requests failed, so some facts may be missing."; }
  else { chip = ["ok", "Read"]; line = "Read from the BFF just now. Nothing here is simulated."; }

  let cards = null;
  if (phase === "read") {
    const id = claims?.idToken?.payload || {};
    const at = claims?.decoded?.payload || {};
    // Say which token a value came from; never show an access-token value under an ID-token label.
    const pick = (k) => {
      if (id[k] != null) return { v: id[k], from: "ID token" };
      if (at[k] != null) return { v: at[k], from: "access token" };
      return { v: null, from: null };
    };
    const show = (k, fmt = (v) => v) => {
      const { v, from } = pick(k);
      return v == null ? (claims?.authenticated === false ? "no tokens held for this session" : "not in these tokens") : `${fmt(v)} (${from})`;
    };
    cards = (
      <CardGrid>
        <Card title="BFF session (this app's own)" tone="live" data-testid="session-lab-bff">
          <p className="pu-status-line"><StatusChip tone="info">Real</StatusChip>read-only</p>
          <KvList items={[
            { label: "provider", value: text(status.loginProvider) },
            { label: "session type", value: text(status.sessionType) },
            { label: "access token expires", value: MIN(status.expiresAt) },
            { label: "refresh token held", value: status.hasRefreshToken ? "yes" : "no" },
            { label: "cookie", value: "connect.sid: HttpOnly, 24 h, sameSite lax locally and none in production (from the server config)" },
          ]} />
        </Card>
        <Card title="Sign-on facts in your tokens" tone="live" data-testid="session-lab-claims">
          <p className="pu-status-line"><StatusChip tone="info">Real</StatusChip>read-only</p>
          <KvList items={[
            { label: "auth_time", value: show("auth_time", (v) => `${v}, ${WHEN(v)}`), mono: true },
            { label: "amr", value: show("amr", (v) => [].concat(v).join(", ")), mono: true },
            { label: "sid", value: show("sid"), mono: true },
            { label: "iat", value: show("iat", WHEN), mono: true },
            { label: "exp", value: show("exp", WHEN), mono: true },
          ]} />
        </Card>
      </CardGrid>
    );
  }

  return (
    <>
      {/* Mounted before its text changes, so the result of the read is announced. */}
      <p className="pu-status-line" role="status" data-testid="session-lab-real-status">
        <StatusChip tone={chip[0]}>{chip[1]}</StatusChip>{line}
      </p>
      {cards}
      <Card tone="neutral" title="Why not the PingOne cookie?" data-testid="session-lab-cookie-note">
        <p className="pu-note">
          The identity provider&apos;s own session cookie (PingOne or PingFederate, whichever you signed in with) is set on that provider&apos;s host. A page on this app cannot read it, so the facts in the first section come from
          this app&apos;s own session and the tokens it holds. <code>amr</code> and <code>sid</code> only appear when the provider puts them in the tokens, and whether PingOne sets <code>auth_time</code> and <code>amr</code> the
          same way on a single sign-on through an existing session is UNVERIFIED.
        </p>
      </Card>
    </>
  );
}

const reduce = (s, a) => {
  switch (a.type) {
    case "report": return report(s, a.methods, a.idleMin);
    case "advance": return advance(s, a.minutes);
    case "revoke": return revoke(s);
    default: return initial();
  }
};

function MockLab() {
  const [s, dispatch] = useReducer(reduce, undefined, initial);
  const [method, setMethod] = useState("pwd");
  const [within, setWithin] = useState("480");
  const [result, setResult] = useState(null);
  const methodId = useId();
  const withinId = useId();
  const x = s.session;
  const live = isLive(s);
  const act = (a) => { setResult(null); dispatch(a); };
  const noSession = !x;
  const sessionChip = !x ? ["neutral", "No session"] : live ? ["info", "Active"] : ["warn", "Idle timeout passed"];
  const rows = x ? [
    { label: "idle timeout", value: `${x.idleMin} min${x.idleMin === DEFAULT_IDLE_MIN ? " (default, inferred: UNVERIFIED)" : ""}` },
    { label: "idle ends at", value: `t+${x.activeAt + x.idleMin} min` },
    ...Object.entries(x.authenticators).map(([m, at]) => ({ label: `last sign-on · ${m}`, value: `t+${at} min (${s.now - at} min ago)` })),
  ] : [];
  return (
    <>
      <p className="pu-status-line" data-testid="session-lab-sim">
        <StatusChip tone="neutral">Simulated</StatusChip>Nothing here calls PingOne; the clock below is a pretend clock you advance.
      </p>
      <CardGrid>
        <Card title="Flow actions (Return Success Response)" data-testid="session-lab-actions">
          <div className="pu-actions">
            <ActionButton lead={noSession} onClick={() => act({ type: "report", methods: ["pwd"] })}>Sign in with password</ActionButton>
            <ActionButton onClick={() => act({ type: "report", methods: ["pwdless"] })}>Sign in passwordless</ActionButton>
            <ActionButton onClick={() => act({ type: "report", methods: ["mfa"] })}>Report mfa, no challenge</ActionButton>
            <ActionButton onClick={() => act({ type: "report", methods: [] })}>Report no methods</ActionButton>
            <ActionButton onClick={() => act({ type: "report", methods: ["pwd"], idleMin: 5 })}>Report pwd, idle 5 min</ActionButton>
            <ActionButton onClick={() => act({ type: "revoke" })}>Delete session</ActionButton>
          </div>
        </Card>
        <Card title="The session record (simulated)" tone="neutral" data-testid="session-lab-record">
          <p className="pu-status-line"><StatusChip tone={sessionChip[0]}>{sessionChip[1]}</StatusChip></p>
          {rows.length ? <KvList items={rows} /> : <p className="pu-note pu-empty">No session yet. Use a flow action to create one.</p>}
        </Card>
        <Card title={`Pretend clock: t+${s.now} min`} data-testid="session-lab-clock">
          <div className="pu-actions">
            {[[1, "+1 min"], [60, "+1 hour"], [540, "+9 hours"], [1440, "+1 day"]].map(([m, l]) => (
              <ActionButton key={m} onClick={() => act({ type: "advance", minutes: m })}>{l}</ActionButton>
            ))}
            <ActionButton onClick={() => act({ type: "reset" })}>Reset</ActionButton>
          </div>
        </Card>
        <Card title="Check Session (simulated)" data-testid="session-lab-check">
          <div className="session-lab-page__form">
            <div>
              <label className="pu-label" htmlFor={methodId}>Method</label>
              <select id={methodId} className="pu-select" value={method} onChange={(e) => { setMethod(e.target.value); setResult(null); }}>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="pu-label" htmlFor={withinId}>Within (min)</label>
              <input id={withinId} className="pu-select" type="number" min="1" value={within} onChange={(e) => { setWithin(e.target.value); setResult(null); }} />
            </div>
          </div>
          <div className="pu-actions">
            <ActionButton lead={!noSession} onClick={() => setResult(check(s, { method, withinMin: Math.max(1, Number(within) || 1) }))}>Check</ActionButton>
          </div>
          {/* Always mounted so a new result is announced. */}
          <p className="pu-status-line session-lab-page__result" role="status" data-testid="session-lab-result">
            {result
              ? <><StatusChip tone={result.ok ? "ok" : "danger"}>{result.ok ? "PASS" : "FAIL"}</StatusChip>{" "}{result.reason}</>
              : <><StatusChip tone="neutral">Not checked</StatusChip>{" "}Press Check to read the simulated session.</>}
          </p>
        </Card>
      </CardGrid>
      <Card tone="neutral" title="What happened" data-testid="session-lab-log">
        {s.log.length
          ? <ol className="session-lab-page__log">{s.log.map((l, i) => (<li key={i}>t+{l.at}: {l.text}</li>))}</ol>
          : <p className="pu-note pu-empty">Nothing yet. Each action you take is listed here.</p>}
      </Card>
    </>
  );
}

// The page's one button element: `lead` is the single primary for the current view state (see the header comment).
function ActionButton({ lead, ...rest }) {
  return <button type="button" className={lead ? "pu-btn pu-btn--primary" : "pu-btn"} {...rest} />;
}
