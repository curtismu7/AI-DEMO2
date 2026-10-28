import { useEffect, useReducer, useState } from "react";
import apiClient from "../services/apiClient";
import PageHeader from "../components/common/PageHeader";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import { SESSION_LAB_DIAGRAM } from "../config/sessionLabDiagram";
import { METHODS, initial, report, revoke, advance, check, isLive } from "../config/sessionLabModel";
import "./SessionLabPage.css";

// Real session on top (read-only: the BFF's own session and the claims in the tokens it holds). Mock
// PingOne session below (simulated, in this browser tab only, never calls PingOne). The PingOne cookie
// lives on the PingOne host, so this page cannot show it; the cookie it can describe is the BFF's.
const MIN = (ms) => (ms == null ? "-" : `${Math.round((ms - Date.now()) / 60000)} min from now`);
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
    Promise.all([apiClient.get("/api/auth/oauth/user/status"), apiClient.get("/api/auth/oauth/user/token-claims")])
      .then(([s, c]) => live && setState({ status: s.data, claims: c.data }))
      .catch(() => live && setState({ error: true }));
    return () => { live = false; };
  }, []);
  if (state.loading) return <p>Reading your session…</p>;
  if (state.error || !state.status?.authenticated) return <p className="session-lab__warn">Could not read a signed-in session.</p>;
  const { status, claims } = state;
  const id = claims?.idToken?.payload || {};
  const at = claims?.decoded?.payload || {};
  const pick = (k) => id[k] ?? at[k];
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
            ["auth_time", pick("auth_time") ? `${pick("auth_time")} (${WHEN(pick("auth_time"))})` : "not in these tokens"],
            ["amr", [].concat(pick("amr") || []).join(", ") || "not in these tokens"],
            ["sid", pick("sid")],
            ["iat", WHEN(pick("iat"))],
            ["exp", WHEN(pick("exp"))],
          ]} />
        </div>
      </div>
      <p className="session-lab__note">
        The PingOne session cookie is set on the PingOne host. A page on this app cannot read it, so the facts above come from
        this app's own session and the tokens it holds. Whether PingOne sets <code>auth_time</code> and <code>amr</code> the
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
  const [within, setWithin] = useState(480);
  const [result, setResult] = useState(null);
  const x = s.session;
  const live = isLive(s);
  const act = (a) => { setResult(null); dispatch(a); };
  const rows = x ? [
    ["status", live ? "active" : "idle timeout passed"],
    ["idle timeout", `${x.idleMin} min`],
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
        <label>Method <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Within (min) <input type="number" min="1" value={within} onChange={(e) => setWithin(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button type="button" onClick={() => setResult(check(s, { method, withinMin: within }))}>Check</button>
      </div>
      {result && <p role="status" data-testid="session-lab-result" className={result.ok ? "session-lab__ok" : "session-lab__bad"}>{result.ok ? "PASS" : "FAIL"}: {result.reason}</p>}
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
