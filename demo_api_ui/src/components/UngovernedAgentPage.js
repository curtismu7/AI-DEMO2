// UngovernedAgentPage.js
// The "before" picture: an AI agent that rides a user's logged-in browser
// session (e.g. OpenCLI — "Browser Use on your logged-in Chrome") to move money
// through this bank's own UI. It succeeds with full user privileges and leaves
// no agent identity, scope, consent, or audit behind — the exact anti-pattern
// this demo's Agent Gateway (RFC 8693 act-chain + PingOne Authorize) solves.
//
// The punchline needs no new backend: every transaction already records the
// caller's clientType ('ai_agent' when it carries the agent scope + act claim,
// 'enduser' for a plain session cookie). A session-riding transfer is therefore
// stored as indistinguishable from the human. The Recent Transfers widget below
// polls GET /api/transactions/my and badges each row by clientType.
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import "./UngovernedAgentPage.css";

const OPENCLI_URL = "https://github.com/jackwener/OpenCLI";

// governed vs ungoverned — the sales contrast, one row per identity control.
const COMPARISON = [
  {
    dimension: "Identity",
    governed: "Agent has its own identity; acts on behalf of the user via an RFC 8693 act-chain (act.sub = agent, sub = user).",
    ungoverned: "No agent identity. The session cookie IS the user — the bank sees only the human.",
  },
  {
    dimension: "Scopes",
    governed: "Least-privilege scopes (e.g. banking:read); a write it wasn't granted is denied.",
    ungoverned: "Full user power. Anything the human can do in the browser, the agent can do.",
  },
  {
    dimension: "Consent / HITL",
    governed: "Agent-aware: the agent's high-risk actions trigger a human-in-the-loop consent challenge (HTTP 428), attributed to the agent.",
    ungoverned: "No agent-level consent. Reads and low-friction writes proceed unchecked; only the user's own transaction prompts (e.g. step-up) still apply.",
  },
  {
    dimension: "Authorization",
    governed: "Every tool call gets a PingOne Authorize decision (PERMIT / DENY / HITL) at the gateway.",
    ungoverned: "None. The request looks like ordinary user activity, so nothing evaluates it.",
  },
  {
    dimension: "Audit",
    governed: "Tamper-evident trail tagged with the agent's identity and the act-chain.",
    ungoverned: "Indistinguishable from the human. No actor to attribute the action to.",
  },
  {
    dimension: "Revocation",
    governed: "Disable the agent client or revoke its grant — the human keeps working.",
    ungoverned: "Nothing to revoke short of killing the user's own session.",
  },
  {
    dimension: "Blast radius",
    governed: "Bounded by the granted scopes and per-action policy.",
    ungoverned: "Everything the user's session can reach.",
  },
];

