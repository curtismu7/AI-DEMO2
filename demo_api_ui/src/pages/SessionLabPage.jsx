import { useEffect, useReducer, useState } from "react";
import apiClient from "../services/apiClient";
import PageHeader from "../components/common/PageHeader";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import { SESSION_LAB_DIAGRAM } from "../config/sessionLabDiagram";
import { METHODS, DEFAULT_IDLE_MIN, initial, report, revoke, advance, check, isLive } from "../config/sessionLabModel";
import "./SessionLabPage.css";

// Real session on top (read-only: the BFF's own session and the claims in the tokens it holds). Mock
// PingOne session below (simulated, in this browser tab only, never calls PingOne). The PingOne cookie
// lives on the PingOne host, so this page cannot show it; the cookie it can describe is the BFF's.
const MIN = (ms) => {
  if (ms == null) return "-";
  const m = Math.round((ms - Date.now()) / 60000);
  return m < 0 ? "expired" : `${m} min from now`;
};
const WHEN = (sec) => (sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-");

function Table({ rows }) {
  return (
    <table className="session-lab__table">
      <tbody>{rows.map(([k, v]) => (<tr key={k}><th scope="row">{k}</th><td>{v == null || v === "" ? "-" : String(v)}</td></tr>))}</tbody>
    </table>
  );
}

function RealSession() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    Promise.allSettled([apiClient.get("/api/auth/oauth/user/status"), apiClient.get("/api/auth/oauth/user/token-claims")])
      .then(([st, cl]) => live && setState({
        status: st.status === "fulfilled" ? st.value.data : null,
        claims: cl.status === "fulfilled" ? cl.value.data : null,
        failed: [st, cl].some((r) => r.status === "rejected"),
      }));
    return () => { live = false; };
  }, []);
  if (state.loading) return <p>Reading your session…</p>;
  const { status, claims, failed } = state;
  if (!status) return <p className="session-lab__warn">Could not read your session (the status request failed).</p>;
  if (!status.authenticated) return <p className="session-lab__warn">Not signed in, so there is no session to show.</p>;
  const id = claims?.idToken?.payload || {};
  const at = claims?.decoded?.payload || {};
  // Say which token a value came from; never show an access-token value under an ID-token label.
  const pick = (k) => {
    if (id[k] != null) return { v: id[k], from: "ID token" };
    if (at[k] != null) return { v: at[k], from: "access token" };
    return { v: null, from: null };
  };
  const show = (k, fmt = (v) => v) => { const { v, from } = pick(k); return v == null ? (claims?.authenticated === false ? "no tokens held for this session" : "not in these tokens") : `${fmt(v)} (${from})`; };
  return (
    <>
      <div className="session-lab__grid">
        <div>
          <h3>BFF session (this app's own)</h3>
          <Table rows={[
            ["provider", status.loginProvider],
            ["session type", status.sessionType],
            ["access token expires", MIN(status.expiresAt)],
            ["refresh token held", status.hasRefreshToken ? "yes" : "no"],
            ["cookie", "connect.sid: HttpOnly, 24 h, sameSite lax locally and none in production (from the server config)"],
          ]} />
        </div>
        <div>
          <h3>Sign-on facts in your tokens</h3>
          <Table rows={[
            ["auth_time", show("auth_time", (v) => `${v}, ${WHEN(v)}`)],
            ["amr", show("amr", (v) => [].concat(v).join(", "))],
            ["sid", show("sid")],
            ["iat", show("iat", WHEN)],
            ["exp", show("exp", WHEN)],
          ]} />
        </div>
      </div>
      {failed && <p className="session-lab__warn">One of the two requests failed, so some facts may be missing.</p>}
      <p className="session-lab__note">
        The identity provider's own session cookie (PingOne or PingFederate, whichever you signed in with) is set on that provider's host. A page on this app cannot read it, so the facts above come from
        this app's own session and the tokens it holds. <code>amr</code> and <code>sid</code> only appear when the provider puts them in the tokens, and whether PingOne sets <code>auth_time</code> and <code>amr</code> the
        same way on a single sign-on through an existing session is UNVERIFIED.
      </p>
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
  const x = s.session;
  const live = isLive(s);
  const act = (a) => { setResult(null); dispatch(a); };
  const rows = x ? [
    ["status", live ? "active" : "idle timeout passed"],
    ["idle timeout", `${x.idleMin} min${x.idleMin === DEFAULT_IDLE_MIN ? " (default, inferred: UNVERIFIED)" : ""}`],
    ["idle ends at", `t+${x.activeAt + x.idleMin} min`],
    ...Object.entries(x.authenticators).map(([m, at]) => [`last sign-on · ${m}`, `t+${at} min (${s.now - at} min ago)`]),
  ] : [["status", "no session"]];
  return (
    <div className="session-lab__mock">
      <p className="session-lab__sim">Simulated. Nothing here calls PingOne; the clock below is a pretend clock you advance.</p>
      <div className="session-lab__grid">
        <div>
          <h3>Flow actions (Return Success Response)</h3>
          <div className="session-lab__buttons">
            <button type="button" onClick={() => act({ type: "report", methods: ["pwd"] })}>Sign in with password</button>
            <button type="button" onClick={() => act({ type: "report", methods: ["pwdless"] })}>Sign in passwordless</button>
            <button type="button" onClick={() => act({ type: "report", methods: ["mfa"] })}>Report mfa, no challenge</button>
            <button type="button" onClick={() => act({ type: "report", methods: [] })}>Report no methods</button>
            <button type="button" onClick={() => act({ type: "report", methods: ["pwd"], idleMin: 5 })}>Report pwd, idle 5 min</button>
            <button type="button" onClick={() => act({ type: "revoke" })}>Delete session</button>
          </div>
          <h3>Pretend clock: t+{s.now} min</h3>
          <div className="session-lab__buttons">
            {[[1, "+1 min"], [60, "+1 hour"], [540, "+9 hours"], [1440, "+1 day"]].map(([m, l]) => (
              <button key={m} type="button" onClick={() => act({ type: "advance", minutes: m })}>{l}</button>
            ))}
            <button type="button" onClick={() => act({ type: "reset" })}>Reset</button>
          </div>
        </div>
        <div>
          <h3>The session record</h3>
          <Table rows={rows} />
        </div>
      </div>
      <h3>Check Session</h3>
      <div className="session-lab__buttons">
        <label>Method <select value={method} onChange={(e) => { setMethod(e.target.value); setResult(null); }}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Within (min) <input type="number" min="1" value={within} onChange={(e) => { setWithin(e.target.value); setResult(null); }} /></label>
        <button type="button" onClick={() => setResult(check(s, { method, withinMin: Math.max(1, Number(within) || 1) }))}>Check</button>
      </div>
      <p role="status" data-testid="session-lab-result" className={result ? (result.ok ? "session-lab__ok" : "session-lab__bad") : undefined}>{result ? `${result.ok ? "PASS" : "FAIL"}: ${result.reason}` : ""}</p>
      <h3>What happened</h3>
      <ol className="session-lab__log">{s.log.map((l, i) => (<li key={i}>t+{l.at}: {l.text}</li>))}</ol>
    </div>
  );
}

export default function SessionLabPage() {
  return (
    <div className="session-lab">
      <PageHeader
        eyebrow="Sessions"
        title="Session Lab"
        summary="One PingOne session holds a last sign-on time for each method. A flow's Return Success Response writes them; Check Session reads them."
      />
      <section aria-labelledby="sl-real"><h2 id="sl-real">Your real session</h2><RealSession /></section>
      <EmbeddedFlowDiagram
        config={SESSION_LAB_DIAGRAM}
        title="How a flow and a session meet"
        lede="Return Success Response writes the session; Check Session reads it. Neither one detects methods."
        ariaLabel="PingOne session flow"
        testId="session-lab-diagram"
        pingStyle
      />
      <section aria-labelledby="sl-mock"><h2 id="sl-mock">Change a session (simulated)</h2><MockLab /></section>
    </div>
  );
}
