// DemoArchSlidesPage.jsx — slide-style architecture figures (the Ping deck
// layouts) redrawn with this demo's real services, with a Play / Step
// walkthrough. Scenes are hand-drawn inline SVG; the player only toggles
// classes on the step-tagged groups, so the slide look stays intact.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DEFAULT_STEP_MS, STEP_TIME_OPTIONS, StepTimeSelector } from "./diagram";
import { CONTROL_PLANE_META } from "./DemoArchControlPlaneScene";
import DemoArchWorkloadScene, { WORKLOAD_META } from "./DemoArchWorkloadScene";
import PingSlideFlow from "./PingSlideFlow";
import { CONTROL_PLANE_SLIDE, CONTROL_PLANE_STEPS, ID_JAG_SLIDE, OBO_SLIDE, OBO_STEPS, CODING_SLIDE, CODING_STEPS } from "../config/pingSlideDiagrams";
import { ID4AI_PDF, ID4AI_SLIDES } from "../config/id4aiSlides";
import "./DemoArchSlidesPage.css";

const SHARED_ROWS = [
  ["Workforce Portal App", "React SPA, cookie session only, never holds a token", "4000", "demo_api_ui/"],
  ["PingAccess (PEP)", "BFF: login callback, session store, RFC 8693 exchange, MCP tool pipeline", "3001", "demo_api_server/"],
  ["PingFederate / DS (IdP · AS)", "PingOne OAuth by default; PingFederate for the ID-JAG and JWT-SVID actor paths", "hosted", "services/agentMcpTokenService.js"],
  ["PingIDM (agent identity)", "PingOne Directory populations, groups and per-agent OAuth clients created by bootstrap", "hosted", "scripts/pingone:bootstrap · /agent-registry"],
  ["Enterprise agents + AuthN sidecar", "AG-UI runner plus LangChain, OpenAI, Mastra and Pydantic runtimes; spiffe-helper sidecar", "3006 · 8888 · 8891–8893", "demo_agent_service/ · langchain_agent/"],
  ["PingGateway (PEP)", "PingGateway (IG) in front of every MCP route; the Node demo gateway is the fallback", "3036 · 3005", "ping-gateway/config/routes/ · demo_mcp_gateway/"],
  ["PingAuthorize (PAP · PDP)", "PingOne Authorize policies; mock engine for offline runs", "hosted · 9001", "demo_authz_server/"],
  ["MCP servers", "Banking MCP, Invest MCP, mortgage REST resource server", "8080 · 8081 · 8082", "oauth-mcp/ · demo_mcp_resource_server/"],
  ["SPIFFE (workload identity)", "SPIRE server and agent, trust domain spiffe://bxfinance.demo, JWT-SVID live, X.509 mTLS planned", "·", "docs/SPIFFE_PLAN.md"],
  ["On-prem infrastructure", "Local LLM proxy over llama.cpp or oMLX, so no prompt leaves the stack", "8090", "demo_llm_proxy/"],
];

const NO_LIVE = () => null;
const OBO_ROWS = [
  ["IdP / OAuth AS · Fine Grained AZ", "PingOne (or PingFederate) issues the tokens; PingOne Authorize decides", "hosted", "services/agentMcpTokenService.js · services/pingOneAuthorizeService.js"],
  ["Agent Credential", "SPIFFE JWT-SVID from spiffe-helper, or a PK-JWT client assertion", "8888", "demo_agent_service/ · docs/SPIFFE_PLAN.md"],
  ["Agent Gateway", "PingGateway in front of every MCP route, with the Node gateway as fallback", "3036 · 3005", "ping-gateway/ · demo_mcp_gateway/"],
  ["Services A–D", "Banking, Invest and mortgage backends, each reached with its own credential type", "8080–8082", "oauth-mcp/ · demo_mcp_resource_server/"],
];
const CODING_ROWS = [
  ["Agent Broker", "PingOne Privilege: brokers just-in-time credentials for coding agents", "hosted", "privilege/"],
  ["Endpoint Controller", "Read-only host inventory of MCP candidates; never invokes tools", "·", "standalone/mcp-discovery-agent/"],
  ["Services", "Jira, Github / Gitlab, SSH servers and databases behind the broker", "·", "n/a in this demo (reference architecture)"],
];

