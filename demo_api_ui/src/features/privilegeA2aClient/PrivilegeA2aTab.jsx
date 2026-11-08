import { useEffect, useRef, useState } from 'react';
import { MarkdownContent } from '../../components/shared/MarkdownText';
import { GATEWAY_RECORD_SIGN_IN_PATH, loadGatewayRecord } from '../../services/gatewayEvents';
import { PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID, PRIVILEGE_A2A_DEMO_QUESTIONS, runPrivilegeA2aChatRun } from '../../utils/privilegeA2aChainRun';
import A2aDocsLinks from '../../components/shared/A2aDocsLinks';
import PageAgentModeToggle, { usePageAgentMode } from '../../components/shared/PageAgentModeToggle';
import { usePrivilegeA2aProfile } from './usePrivilegeA2aProfile';
import { PATH_STEPS, pathProgress } from './pathProgress';
import './PrivilegeA2aTab.css';

// The A2A specification, at the Send Message operation this page demonstrates.
export const A2A_SPEC_SEND_MESSAGE_URL = 'https://a2a-protocol.org/latest/specification/#311-send-message';
const A2A_SPEC_URL = 'https://a2a-protocol.org/latest/specification/';

const WALK = [
  'Ask: type a question below, or pick a suggested one. You watch the agent work.',
  'Delegate: the A2A Client hands the lookup to the Remote Agent with Send Message. The details column shows who acts for whom.',
  'Check access: the reel in the middle shows each step, and each step says why it happened.',
  'Call the tool: click a step to see exactly what was sent and what came back.',
  'Answer: the Remote Agent returns its result to the A2A Client, which replies from that result only. Then check your understanding.',
];
const BREAKS = [
  { label: 'Break it: ungranted user', question: 'Show entitlements for an ungranted user.' },
  { label: 'Break it: needs approval', question: 'Delete the orders-2026 index.' },
  { label: 'Break it: out of scope', question: 'Which of my purchases were returned?' },
];
const WHY = {
  delegate: 'Delegation passes the request on, not the user\'s password.',
  'mcp-call': 'The gateway checks the grant before the tool runs.',
  result: 'The Remote Agent finished; its result goes back to the A2A Client to be shown.',
  error: 'Something stopped this step. Its details say what.',
  model: 'The model decides the next step. Its tokens are what that decision used.',
};
// Illustrative cost only: Claude Sonnet 5.5 list price ($2 in / $10 out per million tokens). The demo's model is priced differently.
const PRICE_PER_MTOK = { input: 2, output: 10, label: 'Claude Sonnet 5.5 list price' };
const runCost = (totals) => (totals.input * PRICE_PER_MTOK.input + totals.output * PRICE_PER_MTOK.output) / 1_000_000;
const costLabel = (totals) => `≈ $${runCost(totals).toFixed(4)} at ${PRICE_PER_MTOK.label}`;
const tokensLine = (tokens) => (tokens ? `${tokens.input.toLocaleString()} in · ${tokens.output.toLocaleString()} out` : '');
const runTokens = (trace) => trace.reduce((sum, entry) => ({
  input: sum.input + (entry.tokens?.input || 0),
  output: sum.output + (entry.tokens?.output || 0),
  calls: sum.calls + (entry.tokens ? 1 : 0),
}), { input: 0, output: 0, calls: 0 });
const CALL_GROUPS = [
  { label: 'Ask the Remote Agent', items: [
    'List all entitlements for Carol Nguyen.',
    'Which grants on prod-db-primary have never been used?',
    'Who is offboarding and still has active access?',
  ] },
  { label: 'Tools the Remote Agent can call', items: [
    'Who has the prod-db-admin role?',
    'Show the access grants on prod-db-primary.',
    'Open a ticket to review Carol Nguyen\'s access to prod-db-primary.',
  ] },
  { label: 'Try a case that stops', items: [
    'Show entitlements for an ungranted user.',
    'Delete the orders-2026 index.',
    'Which of my purchases were returned?',
  ] },
];

