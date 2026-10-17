import { useCallback, useEffect, useState } from "react";
import IdJagPathBar from "../components/IdJagPathBar";
import bffAxios from "../services/bffAxios";
import { openSignIn } from "../utils/signInService";
import "./IdJagPlaygroundPage.css";

// The real PingFederate ID-JAG flow, one step at a time (after Okta's xaa.dev), with a
// spec inspector and live negative tests (after MCPJam's XAA debugger). Raw tokens never
// reach the browser: the BFF returns decoded claims and redacted requests only.

const API = "/api/id-jag-playground";

const SPEC_NOTES = {
  issue: "RFC 8693 token exchange at the IdP with requested_token_type=…:id-jag. audience names the resource authorization server; resource names the MCP server. The IdP decides the scope and returns a short-lived JWT typed oauth-id-jag+jwt in access_token, with token_type N_A.",
  redeem: "RFC 7523 JWT bearer grant at the resource authorization server. It verifies typ, the IdP signature, iss, a single aud equal to its own issuer, exp/iat, and that client_id is the client authenticating now. It grants at most the ID-JAG's scope and mints its own access token. It should not return a refresh token.",
  call: "The ID-JAG stops at the authorization server. The MCP call carries the new access token; the gateway verifies it against oauth-mcp's keys and forwards it. Tools listed here are whatever this token can see in the active vertical.",
  negative: "A resource authorization server must refuse a broken assertion with an OAuth error and no token. Each test mints a fresh ID-JAG, breaks one thing, and checks the refusal.",
};

const VENDORS = [
  { name: "PingFederate 13.1 (this demo)", issue: "Token exchange; subject = refresh token or ID token; SP connection of type OAuth Token Exchange with ID-JAG enabled", redeem: "Also accepts ID-JAG in a JWT bearer grant (IdP connection), not used here: oauth-mcp redeems", notes: "client_id and scope come from the SP connection's attribute mapping: map them to the client at the resource AS and the IT-granted MCP scopes" },
  { name: "Okta (Cross App Access)", issue: "Org authorization server /oauth2/v1/token; subject = ID token or refresh token; client auth private_key_jwt", redeem: "Resource app's own authorization server, JWT bearer, client credentials of the resource app", notes: "Needs a trusted resource connection; resource must match the configured issuer exactly or invalid_target; ID-JAG lives 300 s" },
  { name: "Auth0", issue: "Can act as the requesting side and as the resource authorization server", redeem: "Issues an access token for the Auth0 API", notes: "No refresh token for ID-JAG exchanges" },
  { name: "Keycloak (nightly, experimental)", issue: "Not implemented (receiver only)", redeem: "JWT bearer with an identity-provider alias trusted for the grant; confidential client", notes: "Tracks draft -01; options for assertion reuse and max lifetime" },
  { name: "MCP Enterprise-Managed Authorization", issue: "IdP (Okta first) issues the ID-JAG to the MCP client", redeem: "MCP server's authorization server; confidential clients", notes: "Access token must be audience-restricted to the MCP server named in resource; ID-JAG reusable until it expires" },
];

