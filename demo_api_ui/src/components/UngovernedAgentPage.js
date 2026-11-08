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
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P7 chips, P9 buttons. P5 (key-value)
// is skipped: the page has no label/value summary, only a control-by-control matrix, which the primitives
// keep page-local. P9's "one primary per view" is read as one primary ACTION AT A TIME: the Recent
// transfers control is the one primary and is ONE element for every state, so keyboard focus stays on it.
// Signed out it reads "Sign in" (nothing below works without a session); otherwise "Refresh" (run a
// transfer outside this page, then reload the list without waiting for the 5-minute poll). The Copy
// buttons and the OWASP link are secondaries in every state.
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import "./UngovernedAgentPage.css";
import InlineSpinner from './shared/InlineSpinner';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip,
} from './pingUi';

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
    <PingPage className="ungov-page" data-testid="ungoverned-agent-page">
      <SimBanner data-testid="ungov-banner">
        <strong>EXPLANATION, NOT A SIMULATION</strong> — nothing on this page runs an agent. The
        comparison, the three-step proof and the OWASP threats are written explanation, not measured
        results; the two transfers you compare are run outside this page with the commands below. The
        one real call is Recent transfers: it reads your own stored transactions from this machine&apos;s
        BFF and labels each by the caller type the bank recorded.
      </SimBanner>
      <PageHeader className="ungov-header" eyebrow="UNGOVERNED" title="The Ungoverned Agent" summary={<>What agent access looks like when you do nothing: an AI agent rides the
          user's own logged-in browser session and moves money through the bank's
          UI — with full user power, and nothing to identify, scope, consent, or
          audit it.</>} />

      <PageFrame>
        <Section id="ungov-anti-h" kicker="1 · The pattern" title="The anti-pattern">
          <Card tone="danger">
            <p className="pu-status-line">
              <StatusChip tone="danger">Anti-pattern</StatusChip>
              <span>Session riding: the agent works with the user's own cookie.</span>
            </p>
            <p className="ungov-prose">
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
          </Card>
        </Section>

        <Section
          id="ungov-compare-h"
          kicker="2 · The contrast"
          title="Governed vs. ungoverned"
          lede="Same transfer, two worlds. The governed path is this demo's Agent Gateway; the ungoverned path is a session-riding agent."
        >
          <Card tone="neutral">
            <div className="ungov-table-wrap">
              <table className="ungov-table" aria-label="Governed versus ungoverned agent access">
                <thead>
                  <tr>
                    <th scope="col">Control</th>
                    <th scope="col"><StatusChip tone="ok">Governed</StatusChip> Agent Gateway</th>
                    <th scope="col"><StatusChip tone="danger">Ungoverned</StatusChip> session-riding</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((r) => (
                    <tr key={r.dimension}>
                      <th scope="row" className="ungov-table__dim">{r.dimension}</th>
                      <td className="ungov-table__gov" data-label="Governed (Agent Gateway)">{r.governed}</td>
                      <td className="ungov-table__ungov" data-label="Ungoverned (session-riding)">{r.ungoverned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>

        <Section
          id="ungov-live-h"
          kicker="3 · The proof"
          title="See it live"
          lede={<>Two ways to run the ungoverned side. Both produce a transfer that the
            list below labels <strong>"Direct user session"</strong> — the same
            label as the human typing. Then run the same transfer through the
            embedded governed agent and watch it labelled{" "}
            <strong>"Governed agent"</strong> with a full token chain and audit
            trail.</>}
        >
          <ol className="ungov-steps" aria-label="Live proof sequence">
            <li className="ungov-step"><span className="ungov-step__n" aria-hidden="true">1</span><strong>Run the transfer</strong><small>through a browser session</small></li>
            <li className="ungov-step ungov-step--danger"><span className="ungov-step__n" aria-hidden="true">2</span><strong>Same user label</strong><small>no agent identity or actor</small></li>
            <li className="ungov-step ungov-step--safe"><span className="ungov-step__n" aria-hidden="true">3</span><strong>Run it governed</strong><small>compare the token chain</small></li>
          </ol>

          <CardGrid>
            <Card tone="neutral" title="Live: OpenCLI on the presenter's host">
              <p className="pu-status-line"><StatusChip tone="neutral">Runs on the presenter's laptop</StatusChip></p>
              <p className="ungov-prose">
                OpenCLI needs desktop Chrome + its Browser Bridge extension, so it
                runs on the presenter's laptop (it can't run headless / in Docker —
                that's the point). Install it as an agent skill, then tell the agent
                to make the transfer on the open banking tab.
              </p>
              <CommandBlock command={skillCmd} id="skill" copied={copied} onCopy={copy} />
              <p className="pu-note">
                Full step-by-step in the presenter runbook:{" "}
                <code>docs/runbooks/ungoverned-agent-opencli.md</code>
              </p>
            </Card>

            <Card tone="neutral" title="Reproducible: containerized sidecar">
              <p className="pu-status-line"><StatusChip tone="neutral">Runs in Docker or Kubernetes</StatusChip></p>
              <p className="ungov-prose">
                A headless-Playwright <code>ungoverned-agent</code> service reuses a
                signed-in customer's session and drives the same transfer form — no
                presenter install. It runs <em>inside the cluster</em>, beside the
                governed gateway: even here, it's still just the user's cookie, with
                no gateway, authz, or audit. (Pass the customer's <code>connect.sid</code>{" "}
                via <code>UNGOV_SESSION_COOKIE</code> — see the runbook.)
              </p>
              <CommandBlock command={sidecarCmd} id="sidecar" copied={copied} onCopy={copy} />
              <p className="pu-note">
                Also shippable as a Kubernetes Job (<code>k8s/80-ungoverned-agent-job.yaml</code>).
              </p>
            </Card>
          </CardGrid>

          <RecentTransfersWidget />

          <Card tone="neutral" title="What to watch for">
            <p className="ungov-prose">
              The amount can be identical in both runs. The
              security difference is the caller evidence: <b>Direct user session</b> means the
              bank cannot distinguish the agent from the customer; <b>Governed agent</b> exposes
              the actor, delegated scope, policy decision, and audit trail.
            </p>
          </Card>
        </Section>

        <Section
          id="ungov-owasp-h"
          kicker="4 · The risk"
          title="Why it matters — OWASP agentic threats"
          lede={<>The session-riding pattern leaves these OWASP "Securing Agentic
            Applications" threats un-mitigated — the same threats this demo's
            identity &amp; authorization controls close on the governed path.</>}
        >
          <div className="ungov-threats">
            {OWASP_THREATS.map((t) => (
              <Card tone="danger" title={`${t.id} · ${t.name}`} key={t.id}>
                <p className="pu-status-line"><StatusChip tone="danger">Not mitigated</StatusChip></p>
                <p className="ungov-prose">{t.why}</p>
              </Card>
            ))}
          </div>
          <div className="pu-actions">
            <button
              type="button"
              className="pu-btn"
              onClick={() => navigate("/owasp")}
            >
              See the full OWASP mapping &rarr;
            </button>
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

function CommandBlock({ command, id, copied, onCopy }) {
  return (
    <div className="ungov-code-block">
      <code>{command}</code>
      <button
        type="button"
        className="pu-btn"
        aria-label={`Copy command: ${command}`}
        onClick={() => onCopy(command, id)}
      >
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
  const [updatedAt, setUpdatedAt] = useState(null);
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
      setUpdatedAt(new Date());
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
    <Card tone="live" title="Recent transfers" data-testid="ungov-recent-transfers">
      <p className="pu-status-line">
        <StatusChip tone="info">Live read</StatusChip>
        <span>
          Your stored transactions, polled from <code>/api/transactions/my</code> every 5 min
        </span>
        <span className="ungov-row__time pu-mono" role="status">
          {updatedAt ? `Updated ${formatDateTime(updatedAt)}` : ""}
        </span>
      </p>

      {status === "unauth" && (
        <p className="pu-empty pu-note">
          Sign in as a bank customer to see live transfers. The seeded demo
          customer (<code>john.doe</code>) is the account the sidecar and OpenCLI
          drive.
        </p>
      )}
      {status === "error" && (
        <p className="pu-empty pu-note" role="status">Couldn't load transfers. Is the API up?</p>
      )}
      {status === "loading" && <p className="pu-empty pu-note"><InlineSpinner label="Loading…" /></p>}
      {status === "ok" && rows.length === 0 && (
        <p className="pu-empty pu-note">No transactions yet. Run a transfer to populate this list.</p>
      )}

      {status === "ok" && rows.length > 0 && (
        <ul className="ungov-list" aria-label="Recent transfers, newest first">
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
                  <span className="ungov-row__time pu-mono">{formatDateTime(t.createdAt)}</span>
                  <StatusChip tone={agent ? "ok" : "warn"}>
                    {agent ? "Governed agent (act-as chain)" : "Direct user session"}
                  </StatusChip>
                  {agent && t.actorSub ? (
                    <span className="ungov-row__actor pu-mono">acting as {t.actorSub}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {/* One element for every state, so the one primary keeps keyboard focus when its label changes. */}
      <div className="pu-actions">
        <button
          type="button"
          className="pu-btn pu-btn--primary"
          disabled={status === "loading"}
          onClick={status === "unauth" ? () => navigateToCustomerOAuthLogin('/ungoverned-agent') : load}
        >
          {status === "unauth" ? "Sign in" : "Refresh"}
        </button>
      </div>
    </Card>
  );
}