// What one step sent and got back, as labelled blocks. A step with no wire payload shows its detail text instead.
function WireBlocks({ entry, open = false }) {
  const blocks = [['Request', entry?.request], ['Response', entry?.response]].filter(([, body]) => body);
  if (!blocks.length && entry?.detail) blocks.push(['Detail', entry.detail]);
  if (!blocks.length) return null;
  return (
    <details className="privilege-a2a__wire" open={open} onClick={(event) => event.stopPropagation()}>
      <summary>{blocks.map(([label]) => label).join(' · ')}</summary>
      {blocks.map(([label, body]) => (
        <div key={label}>
          {blocks.length > 1 && <h4>{label}</h4>}
          <pre>{body}</pre>
        </div>
      ))}
    </details>
  );
}

export default function PrivilegeA2aTab() {
  const profile = usePrivilegeA2aProfile();
  // Save the run as the trace the page shows (no secrets: the same fields the reel already displays).
  const saveRun = () => {
    const blob = new Blob([JSON.stringify({ savedAt: new Date().toISOString(), turns, trace }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'a2a-run.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  // Replay the run's steps one at a time, so a presenter or learner sees them land in order.
  const replayRun = async () => {
    const steps = trace.slice();
    setReplaying(true);
    setTrace([]);
    setSelectedStep(null);
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setTrace((current) => [...current, step]);
    }
    setReplaying(false);
  };
  const [agentMode, setAgentMode] = usePageAgentMode('privilege-a2a');
  const demoQuestions = profile?.questions?.length ? profile.questions : PRIVILEGE_A2A_DEMO_QUESTIONS;
  const [input, setInput] = useState('');
  // Learning aids: a walkthrough over the three columns, and the step picked in the reel.
  const [walkStep, setWalkStep] = useState(-1);
  const [selectedStep, setSelectedStep] = useState(null);
  const [callsOpen, setCallsOpen] = useState(false);
  // The compact agent: a small button in the agent column that opens a short panel with a question box.
  const [dockOpen, setDockOpen] = useState(false);
  const [dockText, setDockText] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [trace, setTrace] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const progress = pathProgress(trace, busy);
  // Seconds since Send, so a slow model call reads as "working" and not as "stuck".
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!busy) { setElapsedSec(0); return undefined; }
    const startedAt = Date.now();
    setElapsedSec(0);
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  // The gateway's own record of the last run: its model calls and guardrail verdicts.
  const [record, setRecord] = useState(null);
  const recordLines = record ? record.modelCalls.length + record.guardrail.length + (record.requests?.length || 0) + (record.denials?.length || 0) : 0;
  const abortRef = useRef(null);
  const recordTimerRef = useRef(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(recordTimerRef.current);
  }, []);

  const handleEvent = (eventName, payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (eventName === 'token' && typeof payload.text === 'string') {
      setTurns(current => {
        if (!current.length) return current;
        const updated = [...current];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = { ...last, answer: last.answer + payload.text };
        return updated;
      });
    } else if (eventName === 'trace') {
      setTrace(current => [...current, {
        kind: typeof payload.kind === 'string' ? payload.kind : 'activity',
        text: typeof payload.text === 'string' ? payload.text : 'Agent activity',
        detail: typeof payload.detail === 'string' ? payload.detail : '',
        // Who called whom, how long it took, and the wire JSON of that hop (display names when the profile has them).
        fromKey: typeof payload.from === 'string' ? payload.from : '',
        from: typeof payload.fromLabel === 'string' && payload.fromLabel ? payload.fromLabel : (typeof payload.from === 'string' ? payload.from : ''),
        to: typeof payload.toLabel === 'string' && payload.toLabel ? payload.toLabel : (typeof payload.to === 'string' ? payload.to : ''),
        elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : null,
        request: typeof payload.request === 'string' ? payload.request : '',
        response: typeof payload.response === 'string' ? payload.response : '',
        // A model call's token counts, as the agent reported them; absent for hops that made no model call.
        tokens: payload.tokens && typeof payload.tokens === 'object' ? payload.tokens : null,
      }]);
    } else if (eventName === 'done') {
      if (typeof payload.sessionId === 'string' && payload.sessionId.length <= 128) {
        setSessionId(payload.sessionId);
      }
    } else if (eventName === 'error') {
      setError(typeof payload.error === 'string' ? payload.error : 'The A2A request failed.');
    }
  };

  const submitQuestion = async (event, text = input) => {
    event?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setTrace([]);
    setSelectedStep(null);
    setRecord(null);
    clearTimeout(recordTimerRef.current);
    const startedAt = Date.now();
    setTurns(current => [...current, { question: message, answer: '' }]);
    setInput('');
    setSelectedQuestion('');

    try {
      // One run feeds both surfaces: this tab's conversation and trace, and the floating agent
      // (reel, sequence view and the answer), which receives it as Step 25A and stays on this page.
      const run = runPrivilegeA2aChatRun({ message, sessionId, mode: agentMode, profile, onEvent: handleEvent, signal: controller.signal });
      window.dispatchEvent(new CustomEvent('agent-demo-step-select', {
        detail: {
          uc: {
            id: 'UC46A',
            useCaseId: PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID,
            title: 'Privilege A2A access review in the agent',
            trigger: { type: 'link', path: `${window.location.pathname}${window.location.search}` },
          },
          stepNumber: '25A',
          opts: { keepTrace: true, keepPanelClosed: true, run },
        },
      }));
      await run;
    } catch (requestError) {
      if (controller.signal.aborted) setError(controller.discarded ? '' : 'Request cancelled.');
      else setError(requestError instanceof Error ? requestError.message : 'The A2A request failed.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      // The gateway ships each line as it writes it; give the index a moment.
      if (!controller.signal.aborted) {
        recordTimerRef.current = setTimeout(async () => setRecord(await loadGatewayRecord({ since: startedAt - 2000, until: Date.now() + 2000 })), 1500);
      }
    }
  };

  const cancelRequest = () => abortRef.current?.abort();

  // Back to a blank page: stop a run in flight, drop its conversation, trace and gateway record, and clear the boxes. The agent mode stays.
  const resetPage = () => {
    if (abortRef.current) {
      abortRef.current.discarded = true;
      abortRef.current.abort();
    }
    clearTimeout(recordTimerRef.current);
    setTurns([]);
    setTrace([]);
    setRecord(null);
    setSessionId('');
    setError('');
    setInput('');
    setDockText('');
    setSelectedQuestion('');
    setSelectedStep(null);
    setWalkStep(-1);
    setReplaying(false);
  };

  // The A2A exchange, read off the trace: the client's Send Message, the Remote Agent's work, its reply, the client's answer.
  const sentAt = trace.findIndex((entry) => entry.kind === 'delegate');
  const replyAt = trace.map((entry) => entry.kind).lastIndexOf('result');
  const failed = trace.some((entry) => entry.kind === 'error');
  const toolCalls = trace.filter((entry) => entry.kind === 'mcp-call').length;
  const answered = Boolean(turns.length && turns[turns.length - 1].answer);
  const exchange = [
    { label: '1. Send Message', who: 'A2A Client → Remote Agent', step: sentAt, state: sentAt >= 0 ? 'done' : busy ? 'working' : 'waiting' },
    { label: '2. Remote Agent works', who: toolCalls ? `${toolCalls} MCP tool call${toolCalls === 1 ? '' : 's'}` : 'checks access data', step: trace.findIndex((entry) => entry.kind === 'mcp-call'),
      state: replyAt >= 0 ? 'done' : failed ? 'stopped' : sentAt >= 0 && busy ? 'working' : 'waiting' },
    { label: '3. Reply returned', who: 'Remote Agent → A2A Client', step: replyAt, state: replyAt >= 0 ? 'done' : failed && sentAt >= 0 ? 'stopped' : 'waiting' },
    { label: '4. Client answers', who: 'A2A Client → you', step: -1, state: answered && replyAt >= 0 ? 'done' : replyAt >= 0 && busy ? 'working' : 'waiting' },
  ];

  const suggestedQuestions = (
        <div className="privilege-a2a__chips" role="group" aria-label="Suggested questions for this vertical">
          {demoQuestions.map(question => (
            <button
              key={question}
              type="button"
              className="privilege-a2a__chip"
              onClick={() => submitQuestion(null, question)}
              disabled={busy}
            >
              {question}
            </button>
          ))}
        </div>
  );

  const nowLine = (() => {
    if (error && !busy) return 'Stopped. The step marked "stopped" says why.';
    if (!trace.length && !busy) return turns.length ? 'Done. Ask another question, or press Reset.' : 'Pick a question, or type your own, then press Send.';
    if (busy && sentAt < 0) return 'The A2A Client is deciding what to ask the Remote Agent…';
    if (busy && replyAt < 0) return toolCalls ? 'The Remote Agent is calling MCP tools through the gateway…' : 'The A2A Client sent Send Message. The Remote Agent is working…';
    if (busy) return 'The Remote Agent replied. The A2A Client is writing the answer…';
    return 'Done. Click any step to see what was sent and what came back.';
  })();

  return (
    <section className="privilege-a2a" aria-labelledby="privilege-a2a-title">
      <header className="privilege-a2a__header">
        <div>
          <h2 id="privilege-a2a-title">A2A access review</h2>
          <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} disabled={busy} />
          <p>The A2A Client sends your question to a Remote Agent with <a href={A2A_SPEC_SEND_MESSAGE_URL} target="_blank" rel="noreferrer">Send Message</a>. The Remote Agent checks access data through MCP.</p>
        </div>
        <div className="privilege-a2a__path-wrap">
        <ol className="privilege-a2a__path" aria-label="Agent request path">
          {PATH_STEPS.map((label, index) => (
            <li
              key={`${index}-${label}`}
              className={`${index <= progress.reached ? 'is-done' : ''}${progress.active === index ? ' is-active' : ''}`.trim() || undefined}
              aria-current={progress.active === index ? 'step' : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
          <p className="privilege-a2a__now" role="status">
            {nowLine}
            {busy && (
              <span className="privilege-a2a__clock" data-testid="a2a-clock">
                {' '}<span className="privilege-a2a__dot" aria-hidden="true" />{elapsedSec}s
                {elapsedSec >= 8 ? ' · still working: a model call can take 10 to 30 seconds' : ''}
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="privilege-a2a__workspace">
        <section className="privilege-a2a__conversation" aria-label="Conversation">
          {!dockOpen && (
            <button type="button" className="privilege-a2a__dock-open" onClick={() => setDockOpen(true)} aria-label="Open the compact agent">Compact agent</button>
          )}
          {dockOpen && (
            <div className="privilege-a2a__dock" role="dialog" aria-label="Compact agent">
              <div className="privilege-a2a__dock-bar">
                <span>Compact agent</span>
                <button type="button" onClick={() => setDockOpen(false)} aria-label="Minimise the compact agent">−</button>
              </div>
              <textarea
                value={dockText}
                onChange={(event) => setDockText(event.target.value)}
                aria-label="Question for the compact agent"
                rows={2}
                placeholder="Ask about an entitlement…"
              />
              <button
                type="button"
                className="privilege-a2a__dock-send"
                disabled={busy || !dockText.trim()}
                onClick={() => { const text = dockText.trim(); setDockText(''); submitQuestion(null, text); }}
              >
                Send
              </button>
            </div>
          )}
          <div className="privilege-a2a__head">
            <h3>Conversation</h3>
            {/* The movie-reel / sequence view of this run: every hop, claim and gateway decision,
                kept after the run ends (until the next run starts). It sits here, not by the trace: once a run
                starts, the floating agent panel opens over the right-hand column. */}
            <button
              type="button"
              className="privilege-a2a__details"
              onClick={() => window.dispatchEvent(new CustomEvent('agent-evidence-open', { detail: { view: 'sequence-view' } }))}
              disabled={!busy && turns.length === 0}
              title="Open the step-by-step sequence of this run, with details for each hop"
            >
              Open run details
            </button>
          </div>
          {turns.length === 0 ? (
            <div className="privilege-a2a__start">
              <p className="privilege-a2a__empty">Ask who has access to a resource, what roles a person holds, or whether a ticket exists:</p>
              {suggestedQuestions}
            </div>
          ) : (
            <div className="privilege-a2a__turns" aria-live={busy ? "off" : "polite"}>
              {turns.map((turn, index) => (
                <article className="privilege-a2a__turn" key={`${index}-${turn.question}`}>
                  <p className="privilege-a2a__question">{turn.question}</p>
                  <div className="privilege-a2a__answer">
                    {turn.answer ? <MarkdownContent text={turn.answer} /> : (busy && index === turns.length - 1 ? 'Reviewing access…' : '')}
                  </div>
                </article>
              ))}
              <p className="privilege-a2a__empty">Ask another:</p>
              {suggestedQuestions}
            </div>
          )}
          {error && <p className="privilege-a2a__error" role="alert">{error}</p>}
          <form className="privilege-a2a__composer" onSubmit={submitQuestion}>
        <label htmlFor="privilege-a2a-demo-question">Demo question</label>
        <select
          id="privilege-a2a-demo-question"
          value={selectedQuestion}
          onChange={event => {
            setSelectedQuestion(event.target.value);
            setInput(event.target.value);
          }}
          disabled={busy}
        >
          <option value="">Choose an A2A access-review question</option>
          {demoQuestions.map(question => <option key={question} value={question}>{question}</option>)}
        </select>
        <label htmlFor="privilege-a2a-question">Your question</label>
        <textarea
          id="privilege-a2a-question"
          value={input}
          onChange={event => {
            setInput(event.target.value);
            if (event.target.value !== selectedQuestion) setSelectedQuestion('');
          }}
          maxLength={4000}
          rows={3}
          placeholder="For example: Review Carol Nguyen's current entitlements."
        />
        <div className="privilege-a2a__actions">
          {busy && <button className="privilege-a2a__cancel" type="button" onClick={cancelRequest}>Cancel</button>}
          <button
            type="button"
            onClick={resetPage}
            disabled={!busy && !turns.length && !trace.length && !error && !input}
            title="Stop any run and clear the conversation, trace and question box"
          >
            Reset
          </button>
          <div className="privilege-a2a__calls">
            <button type="button" aria-expanded={callsOpen} aria-controls="privilege-a2a-calls" onClick={() => setCallsOpen((open) => !open)}>Calls ▾</button>
            {callsOpen && (
              <ul id="privilege-a2a-calls" className="privilege-a2a__calls-menu" role="listbox" aria-label="Calls you can make">
                {CALL_GROUPS.map((group) => (
                  <li key={group.label} role="presentation">
                    <span className="privilege-a2a__calls-group">{group.label}</span>
                    {group.items.map((item) => (
                      <button key={`${group.label}-${item}`} type="button" role="option" aria-selected={input === item}
                        onClick={() => { setInput(item); setSelectedQuestion(''); setCallsOpen(false); }}>
                        {item}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="privilege-a2a__send" type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Reviewing…' : 'Send question'}
          </button>
        </div>
          </form>
        </section>

        <aside className="privilege-a2a__trace" aria-label="Agent trace">
          {record && (
            <>
              <h3>Gateway record</h3>
              {record.state === 'needsAuth' && (
                <p className="privilege-a2a__empty">
                  The gateway keeps its own record of this run. To load it, <a href={GATEWAY_RECORD_SIGN_IN_PATH}>sign in to the gateway findings door</a>, then ask again.
                </p>
              )}
              {record.state === 'error' && <p className="privilege-a2a__empty">The gateway record could not be read: {record.error}</p>}
              {record.state === 'ready' && recordLines === 0 && (
                <p className="privilege-a2a__empty">The gateway recorded nothing for this run.</p>
              )}
              {record.state === 'ready' && recordLines > 0 && (
                <p className="privilege-a2a__empty">Every line the gateway wrote while this review ran. Its model-call lines do not name the agent, so another session's calls in the same seconds would appear here too.</p>
              )}
              {record.state === 'ready' && recordLines > 0 && (
                <ol>
                  {(record.requests || []).map((request, index) => (
                    <li className="privilege-a2a__trace-entry" key={`request-${index}`}>
                      <span className="privilege-a2a__trace-kind">accepted</span>
                      <span className="privilege-a2a__trace-text">{request.method} {request.path} · app {request.app} · principal {request.principal}</span>
                    </li>
                  ))}
                  {(record.denials || []).map((denial, index) => (
                    <li className="privilege-a2a__trace-entry" key={`denial-${index}`}>
                      <span className="privilege-a2a__trace-kind">refused</span>
                      <span className="privilege-a2a__trace-text">policy denied · app {denial.app} · principal {denial.principal}</span>
                    </li>
                  ))}
                  {record.modelCalls.map((call, index) => (
                    <li className="privilege-a2a__trace-entry" key={`model-${index}`}>
                      <span className="privilege-a2a__trace-kind">model call</span>
                      <span className="privilege-a2a__trace-text">
                        {call.model || call.provider || 'model'} · {call.totalTokens ?? '?'} tokens ({call.promptTokens ?? '?'} in, {call.completionTokens ?? '?'} out)
                        {call.costUsd != null ? ` · $${call.costUsd.toFixed(6)}` : ''}{call.latencyMs != null ? ` · ${call.latencyMs} ms` : ''}{call.status != null ? ` · HTTP ${call.status}` : ''}
                      </span>
                    </li>
                  ))}
                  {record.guardrail.map((verdict, index) => (
                    <li className="privilege-a2a__trace-entry" key={`guardrail-${index}`}>
                      <span className="privilege-a2a__trace-kind">guardrail</span>
                      <span className="privilege-a2a__trace-text">{verdict.event} · {verdict.category}{verdict.client ? ` · ${verdict.client}` : ''}</span>
                      {verdict.frameworks.length > 0 && (
                        <ul className="privilege-a2a__compliance" aria-label="Privilege compliance mappings">
                          {verdict.frameworks.map(framework => (
                            <li key={framework.label}>{framework.label}: {framework.identifiers.join(', ')}</li>
                          ))}
                          {verdict.rules.length > 0 && <li>Rules: {verdict.rules.join(', ')}</li>}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          <div className="privilege-a2a__reel-head">
            <h3>Agent trace</h3>
            <div className="privilege-a2a__reel-actions">
              <button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href)} disabled={trace.length === 0}>Copy link</button>
              <button type="button" onClick={saveRun} disabled={trace.length === 0}>Save run</button>
              <button type="button" onClick={replayRun} disabled={trace.length === 0 || replaying}>{replaying ? 'Replaying…' : 'Replay'}</button>
            </div>
          </div>
          {trace.length > 0 && (() => {
            const totals = runTokens(trace);
            return (
              <p className="privilege-a2a__run-totals">
                {totals.calls > 0
                  ? `${totals.calls} model call${totals.calls === 1 ? '' : 's'} · ${totals.input.toLocaleString()} in · ${totals.output.toLocaleString()} out tokens · ${costLabel(totals)}`
                  : 'No model calls in this run'}
              </p>
            );
          })()}
          {trace.length === 0 ? (
            <p className="privilege-a2a__empty">Delegation and tool activity will appear here while the review runs.</p>
          ) : (
            <ol>
              {trace.map((entry, index) => (
                <li
                  className={`privilege-a2a__trace-entry${selectedStep === index ? ' is-selected' : ''}`}
                  key={`${index}-${entry.kind}`}
                  onClick={() => setSelectedStep(index)}
                >
                  <span className="privilege-a2a__trace-kind">{entry.kind}</span>
                  <span className="privilege-a2a__trace-text">{entry.text}</span>
                  {WHY[entry.kind] && <span className="privilege-a2a__why">{WHY[entry.kind]}</span>}
                  {entry.tokens && <span className="privilege-a2a__tokens">{tokensLine(entry.tokens)}</span>}
                  {entry.from && entry.to && (
                    <span className="privilege-a2a__trace-route">{entry.from} → {entry.to}</span>
                  )}
                  <WireBlocks entry={entry} />
                </li>
              ))}
            </ol>
          )}
        </aside>
        <aside className="privilege-a2a__step-panel" aria-label="Step details">
          <h3>Guide</h3>
          <div className="privilege-a2a__walk" aria-label="Walkthrough">
            {walkStep < 0 ? (
              <button type="button" className="privilege-a2a__walk-start" onClick={() => setWalkStep(0)}>Start walkthrough</button>
            ) : (
              <>
                <p><b>Step {walkStep + 1} of {WALK.length}.</b> {WALK[walkStep]}</p>
                <div className="privilege-a2a__walk-nav">
                  <button type="button" onClick={() => setWalkStep((s) => Math.max(0, s - 1))} disabled={walkStep === 0}>Back</button>
                  <button type="button" onClick={() => (walkStep === WALK.length - 1 ? setWalkStep(-1) : setWalkStep((s) => s + 1))}>
                    {walkStep === WALK.length - 1 ? 'Finish' : 'Next'}
                  </button>
                  <button type="button" onClick={() => setWalkStep(-1)}>Stop</button>
                </div>
              </>
            )}
          </div>
          <div className="privilege-a2a__breaks" role="group" aria-label="Try a case that stops">
            {BREAKS.map((item) => (
              <button key={item.label} type="button" className="privilege-a2a__break" disabled={busy}
                onClick={() => { setInput(item.question); setSelectedQuestion(''); }}>
                {item.label}
              </button>
            ))}
          </div>
          <h3>A2A exchange</h3>
          <ol className="privilege-a2a__exchange" aria-label="A2A exchange">
            {exchange.map((row) => (
              <li key={row.label} className={`is-${row.state}`}>
                <button type="button" disabled={row.step < 0} onClick={() => setSelectedStep(row.step)}>
                  <b>{row.label}</b>
                  <span>{row.who}</span>
                  <em>{row.state === 'done' ? 'done' : row.state === 'working' ? 'working…' : row.state === 'stopped' ? 'stopped' : 'waiting'}</em>
                </button>
                {row.step >= 0 && <WireBlocks entry={trace[row.step]} open />}
              </li>
            ))}
          </ol>
          <p className="privilege-a2a__empty">
            Per the <a href={A2A_SPEC_SEND_MESSAGE_URL} target="_blank" rel="noreferrer">Send Message</a> operation, the Remote Agent answers with a Task (states such as working, completed, input-required) or a direct Message. <a href={A2A_SPEC_URL} target="_blank" rel="noreferrer">A2A specification</a>
          </p>
          <h3>Who acts for whom</h3>
          <ol className="privilege-a2a__chain">
            <li><span>Signed-in user</span></li>
            <li><span>A2A Client (main agent){profile?.agentName ? `: ${profile.agentName}` : ''}</span></li>
            <li><span>Remote Agent (A2A Server){profile?.specialistName ? `: ${profile.specialistName}` : ''}</span></li>
            <li><span>MCP tools, through the gateway</span></li>
          </ol>
          <h3>Selected step</h3>
          {selectedStep !== null && trace[selectedStep] ? (() => {
            const entry = trace[selectedStep];
            return (
              <>
                <p className="privilege-a2a__step-kind">{entry.kind}</p>
                {entry.text && <p>{entry.text}</p>}
                {entry.from && entry.to && (
                  <p className="privilege-a2a__trace-route">{entry.from} → {entry.to}{entry.elapsedMs != null ? ` · ${entry.elapsedMs} ms` : ''}</p>
                )}
                {entry.detail && <><h4>Details</h4><pre>{entry.detail}</pre></>}
                {entry.request && <><h4>What was sent</h4><pre>{entry.request}</pre></>}
                {entry.response && <><h4>What came back</h4><pre>{entry.response}</pre></>}
              </>
            );
          })() : (
            <p className="privilege-a2a__empty">Click a step in the reel to see what was sent and what came back.</p>
          )}
          <h3>Tokens</h3>
          {selectedStep !== null && trace[selectedStep]?.tokens ? (
            <p>This step: {tokensLine(trace[selectedStep].tokens)}</p>
          ) : null}
          {trace.length > 0 ? (
            <p className="privilege-a2a__empty">Run total: {tokensLine(runTokens(trace))} · {costLabel(runTokens(trace))}</p>
          ) : (
            <p className="privilege-a2a__empty">Token counts appear here once a run starts.</p>
          )}
          <h3>Direct or through the gateway?</h3>
          <table className="privilege-a2a__compare">
            <tbody>
              <tr><th scope="row">Who checks the grant</th><td>Direct: the tool trusts the call. Gateway: the gateway checks each hop.</td></tr>
              <tr><th scope="row">Screening</th><td>Direct: none. Gateway: prompts and replies are screened.</td></tr>
              <tr><th scope="row">Record</th><td>Direct: only the app's own log. Gateway: every call is in the gateway's log.</td></tr>
            </tbody>
          </table>
          <A2aDocsLinks />
        </aside>
      </div>

    </section>
  );
}