const SLIDE_ROWS = {
  "workload-agents": [
    ["Transaction token (TX JWT)", "Delegated access token: sub = user, act = agent, aud = mcp-gw; chained act for A2A", "·", "docs/TOKEN_FLOW.md"],
    ["Not Authorized / Approved", "PERMIT, DENY, STEP-UP or HITL obligation; HITL raises a consent challenge", "3009", "demo_hitl_service/"],
    ["3rd-party MCP · 3rd-party AS", "Weather and Brave MCP (public tools); PingOne Agent Privilege as the optional hosted path", "·", "mcp-weather · mcp-brave · privilege/"],
  ],
  "ciba-hitl": [
    ["Not Authorized (step-up required)", "Authorize returns STEP_UP when a write tool crosses the step-up amount (default $500); the gateway refuses the call", "·", "services/authorizeObligations.js"],
    ["CIBA", "BFF starts OIDC CIBA Core 1.0 at PingOne with a separate CIBA client, login_hint = session user, binding_message = the transaction; poll mode only", "·", "routes/ciba.js · services/cibaService.js"],
    ["Approved", "User approves out of band (PingOne MFA push or email link; a simulated approval tab for offline demos). The BFF polls, stores tokens in the session and marks step-up verified for 5 minutes", "·", "pages/CibaApprovalPage.js"],
    ["TX JWT", "Single-use transaction receipt bound to user, agent and tool, recorded as a HITL challenge; the tool call is retried with it", "3009", "services/cibaTransactionReceipt.js · demo_hitl_service/"],
  ],
  "id-jag": [
    ["Token Exchange → ID-JAG", "RFC 8693 at PingFederate with requested_token_type id-jag, audience = the third-party authorization server, resource = the MCP server. The BFF holds the refresh token", "·", "routes/xaaIdJagDemo.js · /pingfederate-id-jag"],
    ["Discovery · RFC 9728", "A 401 from the MCP server carries protected-resource metadata naming its authorization server; no pre-shared configuration", "·", "ping-gateway/config/routes/00-mcp-oauth-bootstrap.json"],
    ["3rd Party AS", "oauth-mcp's embedded OAuth 2.1 authorization server redeems the ID-JAG as a JWT bearer grant (RFC 7523) and issues its own access token", "8080", "oauth-mcp/src/oauth/IdJagGrantHandler.ts"],
    ["3rd Party MCP · 3rd Party AT", "The MCP call carries the locally issued token, not the ID-JAG; PingGateway validates it and asks Authorize", "8080", "oauth-mcp/"],
  ],
};

const CONTROL_PLANE_ROWS = [
  ["IDP / OAuth Authorization Server", "PingOne, plus PingFederate for ID-JAG and the JWT-SVID actor path", "hosted", "demo_api_server/services/agentMcpTokenService.js"],
  ["Fine Grained Authorization", "PingOne Authorize (mock demo_authz_server offline); intent binding via PAR", "hosted · 9001", "demo_authz_server/ · services/pingOneAuthorizeService.js"],
  ["Helix", "The language model behind the agent when a Helix agent key is configured; heuristics-only without it", "·", "README · Configure the AI agent (Helix)"],
  ["JIT Policy · Credential Broker", "PingOne Privilege: virtual keys for LLM providers, credential brokering for MCP", "hosted", "privilege/ · docs/privilege-llm-protection.md"],
  ["Secret Stores", "Encrypted secrets.vault (AES-256-GCM, Argon2id) loaded into the config store at startup; Privilege vault; K8s secrets on the SE cluster", "·", "demo_api_server/ · se-*"],
  ["Workload IDP", "SPIRE server and agent, spiffe-helper sidecars, trust domain spiffe://bxfinance.demo", "·", "docs/SPIFFE_PLAN.md"],
  ["Agent Privilege", "LLM proxy, demo MCP gateway, A2A delegation (UC2), Privilege AI Guard", "8090 · 3005", "demo_llm_proxy/ · demo_mcp_gateway/"],
  ["Ping Gateway", "PingGateway (IG) as the MCP ingress PEP: introspection, Authorize decision, RFC 9728 metadata", "3036", "ping-gateway/"],
  ["Endpoint Controller", "mcp-discovery-agent: read-only host inventory of MCP candidates, never invokes tools", "·", "standalone/mcp-discovery-agent/"],
  ["Personal Agents", "LM Studio, Claude Desktop, MCP Inspector, LibreChat through the external door", "·", "docs/EXTERNAL_DOOR_MCP_FLOW.md"],
  ["Enterprise Workload Agents", "AG-UI orchestrator with A2A specialists; autonomous ephemeral runs", "3006", "demo_agent_service/ · routes/autonomousRuns.js"],
  ["MCP servers · LLM providers", "oauth-mcp, invest RS, mortgage RS; weather, Brave, hosted PingOne MCP; llama.cpp local or OpenAI / Anthropic via Privilege", "8080–8082", "oauth-mcp/ · demo_mcp_resource_server/"],
  ["Agentic Control Plane", "Catalog, registry, discovery, governance, observability pages plus Grafana / Jaeger / Loki", "·", "/agent-registry · /mcp-tools · /mcp-discovery · /agent-lifecycle"],
];

