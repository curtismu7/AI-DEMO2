import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import terms from "../data/idJagTerms.json";
import bffAxios from "../services/bffAxios";
import IdJagPathBar from "../components/IdJagPathBar";
import "./IdJagLearnPage.css";
import "./IdJagInspectPage.css";

// Inspector: get an ID-JAG (the playground's issue route) or paste any token, and see the spec checks; each backend's
// discovery metadata sits in a collapsed section. Paste/discovery come from /api/id-jag-inspect
// (demo_api_server/routes/idJagInspect.js); nothing pasted is stored. An issued ID-JAG stays server-side in the
// playground session (the issue route never returns it), so it is checked there, not pasted into the box.
// Ported from the standalone kit's InspectPage. The kit's Live log tab relays the resource AS's decision record;
// oauth-mcp keeps none, so here that tab only says so.

const API = "/api/id-jag-inspect";
const PLAYGROUND = "/pingfederate-id-jag/playground";
const PG = "/api/id-jag-playground";
const MODE_KEY = "idjag.playground.mode"; // the playground's remembered mode
const ISSUE_MODES = ["oauth-mcp", "pf-pf"]; // modes that mint at a PingFederate (mock and byo do not)
const TABS = [["decode", "Decode & check"], ["log", "Live log"]];
const TYPE_LABEL = { "id-jag": "ID-JAG", "id-token": "ID token", "access-token": "Access token", saml: "SAML assertion", unknown: "not recognised" };
const STATUS = { pass: ["ok", "✓ Pass"], warn: ["warn", "! Warning"], fail: ["fail", "✕ Fail"] };
// Check id -> glossary term id (checks without a glossary term have no link).
export const CHECK_TERMS = {
  typ: "id-jag", "trusted-idp": "idp-authorization-server", iss: "idp-authorization-server",
  aud: "resource-authorization-server", client_id: "strict-client-binding",
};
const termName = (id) => terms.find((t) => t.id === id)?.term;
const json = (v) => JSON.stringify(v, null, 2);
const chosenMode = () => { try { const v = localStorage.getItem(MODE_KEY); return ISSUE_MODES.includes(v) ? v : "oauth-mcp"; } catch { return "oauth-mcp"; } };
const errText = (e) => (e.response?.status === 401 ? "Sign in to use the Inspector." : e.response?.data?.message || e.response?.data?.error || e.message);

