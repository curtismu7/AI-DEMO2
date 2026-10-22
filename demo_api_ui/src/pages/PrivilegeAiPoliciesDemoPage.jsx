// /privilege-ai-policies (in the app) and /standalone/ai-policies (chrome-free, no live calls).
// A Privilege demo: Cedar runs INSIDE the Privilege gateway. This page sends real tool calls through a real door and shows
// what the gateway answered, next to the real Active policy that decided it. It contains no Cedar engine and decides nothing.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { PF_CEDAR_DIAGRAM } from '../config/privilegePfCedarDiagram';
import { CEDAR_VOCABULARY, DOOR_NAME, OUTCOMES, PF_AGENT, POLICIES, SCENARIOS } from '../config/privilegeAiPoliciesDemo';
import { connectDoor, runTool } from '../services/privilegeAiPoliciesDemoService';
import './PrivilegeAiPoliciesDemoPage.css';

const CLIENT_PAGE = '/privilege-mcp-client';
const LIVE_PAGE = '/privilege-ai-policies';
const DOC_URL = 'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md';

function Verdict({ result }) {
  const o = OUTCOMES[result.outcome];
  return (
    <div className={`apd-verdict apd-verdict--${result.outcome}`} data-testid="apd-verdict" data-outcome={result.outcome} role="status">
      <strong className="apd-verdict-label">{o.label}</strong>
      <p>{o.note}</p>
      {result.instructionId && <p>Approval id from the gateway: <code data-testid="apd-ins">{result.instructionId}</code></p>}
      {result.detail && <p className="apd-muted">{result.detail}</p>}
    </div>
  );
}

function Scenario({ s, live, ready, state, onRun }) {
  const policies = s.policies.map((id) => ({ id, ...POLICIES[id] }));
  const matches = state && state.result && state.result.outcome === s.expect;
  return (
    <article className="apd-card" data-testid={`apd-scn-${s.id}`}>
      <h3>{s.title}</h3>
      <p>{s.story}</p>
      <p className="apd-call"><span className="apd-muted">Call:</span> <code>{s.tool}</code> <code>{JSON.stringify(s.args)}</code> <span className="apd-muted">on the </span><code>{DOOR_NAME}</code><span className="apd-muted"> door</span></p>
      <p className="apd-muted">{s.notice}</p>
      <p className="apd-expect">Expected from the gateway: <strong>{OUTCOMES[s.expect].label}</strong></p>

      {policies.map((p) => (
        <details key={p.id} className="apd-policy" data-testid={`apd-policy-${p.id}`}>
          <summary><code>{p.id}</code> <span className="apd-tag">{p.state}</span> {p.summary}</summary>
          <pre>{p.cedar}</pre>
          <p className="apd-muted">Mirror of the live policy (read from the Privilege console 2026-10-22). The gateway runs the original.</p>
        </details>
      ))}
      {policies.length === 0 && <p className="apd-muted">No AI policy names this tool.</p>}

      {live ? (
        <div className="apd-actions">
          <button type="button" className="apd-btn" disabled={!ready || state?.running} onClick={() => onRun(s)} data-testid={`apd-run-${s.id}`}>
            {state?.running ? 'Calling the gateway…' : 'Run through Privilege'}
          </button>
          {!ready && <span className="apd-muted">Connect and sign in first.</span>}
        </div>
      ) : (
        <p className="apd-muted">Live runs need a Privilege sign-in: <Link to={LIVE_PAGE}>open the demo inside the app</Link>.</p>
      )}

      {state?.result && (
        <>
          <Verdict result={state.result} />
          {state.result.outcome === 'hold' && (
            <div className="apd-hold" data-testid="apd-hold">
              <p>Approve it in the Privilege console: <strong>Access Request Approvals</strong>, then press Retry. Nothing here approves it for you.</p>
              <button type="button" className="apd-btn" disabled={state.running} onClick={() => onRun(s)} data-testid="apd-retry">Retry after approval</button>
            </div>
          )}
          <p className={matches ? 'apd-ok' : 'apd-muted'}>{matches ? 'Matches what was expected.' : `Expected ${OUTCOMES[s.expect].label}, got ${OUTCOMES[state.result.outcome].label}.`}</p>
          <details className="apd-raw"><summary>The raw response from the gateway</summary><pre>{JSON.stringify(state.result.raw, null, 2)}</pre></details>
        </>
      )}
    </article>
  );
}

