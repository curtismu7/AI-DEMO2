import { useState } from "react";
import apiClient from "../services/apiClient";
import "./OboDemoPage.css";

// On-behalf-of demo. The BFF runs RFC 8693 delegation for the signed-in user and returns a step
// trace: status, timing and token-free facts per hop. This page renders that trace; it never sees
// a token. Layout follows /privilege-a2a: the run on the left, the trace on the right, and a click
// on a trace line opens that step's details on the left.
const SHORT = (sha) => (sha ? `sha256 ${String(sha).slice(0, 8)} (hash only)` : "-");
const AUD = (aud) => [].concat(aud || []).join(", ") || "-";
const SCOPES = (s) => (s ? `${s.count} scope${s.count === 1 ? "" : "s"}${s.sample?.length ? ` (${s.sample.join(" ")}${s.count > s.sample.length ? " …" : ""})` : ""}` : "-");
const MINUTES = (m) => (m == null ? "-" : `${m} min`);

const STEPS = {
  1: { title: "You are signed in", route: "browser → BFF session",
    why: "Your session holds a PingOne access token. The BFF reads it server-side; it is never sent to the browser or the model.",
    rows: (f) => [["sub", f.sub], ["client_id", f.client_id], ["aud", AUD(f.aud)], ["scope", SCOPES(f.scope)], ["expires in", MINUTES(f.expiresInMin)], ["token", SHORT(f.sha)]] },
  2: { title: "Agent gets its own identity", route: "BFF → PingOne /as/token (client credentials)",
    why: "The AI Agent app proves who the agent is with its own credentials. This becomes the actor in the exchange.",
    rows: (f) => [["grant_type", "client_credentials"], ["client_id", f.client_id], ["scope", f.scope], ["actor token", SHORT(f.sha)], ["expires in", MINUTES(f.expiresInMin)]] },
  3: { title: "Token exchange (RFC 8693)", route: "BFF → PingOne /as/token",
    why: "The Token Exchanger app trades your token plus the agent token for one delegated token.",
    rows: (f) => [["grant_type", f.grant_type], ["subject_token", `your token · ${SHORT(f.subjectSha)}`], ["actor_token", `agent token · ${SHORT(f.actorSha)}`], ["audience", f.audience], ["scope", f.scope], ["authenticated as", `Token Exchanger · ${f.exchanger}`]] },
  4: { title: "Delegated token: what changed", route: "PingOne → BFF (claims only)",
    why: "Your identity is kept, the agent is recorded as the actor, and the audience and scope are narrowed." },
  5: { title: "Downstream accepts the delegated token", route: "BFF → downstream API",
    why: "The downstream API only accepts a token with the right audience and an act claim.",
    rows: (f) => [["request", "GET /api/obo/downstream"], ["Authorization", "delegated token"], ["response", `${f.status}`]] },
  6: { title: "Downstream refuses your own token", route: "BFF → downstream API",
    why: "The same call with your original token is refused: only the delegated token carries the agent.",
    rows: (f) => [["request", "GET /api/obo/downstream"], ["Authorization", "your token"], ["response", `${f.status}`]] },
  7: { title: "No token leaked", route: "BFF → browser / model",
    why: "Everything returned to the browser and the model was scanned for token text.",
    rows: (f) => [["scanned", "evidence object and MCP result text"], ["token patterns found", f.leak ? "yes" : "0"]] },
};
const STEP_IDS = [1, 2, 3, 4, 5, 6, 7];
const LABEL = { idle: "not run", run: "running…", pass: "✓ ok", fail: "✕ failed", skip: "skipped" };

function Table({ rows }) {
  return (
    <table className="obo-demo__table">
      <tbody>{rows.map(([k, v]) => (<tr key={k}><th scope="row">{k}</th><td>{v == null ? "-" : String(v)}</td></tr>))}</tbody>
    </table>
  );
}

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
      <thead><tr><th /><th scope="col">Your token</th><th scope="col">Delegated</th></tr></thead>
      <tbody>{rows.map(([k, before, after, same]) => (
        <tr key={k}><th scope="row">{k}</th><td>{k === "sub" ? d.sub : before}</td><td className={k === "sub" ? (same ? "obo-demo__good" : "obo-demo__bad") : "obo-demo__diff"}>{k === "sub" ? (same ? `${after} (same)` : after) : after}</td></tr>
      ))}</tbody>
    </table>
  );
}

