// /privilege-ai-policies (in the app) and /standalone/ai-policies (chrome-free, no live calls).
// A Privilege demo: Cedar runs INSIDE the Privilege gateway. This page sends real tool calls through a real door and shows
// what the gateway answered, next to the real Active policy that decided it. It contains no Cedar engine and decides nothing.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// Skipped: P6 (no list-and-detail inspector here: three scenario cards and a form) and P8 (the diagram is the shared
// EmbeddedFlowDiagram, not page boxes).
//
// P9, one primary per view state (see nextAction below). The primary is the one action that advances the flow:
//   - not connected / not signed in / connecting: "Check again" (nothing else can run);
//   - connected, a scenario is HELD: "Retry after approval" on that scenario (the only action that advances it);
//   - connected otherwise: "Run through Privilege" on the first scenario not yet run (the first one once all have run).
// Every other button is a secondary. The standalone walkthrough (live=false) has no buttons: its only actions are links.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { AI_POLICIES_DIAGRAM } from '../config/privilegeAiPoliciesDiagram';
import {
  BASELINE_RULES, CEDAR_VOCABULARY, DOOR_NAME, EVIDENCE, LAB_TOOLS, OPTION_NOTES, OUTCOMES, OUTCOME_CHOICES, PF_AGENT, POLICIES, SCENARIOS,
  applyEdit, buildCedar, predictImpact,
} from '../config/privilegeAiPoliciesDemo';
import { connectDoor, runTool } from '../services/privilegeAiPoliciesDemoService';
import './PrivilegeAiPoliciesDemoPage.css';

const CLIENT_PAGE = '/privilege-mcp-client';
const LIVE_PAGE = '/privilege-ai-policies';
const DOC_URL = 'https://github.com/curtismu7/AI-DEMO2/blob/main/privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md';

