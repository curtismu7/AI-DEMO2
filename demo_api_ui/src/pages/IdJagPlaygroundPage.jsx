import { createContext, Fragment, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import IdJagPathBar from "../components/IdJagPathBar";
import { diagramLinkProps } from "../utils/diagramLinks";
import { PLAYGROUND_DIAGRAMS, playgroundDiagramPath } from "../utils/idJagPlaygroundDiagrams";
import bffAxios from "../services/bffAxios";
import { openSignIn } from "../utils/signInService";
import { MOCK_CONFIG, mockApi } from "../utils/idJagPlaygroundMock";
import { codeSnippet } from "../utils/codeSnippet";
import { mcpcCommand, vscodeMcpJson, vscodeSettings } from "../utils/realClients";
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
  { id: "byo", label: "Your IdP → our resource AS" },
];
const BYO_TARGETS = [{ id: "oauth-mcp", label: "oauth-mcp" }, { id: "pingfederate", label: "PingFederate" }];
const VIEWS = [{ id: "form", label: "Form" }, { id: "json", label: "JSON" }, { id: "code", label: "Code" }];
// The standalone kit's PingFederate and sample MCP server: the real clients (mcpc, VS Code) sign in there.
const KIT = { pfUrl: "https://cmuir-pf.ping-devops.com", mcpUrl: "http://localhost:19090/mcp" };
const ON_LOCALHOST = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const XAA_BUTTON = "Get an ID-JAG from xaa.dev (IdenX, a free third-party IdP)";

const stored = (key, allowed, fallback) => {
  try { const v = localStorage.getItem(key); return allowed.some((a) => a.id === v) ? v : fallback; } catch { return fallback; }
};
const store = (key, v) => { try { localStorage.setItem(key, v); } catch { /* storage blocked: not remembered */ } };