// ---- Live mode: map one BFF app event (category / tag / severity) to a slide step ----
// Events come from GET /api/arch-events (`app-event`). Matching is by tag prefix first,
// category second; an event no slide step explains returns null and only shows in the log.
const tagIs = (ev, ...prefixes) => prefixes.some((p) => String(ev.tag || "").startsWith(p));
const catIs = (ev, ...cats) => cats.includes(ev.category);

export function liveStepTopology(ev) {
  if (tagIs(ev, "oauth/") || catIs(ev, "oauth", "auth_lifecycle")) return 2;
  if (tagIs(ev, "agent/message")) return 3;
  if (tagIs(ev, "agent/complete", "mcp/result")) return 8;
  if (catIs(ev, "token_exchange", "delegation")) return 4;
  if (catIs(ev, "agent", "agent_prompt", "helix")) return 5;
  if (tagIs(ev, "mcp/") || catIs(ev, "mcp", "gateway_path", "enterprise_mcp")) return 6;
  if (catIs(ev, "authorize", "introspection", "intent_auth", "intent_token")) return 7;
  if (tagIs(ev, "hitl/", "ciba/") || catIs(ev, "hitl")) return 9;
  return null;
}

export function liveStepCiba(ev) {
  if (tagIs(ev, "ciba/initiate")) return 4;
  if (tagIs(ev, "ciba/tokens-received")) return 6;
  if (tagIs(ev, "ciba/denied", "ciba/timeout")) return 5;
  if (tagIs(ev, "hitl/consent-verified")) return 7;
  if (tagIs(ev, "hitl/", "personal_agent/step_up_required")) return 3;
  if (tagIs(ev, "authorize/permit", "authorize/gate-permitted", "mcp/result")) return 8;
  if (catIs(ev, "authorize", "introspection")) return 2;
  if (tagIs(ev, "mcp/tool") || catIs(ev, "mcp", "gateway_path")) return 1;
  return null;
}

export function liveStepIdJag(ev) {
  if (tagIs(ev, "oauth/") || catIs(ev, "oauth", "auth_lifecycle")) return 1;
  if (catIs(ev, "token_exchange")) return 2;
  if (tagIs(ev, "enterprise_mcp/token_issued")) return 4;
  if (tagIs(ev, "authorize/permit", "authorize/gate-permitted", "mcp/result")) return 6;
  if (catIs(ev, "authorize", "introspection")) return 5;
  if (tagIs(ev, "mcp/") || catIs(ev, "mcp", "gateway_path", "enterprise_mcp")) return 3;
  return null;
}

export function liveStepControlPlane(ev) {
  if (tagIs(ev, "oauth/user/login", "hosted-access/")) return 1;
  if (tagIs(ev, "oauth/") || catIs(ev, "oauth", "token_exchange", "auth_lifecycle", "delegation")) return 2;
  if (catIs(ev, "authorize", "introspection", "intent_auth", "intent_token", "helix")) return 3;
  if (tagIs(ev, "enterprise_mcp/token_issued")) return 4;
  if (tagIs(ev, "mcp/result")) return 8;
  if (tagIs(ev, "mcp/") || catIs(ev, "mcp", "gateway_path", "enterprise_mcp")) return 6;
  if (catIs(ev, "agent", "agent_prompt", "personal_agent")) return 7;
  if (catIs(ev, "config", "threshold", "startup")) return 9;
  return null;
}

