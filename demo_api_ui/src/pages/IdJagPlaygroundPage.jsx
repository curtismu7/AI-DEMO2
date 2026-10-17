import { createContext, Fragment, useContext, useEffect, useState } from "react";
import IdJagPathBar from "../components/IdJagPathBar";
import bffAxios from "../services/bffAxios";
import { openSignIn } from "../utils/signInService";
import { MOCK_CONFIG, mockApi } from "../utils/idJagPlaygroundMock";
import "./IdJagPlaygroundPage.css";

// The real PingFederate ID-JAG flow, one step at a time (after Okta's xaa.dev), with a
// spec inspector and live negative tests (after MCPJam's XAA debugger). Raw tokens never
// reach the browser: the BFF returns decoded claims and redacted requests only.
// Mock mode runs the same steps from client-side fixtures and sends nothing.

const API = "/api/id-jag-playground";
const RETURN_TO = "/pingfederate-id-jag/playground";
const MODE_KEY = "idjag.playground.mode";
const VIEW_KEY = "idjag.playground.view";

const MODES = [
  { id: "mock", label: "Mock (no sign-in)" },
  { id: "oauth-mcp", label: "PingFederate → oauth-mcp" },
  { id: "pf-pf", label: "PingFederate → PingFederate" },
];
const VIEWS = [{ id: "form", label: "Form" }, { id: "json", label: "JSON" }];

const stored = (key, allowed, fallback) => {
  try { const v = localStorage.getItem(key); return allowed.some((a) => a.id === v) ? v : fallback; } catch { return fallback; }
};
const store = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage blocked: not remembered */ } };

const SPEC_NOTES = {
  issue: "RFC 8693 token exchange at the IdP with requested_token_type=…:id-jag. audience names the resource authorization server; resource names the MCP server. The IdP decides the scope and returns a short-lived JWT typed oauth-id-jag+jwt in access_token, with token_type N_A.",
  redeem: "RFC 7523 JWT bearer grant at the resource authorization server. It verifies typ, the IdP signature, iss, a single aud equal to its own issuer, exp/iat, and that client_id is the client authenticating now. It grants at most the ID-JAG's scope and mints its own access token. It should not return a refresh token.",
  negative: "A resource authorization server must refuse a broken assertion with an OAuth error and no token. Each test mints a fresh ID-JAG, breaks one thing, and checks the refusal.",
};

// Per-mode wording: who redeems, who validates the MCP call.
const MODE_TEXT = {
  "oauth-mcp": {
    signInTitle: "Sign in with PingFederate",
    signInNote: "The ID-JAG is minted from your PingFederate session (the refresh token the BFF holds). This always starts a fresh PingFederate sign-in.",
    redeemTitle: "Redeem it at the MCP authorization server",
    asRole: "Redeems the ID-JAG, mints its own token",
    mcpRole: "Reached through the MCP gateway",
    call: "The ID-JAG stops at the authorization server. The MCP call carries the new access token; the gateway verifies it against oauth-mcp's keys and forwards it. Tools listed here are whatever this token can see in the active vertical.",
  },
  "pf-pf": {
    signInTitle: "Sign in at the issuer PingFederate",
    signInNote: "The ID-JAG is minted from your session at the SE PingFederate, the issuer. This sign-in is separate from the app's own sign-in.",
    redeemTitle: "Redeem it at the local PingFederate",
    asRole: "Redeems the ID-JAG, mints the access token the gateway validates",
    mcpRole: "Reached through the MCP gateway, which validates PingFederate's token",
    call: "The ID-JAG stops at the local PingFederate. The MCP call carries the access token the local PingFederate minted; the gateway validates PingFederate's token and forwards it. Tools listed here are whatever this token can see in the active vertical.",
  },
  mock: {
    signInTitle: "Sign in with PingFederate",
    signInNote: "Mock mode needs no sign-in: every step below uses sample data in your browser.",
    redeemTitle: "Redeem it at the MCP authorization server",
    asRole: "Redeems the ID-JAG, mints its own token",
    mcpRole: "Reached through the MCP gateway",
    call: "The ID-JAG stops at the authorization server. The MCP call carries the new access token. In mock mode the tool list and results are sample data.",
  },
};