export default function OboDemoPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { ok, steps, checks, failedStep, error }
  const [selected, setSelected] = useState(null);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    setSelected(null);
    try {
      const response = await apiClient.post("/api/obo/run");
      setResult({ ok: true, steps: response.data.steps || [], checks: response.data.checks || [] });
      setSelected(4);
    } catch (err) {
      const data = err?.response?.data || {};
      if (Array.isArray(data.steps)) {
        setResult({ ok: false, steps: data.steps, checks: [], failedStep: data.failedStep, error: data.error });
        setSelected(data.failedStep || null);
      } else {
        setError(data.message || data.error || "The OBO run failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const byId = Object.fromEntries((result?.steps || []).map((s) => [s.id, s]));
  const statusOf = (id) => (busy ? "idle" : byId[id]?.status || "idle");
  const totalMs = (result?.steps || []).reduce((sum, s) => sum + (s.ms || 0), 0);
  const passed = (result?.checks || []).filter((c) => c.pass).length;
  const who = result?.ok ? {
    sub: byId[1]?.facts?.sub, agent: byId[2]?.facts?.client_id, exchanger: byId[3]?.facts?.exchanger, target: `${byId[3]?.facts?.audience} · scope ${byId[3]?.facts?.scope}`,
  } : null;

  function renderDetails() {
    if (!selected) return <div className="obo-demo__empty">Click a line on the right to see what happened at that step.</div>;
    const info = STEPS[selected];
    const step = byId[selected];
    const st = statusOf(selected);
    let body;
    if (!step || st === "idle") body = <div className="obo-demo__empty">This step has not run yet. Press “Run the delegation”.</div>;
    else if (st === "skip") body = <div className="obo-demo__empty">Skipped because step {result.failedStep} failed.</div>;
    else if (st === "fail" && step.facts?.error) {
      body = (
        <>
          <div className="obo-demo__why"><b>Why it failed.</b> PingOne refused this step.{/subject_token/.test(step.facts.description || "") ? " It did not accept the signed-in token as the input to the exchange: the token may be expired, or its client may not be trusted by the tenant's exchange policy. Sign in again and retry." : ""}</div>
          <Table rows={[["error", step.facts.error], ["description", step.facts.description], ["http status", step.facts.httpStatus]]} />
        </>
      );
    } else if (selected === 4) body = <><p>{info.why}</p><DeltaTable facts={step.facts} /></>;
    else body = <><p>{info.why}</p><Table rows={info.rows(step.facts)} /></>;
    return (
      <>
        <h3 className="obo-demo__step-title">{selected}. {info.title}</h3>
        <div className="obo-demo__route">{info.route}{st === "pass" && step?.ms ? ` · ${step.ms} ms` : ""}</div>
        {body}
      </>
    );
  }

  return (
    <div className="obo-demo">
      <h1 className="obo-demo__title">On behalf of the user</h1>
      <p className="obo-demo__lede">
        An agent acts for you through RFC 8693 delegation. The exchange keeps your identity (<code>sub</code>),
        records the agent as <code>act</code>, and issues a token the downstream API accepts. Your own token is
        refused there. The model never sees either token.{" "}
        <a href="/architecture/obo-flow.html" target="_blank" rel="noopener noreferrer">View the flow diagram (opens in a new tab)</a>
      </p>
      <div className="obo-demo__workspace">
        <section aria-label="Run">
          <div className="obo-demo__card">
            <h2 className="obo-demo__h2">Run</h2>
            {who ? (
              <dl className="obo-demo__who">
                <dt>Signed in as</dt><dd>{who.sub}</dd>
                <dt>Agent (actor)</dt><dd>{who.agent}</dd>
                <dt>Exchanger</dt><dd>{who.exchanger}</dd>
                <dt>Target</dt><dd>{who.target}</dd>
              </dl>
            ) : null}
            <div className="obo-demo__run">
              <button type="button" className="obo-demo__button" onClick={run} disabled={busy}>
                {busy ? "Running…" : "Run the delegation"}
              </button>
              <span className="obo-demo__status">
                {busy ? "Running the exchange…" : result ? (result.ok ? `Done in ${(totalMs / 1000).toFixed(1)} s` : `Stopped at step ${result.failedStep}`) : "Not run yet"}
              </span>
            </div>
            {error ? <p role="alert" className="obo-demo__error">{error}</p> : null}
            {result?.ok ? (
              <div className={`obo-demo__verdict ${passed === result.checks.length ? "obo-demo__verdict--pass" : "obo-demo__verdict--fail"}`} role="status">
                {passed === result.checks.length ? "✓ " : "✕ "}Delegation {passed === result.checks.length ? "verified" : "not verified"}: {passed} of {result.checks.length} checks passed
              </div>
            ) : null}
            {result && !result.ok ? (
              <div className="obo-demo__verdict obo-demo__verdict--fail" role="status">✕ The exchange failed at step {result.failedStep}</div>
            ) : null}
            {result?.checks?.length ? (
              <ul className="obo-demo__checks" aria-label="Delegation checks">
                {result.checks.map((check) => (
                  <li key={check.id}><span className={`obo-demo__chip obo-demo__chip--${check.pass ? "pass" : "fail"}`}>{check.pass ? "PASS" : "FAIL"}</span><span>{check.label}</span></li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="obo-demo__card" aria-live="polite">
            <h2 className="obo-demo__h2">Step details</h2>
            {renderDetails()}
          </div>
        </section>
        <aside aria-label="Delegation trace">
          <div className="obo-demo__card">
            <h2 className="obo-demo__h2">Trace</h2>
            <ol className="obo-demo__trace">
              {STEP_IDS.map((id) => {
                const st = statusOf(id);
                const ms = byId[id]?.ms;
                return (
                  <li key={id}>
                    <button type="button" className="obo-demo__line" aria-current={selected === id ? "true" : undefined} onClick={() => setSelected(id)}>
                      <span className="obo-demo__num">{id}</span>
                      <span><span className="obo-demo__line-title">{STEPS[id].title}</span><span className="obo-demo__line-route">{STEPS[id].route}</span></span>
                      <span className="obo-demo__meta"><span className={`obo-demo__st obo-demo__st--${st}`}>{LABEL[st]}</span>{st === "pass" && ms ? `${ms} ms` : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="obo-demo__legend">Each line is one hop. Click a line to see what was sent and what came back. Tokens appear only as short hashes and claims.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