function Json({ value }) {
  if (value === undefined || value === null) return null;
  return <pre className="ijp-json">{JSON.stringify(value, null, 2)}</pre>;
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

export default function IdJagPlaygroundPage() {
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState("");
  const [issued, setIssued] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [redeemScope, setRedeemScope] = useState("");
  const [redeemed, setRedeemed] = useState(null);
  const [tools, setTools] = useState(null);
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [callResult, setCallResult] = useState(null);
  const [negatives, setNegatives] = useState([]);
  const [negResults, setNegResults] = useState({});
  const [error, setError] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await bffAxios.get(`${API}/config`);
      // An older BFF without this route answers with the SPA's HTML, not JSON.
      if (!data?.idp) throw new Error("This server does not have the ID-JAG playground API yet. Deploy the latest BFF.");
      setConfig(data);
    } catch (e) { setError(e.response?.data || { message: e.message }); }
  }, []);

  useEffect(() => {
    loadConfig();
    bffAxios.get(`${API}/negative`).then((r) => setNegatives(r.data)).catch(() => {});
  }, [loadConfig]);

  const run = async (label, fn) => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError({ step: label, ...(e.response?.data || { message: e.message }) }); } finally { setBusy(""); }
  };

  const signIn = () => run("signin", async () => {
    // Always a PingFederate sign-in: clear whatever session is here first.
    await bffAxios.post("/api/auth/clear-session").catch(() => {});
    // PingFederate's own login page: the real IdP sign-in the ID-JAG is minted from.
    openSignIn({ returnTo: "/pingfederate-id-jag/playground", force: true, redirect: true });
  });

  const issue = () => run("issue", async () => {
    setRedeemed(null); setTools(null); setCallResult(null); setInspection(null);
    const r = await bffAxios.post(`${API}/issue`, {});
    setIssued(r.data);
    setInspection((await bffAxios.post(`${API}/inspect`, {})).data);
  });

  const redeem = () => run("redeem", async () => {
    setTools(null); setCallResult(null);
    const r = await bffAxios.post(`${API}/redeem`, redeemScope.trim() ? { scope: redeemScope.trim() } : {}, { validateStatus: () => true });
    setRedeemed(r.data);
  });

  const listTools = () => run("list", async () => {
    const r = await bffAxios.post(`${API}/call`, {});
    setTools(r.data);
    setTool(r.data.tools?.[0]?.name || "");
  });

  const callTool = () => run("call", async () => {
    let parsed = {};
    try { parsed = JSON.parse(args || "{}"); } catch { throw new Error("Arguments must be JSON"); }
    setCallResult((await bffAxios.post(`${API}/call`, { tool, arguments: parsed })).data);
  });

  const runNegative = (id) => run(`neg-${id}`, async () => {
    const r = await bffAxios.post(`${API}/negative/${id}`, {}, { validateStatus: () => true });
    setNegResults((m) => ({ ...m, [id]: r.data }));
  });

  const runAllNegatives = () => run("neg-all", async () => {
    for (const t of negatives) {
      const r = await bffAxios.post(`${API}/negative/${t.id}`, {}, { validateStatus: () => true });
      setNegResults((m) => ({ ...m, [t.id]: r.data }));
    }
  });

  const pfReady = config && config.provider === "pingfederate" && config.enabled;
  const canRun = pfReady && config.signedIn;
  const passed = inspection ? inspection.checks.filter((c) => c.status === "pass").length : 0;

  return (
    <main className="ijp" data-testid="id-jag-playground">
      <IdJagPathBar current="play" />
      <header className="ijp-hero">
        <p className="ijp-eyebrow">PingFederate · ID-JAG · try it and validate it</p>
        <h1>ID-JAG Playground</h1>
        <p className="ijp-lede">
          Run the real flow one step at a time against this demo's PingFederate and MCP authorization server.
          Every request and response is shown (tokens decoded, never raw), the ID-JAG is checked against the
          IETF draft, and live negative tests confirm the authorization server refuses what it should.
        </p>
      </header>

      {config && (
        <section className="ijp-actors" aria-label="Who plays which role">
          <div className="ijp-actor"><h3>Client</h3><p>This demo's BFF, acting for the agent</p><dl><dt>IdP client</dt><dd>{config.idp.exchangeClientId || "—"}</dd><dt>Client at the AS</dt><dd>{config.resourceAs.clientId || "—"}</dd></dl></div>
          <div className="ijp-actor ijp-actor--idp"><h3>IdP: {config.idp.name}</h3><p>Issues the ID-JAG</p><dl><dt>Issuer</dt><dd>{config.idp.issuer || "—"}</dd><dt>Token endpoint</dt><dd>{config.idp.tokenEndpoint || "—"}</dd><dt>JWKS</dt><dd>{config.idp.jwksUrl || "—"}</dd></dl></div>
          <div className="ijp-actor ijp-actor--as"><h3>Resource AS: {config.resourceAs.name}</h3><p>Redeems the ID-JAG, mints its own token</p><dl><dt>Issuer (aud)</dt><dd>{config.resourceAs.issuer || "—"}</dd><dt>Token endpoint</dt><dd>{config.resourceAs.tokenEndpoint || "—"}</dd></dl></div>
          <div className="ijp-actor"><h3>MCP server</h3><p>Reached through the MCP gateway</p><dl><dt>Resource</dt><dd>{config.request.resource || "—"}</dd><dt>Requested scope</dt><dd>{config.request.scope || "(none)"}</dd></dl></div>
        </section>
      )}

      {config && !pfReady && (
        <div className="ijp-banner" role="alert">
          {config.provider !== "pingfederate"
            ? "The login provider is PingOne. ID-JAG only exists on PingFederate: switch the provider to PingFederate (top-bar P1/PF, admin) and sign in."
            : "pf_id_jag_enabled is off on this BFF."}
        </div>
      )}
      {error && <div className="ijp-banner ijp-banner--error" role="alert"><strong>{error.error || "Error"}</strong> {error.message || error.error_description || ""}</div>}

      <Step n={1} title="Sign in with PingFederate" note="The ID-JAG is minted from your PingFederate session (the refresh token the BFF holds). This always starts a fresh PingFederate sign-in.">
        <p className="ijp-status" data-testid="ijp-signin-status">{config?.signedIn ? "Signed in with PingFederate." : "Not signed in with PingFederate."}</p>
        <button type="button" className="ijp-btn ijp-btn--primary" onClick={signIn} disabled={!pfReady || !!busy}>
          {config?.signedIn ? "Sign in again" : "Sign in with PingFederate"}
        </button>
      </Step>

      <Step n={2} title="Get an ID-JAG from PingFederate" note={SPEC_NOTES.issue}>
        <button type="button" className="ijp-btn ijp-btn--primary" onClick={issue} disabled={!canRun || !!busy}>{busy === "issue" ? "Requesting…" : "Request ID-JAG"}</button>
        {issued && (
          <div className="ijp-io">
            <div><h4>Request</h4><Json value={issued.request} /></div>
            <div><h4>Response</h4><Json value={issued.response} /></div>
            <div><h4>Decoded ID-JAG</h4><Json value={issued.token} /></div>
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

      <Step n={3} title="Redeem it at the MCP authorization server" note={SPEC_NOTES.redeem}>
        <label className="ijp-field">Ask for a narrower scope (optional)
          <input value={redeemScope} onChange={(e) => setRedeemScope(e.target.value)} placeholder="e.g. accounts:read" />
        </label>
        <button type="button" className="ijp-btn ijp-btn--primary" onClick={redeem} disabled={!canRun || !issued || !!busy}>{busy === "redeem" ? "Redeeming…" : "Redeem ID-JAG"}</button>
        {redeemed && (
          <div className="ijp-io">
            <div><h4>Request</h4><Json value={redeemed.request} /></div>
            <div><h4>Response (HTTP {redeemed.status})</h4><Json value={redeemed.response} /></div>
            {redeemed.token && <div><h4>Decoded access token</h4><Json value={redeemed.token} /></div>}
          </div>
        )}
      </Step>

      <Step n={4} title="Call the MCP server with the new token" note={SPEC_NOTES.call}>
        <button type="button" className="ijp-btn" onClick={listTools} disabled={!canRun || !redeemed?.token || !!busy}>{busy === "list" ? "Listing…" : "List tools this token can see"}</button>
        {tools && (
          <div className="ijp-call">
            <label className="ijp-field">Tool
              <select value={tool} onChange={(e) => setTool(e.target.value)}>
                {(tools.tools || []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </label>
            <label className="ijp-field">Arguments (JSON)
              <textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <button type="button" className="ijp-btn ijp-btn--primary" onClick={callTool} disabled={!tool || !!busy}>{busy === "call" ? "Calling…" : "Call tool"}</button>
            <p className="ijp-note">{(tools.tools || []).length} tools listed.</p>
          </div>
        )}
        {callResult && <div className="ijp-io"><div><h4>Request</h4><Json value={callResult.request} /></div><div><h4>Result</h4><Json value={callResult.result} /></div></div>}
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
  );
}
