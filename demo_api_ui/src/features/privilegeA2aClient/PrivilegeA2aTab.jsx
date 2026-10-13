import { useState } from 'react';
import { GATEWAY_RECORD_SIGN_IN_PATH, loadGatewayRecord } from '../../services/gatewayEvents';
import { PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID, PRIVILEGE_A2A_DEMO_QUESTIONS, runPrivilegeA2aChatRun } from '../../utils/privilegeA2aChainRun';
import { usePrivilegeA2aProfile } from './usePrivilegeA2aProfile';
import './PrivilegeA2aTab.css';

export default function PrivilegeA2aTab() {
  const profile = usePrivilegeA2aProfile();
  const demoQuestions = profile?.questions?.length ? profile.questions : PRIVILEGE_A2A_DEMO_QUESTIONS;
  const [input, setInput] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  // The gateway's own record of the last run: its model calls and guardrail verdicts.
  const [record, setRecord] = useState(null);
  const recordLines = record ? record.modelCalls.length + record.guardrail.length + (record.requests?.length || 0) + (record.denials?.length || 0) : 0;

  // The run is shown by the floating agent (reel, sequence view and the answer), not on this page:
  // start it here, then hand it to the agent as Step 25A, staying on this page.
  const submitQuestion = (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setRecord(null);
    const startedAt = Date.now();
    setInput('');
    setSelectedQuestion('');
    const run = runPrivilegeA2aChatRun({
      message,
      sessionId,
      profile,
      onEvent: (eventName, payload) => {
        if (eventName === 'done' && typeof payload?.sessionId === 'string' && payload.sessionId.length <= 128) setSessionId(payload.sessionId);
      },
    });
    window.dispatchEvent(new CustomEvent('agent-demo-step-select', {
      detail: {
        uc: {
          id: 'UC46A',
          useCaseId: PRIVILEGE_A2A_ACCESS_REVIEW_AGENT_USE_CASE_ID,
          title: 'Privilege A2A access review in the agent',
          trigger: { type: 'link', path: `${window.location.pathname}${window.location.search}` },
        },
        stepNumber: '25A',
        opts: { keepTrace: true, run },
      },
    }));
    run.catch(() => {}).finally(() => {
      setBusy(false);
      // The gateway ships each line as it writes it; give the index a moment.
      setTimeout(async () => setRecord(await loadGatewayRecord({ since: startedAt - 2000, until: Date.now() + 2000 })), 1500);
    });
  };

  return (
    <section className="privilege-a2a" aria-labelledby="privilege-a2a-title">
      <header className="privilege-a2a__header">
        <div>
          <h2 id="privilege-a2a-title">A2A access review</h2>
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
        <aside className="privilege-a2a__trace" aria-label="Gateway record">
          {!record && <p className="privilege-a2a__empty">The answer, the delegation hops and the token chain appear in the floating agent. The gateway's own record of the run loads here when it finishes.</p>}
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
          <span>Sends the question to the floating agent: Main agent → A2A → Analyst → MCP tools.</span>
          <button className="privilege-a2a__send" type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Reviewing…' : 'Send question'}
          </button>
        </div>
      </form>
    </section>
  );
}
