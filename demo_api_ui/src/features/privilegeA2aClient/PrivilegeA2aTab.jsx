import { useEffect, useRef, useState } from 'react';
import { GATEWAY_RECORD_SIGN_IN_PATH, loadGatewayRecord } from '../../services/gatewayEvents';
import { PRIVILEGE_A2A_DEMO_QUESTIONS, runPrivilegeA2aChatRun } from '../../utils/privilegeA2aChainRun';
import { usePrivilegeA2aProfile } from './usePrivilegeA2aProfile';
import './PrivilegeA2aTab.css';

export default function PrivilegeA2aTab() {
  const profile = usePrivilegeA2aProfile();
  const demoQuestions = profile?.questions?.length ? profile.questions : PRIVILEGE_A2A_DEMO_QUESTIONS;
  const [input, setInput] = useState('');
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

  useEffect(() => () => abortRef.current?.abort(), []);

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
      }]);
    } else if (eventName === 'done') {
      if (typeof payload.sessionId === 'string' && payload.sessionId.length <= 128) {
        setSessionId(payload.sessionId);
      }
    } else if (eventName === 'error') {
      setError(typeof payload.error === 'string' ? payload.error : 'The A2A request failed.');
    }
  };

  const submitQuestion = async (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setTrace([]);
    setRecord(null);
    const startedAt = Date.now();
    setTurns(current => [...current, { question: message, answer: '' }]);
    setInput('');
    setSelectedQuestion('');

    try {
      await runPrivilegeA2aChatRun({ message, sessionId, profile, onEvent: handleEvent, signal: controller.signal });
    } catch (requestError) {
      if (controller.signal.aborted) setError('Request cancelled.');
      else setError(requestError instanceof Error ? requestError.message : 'The A2A request failed.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      // The gateway ships each line as it writes it; give the index a moment.
      if (!controller.signal.aborted) {
        setTimeout(async () => setRecord(await loadGatewayRecord({ since: startedAt - 2000, until: Date.now() + 2000 })), 1500);
      }
    }
  };

  const cancelRequest = () => abortRef.current?.abort();

  return (
    <section className="privilege-a2a" aria-labelledby="privilege-a2a-title">
      <header className="privilege-a2a__header">
        <div>
          <h2 id="privilege-a2a-title">A2A access review</h2>
          <p>Ask about an entitlement. The main agent hands the lookup to a worker agent, which checks access data through MCP. In gateway mode every hop goes through the PingOne Privilege AI Gateway: each agent uses its own agent key, and the gateway screens the messages and the tool results.</p>
        </div>
        <ol className="privilege-a2a__path" aria-label="Agent request path">
          <li>Main agent</li>
          <li>AI Gateway</li>
          <li>Worker agent</li>
          <li>AI Gateway</li>
          <li>MCP tools</li>
        </ol>
      </header>

      <div className="privilege-a2a__workspace">
        <section className="privilege-a2a__conversation" aria-label="Conversation">
          <h3>Conversation</h3>
          {turns.length === 0 ? (
            <p className="privilege-a2a__empty">Ask who has access to a resource, what roles a person holds, or whether an access ticket exists.</p>
          ) : (
            <div className="privilege-a2a__turns" aria-live="polite">
              {turns.map((turn, index) => (
                <article className="privilege-a2a__turn" key={`${index}-${turn.question}`}>
                  <p className="privilege-a2a__question">{turn.question}</p>
                  <p className="privilege-a2a__answer">{turn.answer || (busy && index === turns.length - 1 ? 'Reviewing access…' : '')}</p>
                </article>
              ))}
            </div>
          )}
          {error && <p className="privilege-a2a__error" role="alert">{error}</p>}
        </section>

        <aside className="privilege-a2a__trace" aria-label="Agent trace">
          <h3>Agent trace</h3>
          {trace.length === 0 ? (
            <p className="privilege-a2a__empty">Delegation and tool activity will appear here while the review runs.</p>
          ) : (
            <ol>
              {trace.map((entry, index) => (
                <li className="privilege-a2a__trace-entry" key={`${index}-${entry.kind}`}>
                  <span className="privilege-a2a__trace-kind">{entry.kind}</span>
                  <span className="privilege-a2a__trace-text">{entry.text}</span>
                  {entry.detail && <details><summary>Details</summary><pre>{entry.detail}</pre></details>}
                </li>
              ))}
            </ol>
          )}
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
                        <details>
                          <summary>Details</summary>
                          <pre>{[...verdict.frameworks.map(framework => `${framework.label}: ${framework.identifiers.join(', ')}`), ...(verdict.rules.length ? [`Rules: ${verdict.rules.join(', ')}`] : [])].join('\n')}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </aside>
      </div>

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
  );
}