const VENDORS = [
  { name: "PingFederate 13.1 (this demo)", issue: "Token exchange; subject = refresh token or ID token; SP connection of type OAuth Token Exchange with ID-JAG enabled", redeem: "Can be the redeeming side too: a JWT bearer grant through an IdP connection. Pick PingFederate → PingFederate above to have the local PingFederate redeem what the SE PingFederate issued", notes: "client_id and scope come from the SP connection's attribute mapping: map them to the client at the resource AS and the IT-granted MCP scopes" },
  { name: "Okta (Cross App Access)", issue: "Org authorization server /oauth2/v1/token; subject = ID token or refresh token; client auth private_key_jwt", redeem: "Resource app's own authorization server, JWT bearer, client credentials of the resource app", notes: "Needs a trusted resource connection; resource must match the configured issuer exactly or invalid_target; ID-JAG lives 300 s" },
  { name: "Auth0", issue: "Can act as the requesting side and as the resource authorization server", redeem: "Issues an access token for the Auth0 API", notes: "No refresh token for ID-JAG exchanges" },
  { name: "Keycloak (nightly, experimental)", issue: "Not implemented (receiver only)", redeem: "JWT bearer with an identity-provider alias trusted for the grant; confidential client", notes: "Tracks draft -01; options for assertion reuse and max lifetime" },
  { name: "MCP Enterprise-Managed Authorization", issue: "IdP (Okta first) issues the ID-JAG to the MCP client", redeem: "MCP server's authorization server; confidential clients", notes: "Access token must be audience-restricted to the MCP server named in resource; ID-JAG reusable until it expires" },
];

const ViewContext = createContext("form");
const TIME_CLAIMS = new Set(["exp", "iat", "nbf", "auth_time"]);

function Fields({ value, name }) {
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) return <span>{value.map(String).join(", ") || "(empty)"}</span>;
    return <ol className="ijp-kv-list">{value.map((v, i) => <li key={i}><Fields value={v} /></li>)}</ol>;
  }
  if (value && typeof value === "object") {
    return (
      <dl className="ijp-kv">
        {Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd><Fields value={v} name={k} /></dd></Fragment>
        ))}
      </dl>
    );
  }
  if (TIME_CLAIMS.has(name) && typeof value === "number") return <span>{value} <span className="ijp-cite">({new Date(value * 1000).toLocaleString()})</span></span>;
  return <span>{String(value)}</span>;
}

function Data({ value }) {
  const view = useContext(ViewContext);
  if (value === undefined || value === null) return null;
  if (view === "json") return <pre className="ijp-json">{JSON.stringify(value, null, 2)}</pre>;
  return <div className="ijp-form"><Fields value={value} /></div>;
}

