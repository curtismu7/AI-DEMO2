// /privilege-ai-policies (in the app) and /standalone/ai-policies (chrome-free, no live calls).
// A Privilege demo: Cedar runs INSIDE the Privilege gateway. This page sends real tool calls through a real door and shows
// what the gateway answered, next to the real Active policy that decided it. It contains no Cedar engine and decides nothing.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { AI_POLICIES_DIAGRAM } from '../config/privilegeAiPoliciesDiagram';
import {
  BASELINE_RULES, CEDAR_VOCABULARY, DOOR_NAME, EVIDENCE, LAB_TOOLS, OPTION_NOTES, OUTCOMES, OUTCOME_CHOICES, PF_AGENT, POLICIES, SCENARIOS,
  applyEdit, buildCedar, predictImpact,
} from '../config/privilegeAiPoliciesDemo';
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
          {state.previous && state.previous !== state.result.outcome && (
            <p className="apd-changed" data-testid="apd-changed">
              Changed since your last run: <strong>{OUTCOMES[state.previous].label}</strong> → <strong>{OUTCOMES[state.result.outcome].label}</strong>. Something changed on Privilege between the two runs.
            </p>
          )}
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

const TOOL_SCENARIO = { SearchIndexTool: 'hold', GenericOpenSearchApiTool: 'deny', ListIndexTool: 'allow' };
const STAGE_LABEL = { allow: 'ALLOWED', hold: 'HELD', deny: 'DENIED' };