export default function PrivilegeAiPoliciesDemoPage({ live = true }) {
  const [conn, setConn] = useState({ status: live ? 'connecting' : 'off' });
  const [runs, setRuns] = useState({});

  const connect = useCallback(async () => {
    setConn({ status: 'connecting' });
    try {
      const r = await connectDoor(DOOR_NAME);
      if (!r.ok) setConn({ status: 'nodoor' });
      else setConn({ status: r.authenticated ? 'ready' : 'signin', url: r.url });
    } catch (e) {
      setConn({ status: e.status === 401 ? 'signin' : 'error', message: e.message });
    }
  }, []);

  useEffect(() => { if (live) connect(); }, [live, connect]);

  const run = async (s) => {
    setRuns((r) => ({ ...r, [s.id]: { ...r[s.id], running: true } }));
    const result = await runTool(s.tool, s.args);
    setRuns((r) => ({ ...r, [s.id]: { running: false, result } }));
    if (result.outcome === 'signin') setConn((c) => ({ ...c, status: 'signin' }));
  };

  const ready = conn.status === 'ready';
  const STATUS = {
    connecting: 'Connecting to the door…',
    ready: `Connected and signed in to the ${DOOR_NAME} door.`,
    signin: `Not signed in to the ${DOOR_NAME} door yet.`,
    nodoor: `The ${DOOR_NAME} door is not registered on this gateway, so there is nothing to call.`,
    error: `Could not reach the Privilege client: ${conn.message || 'unknown error'}.`,
  };

  return (
    <div className="apd-page" data-testid="apd-page">
      <header className="apd-hero">
        <h1>Privilege AI Policies demo</h1>
        <p className="apd-lede">
          Privilege decides every tool call an AI agent makes with <strong>Cedar policies, inside the gateway</strong>. Run a call through a real door and see
          what the gateway answers: allowed, refused, or held for a human, next to the real policy that decided it.
        </p>
        <p className="apd-banner" data-testid="apd-banner">
          Every decision on this page comes from the Privilege gateway. This page runs no Cedar engine and decides nothing.
        </p>
      </header>

      {live && (
        <section className="apd-panel" aria-labelledby="apd-conn" data-testid="apd-conn" data-status={conn.status}>
          <h2 id="apd-conn">1. Connect to the door</h2>
          <p>{STATUS[conn.status]}</p>
          {conn.status === 'signin' && (
            <p>Sign in once on the Privilege client (it opens the door's own sign-in), then come back and check again. <Link to={CLIENT_PAGE}>Open the Privilege client</Link>.</p>
          )}
          <p className="apd-muted">This also points your Privilege client session at this door, like its door picker does.</p>
          <button type="button" className="apd-btn apd-btn--ghost" onClick={connect} disabled={conn.status === 'connecting'}>Check again</button>
        </section>
      )}

      <section aria-labelledby="apd-scn">
        <h2 id="apd-scn">{live ? '2. Run a real call' : 'The scenarios'}</h2>
        <div className="apd-cards">
          {SCENARIOS.map((s) => <Scenario key={s.id} s={s} live={live} ready={ready} state={runs[s.id]} onRun={run} />)}
          <article className="apd-card apd-card--unproven" data-testid="apd-scn-pf-agent">
            <h3>{PF_AGENT.title} <span className="apd-tag apd-tag--warn">{PF_AGENT.status}</span></h3>
            <p>{PF_AGENT.story}</p>
            <ul>{PF_AGENT.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="apd-muted">There is no live run for this one on purpose.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="apd-vocab" className="apd-panel" data-testid="apd-vocab">
        <h2 id="apd-vocab">What a Privilege AI policy can read</h2>
        <p>A fixed set of attributes. No raw token claims, no <code>act</code>, and no ID-JAG hook.</p>
        <table className="apd-table">
          <thead><tr><th>Attribute</th><th>Where it comes from</th></tr></thead>
          <tbody>{CEDAR_VOCABULARY.map((v) => <tr key={v.attr}><td><code>{v.attr}</code></td><td>{v.from}</td></tr>)}</tbody>
        </table>
        <p><a href={DOC_URL} target="_blank" rel="noreferrer">Full write-up: PF identity in Cedar policies</a></p>
      </section>

      <section aria-labelledby="apd-diag" className="apd-panel">
        <h2 id="apd-diag">How a PingFederate identity reaches a Cedar decision</h2>
        <EmbeddedFlowDiagram
          config={PF_CEDAR_DIAGRAM}
          title="PingFederate identity to a Cedar policy decision"
          lede="Solid arrows were observed on the SE gateway; dashed arrows are designs not set up yet."
          ariaLabel="PingFederate identity to Cedar policy"
          testId="apd-diagram"
          pingStyle
        />
      </section>
    </div>
  );
}