function Segmented({ label, options, value, onPick, disabled }) {
  return (
    <div className="ijp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} title={o.title}
          disabled={disabled || o.disabled} onClick={() => onPick(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function Step({ n, title, note, children }) {
  return (
    <section className="ijp-step" aria-labelledby={`ijp-step-${n}`}>
      <header className="ijp-step__head">
        <span className="ijp-step__n">{n}</span>
        <h2 id={`ijp-step-${n}`}>{title}</h2>
      </header>
      {note && <p className="ijp-note">{note}</p>}
      {children}
    </section>
  );
}

/** Tool arguments from the form inputs, typed by the tool's inputSchema. */
function buildArgs(props, form) {
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    const v = form[k];
    if (v === undefined || v === "") continue;
    if (p.type === "number" || p.type === "integer") out[k] = Number(v);
    else if (p.type === "object" || p.type === "array") {
      try { out[k] = JSON.parse(v); } catch { throw new Error(`${k} must be JSON`); }
    } else out[k] = v;
  }
  return out;
}

export default function IdJagPlaygroundPage() {
  const [mode, setMode] = useState(() => stored(MODE_KEY, MODES, "oauth-mcp"));
  const [view, setView] = useState(() => stored(VIEW_KEY, VIEWS, "form"));
  const [realModes, setRealModes] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState("");
  const [issued, setIssued] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [redeemScope, setRedeemScope] = useState("");
  const [redeemed, setRedeemed] = useState(null);
  const [tools, setTools] = useState(null);
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [argForm, setArgForm] = useState({});
  const [callResult, setCallResult] = useState(null);
  const [negatives, setNegatives] = useState([]);
  const [negResults, setNegResults] = useState({});
  const [error, setError] = useState(null);

  const isMock = mode === "mock";
  const api = isMock ? mockApi : bffAxios;

  const applyConfig = (data) => {
    // An older BFF without this route answers with the SPA's HTML, not JSON.
    if (!data?.idp) throw new Error("This server does not have the ID-JAG playground API yet. Deploy the latest BFF.");
    setConfig(data);
    if (data.modes) setRealModes(data.modes);
  };
  const loadNegatives = (a) => a.get(`${API}/negative`).then((r) => setNegatives(Array.isArray(r.data) ? r.data : [])).catch(() => {});

  useEffect(() => {
    if (mode === "mock") { setConfig(MOCK_CONFIG); loadNegatives(mockApi); return; }
    (async () => {
      try {
        const { data } = await bffAxios.get(`${API}/config`);
        applyConfig(data);
        // The BFF session remembers its own mode; bring it in line with the one this browser picked.
        if (data.mode && data.mode !== mode) {
          if (data.modes?.find((m) => m.id === mode)?.available === false) setMode(data.mode);
          else applyConfig((await bffAxios.post(`${API}/mode`, { mode })).data);
        }
      } catch (e) { setError(e.response?.data || { message: e.message }); }
    })();
    loadNegatives(bffAxios);
    // Initial load only: later mode changes go through pickMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearResults = () => {
    setIssued(null); setInspection(null); setRedeemed(null); setTools(null); setCallResult(null); setNegResults({});
  };

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError({ step: label, ...(e.response?.data || { message: e.message }) }); } finally { setBusy(""); }
  };

  const pickMode = (m) => {
    if (m === mode) return;
    store(MODE_KEY, m);
    clearResults();
    setMode(m);
    if (m === "mock") { setError(null); setConfig(MOCK_CONFIG); loadNegatives(mockApi); return; }
    run("mode", async () => {
      applyConfig((await bffAxios.post(`${API}/mode`, { mode: m })).data);
      if (isMock) loadNegatives(bffAxios);
    });
  };

  const pickView = (v) => { store(VIEW_KEY, v); setView(v); };

  const signIn = () => {
    if (mode === "pf-pf") {
      // Sign in at the issuer PingFederate, not the app's own provider.
      window.location.assign(`${API}/issuer/login?return_to=${RETURN_TO}`);
      return;
    }
    run("signin", async () => {
      // Always a PingFederate sign-in: clear whatever session is here first.
      await bffAxios.post("/api/auth/clear-session").catch(() => {});
      // PingFederate's own login page: the real IdP sign-in the ID-JAG is minted from.
      openSignIn({ returnTo: RETURN_TO, force: true, redirect: true });
    });
  };

  const issue = () => run("issue", async () => {
    setRedeemed(null); setTools(null); setCallResult(null); setInspection(null);
    const r = await api.post(`${API}/issue`, {});
    setIssued(r.data);
    setInspection((await api.post(`${API}/inspect`, {})).data);
  });

  const redeem = () => run("redeem", async () => {
    setTools(null); setCallResult(null);
    const r = await api.post(`${API}/redeem`, redeemScope.trim() ? { scope: redeemScope.trim() } : {}, { validateStatus: () => true });
    setRedeemed(r.data);
  });

  const pickTool = (name) => { setTool(name); setArgForm({}); };

  const listTools = () => run("list", async () => {
    const r = await api.post(`${API}/call`, {});
    setTools(r.data);
    pickTool(r.data.tools?.[0]?.name || "");
  });

  const selected = (tools?.tools || []).find((t) => t.name === tool);
  const schemaProps = selected?.inputSchema?.properties;
  const required = selected?.inputSchema?.required || [];
  const useArgForm = view === "form" && schemaProps && Object.keys(schemaProps).length > 0;

  const callTool = () => run("call", async () => {
    let parsed = {};
    if (useArgForm) parsed = buildArgs(schemaProps, argForm);
    else { try { parsed = JSON.parse(args || "{}"); } catch { throw new Error("Arguments must be JSON"); } }
    setCallResult((await api.post(`${API}/call`, { tool, arguments: parsed })).data);
  });

  const runNegative = (id) => run(`neg-${id}`, async () => {
    const r = await api.post(`${API}/negative/${id}`, {}, { validateStatus: () => true });
    setNegResults((m) => ({ ...m, [id]: r.data }));
  });

  const runAllNegatives = () => run("neg-all", async () => {
    for (const t of negatives) {
      const r = await api.post(`${API}/negative/${t.id}`, {}, { validateStatus: () => true });
      setNegResults((m) => ({ ...m, [t.id]: r.data }));
    }
  });

  const text = MODE_TEXT[mode];
  const pfReady = !!config && (isMock || (mode === "pf-pf" ? !!config.enabled : config.provider === "pingfederate" && config.enabled));
  const canRun = pfReady && (isMock || config.signedIn);
  const passed = inspection ? inspection.checks.filter((c) => c.status === "pass").length : 0;
  const modeOptions = MODES.map((m) => {
    const real = realModes?.find((r) => r.id === m.id);
    return real?.available === false ? { ...m, disabled: true, title: real.reason || "Not available on this server" } : m;
  });
  const signInStatus = isMock ? "Mock: no sign-in needed."
    : mode === "pf-pf" ? (config?.signedIn ? "Signed in at the issuer PingFederate." : "Not signed in at the issuer PingFederate.")
    : (config?.signedIn ? "Signed in with PingFederate." : "Not signed in with PingFederate.");

  return (
    <ViewContext.Provider value={view}>
      <main className={`ijp${isMock ? " ijp--mock" : ""}`} data-testid="id-jag-playground">
        <IdJagPathBar current="play" />
        <header className="ijp-hero">
          <img className="ijp-logo" src="/branding/ping-logo.png" alt="Ping Identity" />
          <div>
            <p className="ijp-eyebrow">PingFederate · ID-JAG · try it and validate it</p>
            <h1>ID-JAG Playground</h1>
            <p className="ijp-lede">
              Run the real flow one step at a time against this demo's PingFederate and MCP authorization server.
              Every request and response is shown (tokens decoded, never raw), the ID-JAG is checked against the
              IETF draft, and live negative tests confirm the authorization server refuses what it should.
            </p>
          </div>
        </header>

        <div className="ijp-toolbar">
          <div className="ijp-toolbar__group"><span>Mode</span><Segmented label="Playground mode" options={modeOptions} value={mode} onPick={pickMode} disabled={!!busy} /></div>
          <div className="ijp-toolbar__group"><span>View</span><Segmented label="Data view" options={VIEWS} value={view} onPick={pickView} /></div>
        </div>
        {isMock && <p className="ijp-mock-badge" role="status" data-testid="ijp-mock-badge">Mock: sample data, nothing is sent</p>}

        {config && (
          <section className="ijp-actors" aria-label="Who plays which role">
            <div className="ijp-actor"><h3>Client</h3><p>This demo's BFF, acting for the agent</p><dl><dt>IdP client</dt><dd>{config.idp.exchangeClientId || "—"}</dd><dt>Client at the AS</dt><dd>{config.resourceAs.clientId || "—"}</dd></dl></div>
            <div className="ijp-actor ijp-actor--idp"><h3>IdP: {config.idp.name}</h3><p>Issues the ID-JAG</p><dl><dt>Issuer</dt><dd>{config.idp.issuer || "—"}</dd><dt>Token endpoint</dt><dd>{config.idp.tokenEndpoint || "—"}</dd><dt>JWKS</dt><dd>{config.idp.jwksUrl || "—"}</dd></dl></div>
            <div className="ijp-actor ijp-actor--as"><h3>Resource AS: {config.resourceAs.name}</h3><p>{text.asRole}</p><dl><dt>Issuer (aud)</dt><dd>{config.resourceAs.issuer || "—"}</dd><dt>Token endpoint</dt><dd>{config.resourceAs.tokenEndpoint || "—"}</dd></dl></div>
            <div className="ijp-actor"><h3>MCP server</h3><p>{text.mcpRole}</p><dl><dt>Resource</dt><dd>{config.request.resource || "—"}</dd><dt>Requested scope</dt><dd>{config.request.scope || "(none)"}</dd></dl></div>
          </section>
        )}

        {config && !pfReady && (
          <div className="ijp-banner" role="alert">
            {mode === "oauth-mcp" && config.provider !== "pingfederate"
              ? "The login provider is PingOne. ID-JAG only exists on PingFederate: switch the provider to PingFederate (top-bar P1/PF, admin) and sign in."
              : "pf_id_jag_enabled is off on this BFF."}
          </div>
        )}
        {error && <div className="ijp-banner ijp-banner--error" role="alert"><strong>{error.error || "Error"}</strong> {error.message || error.error_description || ""}</div>}

        <Step n={1} title={text.signInTitle} note={text.signInNote}>
          <p className="ijp-status" data-testid="ijp-signin-status">{signInStatus}</p>
          <button type="button" className="ijp-btn ijp-btn--primary" onClick={signIn} disabled={isMock || !pfReady || !!busy}>
            {config?.signedIn && !isMock ? "Sign in again" : text.signInTitle}
          </button>
        </Step>

        <Step n={2} title="Get an ID-JAG from PingFederate" note={SPEC_NOTES.issue}>
          <button type="button" className="ijp-btn ijp-btn--primary" onClick={issue} disabled={!canRun || !!busy}>{busy === "issue" ? "Requesting…" : "Request ID-JAG"}</button>
          {issued && (
            <div className="ijp-io">
              <div><h4>Request</h4><Data value={issued.request} /></div>
              <div><h4>Response</h4><Data value={issued.response} /></div>
              <div><h4>Decoded ID-JAG</h4><Data value={issued.token} /></div>
            </div>
          )}
          {inspection && (
            <div className="ijp-checks" data-testid="ijp-checks">
              <h4>Spec check: {passed} of {inspection.checks.length} pass</h4>
              <table>
                <thead><tr><th>Check</th><th>Result</th><th>Expected</th><th>Actual</th><th>Rule</th></tr></thead>
                <tbody>
                  {inspection.checks.map((c) => (
                    <tr key={c.id} className={`is-${c.status}`}>
                      <td>{c.label}</td>
                      <td>{c.status === "pass" ? "✅ pass" : c.status === "warn" ? "⚠️ warn" : "❌ fail"}</td>
                      <td>{String(c.expected ?? "")}</td>
                      <td>{typeof c.actual === "object" ? JSON.stringify(c.actual) : String(c.actual ?? "")}</td>
                      <td className="ijp-cite">{c.cite}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Step>

        <Step n={3} title={text.redeemTitle} note={SPEC_NOTES.redeem}>
          <label className="ijp-field">Ask for a narrower scope (optional)
            <input value={redeemScope} onChange={(e) => setRedeemScope(e.target.value)} placeholder="e.g. accounts:read" />
          </label>
          <button type="button" className="ijp-btn ijp-btn--primary" onClick={redeem} disabled={!canRun || !issued || !!busy}>{busy === "redeem" ? "Redeeming…" : "Redeem ID-JAG"}</button>
          {redeemed && (
            <div className="ijp-io">
              <div><h4>Request</h4><Data value={redeemed.request} /></div>
              <div><h4>Response (HTTP {redeemed.status})</h4><Data value={redeemed.response} /></div>
              {redeemed.token && <div><h4>Decoded access token</h4><Data value={redeemed.token} /></div>}
            </div>
          )}
        </Step>

        <Step n={4} title="Call the MCP server with the new token" note={text.call}>
          <button type="button" className="ijp-btn" onClick={listTools} disabled={!canRun || !redeemed?.token || !!busy}>{busy === "list" ? "Listing…" : "List tools this token can see"}</button>
          {tools && (
            <div className="ijp-call">
              <p className="ijp-note" data-testid="ijp-tool-count">{(tools.tools || []).length} tools</p>
              {tools.deniedTools?.length > 0 && <p className="ijp-note">Hidden by the gateway's policy: {tools.deniedTools.join(", ")}</p>}
              <label className="ijp-field">Tool
                <select value={tool} onChange={(e) => pickTool(e.target.value)}>
                  {(tools.tools || []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </label>
              {selected?.description && <p className="ijp-note">{selected.description}</p>}
              {useArgForm ? (
                <fieldset className="ijp-args">
                  <legend>Arguments</legend>
                  {Object.entries(schemaProps).map(([k, p]) => {
                    const req = required.includes(k);
                    const set = (v) => setArgForm((f) => ({ ...f, [k]: v }));
                    const label = <>{k}{req && <span className="ijp-req"> (required)</span>}</>;
                    if (p.type === "boolean") {
                      return <label key={k} className="ijp-check"><input type="checkbox" checked={!!argForm[k]} onChange={(e) => set(e.target.checked)} />{label}</label>;
                    }
                    return (
                      <label key={k} className="ijp-field">{label}
                        {Array.isArray(p.enum) ? (
                          <select value={argForm[k] ?? ""} required={req} onChange={(e) => set(e.target.value)}>
                            <option value="">(none)</option>
                            {p.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                          </select>
                        ) : (
                          <input type={p.type === "number" || p.type === "integer" ? "number" : "text"} value={argForm[k] ?? ""} required={req}
                            placeholder={p.description || (p.type === "object" || p.type === "array" ? "JSON" : "")} onChange={(e) => set(e.target.value)} />
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <label className="ijp-field">Arguments (JSON)
                  <textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} />
                </label>
              )}
              <button type="button" className="ijp-btn ijp-btn--primary" onClick={callTool} disabled={!tool || !!busy}>{busy === "call" ? "Calling…" : "Call tool"}</button>
            </div>
          )}
          {callResult && <div className="ijp-io"><div><h4>Request</h4><Data value={callResult.request} /></div><div><h4>Result</h4><Data value={callResult.result} /></div></div>}
        </Step>

        <Step n={5} title="Negative tests against the authorization server" note={SPEC_NOTES.negative}>
          <button type="button" className="ijp-btn" onClick={runAllNegatives} disabled={!canRun || !!busy}>{busy === "neg-all" ? "Running…" : "Run all"}</button>
          <ul className="ijp-negatives">
            {negatives.map((t) => {
              const r = negResults[t.id];
              return (
                <li key={t.id} className={r ? (r.pass ? "is-pass" : "is-fail") : ""}>
                  <div>
                    <strong>{t.label}</strong> <span className="ijp-cite">expects {t.expect}</span>
                    <p className="ijp-note">{t.why}</p>
                    {r && <p className="ijp-result">{r.pass ? "✅ refused" : "❌ not refused"}{r.status ? ` (HTTP ${r.status}${r.error ? `, ${r.error}` : ""})` : ""}{r.note ? ` ${r.note}` : ""}</p>}
                  </div>
                  <button type="button" className="ijp-btn" onClick={() => runNegative(t.id)} disabled={!canRun || !!busy}>Run</button>
                </li>
              );
            })}
          </ul>
        </Step>

        <section className="ijp-step" aria-labelledby="ijp-vendors">
          <header className="ijp-step__head"><h2 id="ijp-vendors">How other implementations do it</h2></header>
          <p className="ijp-note">Same draft, different products. Use this to explain where PingFederate fits and what to check when a customer brings Okta, Auth0 or Keycloak.</p>
          <table className="ijp-vendors">
            <thead><tr><th>Product</th><th>Issuing the ID-JAG</th><th>Redeeming it</th><th>Worth knowing</th></tr></thead>
            <tbody>{VENDORS.map((v) => <tr key={v.name}><td>{v.name}</td><td>{v.issue}</td><td>{v.redeem}</td><td>{v.notes}</td></tr>)}</tbody>
          </table>
          <p className="ijp-note">
            Sources: <a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/" target="_blank" rel="noopener noreferrer">IETF draft</a>,{" "}
            <a href="https://developer.okta.com/docs/guides/xaa-request-token-ex/main/" target="_blank" rel="noopener noreferrer">Okta XAA</a>,{" "}
            <a href="https://workos.com/blog/mcp-enterprise-managed-authorization-id-jag" target="_blank" rel="noopener noreferrer">WorkOS</a>,{" "}
            <a href="https://www.keycloak.org/nightly/securing-apps/identity-assertion-jwt-authorization-grant" target="_blank" rel="noopener noreferrer">Keycloak</a>,{" "}
            <a href="https://docs.mcpjam.com/inspector/xaa-debugger" target="_blank" rel="noopener noreferrer">MCPJam XAA debugger</a>,{" "}
            <a href="https://developer.okta.com/blog/2026/01/20/xaa-dev-playground" target="_blank" rel="noopener noreferrer">xaa.dev</a>.
          </p>
        </section>
      </main>
    </ViewContext.Provider>
  );
}
