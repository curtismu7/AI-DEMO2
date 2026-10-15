import { useEffect, useRef, useState } from 'react';
import { MarkdownContent } from '../../components/shared/MarkdownText';
import { GATEWAY_RECORD_SIGN_IN_PATH, loadGatewayRecord } from '../../services/gatewayEvents';
import { PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID, PRIVILEGE_A2A_DEMO_QUESTIONS, runPrivilegeA2aChatRun } from '../../utils/privilegeA2aChainRun';
import PageAgentModeToggle, { usePageAgentMode } from '../../components/shared/PageAgentModeToggle';
import { usePrivilegeA2aProfile } from './usePrivilegeA2aProfile';
import './PrivilegeA2aTab.css';

const WALK = [
  'Ask: type a question below, or pick a suggested one. You watch the agent work.',
  'Delegate: the main agent hands the lookup to the analyst. The details column shows who acts for whom.',
  'Check access: the reel in the middle shows each step, and each step says why it happened.',
  'Call the tool: click a step to see exactly what was sent and what came back.',
  'Answer: the agent replies from the tool result only. Then check your understanding.',
];
const BREAKS = [
  { label: 'Break it: ungranted user', question: 'Show entitlements for an ungranted user.' },
  { label: 'Break it: needs approval', question: 'Delete the orders-2026 index.' },
  { label: 'Break it: out of scope', question: 'Which of my purchases were returned?' },
];
const WHY = {
  delegate: 'Delegation passes the request on, not the user\'s password.',
  'mcp-call': 'The gateway checks the grant before the tool runs.',
  result: 'The result goes back to the main agent to be shown.',
  error: 'Something stopped this step. Its details say what.',
};
const QUIZ_OPTIONS = [
  'The main agent',
  'The analyst agent, through an MCP tool',
  'The browser page',
];

export default function PrivilegeA2aTab() {
  const profile = usePrivilegeA2aProfile();
  const [agentMode, setAgentMode] = usePageAgentMode('privilege-a2a');
  const demoQuestions = profile?.questions?.length ? profile.questions : PRIVILEGE_A2A_DEMO_QUESTIONS;
  const [input, setInput] = useState('');
  // Learning aids: a walkthrough over the three columns, the step picked in the reel, and a short quiz after a good run.
  const [walkStep, setWalkStep] = useState(-1);
  const [selectedStep, setSelectedStep] = useState(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState(null);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [trace, setTrace] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
        from: typeof payload.fromLabel === 'string' && payload.fromLabel ? payload.fromLabel : (typeof payload.from === 'string' ? payload.from : ''),
        to: typeof payload.toLabel === 'string' && payload.toLabel ? payload.toLabel : (typeof payload.to === 'string' ? payload.to : ''),
        elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : null,
        request: typeof payload.request === 'string' ? payload.request : '',
        response: typeof payload.response === 'string' ? payload.response : '',
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
    setQuizOpen(false);
    setQuizAnswer(null);
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
      const result = await run;
      if (result?.ok) setQuizOpen(true);
    } catch (requestError) {
      if (controller.signal.aborted) setError('Request cancelled.');
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

  return (
    <section className="privilege-a2a" aria-labelledby="privilege-a2a-title">
      <header className="privilege-a2a__header">
        <div>
          <h2 id="privilege-a2a-title">A2A access review</h2>
          <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} disabled={busy} />
          <p>Ask about an entitlement. The main agent hands the lookup to a worker agent, which checks access data through MCP. In gateway mode every hop goes through the PingOne Agent Privilege: each agent uses its own agent key, and the gateway screens the messages and the tool results.</p>
        </div>
        <ol className="privilege-a2a__path" aria-label="Agent request path">
          <li>Main agent</li>
          <li>Agent Privilege</li>
          <li>Worker agent</li>
          <li>Agent Privilege</li>
          <li>MCP tools</li>
        </ol>
      </header>

      <div className="privilege-a2a__workspace">
        <section className="privilege-a2a__conversation" aria-label="Conversation">
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
            <p className="privilege-a2a__empty">Ask who has access to a resource, what roles a person holds, or whether an access ticket exists.</p>
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
            </div>
          )}
          {error && <p className="privilege-a2a__error" role="alert">{error}</p>}
          {quizOpen && (
            <div className="privilege-a2a__quiz" role="group" aria-label="Check your understanding">
              <p><b>Check your understanding:</b> Which agent actually reads the entitlements?</p>
              {QUIZ_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  className={`privilege-a2a__quiz-opt${quizAnswer === index ? (index === 1 ? ' is-right' : ' is-wrong') : ''}`}
                  disabled={quizAnswer !== null}
                  onClick={() => setQuizAnswer(index)}
                >
                  {option}
                </button>
              ))}
              {quizAnswer !== null && (
                <p className="privilege-a2a__quiz-why">
                  {quizAnswer === 1 ? 'Correct. ' : 'Not quite. '}The main agent only delegates. The analyst calls the tool through the gateway.
                </p>
              )}
            </div>
          )}
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
          <form className="privilege-a2a__composer" onSubmit={submitQuestion}>
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
          disabled={busy}
        />
        <div className="privilege-a2a__actions">
          <span>Send a question to trigger Main agent → A2A → Analyst → MCP tools.</span>
          {busy && <button className="privilege-a2a__cancel" type="button" onClick={cancelRequest}>Cancel</button>}
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
          <h3>Agent trace</h3>
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
                  {entry.from && entry.to && (
                    <span className="privilege-a2a__trace-route">{entry.from} → {entry.to}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </aside>
        <aside className="privilege-a2a__step-panel" aria-label="Step details">
          <h3>Who acts for whom</h3>
          <ol className="privilege-a2a__chain">
            <li><span>Signed-in user</span></li>
            <li><span>Main agent{profile?.agentName ? `: ${profile.agentName}` : ''}</span></li>
            <li><span>Analyst{profile?.specialistName ? `: ${profile.specialistName}` : ''}</span></li>
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
          <p className="privilege-a2a__empty">Not reported yet. The agents do not send token counts with the trace.</p>
        </aside>
      </div>

    </section>
  );
}