// The outcome word is always shown; the tone only adds colour to it (P7).
const VERDICT_TONE = { allow: 'ok', deny: 'danger', hold: 'warn', signin: 'warn', 'tool-error': 'warn', error: 'danger' };
const EVIDENCE_TONE = { measured: 'ok', 'console-text': 'info', inferred: 'warn' };
const CONN_META = {
  connecting: { tone: 'neutral', word: 'Connecting' },
  ready: { tone: 'ok', word: 'Connected' },
  signin: { tone: 'warn', word: 'Sign in needed' },
  nodoor: { tone: 'warn', word: 'No door' },
  error: { tone: 'danger', word: 'Error' },
};

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

  // The one primary action for this view state (P9). The walkthrough has no buttons, so no primary.
  let nextAction = null;
  if (live) {
    const held = SCENARIOS.find((s) => runs[s.id]?.result?.outcome === 'hold');
    const next = SCENARIOS.find((s) => !runs[s.id]?.result) || SCENARIOS[0];
    if (!ready) nextAction = 'connect';
    else if (held) nextAction = 'retry';
    else nextAction = `run-${next.id}`;
  }
  const connMeta = CONN_META[conn.status] || CONN_META.error;

  return (
    <PingPage className="apd-page" data-testid="apd-page">
      <SimBanner data-testid="apd-banner">
        {live ? (
          <>
            <strong>LIVE CALLS, MIRRORED POLICIES</strong> — every decision on this page comes from the Privilege gateway. This page runs no Cedar engine and decides nothing.
            Real: the three scenario runs, sent only when you press a button, to the {DOOR_NAME} door.
            Not real: the policy text (a mirror of the console), the options lab (a prediction) and the diagram (its Simulate button only animates).
          </>
        ) : (
          <>
            <strong>WALKTHROUGH, NO CALLS</strong> — nothing on this public page reaches the Privilege gateway, so no decision is shown, only the one each scenario is expected
            to get. The policy text is a mirror of the console, the options lab is a prediction and the diagram is a drawing. Live runs are in the app.
            This page runs no Cedar engine and decides nothing.
          </>
        )}
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · AI Policies"
        title="Privilege AI Policies demo"
        summary="Privilege decides every tool call an AI agent makes with Cedar policies, inside the gateway. Run a call through a real door and see what the gateway answers: allowed, refused, or held for a human, next to the real policy that decided it."
      />
      <PageFrame>
        {live && (
          <Section id="apd-conn-h" kicker="1 · Connect" title="Connect to the door">
            <Card tone={ready ? "ok" : connMeta.tone} data-testid="apd-conn" data-status={conn.status}>
              <p className="pu-status-line"><StatusChip tone={connMeta.tone}>{connMeta.word}</StatusChip><span>{STATUS[conn.status]}</span></p>
              {conn.status === 'signin' && (
                <p className="pu-note">Sign in once on the Privilege client (it opens the door&apos;s own sign-in), then come back and check again. <Link to={CLIENT_PAGE}>Open the Privilege client</Link>.</p>
              )}
              <p className="pu-note">This also points your Privilege client session at this door, like its door picker does.</p>
              <div className="pu-actions">
                <ActionButton next={nextAction === 'connect'} onClick={connect} busy={conn.status === 'connecting'}>Check again</ActionButton>
              </div>
            </Card>
          </Section>
        )}

        <Section id="apd-scn-h" kicker={live ? "2 · Run" : "1 · Scenarios"} title={live ? 'Run a real call' : 'The scenarios'}>
          <CardGrid>
            {SCENARIOS.map((s) => <Scenario key={s.id} s={s} live={live} ready={ready} state={runs[s.id]} onRun={run} nextAction={nextAction} />)}
            <Card title={PF_AGENT.title} tone="neutral" data-testid="apd-scn-pf-agent">
              <p className="pu-status-line"><StatusChip tone="ok">{PF_AGENT.status}</StatusChip><span>Not run on this page: it has its own.</span></p>
              <p className="pu-note">{PF_AGENT.story}</p>
              <ul className="pu-note apd-list">{PF_AGENT.facts.map((f) => <li key={f}>{f}</li>)}</ul>
              <p className="pu-note"><Link to={PF_AGENT.link} data-testid="apd-pf-link">Run it on the PingFederate Token Demo page</Link></p>
            </Card>
          </CardGrid>
        </Section>

        <OptionsLab />

        <div data-testid="apd-vocab">
          <Section
            id="apd-vocab-h"
            kicker="4 · Reference"
            title="What a Privilege AI policy can read"
            lede="A fixed set of attributes. No raw token claims, no act, and no ID-JAG hook."
          >
            <Card tone="neutral">
              <div className="apd-table-wrap">
                <table className="apd-table">
                  <thead><tr><th scope="col">Attribute</th><th scope="col">Where it comes from</th></tr></thead>
                  <tbody>{CEDAR_VOCABULARY.map((v) => <tr key={v.attr}><td><code>{v.attr}</code></td><td>{v.from}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="pu-note"><a href={DOC_URL} target="_blank" rel="noreferrer">Full write-up: PF identity in Cedar policies</a></p>
            </Card>
          </Section>
        </div>

        <Section id="apd-diag-h" kicker="5 · How it decides" title="Cedar runs inside the gateway">
          <EmbeddedFlowDiagram
            config={AI_POLICIES_DIAGRAM}
            title="How a tool call is decided, and where this page and PingFederate fit"
            lede="Solid arrows were observed on the SE gateway; dashed arrows are inferred or not proven. This page is only a client: it sends a call and shows the real verdict."
            ariaLabel="How Privilege decides a tool call with Cedar"
            testId="apd-diagram"
            pingStyle
          />
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// The one button component: P9's primary is decided at run time from the view state (see the header), so the class lives here once
// and every button on the page goes through it.
// While a call is in flight the button is aria-disabled, not disabled: a disabled button drops keyboard focus to the page
// body, so a keyboard user who pressed it would have to tab back from the top.
function ActionButton({ next, busy, onClick, ...rest }) {
  return (
    <button
      type="button"
      className={next ? 'pu-btn pu-btn--primary' : 'pu-btn'}
      aria-disabled={busy ? 'true' : undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    />
  );
}

function PolicyState({ state }) {
  return <StatusChip tone={state === 'Active' ? 'ok' : 'neutral'}>{state}</StatusChip>;
}

// Only these outcomes are an answer the gateway actually gave; sign-in and error come from this page or the BFF.
const GATEWAY_ANSWERS = new Set(['allow', 'hold', 'deny', 'tool-error']);

// tabIndex -1: not in the tab order, but a run that unmounts the button the keyboard user pressed (Retry) can park focus here.
function Verdict({ result, verdictRef }) {
  const o = OUTCOMES[result.outcome];
  return (
    <div className="apd-verdict" data-testid="apd-verdict" data-outcome={result.outcome} role="status" tabIndex={-1} ref={verdictRef}>
      <p className="pu-status-line"><StatusChip tone={VERDICT_TONE[result.outcome] ?? 'neutral'}>{o.label}</StatusChip> {GATEWAY_ANSWERS.has(result.outcome) ? 'The gateway\u2019s answer to this call' : 'No gateway answer: the call did not reach a verdict'}</p>
      <p className="pu-note">{o.note}</p>
      {result.instructionId && <p className="pu-note">Approval id from the gateway: <code data-testid="apd-ins">{result.instructionId}</code></p>}
      {result.detail && <p className="pu-note">{result.detail}</p>}
    </div>
  );
}

function Scenario({ s, live, ready, state, onRun, nextAction }) {
  const policies = s.policies.map((id) => ({ id, ...POLICIES[id] }));
  const matches = state && state.result && state.result.outcome === s.expect;
  const tone = state?.result ? VERDICT_TONE[state.result.outcome] : undefined;
  // The designed walk-through for a HELD scenario is: held, approve in the console, retry, allowed. That last step is the
  // expected outcome of the walk-through, not a mismatch with the "Expected HELD" of the first run.
  const approvedRetry = Boolean(state?.result) && s.expect === 'hold' && state.previous === 'hold' && state.result.outcome === 'allow';

  // Retry unmounts when the answer is no longer HELD, so a keyboard user who pressed it would drop to the page body.
  // We remember the Retry button that was pressed. After that run settles, focus moves to the verdict only if that button is
  // gone AND focus really fell to the page body. If the user moved on during the call (another card's Run, a link ...),
  // focus is somewhere real and is left alone.
  const verdictRef = useRef(null);
  const pressedRetry = useRef(null);
  const settled = Boolean(state?.result) && !state?.running;
  useEffect(() => {
    const pressed = pressedRetry.current;
    if (!pressed || !settled) return;
    pressedRetry.current = null;
    const active = document.activeElement;
    const focusLost = !active || active === document.body;
    if (!pressed.isConnected && focusLost) verdictRef.current?.focus();
  }, [settled, state?.result]);
  const retry = (e) => { pressedRetry.current = e.currentTarget; onRun(s); };

  return (
    <Card title={s.title} tone={tone} data-testid={`apd-scn-${s.id}`}>
      <p className="pu-note">{s.story}</p>
      <KvList
        items={[
          { label: 'Call', value: <><code>{s.tool}</code> <code>{JSON.stringify(s.args)}</code></> },
          { label: 'Door', value: <code>{DOOR_NAME}</code> },
          { label: 'Expected from the gateway', value: <strong>{OUTCOMES[s.expect].label}</strong> },
        ]}
      />
      <p className="pu-note">{s.notice}</p>

      {policies.map((p) => (
        <details key={p.id} className="apd-policy" data-testid={`apd-policy-${p.id}`}>
          <summary><code>{p.id}</code> <PolicyState state={p.state} /> {p.summary}</summary>
          <pre role="region" tabIndex={0} aria-label={`Cedar of ${p.id}`}>{p.cedar}</pre>
          <p className="pu-note">Mirror of the live policy (read from the Privilege console 2026-10-22). The gateway runs the original.</p>
        </details>
      ))}
      {policies.length === 0 && <p className="pu-note">No AI policy names this tool.</p>}

      {live ? (
        <div className="pu-actions">
          <ActionButton
            next={nextAction === `run-${s.id}`}
            disabled={!ready}
            busy={state?.running}
            onClick={() => onRun(s)}
            aria-label={state?.running ? undefined : `Run through Privilege: ${s.title}`}
            data-testid={`apd-run-${s.id}`}
          >
            {state?.running ? 'Calling the gateway…' : 'Run through Privilege'}
          </ActionButton>
          {!ready && <span className="pu-note">Connect and sign in first.</span>}
        </div>
      ) : (
        <p className="pu-note">Live runs need a Privilege sign-in: <Link to={LIVE_PAGE}>open the demo inside the app</Link>.</p>
      )}

      {state?.result && (
        <>
          <Verdict result={state.result} verdictRef={verdictRef} />
          {state.previous && state.previous !== state.result.outcome && !approvedRetry && (
            <p className="pu-status-line apd-changed" data-testid="apd-changed">
              <StatusChip tone="info">Changed</StatusChip>
              <span>
                Changed since your last run: <strong>{OUTCOMES[state.previous].label}</strong> → <strong>{OUTCOMES[state.result.outcome].label}</strong>. Something changed on Privilege between the two runs.
              </span>
            </p>
          )}
          {state.result.outcome === 'hold' && (
            <div className="apd-hold" data-testid="apd-hold">
              <p className="pu-note">Approve it in the Privilege console: <strong>Access Request Approvals</strong>, then press Retry. Nothing here approves it for you.</p>
              <ActionButton
                next={nextAction === 'retry'}
                busy={state.running}
                onClick={retry}
                data-testid="apd-retry"
              >
                Retry after approval
              </ActionButton>
            </div>
          )}
          <p className="pu-status-line">
            {approvedRetry
              ? <><StatusChip tone="ok">Allowed on retry</StatusChip><span>Held, then allowed on retry: the expected end of this walk-through.</span></>
              : matches
              ? <><StatusChip tone="ok">Match</StatusChip><span>Matches what was expected.</span></>
              : <><StatusChip tone="warn">Differs</StatusChip><span>{`Expected ${OUTCOMES[s.expect].label}, got ${OUTCOMES[state.result.outcome].label}.`}</span></>}
          </p>
          <details className="apd-policy apd-raw">
            <summary>The raw response from the gateway</summary>
            <pre role="region" tabIndex={0} aria-label="Raw gateway response">{JSON.stringify(state.result.raw, null, 2)}</pre>
          </details>
        </>
      )}
    </Card>
  );
}

const TOOL_SCENARIO = { SearchIndexTool: 'hold', GenericOpenSearchApiTool: 'deny', ListIndexTool: 'allow' };
const STAGE_LABEL = { allow: 'ALLOWED', hold: 'HELD', deny: 'DENIED' };

// Mirrors the options of the Privilege console's AI Policies "Build a rule" form. Pick a rule to edit (or add one), change an
// option, and see the exact Cedar the console would save and the predicted impact on the three scenarios. The prediction is
// documented behaviour for these three tools; the gateway decides for real once you save the change and run the scenario again.
// Nothing in this block calls the gateway, so nothing in it is titled or coloured as a gateway answer.
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
    <div data-testid="apd-lab">
      <Section
        id="apd-lab-h"
        kicker="3 · Options lab"
        title="Change an option on Privilege, see the impact"
        lede="This mirrors the Privilege console's AI Policies editor (Build a rule): the same options generate the Cedar the gateway runs. Change an option below to see the Cedar it would save and what it would do to the three scenarios."
      >
        <p className="pu-status-line">
          <StatusChip tone="neutral">Prediction</StatusChip>
          <span data-testid="apd-lab-honest">
            The impact column is a <strong>prediction</strong> from Privilege&apos;s documented behaviour for these three tools. The gateway decides for real once you make the
            change in the console and press Run again above, where the page shows what changed.
          </span>
        </p>

        <CardGrid>
          <Card title="Options" tone="neutral">
            <div className="apd-field">
              <label className="pu-label" htmlFor="apd-lab-rule">Rule to change</label>
              <select id="apd-lab-rule" className="pu-select" value={editing} onChange={(e) => pick(e.target.value)} data-testid="apd-lab-rule">
                {BASELINE_RULES.map((r) => <option key={r.id} value={r.id}>{r.id} (today: {r.outcome === 'hold' ? 'hold' : 'refuse'} {r.tool})</option>)}
                <option value="new">A new rule</option>
              </select>
            </div>
            <div className="apd-field">
              <label className="pu-label" htmlFor="apd-lab-outcome">Outcome</label>
              <select id="apd-lab-outcome" className="pu-select" value={edit.outcome} onChange={(e) => set({ outcome: e.target.value })} data-testid="apd-lab-outcome">
                {OUTCOME_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="pu-note">{OUTCOME_CHOICES.find((o) => o.value === edit.outcome).note}</p>
            </div>
            <div className="apd-field">
              <label className="pu-label" htmlFor="apd-lab-tool">Target: one named tool</label>
              <select id="apd-lab-tool" className="pu-select" value={edit.tool} onChange={(e) => set({ tool: e.target.value })} data-testid="apd-lab-tool">
                {LAB_TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {edit.outcome === 'hold' && (
              <label className="apd-check">
                <input type="checkbox" checked={edit.liftsOnApproval} onChange={(e) => set({ liftsOnApproval: e.target.checked })} data-testid="apd-lab-lifts" />
                Condition: unless an approval is on record
              </label>
            )}
            <div className="apd-field">
              <label className="pu-label" htmlFor="apd-lab-state">Save as</label>
              <select id="apd-lab-state" className="pu-select" value={edit.state} onChange={(e) => set({ state: e.target.value })} data-testid="apd-lab-state">
                <option value="Active">Active (enforced)</option>
                <option value="Candidate">Candidate (validated, never enforced)</option>
              </select>
            </div>
            <p className="pu-note">When it runs: on the request. MCP server: {DOOR_NAME}. Caller: any caller.</p>
          </Card>

          <Card title="Cedar this will save" tone="neutral">
            <pre className="apd-cedar" role="region" tabIndex={0} aria-label="Cedar this will save" data-testid="apd-lab-cedar">{cedar}</pre>
            {edit.state === 'Candidate' && (
              <p className="pu-status-line" data-testid="apd-lab-candidate">
                <StatusChip tone="warn">Candidate</StatusChip>
                <span>Saved as a Candidate, this rule is validated and stored but never enforced, so it changes nothing about any call.</span>
              </p>
            )}
            {edit.outcome === 'hold' && !edit.liftsOnApproval && (
              <p className="pu-status-line" data-testid="apd-lab-nolift">
                <StatusChip tone="warn">No lift</StatusChip>
                <span>Without the `unless` clause the console warns that the rule &quot;asks for a human and then refuses the approval it asked for&quot;: approving never lets the call through.</span>
              </p>
            )}
          </Card>
        </CardGrid>

        <Card tone="neutral">
          <div className="apd-table-wrap">
            <table className="apd-table apd-table--stack" data-testid="apd-lab-impact">
              <caption className="pu-note">Predicted impact on each scenario (a prediction, not a gateway answer)</caption>
              <thead><tr><th scope="col">Scenario / tool</th><th scope="col">Predicted today</th><th scope="col">Predicted with your change</th><th scope="col">Predicted after you approve and retry</th></tr></thead>
              <tbody>
                {LAB_TOOLS.map((t) => {
                  const isChanged = changed.includes(t);
                  return (
                    <tr key={t} className={isChanged ? 'apd-row--changed' : ''} data-testid={`apd-impact-${TOOL_SCENARIO[t]}`} data-changed={isChanged ? 'yes' : 'no'}>
                      <td data-label="Scenario / tool"><code>{t}</code></td>
                      <td data-label="Predicted today">{STAGE_LABEL[today[t].outcome]}</td>
                      <td data-label="Predicted with your change"><strong>{STAGE_LABEL[impact[t].outcome]}</strong>{isChanged ? (impact[t].outcome !== today[t].outcome ? ' (changed)' : ' (same, but approval no longer lifts it)') : ''}</td>
                      <td data-label="Predicted after you approve and retry">{impact[t].afterApproval ? STAGE_LABEL[impact[t].afterApproval] : 'n/a'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {changed.length === 0 && <p className="pu-note" data-testid="apd-lab-nochange">This change would not alter any of the three scenarios.</p>}
        </Card>

        <Card title="Make it real" tone="neutral">
          <ol className="apd-steps">
            <li>In the Privilege console open <strong>Access Management → AI Policies</strong>, open the rule (or create a copy), and choose <strong>Build a rule</strong>.</li>
            <li>Set the options above. Save as <strong>Candidate</strong> first to check it compiles without enforcing it (a rule that does not compile is refused and nothing is stored), then <strong>Save changes</strong> as Active to enforce.</li>
            <li>Press <strong>Run</strong> on the scenario again in the scenarios above. The page shows <em>Changed since your last run</em> with the gateway&apos;s real before and after.</li>
          </ol>
          <p className="pu-note">The door is shared: editing a live rule changes the demo for everyone, so change a copy and put it back.</p>
        </Card>

        <Card title="What each option does, and how we know" tone="neutral">
          <div className="apd-table-wrap">
            <table className="apd-table apd-table--stack">
              <thead><tr><th scope="col">Option</th><th scope="col">Effect</th><th scope="col">Evidence</th></tr></thead>
              <tbody>
                {OPTION_NOTES.map((n) => (
                  <tr key={n.option}>
                    <td data-label="Option"><strong>{n.option}</strong><br /><span className="pu-note">{n.where}</span></td>
                    <td data-label="Effect">{n.effect}</td>
                    <td data-label="Evidence"><StatusChip tone={EVIDENCE_TONE[n.evidence] ?? 'neutral'}>{n.evidence}</StatusChip><br /><span className="pu-note">{EVIDENCE[n.evidence]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </div>
  );
}