function Result({ result }) {
  return (
    <>
      <p><strong>Detected: {TYPE_LABEL[result.type]}</strong>{result.idp && ` · issuer: trusted IdP "${result.idp.name}"`}</p>
      {result.type === "unknown" && <p>This is neither a compact JWT nor a SAML assertion.</p>}
      {result.checks.length > 0 && (
        <div className="ijl-table-wrap">
          <table className="ijl-table">
            <thead><tr><th>Result</th><th>Check</th><th>Expected</th><th>Actual</th><th>Reference</th><th>Glossary</th></tr></thead>
            <tbody>
              {result.checks.map((c) => {
                const [cls, text] = STATUS[c.status];
                const term = CHECK_TERMS[c.id];
                return (
                  <tr key={c.id}>
                    <td><span className={`ijin-badge ijin-badge--${cls}`}>{text}</span></td>
                    <td>{c.label}</td><td>{String(c.expected ?? "")}</td><td>{String(c.actual ?? "")}</td><td>{c.cite}</td>
                    <td>{term && <Link to={`/pingfederate-id-jag/learn#term-${term}`}>{termName(term)}</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {result.header && <><h2>Header</h2><pre className="ijin-code">{json(result.header)}</pre></>}
      {result.claims && <><h2>Claims</h2><pre className="ijin-code">{json(result.claims)}</pre></>}
      {result.assertion && <><h2>Assertion</h2><pre className="ijin-code">{result.assertion.xml}</pre></>}
    </>
  );
}

function Decode() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(false);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [shown, setShown] = useState(null); // the raw ID-JAG, only after an explicit Show token
  // The playground's own state decides sign-in; its server mode follows the mode this browser remembers.
  useEffect(() => {
    (async () => {
      try {
        let { data } = await bffAxios.get(`${PG}/config`);
        const mode = chosenMode();
        if (data.mode !== mode) data = (await bffAxios.post(`${PG}/mode`, { mode })).data;
        setNeedSignIn(!data.signedIn);
      } catch { /* the button reports the problem when pressed */ }
    })();
  }, []);
  const get = async () => {
    setError(""); setResult(null); setIssued(false); setShown(null); setBusy(true);
    try {
      await bffAxios.post(`${PG}/issue`, {});
      // The same checks as a pasted token, on the token the server holds, trusted via the playground's mode.
      const { data } = await bffAxios.post(`${API}/issued-check`);
      setResult(data); setIssued(true);
    } catch (e) {
      if (e.response?.status === 401) setNeedSignIn(true); else setError(errText(e));
    } finally { setBusy(false); }
  };
  const show = async () => {
    try { setShown((await bffAxios.post(`${API}/issued-token`)).data.token); } catch (e) { setError(errText(e)); }
  };
  const run = async () => {
    setError(""); setResult(null); setIssued(false); setShown(null);
    try { setResult((await bffAxios.post(`${API}/decode`, { token: token.trim() })).data); } catch (e) { setError(errText(e)); }
  };
  return (
    <section className="ijl-panel" aria-label="Decode and check">
      <button type="button" className="ijin-btn" disabled={busy || needSignIn} onClick={get}>Get an ID-JAG</button>
      {needSignIn && (
        <p className="ijin-signin" role="alert">
          Sign in at PingFederate first. <a href={`${PLAYGROUND}#ijp-step-1`}>Sign in on the ID-JAG playground</a>
        </p>
      )}
      {issued && <p>The ID-JAG is kept on the server and the checks below ran there. It only reaches the browser if you click Show token.</p>}
      {issued && !shown && <button type="button" className="ijin-btn ijin-btn--secondary" onClick={show}>Show token</button>}
      {shown && (
        <div className="ijin-reveal">
          <label className="ijl-search ijin-field">ID-JAG
            <textarea value={shown} rows={4} readOnly spellCheck={false} />
          </label>
          <button type="button" className="ijin-btn ijin-btn--secondary" onClick={() => navigator.clipboard?.writeText(shown)}>Copy</button>{" "}
          <button type="button" className="ijin-btn ijin-btn--secondary" onClick={() => setShown(null)}>Hide token</button>
        </div>
      )}
      <p className="ijin-or">or paste a token from another tool</p>
      <label className="ijl-search ijin-field">Token
        <textarea value={token} rows={5} spellCheck={false} onChange={(e) => setToken(e.target.value)}
          placeholder="An ID token, ID-JAG, access token (JWT) or a SAML assertion" />
      </label>
      <button type="button" className="ijin-btn ijin-btn--secondary" disabled={!token.trim()} onClick={run}>Decode and check</button>
      {error && <div className="ijin-banner" role="alert">{error}</div>}
      {result && <Result result={result} />}
    </section>
  );
}

function Discovery() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setData((await bffAxios.get(`${API}/discovery`)).data.backends); } catch (e) { setError(errText(e)); }
  }, []);
  // Fetched when first opened, not on page load.
  const onToggle = (e) => { if (e.currentTarget.open && !data && !error) load(); };
  return (
    <details className="ijl-panel ijin-backends" onToggle={onToggle}>
      <summary>Backends (discovery metadata)</summary>
      <p>
        MCP clients look for <code>authorization_grant_profiles_supported</code> and <code>scopes_supported</code> in this metadata
        (MCP enterprise-managed authorization). The marks below show whether each backend publishes them.
      </p>
      <button type="button" className="ijin-btn ijin-btn--secondary" onClick={load}>Refresh</button>
      {error && <div className="ijin-banner" role="alert">{error}</div>}
      {data?.map((b) => (
        <div key={b.id} className="ijin-card">
          <h2>{b.label}</h2>
          <p><code>{b.url}</code></p>
          {b.error ? <div className="ijin-banner" role="alert">Could not fetch: {b.error}</div> : (
            <>
              <ul>{Object.entries(b.profileFields).map(([f, ok]) => <li key={f}><code>{f}</code>: {ok ? "✓ published" : "✕ not published"}</li>)}</ul>
              <pre className="ijin-code">{json(b.data)}</pre>
            </>
          )}
        </div>
      ))}
    </details>
  );
}

function Log() {
  return (
    <section className="ijl-panel" aria-label="Live log">
      <p><strong>Not available in the demo.</strong> The standalone kit shows the resource authorization server's own record of its /token decisions here. The demo's resource AS (oauth-mcp) keeps no such record, so there is nothing to read.</p>
    </section>
  );
}

export default function IdJagInspectPage() {
  const [tab, setTab] = useState("decode");
  return (
    <main className="ijl" data-testid="id-jag-inspect">
      <IdJagPathBar />
      <header className="ijl-hero">
        <p className="ijl-eyebrow">Inspector</p>
        <h1>Inspect a token</h1>
        <p className="ijl-lede">
          Get an ID-JAG from PingFederate, or paste any token, and check it against the IETF draft and this demo's trusted IdPs.
          Each backend's discovery metadata is further down. Sign in first: the Inspector is for signed-in users.
        </p>
      </header>
      <div className="ijl-tabs" role="tablist" aria-label="Inspector sections">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === "decode" && <Decode />}
      {tab === "log" && <Log />}
      <Discovery />
    </main>
  );
}
