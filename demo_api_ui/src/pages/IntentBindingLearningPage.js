import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { EDU } from "../components/education/educationIds";
import SignInPrompt from "../components/SignInPrompt";
import "./IntentBindingLearningPage.css";

/**
 * Intent Binding learning page demonstrating PAR (Pushed Authorization Request).
 * Shows how authorization details are pre-submitted to PingOne via PAR endpoint,
 * then referenced during token exchange via request_uri. Layout: static pipeline
 * header, then permanent PERMIT | DRIFT split for side-by-side outcome comparison.
 */
const PAR_PAYLOAD = { type: "banking_transaction", tool: "create_transfer", amount: 100, payee: "acme-utilities" };

const PIPELINE_STEPS = [
  { num: 1, title: "Declare intent", detail: "Customer authorizes: pay Acme Utilities, up to $100." },
  { num: 2, title: "Push to PAR endpoint", detail: "Authorization details pre-submitted to PingOne via RFC 9126." },
  { num: 3, title: "Receive request_uri", detail: "PingOne returns a reference URI for this authorization context." },
  { num: 4, title: "Token exchange with request_uri", detail: "Agent uses request_uri in token exchange; P1AZ validates the amount." },
];

function useColumnRun(action, defaultAmount) {
  const [amount, setAmount] = useState(defaultAmount);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const run = async (live) => {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    setResult(null);
    try {
      const res = await fetch("/api/demo/intent-binding/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestedAmount: Number(amount), live }),
      });
      const data = await res.json();
      if (res.status === 401) {
        // The page is declared `public` in auth-requirements.json and renders for
        // everyone, but /api/demo/intent-binding/run is behind the bearer gate, so
        // a signed-out visitor can press Run and get "authentication_required".
        // Standing rule: show the page and ASK — never surface a raw 401.
        setNeedsAuth(true);
      } else if (!res.ok) {
        setError(data.reason || data.error || "Request failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { amount, setAmount, loading, result, error, needsAuth, run };
}

const REEL_FRAME_MS = 1400;

/**
 * One frame per hop of the exchange this run actually made. A live run replays
 * the real PAR push the BFF performed (parRequest/parResponse); a simulated run
 * never touches PingOne, so it replays the call this page itself made.
 */
export function buildReelFrames(result, sentBody) {
  if (!result) return [];
  const permit = result.status === 200;
  if (!result.parRequest) {
    return [
      {
        chip: "Request",
        side: "request",
        title: "Request — POST /api/demo/intent-binding/run",
        caption: "Simulated mode — the decision is made by the local engine, no PAR push to PingOne.",
        body: sentBody,
      },
      {
        chip: "Response",
        side: permit ? "permit" : "deny",
        title: `Response — HTTP ${result.status}`,
        caption: result.reason || "",
        body: result,
      },
    ];
  }
  const failed = Boolean(result.parResponse && result.parResponse.error);
  return [
    {
      chip: "Request",
      side: "request",
      title: `Request — POST ${result.parRequest.url}`,
      caption: "Authorization details pushed to PingOne (PAR, RFC 9126 + RAR, RFC 9396).",
      body: result.parRequest,
    },
    {
      chip: "Response",
      side: failed ? "deny" : "response",
      title: failed ? "Response — PAR push rejected" : "Response — request_uri issued",
      caption: failed
        ? "PingOne refused the pushed request; nothing was bound."
        : "PingOne stored the request and returned a reference to it. The amount is not checked here.",
      body: result.parResponse,
    },
    {
      chip: "Decision",
      side: permit ? "permit" : "deny",
      title: permit ? "Decision — PERMIT" : `Decision — DENY (${result.errorCode})`,
      caption: result.reason || "",
      body: { status: result.status, errorCode: result.errorCode, requestUri: result.requestUri },
    },
  ];
}

function RunReel({ kind, result, action, amount, live }) {
  const frames = React.useMemo(
    () => buildReelFrames(result, { action, requestedAmount: Number(amount), live }),
    [result, action, amount, live],
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = frames.length - 1;

  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [frames]);

  useEffect(() => {
    if (!playing || index >= last) {
      if (playing && index >= last) setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setIndex((n) => n + 1), REEL_FRAME_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);

  if (!frames.length) return null;
  const frame = frames[index];

  return (
    <div className="ib-reel" data-testid={`ib-reel-${kind}`}>
      <div className="ib-reel-head">
        <strong>Reel</strong>
        <span className="ib-reel-count">
          {index + 1} / {frames.length}
        </span>
        <div className="ib-reel-ctrls">
          <button type="button" onClick={() => { setPlaying(false); setIndex((n) => Math.max(0, n - 1)); }} disabled={index === 0}>
            Prev
          </button>
          <button
            type="button"
            onClick={() => {
              if (index >= last) { setIndex(0); setPlaying(true); } else { setPlaying((p) => !p); }
            }}
          >
            {index >= last ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => { setPlaying(false); setIndex((n) => Math.min(last, n + 1)); }} disabled={index === last}>
            Next
          </button>
        </div>
      </div>
      <ol className="ib-reel-strip">
        {frames.map((f, n) => (
          <li key={f.chip}>
            <button
              type="button"
              aria-label={`Frame ${n + 1}: ${f.chip}`}
              aria-current={n === index}
              className={n === index ? "is-active" : undefined}
              onClick={() => { setPlaying(false); setIndex(n); }}
            >
              {f.chip}
            </button>
          </li>
        ))}
      </ol>
      <div className={`ib-reel-frame ib-reel-frame--${frame.side}`}>
        <div className="ib-reel-title">{frame.title}</div>
        {frame.caption ? <p className="ib-reel-caption">{frame.caption}</p> : null}
        <pre className="ib-reel-json">{JSON.stringify(frame.body, null, 2)}</pre>
      </div>
    </div>
  );
}

function IntentBindingColumn({ kind, title, outcomeLabel, rationale, col, live }) {
  return (
    <div className={`ib-col ib-col--${kind}`}>
      <div className="ib-col-head">
        <h2>{title}</h2>
        <span className={`ib-pill ib-pill--${kind}`}>{outcomeLabel}</span>
      </div>
      <div className="ib-amount">
        <small>Requested</small>${col.amount}
      </div>
      <p className="ib-rationale">{rationale}</p>
      <div className="ib-controls">
        <label>
          Amount
          <input type="number" value={col.amount} onChange={(e) => col.setAmount(e.target.value)} min={1} />
        </label>
        <button aria-label={`Run ${kind}`} onClick={() => col.run(live)} disabled={col.loading}>
          {col.loading ? "Running…" : "Run"}
        </button>
      </div>
      {col.needsAuth ? (
        <SignInPrompt
          variant="strip"
          message="Running the live decision needs a signed-in session — the PAR push is made on your behalf."
        />
      ) : null}
      {col.error ? (
        <div className={`ib-status ib-status--${kind === "permit" ? "permit" : "deny"}`}>{col.error}</div>
      ) : null}
      {col.result ? (
        <div className={`ib-status ib-status--${col.result.status === 200 ? "permit" : "deny"}`}>
          <strong>{col.result.status === 200 ? "PERMIT" : `DENY (${col.result.errorCode})`}</strong>
          <ul>
            {(col.result.tokenChainEvents || []).map((ev) => (
              <li key={ev.id}>
                <strong>{ev.label}</strong> — {ev.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {col.result ? (
        <RunReel kind={kind} result={col.result} action={kind} amount={col.amount} live={live} />
      ) : null}
    </div>
  );
}

export default function IntentBindingLearningPage() {
  // Default ON: real PingOne Authorize is the intended demo path. RAR amount
  // enforcement is done gateway-side (Demo Agent Gateway requireRarIntent, pinned
  // in #603), independent of this toggle — so PERMIT ($80) / DENY ($500) hold in
  // live mode; the toggle only switches the authorize-decision card between real
  // PingOne and the simulated engine.
  const [live, setLive] = useState(true);
  const navigate = useNavigate();
  const permitCol = useColumnRun("permit", 80);
  const driftCol = useColumnRun("drift", 500);
  const edu = useEducationUIOptional();

  return (
    <div className="intent-binding-page">
      <button className="ib-back-btn" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </button>
      <header className="ib-header-band">
        <div className="ib-eyebrow">Learning · Intent Binding</div>
        <h1>Watch an agent's intent get checked, step by step</h1>
        <p>
          Every transfer an agent makes runs this pipeline. The same authorization payload is pushed
          to PingOne via PAR (RFC 9126), then referenced below in two requests — one within the
          agent's declared authority, one past it.
        </p>
      </header>

      <ol className="ib-pipeline">
        {PIPELINE_STEPS.map((step) => (
          <li key={step.num} className="ib-step">
            <div className="ib-step-num">Step {step.num}</div>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="ib-grant-card" id="par">
        <strong>RAR authorization_details (RFC 9396), pushed via PAR (RFC 9126):</strong>
        <pre className="ib-grant-json">{JSON.stringify(PAR_PAYLOAD, null, 2)}</pre>
      </div>

      <div id="rar">
        <div className="ib-flow-diagram">
          <strong>PAR + RAR flow through the system:</strong>
          <svg viewBox="0 0 1000 200" className="ib-flow-svg">
            <rect x="10" y="40" width="110" height="60" rx="4" fill="#e3f2fd" stroke="#1976d2" strokeWidth="2" />
            <text x="65" y="75" textAnchor="middle" fontSize="14" fontWeight="500">User Declares</text>
            <text x="65" y="92" textAnchor="middle" fontSize="12">Intent: $100</text>

            <path d="M 120 70 L 150 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="150" y="40" width="130" height="60" rx="4" fill="#f3e5f5" stroke="#7b1fa2" strokeWidth="2" />
            <text x="215" y="60" textAnchor="middle" fontSize="12" fontWeight="500">Push to PAR</text>
            <text x="215" y="77" textAnchor="middle" fontSize="11">Endpoint</text>
            <text x="215" y="92" textAnchor="middle" fontSize="10" fill="#666">(auth payload)</text>

            <path d="M 280 70 L 310 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="310" y="40" width="130" height="60" rx="4" fill="#fce4ec" stroke="#c2185b" strokeWidth="2" />
            <text x="375" y="60" textAnchor="middle" fontSize="12" fontWeight="500">Receive</text>
            <text x="375" y="77" textAnchor="middle" fontSize="11">request_uri</text>
            <text x="375" y="92" textAnchor="middle" fontSize="10" fill="#666">(reference ID)</text>

            <path d="M 440 70 L 470 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="470" y="40" width="140" height="60" rx="4" fill="#e8f5e9" stroke="#388e3c" strokeWidth="2" />
            <text x="540" y="60" textAnchor="middle" fontSize="12" fontWeight="500">Token Exchange</text>
            <text x="540" y="77" textAnchor="middle" fontSize="11">with request_uri</text>
            <text x="540" y="92" textAnchor="middle" fontSize="10" fill="#666">(via Agent Gateway)</text>

            <path d="M 610 70 L 640 70" stroke="#666" strokeWidth="2" markerEnd="url(#arrowhead)" />

            <rect x="640" y="30" width="160" height="80" rx="4" fill="#fff3e0" stroke="#f57c00" strokeWidth="2" />
            <text x="720" y="50" textAnchor="middle" fontSize="12" fontWeight="500">PingOne Authorize</text>
            <text x="720" y="67" textAnchor="middle" fontSize="11">Resolves request_uri,</text>
            <text x="720" y="84" textAnchor="middle" fontSize="11">validates amount cap</text>
            <text x="720" y="101" textAnchor="middle" fontSize="10" fill="#f57c00" fontWeight="500">→ PERMIT/DENY</text>

            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#666" />
              </marker>
            </defs>
          </svg>
        </div>

        <div className="ib-split">
        <IntentBindingColumn
          kind="permit"
          title="Within the grant"
          outcomeLabel="Permit"
          rationale={`$${permitCol.amount} is within the $${PAR_PAYLOAD.amount} cap. Steps 3-4 complete and the gateway confirms the request matches the declared intent.`}
          col={permitCol}
          live={live}
        />
        <IntentBindingColumn
          kind="drift"
          title="Drifts past the grant"
          outcomeLabel="Deny"
          rationale={`$${driftCol.amount} exceeds the $${PAR_PAYLOAD.amount} cap. Step 4 stops the chain — the transfer never reaches the account.`}
          col={driftCol}
          live={live}
        />
        </div>
      </div>

      <div className="ib-live-toggle">
        <label>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live mode — route this decision through real PingOne Authorize instead of the simulated engine
        </label>
      </div>

      <p className="ib-edu-link">
        PAR (RFC 9126) is how the request travels; RAR (RFC 9396) is what it means. See the{" "}
        <button type="button" className="ib-link-btn" onClick={() => edu && edu.open(EDU.PAR, "what")}>
          PAR education panel
        </button>{" "}or the{" "}
        <button type="button" className="ib-link-btn" onClick={() => edu && edu.open(EDU.RAR, "what")}>
          RAR education panel
        </button>.
      </p>

      <button className="ib-back-btn ib-back-btn--bottom" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </button>
    </div>
  );
}