export const DEMO_ARCH_SLIDES = [
  { id: "workload-agents", label: "Workload Agents · Topology", path: "/demo-arch-slides/workload-agents", meta: WORKLOAD_META.topology, rows: [...SHARED_ROWS, ...SLIDE_ROWS["workload-agents"]], live: liveStepTopology, render: (st) => <DemoArchWorkloadScene variant="topology" st={st} /> },
  { id: "ciba-hitl", label: "Workload Agents · CIBA Step-up", path: "/demo-arch-slides/ciba-hitl", meta: WORKLOAD_META.ciba, rows: [...SHARED_ROWS, ...SLIDE_ROWS["ciba-hitl"]], live: liveStepCiba, render: (st) => <DemoArchWorkloadScene variant="ciba" st={st} /> },
  { id: "id-jag", drag: true, label: "Workload Agents · 3rd-party MCP via ID-JAG", path: "/demo-arch-slides/id-jag", meta: WORKLOAD_META.idjag, rows: [...SHARED_ROWS, ...SLIDE_ROWS["id-jag"]], live: liveStepIdJag, render: (st, n, r) => <PingSlideFlow key={r} config={ID_JAG_SLIDE} step={n} /> },
  { id: "obo-assistant", drag: true, label: "Workload Agent · Digital Assistant (OBO)", path: "/demo-arch-slides/obo-assistant", meta: { steps: OBO_STEPS, caption: "A digital assistant acts on behalf of a signed-in user: the IdP mints a transaction token naming both user and agent, and the gateway reaches each backend with the credential it expects." }, rows: OBO_ROWS, live: NO_LIVE, render: (st, n, r) => <PingSlideFlow key={r} config={OBO_SLIDE} step={n} /> },
  { id: "coding-agents", drag: true, label: "Employee Agents · Coding Agents", path: "/demo-arch-slides/coding-agents", meta: { steps: CODING_STEPS, caption: "Coding agents are distinguished from humans and get only just-in-time credentials from the Agent Broker, so nothing long-lived sits on the developer machine." }, rows: CODING_ROWS, live: NO_LIVE, render: (st, n, r) => <PingSlideFlow key={r} config={CODING_SLIDE} step={n} /> },
  { id: "control-plane", drag: true, label: "Agentic Control Plane", path: "/demo-arch-slides/control-plane", meta: { ...CONTROL_PLANE_META, steps: CONTROL_PLANE_STEPS }, rows: CONTROL_PLANE_ROWS, live: liveStepControlPlane, render: (st, n, r) => <PingSlideFlow key={r} config={CONTROL_PLANE_SLIDE} step={n} /> },
];

// "ID4AI slides 301": the architecture diagrams of the ID4AI deck, same page and controls, ReactFlow slides.
const ID4AI_DEFS = ID4AI_SLIDES.map((s) => ({
  id: s.id,
  label: s.label,
  path: `/id4ai-slides/${s.id}`,
  page: s.page,
  meta: { steps: s.steps, caption: s.caption },
  rows: [],
  live: NO_LIVE,
  drag: true,
  render: (st, n, r) => <PingSlideFlow key={r} config={s.config} step={n} />,
}));

export function Id4aiSlidesRoute() {
  const { slideId } = useParams();
  return <DemoArchSlidesPage deck="id4ai" slide={slideId} />;
}

const LIVE_LOG_MAX = 12;

// Live state survives a page reload. The UI container runs Vite dev over a bind
// mount, and a sync of the checkout can hot-update or reconnect and reload every
// open tab mid-demo. sessionStorage is per tab, so two slides open side by side
// keep separate state, and closing the tab forgets it.
export const liveStateKey = (slideId) => `das-live:${slideId}`;
const EMPTY_LIVE = { live: false, lit: [], liveNow: 0, liveLog: [] };

function readLiveState(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return EMPTY_LIVE;
    const s = JSON.parse(raw);
    return {
      live: s.live === true,
      lit: Array.isArray(s.lit) ? s.lit.filter((n) => Number.isInteger(n)) : [],
      liveNow: Number.isInteger(s.liveNow) ? s.liveNow : 0,
      liveLog: Array.isArray(s.liveLog) ? s.liveLog.slice(0, LIVE_LOG_MAX) : [],
    };
  } catch (_) {
    return EMPTY_LIVE;
  }
}

function writeLiveState(key, state) {
  try {
    if (!state.live) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(state));
  } catch (_) { /* storage unavailable: Live simply does not survive a reload */ }
}

/**
 * Play / Step state for one slide. `cur` 0 = idle (everything lit), 1..N = walkthrough.
 * Live mode replaces the script: each BFF app event lights the step `liveMap` gives it.
 */