const SPEC_NOTES = {
  issue: "RFC 8693 token exchange at the IdP with requested_token_type=…:id-jag. audience names the resource authorization server; resource names the MCP server. The IdP decides the scope and returns a short-lived JWT typed oauth-id-jag+jwt in access_token, with token_type N_A.",
  redeem: "RFC 7523 JWT bearer grant at the resource authorization server. It verifies typ, the IdP signature, iss, a single aud equal to its own issuer, exp/iat, and that client_id is the client authenticating now. It grants at most the ID-JAG's scope and mints its own access token. It should not return a refresh token.",
  negative: "A resource authorization server must refuse a broken assertion with an OAuth error and no token. Each test mints a fresh ID-JAG, breaks one thing, and checks the refusal.",
  negativeByo: "A resource authorization server must refuse a broken assertion with an OAuth error and no token. We cannot mint at your IdP, so each test reuses your pasted ID-JAG and breaks one thing. Replay is skipped: it would use up your token.",
  revoke: "Control first: the exchange must work before revoking, or a later refusal proves nothing. Then the issuer revokes this session's refresh token (RFC 7009) and the exchange is tried again. Proved means the retry is refused with an OAuth error (invalid_request, or invalid_grant). Revoking ends this session at the issuer, so sign in again to continue.",
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
  byo: {
    signInTitle: "Paste an ID-JAG from your IdP",
    signInNote: "No sign-in here: your own IdP issued this ID-JAG. Its issuer must be on the Trusted IdPs list below, aud must be the issuer of the authorization server you pick, and client_id the value registered for your IdP. The BFF keeps the token server-side and shows only its decoded claims.",
    redeemTitle: "Redeem it at our resource authorization server",
    asRole: "Trusts your IdP's keys, redeems the ID-JAG, mints its own token",
    mcpRole: "Reached through the MCP gateway",
    call: "The ID-JAG stops at our authorization server. The MCP call carries the access token it minted; the gateway validates that token and forwards it. Tools listed here are whatever this token can see in the active vertical.",
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

// A request the page shows (endpoint + body, or method + url): the Code view turns it into fetch().
const isRequest = (v) => !!v && typeof v === "object" && (typeof v.endpoint === "string" || (typeof v.url === "string" && typeof v.method === "string"));

function Data({ value }) {
  const view = useContext(ViewContext);
  if (value === undefined || value === null) return null;
  if (view === "code" && isRequest(value)) return <pre className="ijp-json ijp-code" data-testid="ijp-code">{codeSnippet(value)}</pre>;
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

/** A link to this mode's diagram (step `step` lit); diagrams always open in a new tab. */
function DiagramLink({ mode, step, children }) {
  const to = playgroundDiagramPath(mode, step);
  return <Link className="ijp-diagram-link" to={to} {...diagramLinkProps(to)}>{children}</Link>;
}

function Step({ n, title, note, mode, noDiagram, children }) {
  return (
    <section className="ijp-step" aria-labelledby={`ijp-step-${n}`}>
      <header className="ijp-step__head">
        <span className="ijp-step__n">{n}</span>
        <h2 id={`ijp-step-${n}`}>{title}</h2>
        {!noDiagram && <DiagramLink mode={mode} step={n}>see step {n} on the diagram ↗</DiagramLink>}
      </header>
      {note && <p className="ijp-note">{note}</p>}
      {children}
    </section>
  );
}

/** Which backends answer right now (IdP, resource AS). The newest probe wins: an older one (another mode) may land later. */
function BackendsStrip({ api, mode }) {
  const [list, setList] = useState(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const probe = () => {
    const n = ++seq.current;
    setChecking(true);
    api.get(`${API}/backends`)
      .then((r) => n === seq.current && setList(Array.isArray(r.data?.backends) ? r.data.backends : []))
      .catch(() => n === seq.current && setList([]))
      .finally(() => n === seq.current && setChecking(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(probe, [api, mode]);
  return (
    <div className="ijp-backends" data-testid="ijp-backends" role="group" aria-label="Backends">
      <span className="ijp-backends__label" aria-hidden="true">Backends</span>
      <span className="ijp-backends__list" aria-live="polite">
        {(list || []).map((b) => (
          <span key={b.id} className={`ijp-chip is-${b.state}`} title={b.url}>
            <span className="ijp-chip__led" aria-hidden="true" /><span>{b.label}</span>
            <span className="ijp-chip__state">{b.state === "up" ? "up" : `${b.state}: ${b.detail}`}</span>
          </span>
        ))}
      </span>
      {list && list.length === 0 && <span className="ijp-note">Could not check the backends.</span>}
      <button type="button" className="ijp-btn" onClick={probe} disabled={checking}>{checking ? "Checking…" : "Re-check"}</button>
    </div>
  );
}

/** The verdict line for a revoke-and-prove run. */
function revokeVerdict(r) {
  if (r.proved) return `Proved: the issuer refused a new ID-JAG (${r.retry.error}).`;
  if (!r.control.ok) return `Not proved: the exchange already fails before revoking (${r.control.error || `HTTP ${r.control.status}`}), so nothing was revoked.`;
  if (r.revoke.status !== 200) return `Not proved: the issuer did not accept the revocation (HTTP ${r.revoke.status}${r.revoke.error ? `, ${r.revoke.error}` : ""}).`;
  if (r.retry.ok) return "Not proved: the issuer still issued an ID-JAG.";
  return `Not proved: the retry failed without an OAuth refusal (HTTP ${r.retry.status}).`;
}

/** Real MCP clients against the standalone kit's sample server. Shown on localhost only: the kit runs there. */
function RealClients() {
  return (
    <details className="ijp-real" data-testid="ijp-real-clients">
      <summary>Try it with a real MCP client (needs the standalone kit running locally)</summary>
      <p className="ijp-note">
        mcpc and VS Code sign in at the kit's PingFederate and call its sample MCP server at {KIT.mcpUrl}. Start the kit first
        (<code>docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.desktop-clients.yml up -d</code> in its repo).
      </p>
      <h4>mcpc</h4>
      <pre className="ijp-code">{mcpcCommand({ pfUrl: KIT.pfUrl, mcpUrl: KIT.mcpUrl })}</pre>
      <h4>VS Code: user settings</h4>
      <pre className="ijp-code">{vscodeSettings({ pfUrl: KIT.pfUrl })}</pre>
      <h4>VS Code: .vscode/mcp.json</h4>
      <pre className="ijp-code">{vscodeMcpJson({ mcpUrl: KIT.mcpUrl })}</pre>
    </details>
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

const EMPTY_IDP = { id: "", name: "", issuer: "", jwksUrl: "", idJagClientId: "", clientId: "demo-bff-mcp-client", pfClientId: "ai-demo-pf-idjag-redeemer", scopes: "", targets: ["oauth-mcp"], enabled: true };
const IDP_FIELDS = [
  ["id", "Id (slug)"], ["name", "Name"], ["issuer", "Issuer (https)"], ["jwksUrl", "JWKS URL (https)"],
  ["idJagClientId", "client_id your IdP writes in the ID-JAG"], ["clientId", "Our client at oauth-mcp"],
  ["pfClientId", "Our client at PingFederate"], ["scopes", "Scope cap (space-separated, optional)"],
];
const errText = (e) => e.response?.data?.message || e.response?.data?.error || e.message;

const OIDC_ONLY = new Set(["openid", "profile", "email", "offline_access", "phone", "address"]);
/** The scopes an ID-JAG grants at the MCP server (login-only scopes grant nothing there). */
const scopesOf = (claims) => (Array.isArray(claims?.scope) ? claims.scope : String(claims?.scope || "").split(/\s+/))
  .filter((s) => s && !OIDC_ONLY.has(s));

/** Plain guidance for the OAuth and gateway errors people actually hit here. */
function explain(e, resource) {
  if (!e) return null;
  const text = [e.error, e.error_description, e.pfError, e.pfErrorDescription, e.gatewayErrorCode, e.gatewayMessage, e.message].filter(Boolean).join(" ");
  if (/invalid jwt token/i.test(text)) {
    return "PingFederate could not verify the ID-JAG's signature. Its consumer cannot pick a key by x5t, so the issuer's JWKS must hold a single RSA key, or the local PingFederate still has an older copy of that JWKS cached. Publish a single-key JWKS at the issuer, then re-save the IdP connection (or restart the local PingFederate) so it fetches it again.";
  }
  if (/invalid_target/i.test(text)) {
    return `The authorization server knows no resource ${resource || "matching the request"}. On PingFederate, add it to the Resource URIs of the access token manager that mints this token, then request a new ID-JAG.`;
  }
  if (/intent_mismatch/i.test(text)) {
    return `The gateway's intent policy refused this call: ${e.gatewayMessage || e.message}. The token's intent does not cover this tool; call a tool that matches what the token was issued for.`;
  }
  if (/already (been )?(used|redeemed)|replay|jti.*(used|seen)/i.test(text)) {
    return "This ID-JAG was already redeemed, and each one is single-use. Request a new ID-JAG (step 2), then redeem that one.";
  }
  if (/expired/i.test(text)) return "It expired: ID-JAGs live about 5 minutes. Request a new ID-JAG (step 2) and redeem it (step 3).";
  return null;
}

function ErrorNote({ e, resource }) {
  const hint = explain(e, resource);
  return (
    <div className="ijp-banner ijp-banner--error" role="alert">
      <strong>{e.error || "Error"}</strong> {e.message || e.error_description || ""}{e.pfErrorDescription ? ` (${e.pfErrorDescription})` : ""}
      {e.gatewayStatus && (
        <div className="ijp-cite">
          Gateway answered HTTP {e.gatewayStatus}{e.gatewayErrorCode ? ` ${e.gatewayErrorCode}` : ""}{e.gatewayMessage && e.gatewayMessage !== e.message ? `: ${e.gatewayMessage}` : ""}
        </div>
      )}
      {hint && <p className="ijp-fix">{hint}</p>}
    </div>
  );
}

/** What the pre-flight found before a button was allowed to send anything. */
function PreflightPanel({ gate, onRecheck, busy }) {
  const title = !gate.ok ? "Pre-flight: fix this first, nothing was sent"
    : gate.checks.length ? "Pre-flight: warnings (sent anyway)" : "Pre-flight: All checks pass. Run the step again.";
  return (
    <div className={`ijp-preflight${gate.ok ? "" : " is-fail"}`} role={gate.ok ? "status" : "alert"} data-testid="ijp-preflight">
      <h4>{title}</h4>
      {gate.checks.length > 0 && (
        <ul>
          {gate.checks.map((c) => (
            <li key={c.id} className={`is-${c.status}`}>
              <span className="ijp-preflight__tag">{c.status === "fail" ? "Fail" : "Warn"}</span>
              <div><strong>{c.label}</strong> {c.detail}{c.fix && <p className="ijp-fix">{c.fix}</p>}</div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="ijp-btn" onClick={onRecheck} disabled={busy}>{busy ? "Checking…" : "Re-check"}</button>
    </div>
  );
}

/** Time left on an ID-JAG or access token; stale once expired or used. */
function Lifetime({ id, label, exp, used, now, again }) {
  if (typeof exp !== "number") return null;
  const left = exp - Math.floor(now / 1000);
  const stale = used || left <= 0;
  const text = used ? `redeemed (single-use). ${again}` : left <= 0 ? `expired. ${again}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
  return <p className={`ijp-life${stale ? " is-stale" : ""}`} data-testid={`ijp-life-${id}`}><strong>{label}:</strong> {text}</p>;
}

/** The resource server's answer, drawn as the small app page it protects. */
function ResourcePage({ r }) {
  const b = r.body && typeof r.body === "object" ? r.body : {};
  const ok = r.status === 200;
  const verified = Array.isArray(b.verified) ? b.verified : [];
  const failed = verified.find((v) => !v.ok);
  const subject = String(b.data?.subject || b.principal?.sub || "");
  return (
    <div className="ijp-page" data-testid="ijp-resource-page">
      <div className="ijp-page__bar">
        <span className="ijp-page__method">{r.request?.method || "GET"}</span>
        <span className="ijp-page__url">{r.request?.url}</span>
        <span className={`ijp-pill ${ok ? "is-ok" : "is-bad"}`}>{r.status} {ok ? "OK" : b.error || "refused"}</span>
      </div>
      <p className="ijp-cite">Authorization: {r.request?.authorization}</p>
      {!ok && (
        <div className="ijp-banner ijp-banner--error" role="alert">
          The resource server refused: {failed ? `${failed.check} check failed. ${failed.detail}` : b.error_description || b.error || `HTTP ${r.status}`}
        </div>
      )}
      <div className="ijp-page__grid">
        {b.principal && (
          <div className="ijp-page__card">
            <h4>Who the resource server says you are</h4>
            <dl className="ijp-kv">
              <dt>sub</dt><dd>{b.principal.sub}</dd>
              <dt>client_id</dt><dd>{b.principal.client_id ?? "(none)"}</dd>
              <dt>scope</dt><dd>{b.principal.scope || "(none)"}</dd>
            </dl>
          </div>
        )}
        {verified.length > 0 && (
          <div className="ijp-page__card">
            <h4>How it verified the token</h4>
            <ul className="ijp-verify">
              {verified.map((v) => (
                <li key={v.check} className={v.ok ? "is-pass" : "is-fail"}>
                  <span className="ijp-verify__mark" aria-hidden="true">{v.ok ? "✔" : "✗"}</span>
                  <div><span className="ijp-sr">{v.ok ? "pass" : "fail"}</span><strong>{v.check}</strong> <span className="ijp-cite">{v.detail}</span></div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {b.data && (
          <div className="ijp-page__card ijp-page__profile">
            <h4>Protected data</h4>
            <div className="ijp-profile">
              <span className="ijp-profile__avatar" aria-hidden="true">{subject.slice(0, 2).toUpperCase() || "?"}</span>
              <div><strong>{subject}</strong><div className="ijp-cite">{b.data.profileId}</div></div>
            </div>
            <dl className="ijp-kv">
              {Object.entries(b.data).filter(([k]) => !["subject", "profileId"].includes(k)).map(([k, v]) => (
                <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

/** Registry of outside IdPs whose ID-JAGs our resource authorization servers accept. Admins edit; others read. */
function TrustedIdpsPanel({ api, endpoints }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmId, setConfirmId] = useState("");
  const [err, setErr] = useState("");

  const load = () => api.get(`${API}/trusted-idps`, { _noAuthBanner: true })
    .then((r) => setState(r.data))
    .catch((e) => setState(e.response?.status === 401 ? { signedOut: true } : { error: errText(e) }));
  // Reload when the mode swaps the mock and real API.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(null); setConfirmId(""); setErr(""); load(); }, [api]);

  const write = async (fn) => {
    setErr("");
    try { await fn(); setForm(null); setConfirmId(""); await load(); } catch (e) { setErr(errText(e)); }
  };
  const save = (e) => {
    e.preventDefault();
    const { editing, ...body } = form;
    write(() => (editing ? api.put(`${API}/trusted-idps/${editing}`, body) : api.post(`${API}/trusted-idps`, body)));
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleTarget = (t) => setForm((f) => ({ ...f, targets: f.targets.includes(t) ? f.targets.filter((x) => x !== t) : [...f.targets, t] }));
  const canManage = !!state?.canManage;

  return (
    <section className="ijp-step" aria-labelledby="ijp-trusted" data-testid="ijp-trusted-idps">
      <header className="ijp-step__head"><h2 id="ijp-trusted">Trusted IdPs</h2></header>
      <p className="ijp-note">
        Outside IdPs whose ID-JAGs our resource authorization servers accept in the "Your IdP" mode. oauth-mcp reads the enabled entries from
        {" "}<strong>{API}/trusted-idps/registry</strong>; a PingFederate sync reads <strong>{API}/trusted-idps/pingfederate</strong>. Neither holds a secret.
      </p>
      {!state && <p className="ijp-note">Loading…</p>}
      {state?.signedOut && <p className="ijp-note" data-testid="ijp-trusted-signin">Sign in to see the trusted IdPs. Only admins can add or change them.</p>}
      {state?.error && <div className="ijp-banner ijp-banner--error" role="alert">{state.error}</div>}
      {state?.idps && !canManage && <p className="ijp-note" data-testid="ijp-trusted-readonly">Read only: an admin adds and edits trusted IdPs.</p>}
      {err && <div className="ijp-banner ijp-banner--error" role="alert">{err}</div>}
      {state?.idps && (
        state.idps.length === 0 ? <p className="ijp-note">No trusted IdPs yet.</p> : (
          <div className="ijp-checks">
            <table>
              <thead><tr><th>IdP</th><th>Issuer</th><th>Targets</th><th>What the IdP puts in the ID-JAG, and where it is redeemed</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>
                {state.idps.map((e) => (
                  <tr key={e.id} className={e.enabled ? "" : "is-warn"}>
                    <td><strong>{e.name}</strong><div className="ijp-cite">{e.id}{e.enabled ? "" : " (disabled)"}</div></td>
                    <td>{e.issuer}<div className="ijp-cite">JWKS {e.jwksUrl}</div></td>
                    <td>{e.targets.join(", ")}{e.scopes && <div className="ijp-cite">scope cap: {e.scopes}</div>}</td>
                    <td>
                      {e.targets.map((t) => (
                        <dl key={t} className="ijp-kv">
                          <dt>{t === "pingfederate" ? "PingFederate" : "oauth-mcp"} aud</dt><dd>{endpoints?.[t]?.issuer || "(not configured)"}</dd>
                          <dt>client_id</dt><dd>{e.idJagClientId}</dd>
                          <dt>token endpoint</dt><dd>{endpoints?.[t]?.tokenEndpoint || "(not configured)"}</dd>
                        </dl>
                      ))}
                    </td>
                    {canManage && (
                      <td>
                        {confirmId === e.id ? (
                          <span role="group" aria-label={`Confirm delete ${e.name}`}>
                            Delete {e.name}?{" "}
                            <button type="button" className="ijp-btn ijp-btn--primary" onClick={() => write(() => api.delete(`${API}/trusted-idps/${e.id}`))}>Confirm delete</button>
                            <button type="button" className="ijp-btn" onClick={() => setConfirmId("")}>Cancel</button>
                          </span>
                        ) : (
                          <>
                            <button type="button" className="ijp-btn" onClick={() => setForm({ ...EMPTY_IDP, ...e, editing: e.id })}>Edit</button>
                            <button type="button" className="ijp-btn" onClick={() => setConfirmId(e.id)}>Delete</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {canManage && !form && <button type="button" className="ijp-btn ijp-btn--primary" onClick={() => setForm({ ...EMPTY_IDP, editing: null })}>Add trusted IdP</button>}
      {form && (
        <form onSubmit={save} aria-label={form.editing ? "Edit trusted IdP" : "Add trusted IdP"}><fieldset className="ijp-args">
          <legend>{form.editing ? `Edit ${form.editing}` : "Add trusted IdP"}</legend>
          {IDP_FIELDS.map(([k, label]) => (
            <label key={k} className="ijp-field">{label}
              <input value={form[k]} disabled={k === "id" && !!form.editing} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <fieldset className="ijp-targets"><legend>Targets</legend>
            {BYO_TARGETS.map((t) => (
              <label key={t.id} className="ijp-check"><input type="checkbox" checked={form.targets.includes(t.id)} onChange={() => toggleTarget(t.id)} />{t.label}</label>
            ))}
          </fieldset>
          <label className="ijp-check"><input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />Enabled</label>
          <button type="submit" className="ijp-btn ijp-btn--primary">Save</button>
          <button type="button" className="ijp-btn" onClick={() => setForm(null)}>Cancel</button>
        </fieldset></form>
      )}
    </section>
  );
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
  const [revoked, setRevoked] = useState(null);
  const [byoTarget, setByoTarget] = useState("oauth-mcp");
  const [byoToken, setByoToken] = useState("");
  const [error, setError] = useState(null);
  const [gate, setGate] = useState(null);
  const [resource, setResource] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const location = useLocation();
  const navigate = useNavigate();

  const isMock = mode === "mock";
  const isByo = mode === "byo";
  const api = isMock ? mockApi : bffAxios;

  // The current ID-JAG's claims drive the scope list and the lifetime clocks.
  const idJagClaims = isByo ? (inspection?.trusted ? inspection.claims : null) : issued?.token?.claims;
  const scopeOptions = scopesOf(idJagClaims);
  const scopePick = scopeOptions.includes(redeemScope) ? redeemScope : ""; // a pick the new ID-JAG lacks falls back to all
  const tokenExp = redeemed?.token?.claims?.exp;
  useEffect(() => {
    if (typeof idJagClaims?.exp !== "number" && typeof tokenExp !== "number") return undefined;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [idJagClaims?.exp, tokenExp]);

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
        // Back from the IdenX sign-in (/xaa/callback): get the ID-JAG at once, or say why sign-in failed.
        const back = new URLSearchParams(location.search);
        if (back.has("xaa") || back.has("xaa_error")) navigate(location.pathname, { replace: true });
        if (back.get("xaa_error")) setError({ step: "xaa", error: "xaa_sign_in_failed", message: `IdenX sign-in did not complete (${back.get("xaa_error")}).` });
        else if (back.get("xaa") === "signed_in" && mode === "byo") run("xaa", loadXaaIdJag, checkFor("xaa"));
      } catch (e) { setError(e.response?.data || { message: e.message }); }
    })();
    loadNegatives(bffAxios);
    // Initial load only: later mode changes go through pickMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearResults = () => {
    setIssued(null); setInspection(null); setRedeemed(null); setTools(null); setCallResult(null); setNegResults({}); setResource(null); setGate(null); setRevoked(null);
  };

  /**
   * Ask the BFF whether this step can work right now. Failing checks block the action and stay on
   * screen with their fix; warnings show and let it through. recheck bypasses the BFF's 30 s cache.
   */
  const passes = async (step, params = {}, recheck = false) => {
    let r;
    try {
      ({ data: r } = await bffAxios.get(`${API}/preflight`, { params: { step, mode, origin: window.location.origin, ...params, ...(recheck ? { fresh: "1" } : {}) } }));
      if (!Array.isArray(r?.checks)) throw new Error("This server has no pre-flight checks yet. Deploy the latest BFF.");
    } catch (e) {
      r = { checks: [{ id: "preflight", label: "Pre-flight checks ran", status: "fail", detail: errText(e), fix: "Reload the page. If this persists, the BFF is down or older than this page." }] };
    }
    const ok = !r.checks.some((c) => c.status === "fail");
    const shown = r.checks.filter((c) => c.status !== "pass");
    setGate(shown.length || recheck ? { step, params, ok, checks: shown } : null);
    return ok;
  };

  // Every action button goes through here: pre-flight first (real modes), then the action.
  const run = async (label, fn, check) => {
    setBusy(label);
    setError(null);
    try {
      if (check && !(await passes(check.step, check.params))) return;
      await fn();
    } catch (e) { setError({ step: label, ...(e.response?.data || { message: e.message }) }); } finally { setBusy(""); }
  };
  // Mock mode sends nothing, so it has nothing to pre-flight.
  const checkFor = (step, params) => (isMock ? null : { step, params });

  const recheck = () => {
    setBusy("recheck");
    passes(gate.step, gate.params, true).finally(() => setBusy(""));
  };

  const pickMode = (m) => {
    if (m === mode) return;
    if (m === "mock") {
      store(MODE_KEY, m); clearResults(); setMode(m); setError(null); setConfig(MOCK_CONFIG); loadNegatives(mockApi);
      return;
    }
    run("mode", async () => {
      store(MODE_KEY, m);
      clearResults();
      setMode(m);
      applyConfig((await bffAxios.post(`${API}/mode`, { mode: m })).data);
      if (isMock) loadNegatives(bffAxios);
    }, { step: "mode", params: { mode: m } });
  };

  const pickView = (v) => { store(VIEW_KEY, v); setView(v); };

  const signIn = () => run("signin", async () => {
    if (mode === "pf-pf") {
      // Sign in at the issuer PingFederate, not the app's own provider.
      window.location.assign(`${API}/issuer/login?return_to=${RETURN_TO}`);
      return;
    }
    // Always a PingFederate sign-in: clear whatever session is here first.
    await bffAxios.post("/api/auth/clear-session").catch(() => {});
    // PingFederate's own login page: the real IdP sign-in the ID-JAG is minted from.
    openSignIn({ returnTo: RETURN_TO, force: true, redirect: true });
  }, checkFor("signin"));

  // byo: the browser sends the user's own ID-JAG once; the BFF keeps it and returns decoded claims.
  const byoInspect = () => run("byo", async () => {
    clearResults();
    const { data } = await bffAxios.post(`${API}/byo/inspect`, { idJag: byoToken.trim(), target: byoTarget });
    if (data.config) applyConfig(data.config);
    setInspection(data);
  }, checkFor("issue", { target: byoTarget }));

  // xaa.dev: IdenX (Okta's public playground IdP) issues the ID-JAG. The BFF signs in there, exchanges, and
  // loads the ID-JAG like a pasted one. Mock mode answers with a sample IdenX ID-JAG.
  const loadXaaIdJag = async () => {
    clearResults(); setByoTarget("oauth-mcp");
    let data;
    try {
      ({ data } = await api.post(`${API}/xaa/id-jag`, {}));
    } catch (e) {
      // The BFF may have dropped the IdenX session (refused refresh token): refresh so the button signs in again.
      bffAxios.get(`${API}/config`).then((r) => applyConfig(r.data)).catch(() => {});
      throw e;
    }
    if (data.config) applyConfig(data.config);
    if (isMock) setIssued(data);
    setInspection(data);
  };
  const xaaIdJag = () => run("xaa", async () => {
    if (!isMock && !config?.xaa?.signedIn) {
      window.location.assign(`${API}/xaa/login?return_to=${RETURN_TO}`);
      return;
    }
    await loadXaaIdJag();
  }, checkFor("xaa"));

  const issue = () => run("issue", async () => {
    setRedeemed(null); setTools(null); setCallResult(null); setInspection(null); setResource(null);
    const r = await api.post(`${API}/issue`, {});
    setIssued(r.data);
    setInspection((await api.post(`${API}/inspect`, {})).data);
  }, checkFor("issue"));

  // No scope = everything the ID-JAG grants (the AS gives ID-JAG ∩ client): the working default.
  const scopeBody = scopePick ? { scope: scopePick } : {};
  const redeem = () => run("redeem", async () => {
    setTools(null); setCallResult(null);
    const r = await api.post(`${API}/redeem`, scopeBody, { validateStatus: () => true });
    // A refusal before the AS (sign-in, scope guard) has no request to show: report it as an error.
    if (!r.data?.request) throw Object.assign(new Error(r.data?.message || `Redeem failed (HTTP ${r.status})`), { response: r });
    setRedeemed(r.data);
  }, checkFor("redeem", scopeBody));

  const pickTool = (name) => { setTool(name); setArgForm({}); };

  const listTools = () => run("list", async () => {
    setTools(null); setCallResult(null);
    const r = await api.post(`${API}/call`, {});
    setTools(r.data);
    pickTool(r.data.tools?.[0]?.name || "");
  }, checkFor("call"));

  const openResource = (variant) => run("resource", async () => {
    const r = await api.post(`${API}/resource`, { variant }, { validateStatus: () => true });
    if (!r.data?.request) throw Object.assign(new Error(r.data?.message || `HTTP ${r.status}`), { response: r });
    setResource(r.data);
  }, checkFor("resource", { variant }));

  const selected = (tools?.tools || []).find((t) => t.name === tool);
  const schemaProps = selected?.inputSchema?.properties;
  const required = selected?.inputSchema?.required || [];
  const useArgForm = view === "form" && schemaProps && Object.keys(schemaProps).length > 0;

  const callTool = () => run("call", async () => {
    let parsed = {};
    if (useArgForm) parsed = buildArgs(schemaProps, argForm);
    else { try { parsed = JSON.parse(args || "{}"); } catch { throw new Error("Arguments must be JSON"); } }
    setCallResult(null);
    setCallResult((await api.post(`${API}/call`, { tool, arguments: parsed })).data);
  }, checkFor("call"));

  // Revoke and prove it: the issuer's session ends, so everything this session minted is cleared with it.
  const revokeAndProve = () => run("revoke", async () => {
    const r = await api.post(`${API}/revoke`, {});
    setIssued(null); setInspection(null); setRedeemed(null); setTools(null); setCallResult(null); setResource(null);
    setRevoked(r.data);
    if (!isMock) applyConfig((await bffAxios.get(`${API}/config`)).data);
  }, checkFor("revoke"));

  const runNegative = (id) => run(`neg-${id}`, async () => {
    const r = await api.post(`${API}/negative/${id}`, {}, { validateStatus: () => true });
    setNegResults((m) => ({ ...m, [id]: r.data }));
  }, checkFor("negative"));

  const runAllNegatives = () => run("neg-all", async () => {
    for (const t of negatives) {
      const r = await api.post(`${API}/negative/${t.id}`, {}, { validateStatus: () => true });
      setNegResults((m) => ({ ...m, [t.id]: r.data }));
    }
  }, checkFor("negative"));

  const text = MODE_TEXT[mode];
  // Each step shows the pre-flight result for its own button (byo's Inspect is step 1's).
  const gateAt = (panel) => gate && ((gate.step === "issue" && isByo) || gate.step === "xaa" ? "signin" : gate.step) === panel
    && <PreflightPanel gate={gate} onRecheck={recheck} busy={!!busy} />;
  const errorAt = (...steps) => (error && steps.includes(error.step) ? <ErrorNote e={error} resource={config?.request?.resource} /> : null);
  const toolList = tools?.tools || [];
  const pfRedeems = mode === "pf-pf" || config?.target === "pingfederate";
  const pfReady = !!config && (isMock || isByo || (mode === "pf-pf" ? !!config.enabled : config.provider === "pingfederate" && config.enabled));
  const canRun = pfReady && (isMock || isByo || config.signedIn);
  const hasIdJag = isByo ? !!inspection?.trusted : !!issued;
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

        <p className="ijp-note"><Link to="/pingfederate-id-jag/learn">Learn the ID-JAG terms and sources ↗</Link></p>

        <div className="ijp-toolbar">
          <div className="ijp-toolbar__group"><span>Mode</span><Segmented label="Playground mode" options={modeOptions} value={mode} onPick={pickMode} disabled={!!busy} />
            <DiagramLink mode={mode}>View {PLAYGROUND_DIAGRAMS[mode].label} diagram ↗</DiagramLink></div>
          <div className="ijp-toolbar__group"><span>View</span><Segmented label="Data view" options={VIEWS} value={view} onPick={pickView} /></div>
        </div>
        {gateAt("mode")}
        <BackendsStrip api={api} mode={mode} />
        {isMock &&<p className="ijp-mock-badge" role="status" data-testid="ijp-mock-badge">Mock: sample data, nothing is sent</p>}

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
        {error && !["list", "call", "resource"].includes(error.step) && <ErrorNote e={error} resource={config?.request?.resource} />}

        <Step n={1} mode={mode} title={text.signInTitle} note={text.signInNote}>
          {(isByo || isMock) && (
            <div className="ijp-xaa" data-testid="ijp-xaa">
              <button type="button" className="ijp-btn ijp-btn--primary" onClick={xaaIdJag} disabled={!config?.xaa?.available || !!busy}>
                {busy === "xaa" ? "Getting an ID-JAG…" : XAA_BUTTON}
              </button>
              <p className="ijp-note">
                <a href="https://xaa.dev" target="_blank" rel="noopener noreferrer">xaa.dev</a> is Okta's free Cross App Access playground:
                its IdP, IdenX, signs you in with any email and any 6-digit code and issues an ID-JAG addressed to our oauth-mcp.
                {config?.xaa?.signedIn && config.xaa.user ? ` Signed in at IdenX as ${config.xaa.user}.` : ""}
              </p>
              {config?.xaa && !config.xaa.available && <p className="ijp-note" role="note" data-testid="ijp-xaa-reason">{config.xaa.reason}</p>}
            </div>
          )}
          {isByo ? (
            <>
              <div className="ijp-toolbar__group"><span>Redeem at</span><Segmented label="Target authorization server" options={BYO_TARGETS} value={byoTarget} onPick={setByoTarget} disabled={!!busy} /></div>
              <p className="ijp-note">Your ID-JAG's aud must be <strong>{config?.publicEndpoints?.[byoTarget]?.issuer || "(not configured)"}</strong>.</p>
              <label className="ijp-field ijp-field--wide">Your ID-JAG (compact JWT)
                <textarea rows={4} value={byoToken} spellCheck={false} autoComplete="off" placeholder="eyJ…" onChange={(e) => setByoToken(e.target.value)} />
              </label>
              <button type="button" className="ijp-btn ijp-btn--primary" onClick={byoInspect} disabled={!byoToken.trim() || !!busy}>{busy === "byo" ? "Inspecting…" : "Inspect ID-JAG"}</button>
              {inspection?.trusted === false && <div className="ijp-banner" role="alert" data-testid="ijp-byo-hint">{inspection.hint}</div>}
            </>
          ) : (
            <>
              <p className="ijp-status" data-testid="ijp-signin-status">{signInStatus}</p>
              <button type="button" className="ijp-btn ijp-btn--primary" onClick={signIn} disabled={isMock || !pfReady || !!busy}>
                {config?.signedIn && !isMock ? "Sign in again" : text.signInTitle}
              </button>
            </>
          )}
          {gateAt("signin")}
          {ON_LOCALHOST && <RealClients />}
        </Step>

        <Step n={2} mode={mode} title={isByo ? "Check your ID-JAG against the draft" : "Get an ID-JAG from PingFederate"} note={isByo ? null : SPEC_NOTES.issue}>
          {!isByo && <button type="button" className="ijp-btn ijp-btn--primary" onClick={issue} disabled={!canRun || !!busy}>{busy === "issue" ? "Requesting…" : "Request ID-JAG"}</button>}
          {gateAt("issue")}
          {isByo && inspection && (
            <div className="ijp-io">
              {inspection.request && <div><h4>Request to IdenX</h4><Data value={inspection.request} /></div>}
              <div><h4>Decoded ID-JAG</h4><Data value={{ header: inspection.header, claims: inspection.claims }} /></div>
            </div>
          )}
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

        <Step n={3} mode={mode} title={text.redeemTitle} note={SPEC_NOTES.redeem}>
          <Lifetime id="idjag" label="ID-JAG" exp={idJagClaims?.exp} used={redeemed?.status === 200} now={nowMs}
            again={isByo ? "Get or paste a fresh one to redeem again." : "Request a new one to redeem again."} />
          <label className="ijp-field">Scope to request
            <select value={scopePick} disabled={!idJagClaims} onChange={(e) => setRedeemScope(e.target.value)}>
              <option value="">All scopes in this ID-JAG (recommended)</option>
              {scopeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {!idJagClaims && <p className="ijp-note">{isByo ? "Paste and inspect your ID-JAG first." : "Request an ID-JAG first."}</p>}
          <button type="button" className="ijp-btn ijp-btn--primary" onClick={redeem} disabled={!canRun || !hasIdJag || !!busy}>{busy === "redeem" ? "Redeeming…" : "Redeem ID-JAG"}</button>
          {gateAt("redeem")}
          {redeemed && (
            <div className="ijp-io">
              <div><h4>Request</h4><Data value={redeemed.request} /></div>
              <div><h4>Response (HTTP {redeemed.status})</h4><Data value={redeemed.response} /></div>
              {redeemed.token && <div><h4>Decoded access token</h4><Data value={redeemed.token} /></div>}
            </div>
          )}
          {redeemed && redeemed.status !== 200 && explain(redeemed.response, config?.request?.resource) && (
            <p className="ijp-fix" role="note">{explain(redeemed.response, config?.request?.resource)}</p>
          )}
        </Step>

        <Step n={4} mode={mode} title="Call the MCP server with the new token" note={text.call}>
          <Lifetime id="token" label="Access token" exp={tokenExp} now={nowMs} again="Request and redeem a new ID-JAG." />
          <button type="button" className="ijp-btn" onClick={listTools} disabled={!canRun || !redeemed?.token || !!busy}>{busy === "list" ? "Listing…" : "List tools this token can see"}</button>
          {gateAt("call")}
          {tools && toolList.length > 0 && (
            <div className="ijp-call">
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
          {(tools || callResult || errorAt("list", "call")) && (
            <div className="ijp-results" data-testid="ijp-results" aria-live="polite">
              <h3>Results</h3>
              {errorAt("list", "call")}
              {tools && (
                <div className="ijp-io">
                  <div>
                    <h4 data-testid="ijp-tool-count">tools/list: {toolList.length} tools</h4>
                    {toolList.length > 0
                      ? <Data value={toolList.map(({ name, description }) => ({ name, description }))} />
                      : <p className="ijp-note">0 tools: the token's scope allows none of this server's tools. Check its scope in step 3.</p>}
                    {tools.deniedTools?.length > 0 && <p className="ijp-note">{`Hidden by the gateway's policy: ${tools.deniedTools.join(", ")}`}</p>}
                  </div>
                  <div><h4>Request</h4><Data value={tools.request} /></div>
                </div>
              )}
              {callResult && <div className="ijp-io"><div><h4>tools/call request</h4><Data value={callResult.request} /></div><div><h4>Result</h4><Data value={callResult.result} /></div></div>}
            </div>
          )}
        </Step>

        <section className="ijp-step" aria-labelledby="ijp-resource-h" data-testid="ijp-resource">
          <header className="ijp-step__head"><h2 id="ijp-resource-h">Protected resource: a real backend page</h2></header>
          <p className="ijp-note">
            The resource server also serves a plain page, /protected/profile, behind the same bearer validation as its MCP tools.
            Open it with the access token from step 3, then try it without a token and with the raw ID-JAG: it must refuse both and say which check failed.
          </p>
          {pfRedeems && !isMock && (
            <p className="ijp-banner">This mode's access token comes from PingFederate. oauth-mcp's page trusts oauth-mcp and PingOne issuers, so expect a refusal at the issuer check; PingFederate → oauth-mcp shows it accepted.</p>
          )}
          <button type="button" className="ijp-btn ijp-btn--primary" onClick={() => openResource("token")} disabled={!redeemed?.token || !!busy}>Open the protected page</button>
          <button type="button" className="ijp-btn" onClick={() => openResource("no-token")} disabled={!config || !!busy}>Try without a token</button>
          <button type="button" className="ijp-btn" onClick={() => openResource("id-jag")} disabled={!hasIdJag || !!busy}>Try with the raw ID-JAG</button>
          {gateAt("resource")}
          {errorAt("resource")}
          {resource && (view === "json" ? <Data value={resource} /> : <ResourcePage r={resource} />)}
        </section>

        <Step n={5} mode={mode} title="Negative tests against the authorization server" note={isByo ? SPEC_NOTES.negativeByo : SPEC_NOTES.negative}>
          <button type="button" className="ijp-btn" onClick={runAllNegatives} disabled={!canRun || (isByo && !hasIdJag) || !!busy}>{busy === "neg-all" ? "Running…" : "Run all"}</button>
          {gateAt("negative")}
          <ul className="ijp-negatives">
            {negatives.map((t) => {
              const r = negResults[t.id];
              return (
                <li key={t.id} className={r ? (r.pass ? "is-pass" : "is-fail") : ""}>
                  <div>
                    <strong>{t.label}</strong> <span className="ijp-cite">expects {t.expect}</span>
                    <p className="ijp-note">{t.why}</p>
                    {r && <p className="ijp-result">{r.skipped ? "skipped" : r.pass ? "✅ refused" : "❌ not refused"}{r.status ? ` (HTTP ${r.status}${r.error ? `, ${r.error}` : ""})` : ""}{r.note ? ` ${r.note}` : ""}</p>}
                  </div>
                  <button type="button" className="ijp-btn" onClick={() => runNegative(t.id)} disabled={!canRun || (isByo && !hasIdJag) || !!busy}>Run</button>
                </li>
              );
            })}
          </ul>
        </Step>

        {!isByo && (
          <Step n={6} mode={mode} noDiagram title="Revoke and prove it" note={SPEC_NOTES.revoke}>
            <button type="button" className="ijp-btn ijp-btn--primary" onClick={revokeAndProve} disabled={!canRun || !!busy}>{busy === "revoke" ? "Revoking…" : "Revoke and retry"}</button>
            {gateAt("revoke")}
            {revoked && (
              <>
                <p className={`ijp-pill ${revoked.proved ? "is-ok" : "is-bad"}`} data-testid="ijp-revoke-verdict">{revokeVerdict(revoked)}</p>
                <div className="ijp-io">
                  <div><h4>1. Control: ask for an ID-JAG (HTTP {revoked.control.status})</h4><Data value={revoked.control.request} /></div>
                  {revoked.revoke && <div><h4>2. Revoke the refresh token (HTTP {revoked.revoke.status})</h4><Data value={revoked.revoke.request} /></div>}
                  {revoked.retry && <div><h4>3. Ask again (HTTP {revoked.retry.status})</h4><Data value={revoked.retry.request} /></div>}
                </div>
              </>
            )}
          </Step>
        )}

        <TrustedIdpsPanel api={api} endpoints={config?.publicEndpoints} />

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
