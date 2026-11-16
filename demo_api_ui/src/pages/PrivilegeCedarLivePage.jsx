// /privilege-cedar-live (in the app) and /standalone/cedar-live (chrome-free, no live calls): "Cedar in Privilege (live)".
// A guided tour of three Cedar cases against the real Privilege gateway, in order: hold for a human, a token-scope gate and an
// agent act.sub gate. It composes what already exists and decides nothing: the hold case is the AI Policies demo's own service
// and scenario, the other two are the BFF run behind /privilege-pf-token (its verdict chips and its act.sub result are reused).
// Cedar runs inside the gateway; this page only sends calls and shows the gateway's answer next to the Cedar that decided it.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi): P2 banner first, P3 frame,
// P4 cards, P5 kv, P7 chips with a word, P9 buttons.
//
// P9, one primary per view state: the primary is the one action that advances the tour.
//   - a held call: "Retry after approval";
//   - otherwise "Run" on the first step that can run and has no result yet (step 1 needs the Privilege sign-in, steps 2 and 3
//     need the demo app sign-in and the PingFederate secret on the api-server);
//   - nothing can run yet: "Check again" on step 1.
// Every other button is a secondary. The walkthrough (live=false) has no buttons and makes no calls: only links.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import JsonPane from '../components/shared/JsonPane';
import SignInPrompt from '../components/SignInPrompt';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import {
  CEDAR_IS, CEDAR_ISNT, DOOR_NAME, OUTCOMES, SCENARIOS, SETUP_STEPS, USE_CASES,
} from '../config/privilegeAiPoliciesDemo';
import { ACT_SUB_POLICIES, ACT_SUB_POLICIES_LABEL, ACT_SUB_ISNT, VERDICTS } from '../config/privilegePfTokenDemo';
import {
  LIVE_PATH, MEASURED, NOT_MEASURED, STEPS, WALKTHROUGH_PATH, holdState, interpretRun, scopeGate,
} from '../config/privilegeCedarLive';
import { connectDoor, runTool } from '../services/privilegeAiPoliciesDemoService';
import { getState, runDemo } from '../services/privilegePfTokenDemoService';
import { ActSubResult, VerdictChip } from './PrivilegePfTokenDemoPage';
import './PrivilegeCedarLivePage.css';

const CLIENT_PAGE = '/privilege-mcp-client';
const HOLD_SCENARIO = SCENARIOS.find((s) => s.id === 'hold');
const CASES_READ = 'console copy read 2026-11-16';
const findUseCase = (id) => USE_CASES.find((u) => u.id === id);
const HOLD_POLICY = findUseCase('hold');
const SCOPE_POLICY = findUseCase('scope');

const VERDICT_TONE = { allow: 'ok', deny: 'danger', hold: 'warn', signin: 'warn', 'tool-error': 'warn', error: 'danger' };
const GATEWAY_ANSWERS = new Set(['allow', 'hold', 'deny', 'tool-error']);
const CONN_META = {
  connecting: { tone: 'neutral', word: 'Connecting' },
  ready: { tone: 'ok', word: 'Connected' },
  signin: { tone: 'warn', word: 'Sign in needed' },
  nodoor: { tone: 'warn', word: 'No door' },
  error: { tone: 'danger', word: 'Error' },
};

// One PingFederate run per step. Steps 2 and 3 each press their own button, and each shows only its own slice of the answer.
function usePfRun(onSignedOut) {
  const [run, setRun] = useState({ running: false, data: null, problem: '' });
  const busy = useRef(false);
  const start = useCallback(async () => {
    if (busy.current) return; // aria-disabled while running, not disabled: a disabled button drops keyboard focus
    busy.current = true;
    setRun({ running: true, data: null, problem: '' }); // a failure must never sit beside the previous run's success
    try {
      const out = interpretRun(await runDemo());
      if (out.signedOut) onSignedOut();
      setRun({ running: false, data: out.data || null, problem: out.problem || '' });
    } catch (e) {
      setRun({ running: false, data: null, problem: e.message });
    } finally {
      busy.current = false;
    }
  }, [onSignedOut]);
  return [run, start];
}