function useSlidePlayer(total, liveMap, storageKey) {
  const [saved] = useState(() => readLiveState(storageKey));
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const [resets, setResets] = useState(0); // bumps on Reset so scenes with draggable boxes drop their moved positions
  const [live, setLive] = useState(saved.live);
  const [liveStatus, setLiveStatus] = useState("off"); // off | connecting | open | closed
  const [lit, setLit] = useState(() => new Set(saved.lit));
  const [liveNow, setLiveNow] = useState(saved.liveNow);
  const [liveLog, setLiveLog] = useState(saved.liveLog);

  useEffect(() => {
    writeLiveState(storageKey, { live, lit: [...lit], liveNow, liveLog });
  }, [storageKey, live, lit, liveNow, liveLog]);

  useEffect(() => {
    if (!live) return undefined;
    setLiveStatus("connecting");
    const es = new EventSource("/api/arch-events");
    es.addEventListener("arch-connected", () => setLiveStatus("open"));
    es.addEventListener("app-event", (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (_) { return; }
      // PingOne webhook mirror events (SESSION.UPDATED and friends) arrive by the
      // dozen per sign-in and explain no hop on any slide; drop them before they
      // flood the log.
      if (ev.category === "pingone") return;
      const step = liveMap(ev);
      setLiveLog((log) => [{ ...ev, step }, ...log].slice(0, LIVE_LOG_MAX));
      if (!step) return;
      setLit((s) => (s.has(step) ? s : new Set(s).add(step)));
      setLiveNow(step);
    });
    es.onerror = () => { setLiveStatus("closed"); es.close(); };
    return () => { es.close(); };
  }, [live, liveMap]);

  useEffect(() => {
    if (!playing) return undefined;
    if (cur >= total) {
      setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setCur((c) => Math.min(total, c + 1)), cur === 0 ? 200 : stepMs);
    return () => clearTimeout(t);
  }, [playing, cur, total, stepMs]);

  const play = useCallback(() => {
    setCur((c) => (c >= total ? 0 : c));
    setPlaying(true);
  }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const next = useCallback(() => { setPlaying(false); setCur((c) => Math.min(total, c + 1)); }, [total]);
  const back = useCallback(() => { setPlaying(false); setCur((c) => Math.max(0, c - 1)); }, []);
  const clearLive = useCallback(() => { setLit(new Set()); setLiveNow(0); setLiveLog([]); }, []);
  const reset = useCallback(() => { setPlaying(false); setCur(0); clearLive(); setResets((r) => r + 1); }, [clearLive]);
  const toggleLive = useCallback(() => {
    setPlaying(false);
    setCur(0);
    setLive((v) => {
      if (v) setLiveStatus("off");
      return !v;
    });
  }, []);

  // Class for a step-tagged group.
  // Script: idle → untouched; past → on; current → now; future → off.
  // Live: nothing lit yet → untouched; latest event's step → now; any seen step → on; rest → off.
  const st = useCallback((...ids) => {
    if (ids.length === 0) return "";
    if (live) {
      if (lit.size === 0) return "";
      if (ids.includes(liveNow)) return "das-st das-st-now";
      if (ids.some((i) => lit.has(i))) return "das-st das-st-on";
      return "das-st das-st-off";
    }
    if (cur === 0) return "";
    if (ids.includes(cur)) return "das-st das-st-now";
    if (Math.min(...ids) < cur) return "das-st das-st-on";
    return "das-st das-st-off";
  }, [cur, live, lit, liveNow]);

  return { resets, cur, playing, stepMs, setStepMs, play, pause, next, back, reset, st, live, liveStatus, liveNow, liveLog, toggleLive };
}

const LIVE_STATUS_TEXT = {
  connecting: "Connecting to the BFF event stream…",
  open: "Live. Sign in and run a chip or a chat in another tab; each hop lights its step here.",
  closed: "Stream closed. The feed needs a signed-in session on this host; sign in, then toggle Live again.",
};

function fmtTime(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour12: false });
}