// The OWASP agentic threats this anti-pattern leaves UN-mitigated. Ids/names
// match the catalog on /owasp (OwaspLearnerPage THREATS).
const OWASP_THREATS = [
  { id: "T2", name: "Tool Misuse", why: "The agent wields the user's full toolset with no scope to constrain it." },
  { id: "T3", name: "Privilege Compromise", why: "It inherits every privilege the human session holds." },
  { id: "T8", name: "Repudiation", why: "No agent-attributed audit trail — the action is booked to the human." },
  { id: "T9", name: "Identity Spoofing", why: "The agent presents as the user; there is no separate agent identity." },
];

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function CommandBlock({ command, id, copied, onCopy }) {
  return (
    <div className="ungov-code-block">
      <code>{command}</code>
      <button className="ungov-copy-btn" onClick={() => onCopy(command, id)}>
        {copied === id ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// Recent Transfers widget — polls /api/transactions/my and badges each row by
// clientType. This is the live proof: an ungoverned session-riding transfer
// shows the same amber "Direct user session" badge as the human typing.
function RecentTransfersWidget() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ok | unauth | error
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions/my", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        setStatus("unauth");
        setRows([]);
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data.transactions) ? data.transactions : [];
      // Newest first; cap at 10.
      const sorted = [...list].sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
      );
      setRows(sorted.slice(0, 10));
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    };
    tick();
    timerRef.current = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  return (
    <div className="ungov-widget">
      <div className="ungov-widget__head">
        <h3>Recent transfers</h3>
        <span className="ungov-widget__hint">
          Live · polls <code>/api/transactions/my</code> every 5 min
        </span>
      </div>

      {status === "unauth" && (
        <p className="ungov-widget__empty">
          Sign in as a bank customer to see live transfers. The seeded demo
          customer (<code>john.doe</code>) is the account the sidecar and OpenCLI
          drive.{" "}
          <button
            type="button"
            className="ungov-widget__signin"
            onClick={() => navigateToCustomerOAuthLogin('/ungoverned-agent')}
          >
            Sign in
          </button>
        </p>
      )}
      {status === "error" && (
        <p className="ungov-widget__empty">Couldn't load transfers. Is the API up?</p>
      )}
      {status === "loading" && <p className="ungov-widget__empty">Loading…</p>}
      {status === "ok" && rows.length === 0 && (
        <p className="ungov-widget__empty">No transactions yet. Run a transfer to populate this list.</p>
      )}

      {status === "ok" && rows.length > 0 && (
        <ul className="ungov-widget__list">
          {rows.map((t) => {
            const agent = t.clientType === "ai_agent";
            return (
              <li key={t.id} className="ungov-row">
                <span className="ungov-row__main">
                  <span className="ungov-row__type">{t.type}</span>
                  <span className="ungov-row__amount">{formatCurrency(Number(t.amount))}</span>
                  <span className="ungov-row__desc">{t.description}</span>
                </span>
                <span className="ungov-row__meta">
                  <span className="ungov-row__time">{formatDateTime(t.createdAt)}</span>
                  <span className={`ungov-badge ungov-badge--${agent ? "governed" : "direct"}`}>
                    {agent ? "Governed agent (act-as chain)" : "Direct user session"}
                    {agent && t.actorSub ? ` · acting as ${t.actorSub}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function UngovernedAgentPage() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(null);

  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const sidecarCmd = "docker compose run --rm ungoverned-agent";
  const skillCmd = "npx skills add jackwener/opencli";

  return (
    <div className="ungov-page" data-testid="ungoverned-agent-page">
      <header className="ungov-header">
        <div className="ungov-badge-hero" aria-hidden="true">UNGOVERNED</div>
        <h1>The Ungoverned Agent</h1>
        <p className="ungov-subtitle">
          What agent access looks like when you do nothing: an AI agent rides the
          user's own logged-in browser session and moves money through the bank's
          UI — with full user power, and nothing to identify, scope, consent, or
          audit it.
        </p>
      </header>

      <section className="ungov-section">
        <h2>The anti-pattern</h2>
        <p className="ungov-intro">
          Tools like{" "}
          <a href={OPENCLI_URL} target="_blank" rel="noopener noreferrer">OpenCLI</a>{" "}
          (25.9k, Apache-2.0) let an AI agent drive your <em>logged-in desktop
          Chrome</em> — "Browser Use on your logged-in Chrome." The agent inherits
          your cookies, so from the application's side it simply <strong>is
          you</strong>. There is no separate agent identity, no delegated token, no
          scope to narrow what it can touch, no consent prompt on a high-value
          action, and no audit record that attributes the action to an agent. It
          could check your balance — or drain the account — and the bank cannot
          tell an agent did it. This isn't a strawman: it's a popular, shipping
          tool people install today.
        </p>
      </section>

      <section className="ungov-section">
        <h2>Governed vs. ungoverned</h2>
        <p className="ungov-section-intro">
          Same transfer, two worlds. The governed path is this demo's Agent
          Gateway; the ungoverned path is a session-riding agent.
        </p>
        <div className="ungov-table" role="table" aria-label="Governed versus ungoverned agent access">
          <div className="ungov-table__head" role="row">
            <span role="columnheader">Control</span>
            <span role="columnheader">Governed (Agent Gateway)</span>
            <span role="columnheader">Ungoverned (session-riding)</span>
          </div>
          {COMPARISON.map((r) => (
            <div className="ungov-table__row" role="row" key={r.dimension}>
              <span className="ungov-table__dim" role="cell">{r.dimension}</span>
              <span className="ungov-table__gov" role="cell">{r.governed}</span>
              <span className="ungov-table__ungov" role="cell">{r.ungoverned}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="ungov-section">
        <h2>See it live</h2>
        <p className="ungov-section-intro">
          Two ways to run the ungoverned side. Both produce a transfer that the
          widget below badges <strong>"Direct user session"</strong> — the same
          badge as the human typing. Then run the same transfer through the
          embedded governed agent and watch it badge{" "}
          <strong>"Governed agent"</strong> with a full token chain and audit
          trail.
        </p>

        <div className="ungov-proof-strip" aria-label="Live proof sequence">
          <div className="ungov-proof-step"><span>1</span><strong>Run the transfer</strong><small>through a browser session</small></div>
          <div className="ungov-proof-arrow" aria-hidden="true">→</div>
          <div className="ungov-proof-step ungov-proof-step--danger"><span>2</span><strong>Same user badge</strong><small>no agent identity or actor</small></div>
          <div className="ungov-proof-arrow" aria-hidden="true">→</div>
          <div className="ungov-proof-step ungov-proof-step--safe"><span>3</span><strong>Run it governed</strong><small>compare the token chain</small></div>
        </div>

        <div className="ungov-demo-cols">
          <div className="ungov-demo-col">
            <h3>Live: OpenCLI on the presenter's host</h3>
            <p>
              OpenCLI needs desktop Chrome + its Browser Bridge extension, so it
              runs on the presenter's laptop (it can't run headless / in Docker —
              that's the point). Install it as an agent skill, then tell the agent
              to make the transfer on the open banking tab.
            </p>
            <CommandBlock command={skillCmd} id="skill" copied={copied} onCopy={copy} />
            <p className="ungov-demo-note">
              Full step-by-step in the presenter runbook:{" "}
              <code>docs/runbooks/ungoverned-agent-opencli.md</code>
            </p>
          </div>

          <div className="ungov-demo-col">
            <h3>Reproducible: containerized sidecar</h3>
            <p>
              A headless-Playwright <code>ungoverned-agent</code> service reuses a
              signed-in customer's session and drives the same transfer form — no
              presenter install. It runs <em>inside the cluster</em>, beside the
              governed gateway: even here, it's still just the user's cookie, with
              no gateway, authz, or audit. (Pass the customer's <code>connect.sid</code>{" "}
              via <code>UNGOV_SESSION_COOKIE</code> — see the runbook.)
            </p>
            <CommandBlock command={sidecarCmd} id="sidecar" copied={copied} onCopy={copy} />
            <p className="ungov-demo-note">
              Also shippable as a Kubernetes Job (<code>k8s/80-ungoverned-agent-job.yaml</code>).
            </p>
          </div>
        </div>

        <RecentTransfersWidget />

        <div className="ungov-watch-callout">
          <strong>What to watch for:</strong> the amount can be identical in both runs. The
          security difference is the caller evidence: <b>Direct user session</b> means the
          bank cannot distinguish the agent from the customer; <b>Governed agent</b> exposes
          the actor, delegated scope, policy decision, and audit trail.
        </div>
      </section>

      <section className="ungov-section">
        <h2>Why it matters — OWASP agentic threats</h2>
        <p className="ungov-section-intro">
          The session-riding pattern leaves these OWASP "Securing Agentic
          Applications" threats un-mitigated — the same threats this demo's
          identity &amp; authorization controls close on the governed path.
        </p>
        <div className="ungov-threats">
          {OWASP_THREATS.map((t) => (
            <div className="ungov-threat" key={t.id}>
              <span className="ungov-threat__id">{t.id}</span>
              <span className="ungov-threat__name">{t.name}</span>
              <span className="ungov-threat__why">{t.why}</span>
            </div>
          ))}
        </div>
        <button type="button" className="ungov-owasp-link" onClick={() => navigate("/owasp")}>
          See the full OWASP mapping &rarr;
        </button>
      </section>
    </div>
  );
}