export default function PrivilegeCedarLivePage({ live = true }) {
  const [conn, setConn] = useState({ status: live ? 'connecting' : 'off' });
  const [hold, setHold] = useState({ running: false, result: null, previous: null });
  const [pf, setPf] = useState(null); // null while loading

  const connect = useCallback(async () => {
    setConn({ status: 'connecting' });
    try {
      const r = await connectDoor(DOOR_NAME);
      if (!r.ok) setConn({ status: 'nodoor' });
      else setConn({ status: r.authenticated ? 'ready' : 'signin' });
    } catch (e) {
      setConn({ status: e.status === 401 ? 'signin' : 'error', message: e.message });
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    connect();
    // 401 here is the hosted-access wall (no session), not a missing secret.
    getState()
      .then(({ status, data }) => setPf(status === 401 ? { signedOut: true } : data))
      .catch(() => setPf({ configured: false }));
  }, [live, connect]);

  const onSignedOut = useCallback(() => setPf((s) => ({ ...s, signedOut: true })), []);
  const [scopeRun, runScope] = usePfRun(onSignedOut);
  const [actRun, runAct] = usePfRun(onSignedOut);

  const runHold = async () => {
    setHold((h) => ({ ...h, running: true }));
    const result = await runTool(HOLD_SCENARIO.tool, HOLD_SCENARIO.args);
    setHold((h) => ({ running: false, result, previous: h.result?.outcome ?? null }));
    if (result.outcome === 'signin') setConn((c) => ({ ...c, status: 'signin' }));
  };

  const doorReady = conn.status === 'ready';
  const pfReady = Boolean(pf?.configured);
  const held = hold.result?.outcome === 'hold';

  // The one primary for this view state (P9). The walkthrough has no buttons, so no primary.
  let next = null;
  if (live) {
    if (held) next = 'retry';
    else if (doorReady && !hold.result) next = 'run-hold';
    else if (pfReady && !(scopeRun.data || scopeRun.problem)) next = 'run-scope';
    else if (pfReady && !(actRun.data || actRun.problem)) next = 'run-actsub';
    else if (!doorReady && !pfReady) next = 'connect';
  }

  return (
    <PingPage className="pcl-page" data-testid="pcl-page">
      <SimBanner data-testid="pcl-banner">
        {live ? (
          <>
            <strong>LIVE CALLS, RECORDED POLICY COPIES</strong> — each verdict on this page comes from the Privilege gateway, and the page runs no Cedar engine.
            Real: the three runs, sent only when you press a button (step 1 to the {DOOR_NAME} door with your Privilege sign-in, steps 2 and 3 through this machine&apos;s
            BFF, which mints a real PingFederate token and never shows it). Not real: the Cedar text, which is a copy read from the console on 2026-11-16.
            Steps 2 and 3 only mean something while the matching policies are Active, and when they are not the page says so.
          </>
        ) : (
          <>
            <strong>WALKTHROUGH, NO CALLS</strong> — nothing on this public page reaches the Privilege gateway or PingFederate, so no verdict is shown, only the one each step is
            expected to get. The Cedar text is a copy read from the console on 2026-11-16. This page runs no Cedar engine and decides nothing. The live tour is in the app.
          </>
        )}
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Cedar"
        title="Cedar in Privilege (live)"
        summary="Three Cedar cases against the real Privilege gateway, in order: hold a call for a human, gate a tool by the token's scope, and gate a tool by the agent's act.sub claim. Each shows the gateway's real answer next to the Cedar that decided it."
      />
      <PageFrame>
        <SetupGuide />

        {live && pf?.signedOut && (
          <SignInPrompt variant="strip" message="Sign in to the demo app to mint a PingFederate token for steps 2 and 3." />
        )}

        <Section
          id="pcl-tour-h"
          kicker="The tour"
          title={live ? 'Run the three cases' : 'The three cases'}
          lede="Each step says what to expect, runs one real call, and shows what the gateway answered beside the Cedar and its state."
        >
          <div className="pcl-steps">
            <HoldStep live={live} conn={conn} hold={hold} next={next} onRun={runHold} onConnect={connect} />
            <ScopeStep live={live} pf={pf} run={scopeRun} next={next} onRun={runScope} />
            <ActSubStep live={live} pf={pf} run={actRun} next={next} onRun={runAct} />
          </div>
        </Section>

        <Section
          id="pcl-measured-h"
          kicker="Closing"
          title="What is measured, and what is not"
          lede="Measured on the owner's Privilege tenant with a real PingFederate token. A result on this page is only worth what the policies behind it were: with none Active, every call is allowed."
        >
          <CardGrid>
            <Card title="Measured" tone="neutral" data-testid="pcl-measured">
              <ul className="pcl-list">{MEASURED.map((t) => <li key={t}>{t}</li>)}</ul>
            </Card>
            <Card title="Not measured" tone="warn" data-testid="pcl-notmeasured">
              <ul className="pcl-list">{NOT_MEASURED.map((t) => <li key={t}>{t}</li>)}</ul>
            </Card>
            <Card title="What the act.sub case is not" tone="neutral" data-testid="pcl-actsub-isnt">
              <ul className="pcl-list">{ACT_SUB_ISNT.map((t) => <li key={t}>{t}</li>)}</ul>
            </Card>
          </CardGrid>
          <p className="pu-note">
            Each case has its own page: <Link to="/privilege-ai-policies">AI Policies demo</Link> and <Link to="/privilege-pf-token">PingFederate token demo</Link>.
            {live ? <> The walkthrough without live calls is at <Link to={WALKTHROUGH_PATH}>{WALKTHROUGH_PATH}</Link>.</> : <> Live runs are in the app: <Link to={LIVE_PATH}>open the live tour</Link>.</>}
          </p>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// The one button component: the primary is decided at run time from the view state (see the header).
function ActionButton({ lead, busy, onClick, ...rest }) {
  return (
    <button
      type="button"
      className={lead ? 'pu-btn pu-btn--primary' : 'pu-btn'}
      aria-disabled={busy ? 'true' : undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    />
  );
}

function ConsoleCopy({ policy, state, label = CASES_READ, summary, cedar }) {
  return (
    <details className="pcl-policy" data-testid={`pcl-policy-${policy}`}>
      <summary>
        <code>{policy}</code> <StatusChip tone={state === 'Active' ? 'ok' : 'neutral'}>{state}</StatusChip> {summary}
      </summary>
      <pre className="pcl-cedar" role="region" tabIndex={0} aria-label={`Cedar of ${policy}`}>{cedar}</pre>
      <p className="pu-note">Mirror of the console ({label}). The gateway runs the original.</p>
    </details>
  );
}

function ExpectList({ step, extra }) {
  return (
    <>
      <p className="pu-note">{step.expect}</p>
      <KvList items={[{ label: 'Expected from the gateway', value: <strong>{step.expectWord}</strong> }, ...extra]} />
      <p className="pu-note">{step.needs}</p>
    </>
  );
}

function MintError({ mint }) {
  return (
    <p className="pu-status-line" data-testid="pcl-mint-error">
      <StatusChip tone="danger">Failed</StatusChip>
      PingFederate did not issue a token (HTTP {mint.status}): {mint.error}
    </p>
  );
}

// ---- Step 1: hold for a human ------------------------------------------------------------------------------------------
function HoldStep({ live, conn, hold, next, onRun, onConnect }) {
  const step = STEPS[0];
  const ready = conn.status === 'ready';
  const meta = CONN_META[conn.status] || CONN_META.error;
  const outcome = hold.result?.outcome;
  const state = hold.result ? holdState({ outcome, previous: hold.previous }) : null;
  const o = outcome ? OUTCOMES[outcome] : null;
  const tone = state === 'held' || state === 'approved-retry' ? 'ok' : hold.result ? 'warn' : undefined;
  const STATUS = {
    connecting: 'Connecting to the door…',
    ready: `Connected and signed in to the ${DOOR_NAME} door.`,
    signin: `Not signed in to the ${DOOR_NAME} door yet.`,
    nodoor: `The ${DOOR_NAME} door is not registered on this gateway, so there is nothing to call.`,
    error: `Could not reach the Privilege client: ${conn.message || 'unknown error'}.`,
  };

  return (
    <Card title={step.title} tone={tone} data-testid="pcl-step-hold">
      <p className="pu-kicker">{step.kicker}</p>
      <ExpectList
        step={step}
        extra={[
          { label: 'Call', value: <><code>{HOLD_SCENARIO.tool}</code> <code>{JSON.stringify(HOLD_SCENARIO.args)}</code></> },
          { label: 'Door', value: <code>{DOOR_NAME}</code> },
        ]}
      />
      <p className="pu-note">{step.measured}</p>

      {live && (
        <div data-testid="pcl-conn" data-status={conn.status}>
          <p className="pu-status-line"><StatusChip tone={meta.tone}>{meta.word}</StatusChip><span>{STATUS[conn.status]}</span></p>
          {conn.status === 'signin' && (
            <p className="pu-note">Sign in once on the Privilege client (it opens the door&apos;s own sign-in), then check again. <Link to={CLIENT_PAGE}>Open the Privilege client</Link>.</p>
          )}
        </div>
      )}

      <ConsoleCopy policy={HOLD_POLICY.policy} state={HOLD_POLICY.state} summary="Holds SearchIndexTool for a human unless an approval is on record." cedar={HOLD_POLICY.cedar} />

      {live ? (
        <div className="pu-actions">
          <ActionButton lead={next === 'connect'} busy={conn.status === 'connecting'} onClick={onConnect} data-testid="pcl-connect">Check again</ActionButton>
          <ActionButton
            lead={next === 'run-hold'}
            disabled={!ready}
            busy={hold.running}
            onClick={onRun}
            aria-label={hold.running ? undefined : `Run step 1: ${step.title}`}
            data-testid="pcl-run-hold"
          >
            {hold.running ? 'Calling the gateway…' : 'Run through Privilege'}
          </ActionButton>
          {!ready && <span className="pu-note">Connect and sign in first.</span>}
        </div>
      ) : (
        <p className="pu-note">Live runs need a Privilege sign-in: <Link to={LIVE_PATH}>open the live tour inside the app</Link>.</p>
      )}

      {hold.result && (
        <>
          <div className="pcl-verdict" data-testid="pcl-hold-verdict" data-outcome={outcome} data-state={state} role="status">
            <p className="pu-status-line">
              <StatusChip tone={VERDICT_TONE[outcome] ?? 'neutral'}>{o.label}</StatusChip>
              {GATEWAY_ANSWERS.has(outcome) ? 'The gateway’s answer to this call' : 'No gateway answer: the call did not reach a verdict'}
            </p>
            <p className="pu-note">{o.note}</p>
            {hold.result.instructionId && <p className="pu-note">Approval id from the gateway: <code data-testid="pcl-ins">{hold.result.instructionId}</code></p>}
            {hold.result.detail && <p className="pu-note">{hold.result.detail}</p>}
          </div>
          {state === 'held' && (
            <div className="pcl-hold" data-testid="pcl-hold">
              <p className="pu-status-line"><StatusChip tone="ok">As expected</StatusChip><span>HELD: a hold policy was enforcing on this door.</span></p>
              <p className="pu-note">Approve it in the Privilege console: <strong>Access Request Approvals</strong>, then press Retry. Nothing here approves it for you.</p>
              <ActionButton lead={next === 'retry'} busy={hold.running} onClick={onRun} data-testid="pcl-retry">Retry after approval</ActionButton>
            </div>
          )}
          {state === 'approved-retry' && (
            <p className="pu-status-line" data-testid="pcl-hold-summary"><StatusChip tone="ok">Allowed on retry</StatusChip><span>Held, then allowed on retry: the expected end of this step.</span></p>
          )}
          {state === 'not-held' && (
            <p className="pu-status-line" data-testid="pcl-hold-summary">
              <StatusChip tone="warn">NOT HELD</StatusChip>
              <span>Expected HELD but the gateway allowed the first call: no hold policy was enforcing on this door, or an approval is already on record. This is not the gate working.</span>
            </p>
          )}
          {state === 'signin' && (
            <p className="pu-status-line" data-testid="pcl-hold-summary"><StatusChip tone="warn">Sign in first</StatusChip><span>The call did not reach a verdict because you are not signed in to this door.</span></p>
          )}
          {state === 'other' && (
            <p className="pu-status-line" data-testid="pcl-hold-summary"><StatusChip tone="warn">EXPECTED PATTERN NOT SEEN</StatusChip><span>{`Expected HELD, got ${o.label}. This does not show the hold working.`}</span></p>
          )}
          <details className="pcl-policy">
            <summary>The raw response from the gateway</summary>
            <JsonPane value={hold.result.raw} label="Raw gateway response" hot={['status', 'isError']} />
          </details>
        </>
      )}
    </Card>
  );
}

// ---- The two PingFederate steps share their sign-in and configuration states --------------------------------------------
function PfRunControls({ live, pf, run, lead, onRun, testId, label }) {
  if (!live) return <p className="pu-note">Live runs need the demo app sign-in: <Link to={LIVE_PATH}>open the live tour inside the app</Link>.</p>;
  return (
    <>
      {pf && !pf.signedOut && !pf.configured && (
        <p className="pu-status-line" data-testid="pcl-not-configured">
          <StatusChip tone="warn">Not configured</StatusChip>
          The PingFederate client secret is not set on the api-server, so this run is off.
        </p>
      )}
      {pf?.signedOut && <p className="pu-status-line"><StatusChip tone="warn">Sign in needed</StatusChip>Sign in to the demo app first.</p>}
      {run.problem && (
        <p className="pu-status-line" role="alert" data-testid={`${testId}-problem`}>
          <StatusChip tone="danger">Failed</StatusChip>
          {run.problem}
        </p>
      )}
      <div className="pu-actions">
        <ActionButton lead={lead} disabled={!pf?.configured || Boolean(pf?.signedOut)} busy={run.running} onClick={onRun} data-testid={testId}>
          {run.running ? 'Running…' : label}
        </ActionButton>
      </div>
    </>
  );
}

// ---- Step 2: token-scope gate -----------------------------------------------------------------------------------------
function ScopeStep({ live, pf, run, next, onRun }) {
  const step = STEPS[1];
  const data = run.data;
  const cases = data?.cedar;
  const gate = data && !data.mint?.error ? scopeGate(cases) : null;
  const tone = gate ? (gate.state === 'enforcing' ? 'ok' : 'warn') : undefined;
  return (
    <Card title={step.title} tone={tone} data-testid="pcl-step-scope">
      <p className="pu-kicker">{step.kicker}</p>
      <ExpectList step={step} extra={[{ label: 'Tool', value: <code>SearchIndexTool</code> }, { label: 'Door', value: <code>pftoken</code> }]} />
      <p className="pu-note">{step.measured}</p>
      <ConsoleCopy policy={SCOPE_POLICY.policy} state={SCOPE_POLICY.state} summary="Refuses SearchIndexTool unless the token carries opensearch:search." cedar={SCOPE_POLICY.cedar} />
      <PfRunControls live={live} pf={pf} run={run} lead={next === 'run-scope'} onRun={onRun} testId="pcl-run-scope" label="Mint tokens and call the gateway" />
      {data?.mint?.error && <MintError mint={data.mint} />}
      {gate && <ScopeResult gate={gate} cases={cases} />}
    </Card>
  );
}

function ScopeResult({ gate, cases = [] }) {
  const META = {
    enforcing: { tone: 'ok', chip: 'ENFORCING', message: 'The token without opensearch:search was refused by Cedar and the one with it was allowed: a scope policy was enforcing on this door.' },
    'not-enforcing': { tone: 'warn', chip: 'NOT ENFORCING', message: 'No scope policy was enforcing on this door when this ran. Both tokens were allowed, which is what happens with no policy. This is not the gate working.' },
    unexpected: { tone: 'warn', chip: 'EXPECTED PATTERN NOT SEEN', message: 'The token without the scope was not refused by Cedar while the one with it was allowed, so this run does not show the gate working. The verdicts below say what came back.' },
    none: { tone: 'warn', chip: 'NO RESULT', message: 'This run returned no scope result: the api-server may predate this check.' },
  }[gate.state];
  return (
    <div className="pcl-verdict" data-testid="pcl-scope-result" data-state={gate.state}>
      <p className="pu-status-line" role="status" data-testid="pcl-scope-summary"><StatusChip tone={META.tone}>{META.chip}</StatusChip>{META.message}</p>
      {cases.length > 0 && (
        <div className="pcl-table-wrap">
          <table className="pcl-table">
            <thead><tr><th scope="col">Scope in the token</th><th scope="col">SearchIndexTool</th><th scope="col">What came back</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.key} data-testid={`pcl-scope-${c.key}`} data-verdict={c.verdict}>
                  <td data-label="Scope in the token"><code>{c.scope}</code></td>
                  <td data-label="SearchIndexTool"><VerdictChip verdict={c.verdict} status={c.status} /></td>
                  <td data-label="What came back">{c.message || (VERDICTS[c.verdict]?.note ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Step 3: agent act.sub gate ----------------------------------------------------------------------------------------
function ActSubStep({ live, pf, run, next, onRun }) {
  const step = STEPS[2];
  const data = run.data;
  const actSub = data?.actSub;
  const tone = actSub ? (actSub.enforcing ? 'ok' : 'warn') : undefined;
  return (
    <Card title={step.title} tone={tone} data-testid="pcl-step-actsub">
      <p className="pu-kicker">{step.kicker}</p>
      <ExpectList step={step} extra={[{ label: 'Tools', value: <><code>CountTool</code>, <code>ListIndexTool</code></> }, { label: 'Door', value: <code>pftoken</code> }]} />
      <p className="pu-note">{step.measured}</p>
      <p className="pu-status-line">
        <StatusChip tone="neutral">Active while the check runs</StatusChip>
        <span>The two policies below are created and removed in the console by the owner. This page creates none.</span>
      </p>
      <div data-testid="pcl-actsub-policies">
        {ACT_SUB_POLICIES.map((p) => (
          <ConsoleCopy key={p.key} policy={p.key} state="Active" label={ACT_SUB_POLICIES_LABEL} summary={p.note} cedar={p.cedar} />
        ))}
      </div>
      <PfRunControls live={live} pf={pf} run={run} lead={next === 'run-actsub'} onRun={onRun} testId="pcl-run-actsub" label="Mint a token and call both tools" />
      {data?.mint?.error && <MintError mint={data.mint} />}
      {data && !data.mint?.error && (actSub ? (
        <div className="ppt-page" data-testid="pcl-actsub-result">
          <ActSubResult actSub={actSub} />
        </div>
      ) : (
        <p className="pu-note" data-testid="pcl-actsub-empty">This run returned no act.sub result: the api-server may predate this check.</p>
      ))}
    </Card>
  );
}

// ---- Start here: the console path, what Cedar is and is not (shared with /privilege-ai-policies) --------------------------
function SetupGuide() {
  return (
    <div data-testid="pcl-setup">
      <Section
        id="pcl-setup-h"
        kicker="Start here"
        title="Set up Cedar in Privilege"
        lede="Cedar policies are written and enforced in the Privilege console. This page does not create or change any."
      >
        <CardGrid>
          <Card title="How to get to it" tone="neutral">
            <ol className="pu-note pcl-list" data-testid="pcl-setup-steps">
              {SETUP_STEPS.map((x) => <li key={x.step}><strong>{x.step}.</strong> {x.detail}</li>)}
            </ol>
            <p className="pu-note">Walked on the local console on 2026-11-16, stopping before saving. The console text is the source for the descriptions.</p>
          </Card>
          <Card title="What Cedar is, and is not" tone="neutral" data-testid="pcl-is-isnt">
            <p className="pu-status-line"><StatusChip tone="ok">Is</StatusChip></p>
            <ul className="pu-note pcl-list" data-testid="pcl-is">{CEDAR_IS.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="pu-status-line"><StatusChip tone="warn">Is not</StatusChip></p>
            <ul className="pu-note pcl-list" data-testid="pcl-isnt">{CEDAR_ISNT.map((t) => <li key={t}>{t}</li>)}</ul>
          </Card>
        </CardGrid>
      </Section>
    </div>
  );
}