export default function DemoArchSlidesPage({ slide, deck }) {
  const navigate = useNavigate();
  const id4ai = deck === "id4ai";
  const slides = id4ai ? ID4AI_DEFS : DEMO_ARCH_SLIDES;
  const def = slides.find((s) => s.id === slide) || slides[0];
  const { meta } = def;
  const total = meta.steps.length;
  const p = useSlidePlayer(total, def.live, liveStateKey(def.id));
  const step = p.live
    ? (p.liveNow > 0 ? meta.steps[p.liveNow - 1] : null)
    : (p.cur > 0 ? meta.steps[p.cur - 1] : null);
  const latest = p.liveLog[0] || null;

  return (
    <div className="das-page">
      <span className="das-eyebrow">{id4ai ? "ID4AI slides 301" : "Demo arch slides"}</span>
      {id4ai ? (
        <div className="das-tabs">
          <select className="das-select" value={def.id} onChange={(e) => navigate(`/id4ai-slides/${e.target.value}`)} aria-label="ID4AI slide">
            {slides.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <a className="das-tab" href={`${ID4AI_PDF}#page=${def.page}`} target="_blank" rel="noopener noreferrer">
            Source deck (PDF) · slide {def.page}
          </a>
        </div>
      ) : (
        <nav className="das-tabs" aria-label="Slides">
          {DEMO_ARCH_SLIDES.map((s) => (
            <Link key={s.id} to={s.path} className={`das-tab${s.id === def.id ? " das-tab--active" : ""}`}>
              {s.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="das-controls" role="group" aria-label="Walkthrough controls">
        <button type="button" className="das-btn das-btn--primary" onClick={p.playing ? p.pause : p.play} disabled={p.live}>
          {p.playing ? "Pause" : "▶ Play"}
        </button>
        <button type="button" className="das-btn" onClick={p.back} disabled={p.live || p.cur === 0}>← Back</button>
        <button type="button" className="das-btn" onClick={p.next} disabled={p.live || p.cur >= total}>Step →</button>
        <button type="button" className="das-btn" onClick={p.reset} disabled={!def.drag && !p.live && p.cur === 0 && !p.playing}>↺ Reset</button>
        <StepTimeSelector value={p.stepMs} options={STEP_TIME_OPTIONS} onChange={p.setStepMs} title="Time each step takes during Play" disabled={p.live} />
        {def.live !== NO_LIVE && (
          <button
            type="button"
            className={`das-btn das-btn--live${p.live ? " das-btn--live-on" : ""}`}
            onClick={p.toggleLive}
            aria-pressed={p.live}
            title="Light steps from real BFF events instead of the script"
          >
            <span className={`das-live-dot das-live-dot--${p.liveStatus}`} aria-hidden="true" />
            {p.live ? "Live · on" : "Live"}
          </button>
        )}
        <span className="das-counter">
          {p.live ? `${p.liveLog.length} event${p.liveLog.length === 1 ? "" : "s"}` : p.cur === 0 ? `${total} steps` : `Step ${p.cur} / ${total}`}
        </span>
      </div>

      <div className={`das-stepbar${step ? " das-stepbar--live" : ""}`} aria-live="polite">
        {p.live && !step ? (
          <span className="das-stepbar__desc">{LIVE_STATUS_TEXT[p.liveStatus] || LIVE_STATUS_TEXT.open}</span>
        ) : step ? (
          <>
            <span className="das-stepbar__num">{p.live ? p.liveNow : p.cur}</span>
            <span className="das-stepbar__title">{step[0]}</span>
            <span className="das-stepbar__desc">{step[1]}</span>
          </>
        ) : (
          <span className="das-stepbar__desc">Press Play to walk the request through the diagram, Step to advance one hop at a time, or Live to light steps from real requests. Everything is lit while idle.</span>
        )}
      </div>

      {p.live && latest && (
        <ol className="das-live-log" aria-label="Recent BFF events">
          {p.liveLog.map((ev, i) => (
            <li key={`${ev.ts}-${i}`} className={ev.step ? "" : "das-live-log__unmapped"}>
              <span className="das-live-log__time">{fmtTime(ev.ts)}</span>
              <span className="das-live-log__tag">{ev.tag || ev.category}</span>
              <span className="das-live-log__step">{ev.step ? `→ step ${ev.step}` : "no step"}</span>
              {ev.message && <span className="das-live-log__msg">{ev.message}</span>}
            </li>
          ))}
        </ol>
      )}

      <figure>
        <div className="das-frame">{def.render(p.st, p.live ? p.liveNow : p.cur, p.resets)}</div>
        <figcaption className="das-caption">{meta.caption}</figcaption>
      </figure>

      {def.rows.length > 0 && (
        <>
          <h2>Slide element → what runs in this demo</h2>
          <div className="das-table-wrap">
            <table className="das-table">
              <thead>
                <tr><th>Slide box</th><th>In this demo</th><th>Port</th><th>Source</th></tr>
              </thead>
              <tbody>
                {def.rows.map(([box, what, port, src]) => (
                  <tr key={box}>
                    <td>{box}</td>
                    <td>{what}</td>
                    <td>{port}</td>
                    <td><span className="das-src">{src}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