// Mirrors the options of the Privilege console's AI Policies "Build a rule" form. Pick a rule to edit (or add one), change an
// option, and see the exact Cedar the console would save and the predicted impact on the three scenarios. The prediction is
// documented behaviour for these three tools; the gateway decides for real once you save the change and run the scenario again.
function OptionsLab() {
  const base = (id) => BASELINE_RULES.find((r) => r.id === id) || { outcome: 'refuse', tool: 'ListIndexTool', state: 'Active', liftsOnApproval: true };
  const [editing, setEditing] = useState('hitl-opensearch');
  const [edit, setEdit] = useState(() => ({ ...base('hitl-opensearch') }));
  const pick = (id) => { setEditing(id); setEdit({ ...base(id) }); };
  const set = (patch) => setEdit((e) => ({ ...e, ...patch }));

  const today = predictImpact(BASELINE_RULES);
  const { impact } = applyEdit(editing, edit);
  const cedar = buildCedar(edit);
  const changed = LAB_TOOLS.filter((t) => impact[t].outcome !== today[t].outcome || impact[t].afterApproval !== today[t].afterApproval);

  return (
    <section aria-labelledby="apd-lab" className="apd-panel" data-testid="apd-lab">
      <h2 id="apd-lab">{`Change an option on Privilege, see the impact`}</h2>
      <p>
        This mirrors the Privilege console's AI Policies editor (<strong>Build a rule</strong>): the same options generate the Cedar the gateway runs.
        Change an option below to see the Cedar it would save and what it would do to the three scenarios.
      </p>
      <p className="apd-muted" data-testid="apd-lab-honest">
        The impact column is a <strong>prediction</strong> from Privilege's documented behaviour for these three tools. The gateway decides for real once you make the
        change in the console and press Run again above, where the page shows what changed.
      </p>

      <div className="apd-lab">
        <div className="apd-lab-form">
          <label>Rule to change
            <select value={editing} onChange={(e) => pick(e.target.value)} data-testid="apd-lab-rule">
              {BASELINE_RULES.map((r) => <option key={r.id} value={r.id}>{r.id} (today: {r.outcome === 'hold' ? 'hold' : 'refuse'} {r.tool})</option>)}
              <option value="new">A new rule</option>
            </select>
          </label>
          <label>Outcome
            <select value={edit.outcome} onChange={(e) => set({ outcome: e.target.value })} data-testid="apd-lab-outcome">
              {OUTCOME_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p className="apd-muted">{OUTCOME_CHOICES.find((o) => o.value === edit.outcome).note}</p>
          <label>Target: one named tool
            <select value={edit.tool} onChange={(e) => set({ tool: e.target.value })} data-testid="apd-lab-tool">
              {LAB_TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {edit.outcome === 'hold' && (
            <label className="apd-check">
              <input type="checkbox" checked={edit.liftsOnApproval} onChange={(e) => set({ liftsOnApproval: e.target.checked })} data-testid="apd-lab-lifts" />
              Condition: unless an approval is on record
            </label>
          )}
          <label>Save as
            <select value={edit.state} onChange={(e) => set({ state: e.target.value })} data-testid="apd-lab-state">
              <option value="Active">Active (enforced)</option>
              <option value="Candidate">Candidate (validated, never enforced)</option>
            </select>
          </label>
          <p className="apd-muted">When it runs: on the request. MCP server: {DOOR_NAME}. Caller: any caller.</p>
        </div>

        <div className="apd-lab-cedar">
          <h3>Cedar this will save</h3>
          <pre data-testid="apd-lab-cedar">{cedar}</pre>
          {edit.state === 'Candidate' && <p className="apd-warn" data-testid="apd-lab-candidate">Saved as a Candidate, this rule is validated and stored but never enforced, so it changes nothing about any call.</p>}
          {edit.outcome === 'hold' && !edit.liftsOnApproval && (
            <p className="apd-warn" data-testid="apd-lab-nolift">Without the `unless` clause the console warns that the rule "asks for a human and then refuses the approval it asked for": approving never lets the call through.</p>
          )}
        </div>
      </div>

      <table className="apd-table" data-testid="apd-lab-impact">
        <caption className="apd-muted">Predicted impact on each scenario</caption>
        <thead><tr><th>Scenario / tool</th><th>Today</th><th>With your change</th><th>After you approve and retry</th></tr></thead>
        <tbody>
          {LAB_TOOLS.map((t) => {
            const isChanged = changed.includes(t);
            return (
              <tr key={t} className={isChanged ? 'apd-row--changed' : ''} data-testid={`apd-impact-${TOOL_SCENARIO[t]}`} data-changed={isChanged ? 'yes' : 'no'}>
                <td><code>{t}</code></td>
                <td>{STAGE_LABEL[today[t].outcome]}</td>
                <td><strong>{STAGE_LABEL[impact[t].outcome]}</strong>{isChanged ? (impact[t].outcome !== today[t].outcome ? ' (changed)' : ' (same, but approval no longer lifts it)') : ''}</td>
                <td>{impact[t].afterApproval ? STAGE_LABEL[impact[t].afterApproval] : 'n/a'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {changed.length === 0 && <p className="apd-muted" data-testid="apd-lab-nochange">This change would not alter any of the three scenarios.</p>}

      <h3>Make it real</h3>
      <ol className="apd-steps">
        <li>In the Privilege console open <strong>Access Management → AI Policies</strong>, open the rule (or create a copy), and choose <strong>Build a rule</strong>.</li>
        <li>Set the options above. Save as <strong>Candidate</strong> first to check it compiles without enforcing it (a rule that does not compile is refused and nothing is stored), then <strong>Save changes</strong> as Active to enforce.</li>
        <li>Press <strong>Run</strong> on the scenario again in section 2. The page shows <em>Changed since your last run</em> with the gateway's real before and after.</li>
      </ol>
      <p className="apd-muted">The door is shared: editing a live rule changes the demo for everyone, so change a copy and put it back.</p>

      <h3>What each option does, and how we know</h3>
      <table className="apd-table">
        <thead><tr><th>Option</th><th>Effect</th><th>Evidence</th></tr></thead>
        <tbody>
          {OPTION_NOTES.map((n) => (
            <tr key={n.option}><td><strong>{n.option}</strong><br /><span className="apd-muted">{n.where}</span></td><td>{n.effect}</td><td><span className={`apd-tag apd-tag--${n.evidence}`}>{n.evidence}</span><br /><span className="apd-muted">{EVIDENCE[n.evidence]}</span></td></tr>
          ))}
        </tbody>
      </table>
    </section>
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
    setRuns((r) => ({ ...r, [s.id]: { running: false, result, previous: r[s.id]?.result?.outcome } }));
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

      <OptionsLab />

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
        <h2 id="apd-diag">How Privilege decides: Cedar runs inside the gateway</h2>
        <EmbeddedFlowDiagram
          config={AI_POLICIES_DIAGRAM}
          title="How a tool call is decided, and where this page and PingFederate fit"
          lede="Solid arrows were observed on the SE gateway; dashed arrows are inferred or not proven. This page is only a client: it sends a call and shows the real verdict."
          ariaLabel="How Privilege decides a tool call with Cedar"
          testId="apd-diagram"
          pingStyle
        />
      </section>
    </div>
  );
}
