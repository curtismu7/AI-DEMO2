import { useEffect, useRef, useState } from 'react';
import './PrivilegeA2aTab.css';

const API_URL = '/api/privilege-a2a/chat';
const DEMO_QUESTIONS = [
  'Review access on prod-db-primary.',
  'List all entitlements for Carol Nguyen.',
  'Who has the prod-db-admin role?',
  'Who is offboarding and still has active access?',
];

function readEvent(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, payload: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

export default function PrivilegeA2aTab() {
  const [input, setInput] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [trace, setTrace] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    setTurns(current => [...current, { question: message, answer: '' }]);
    setInput('');
    setSelectedQuestion('');

    try {
      const body = { message };
      if (sessionId) body.sessionId = sessionId;
      const response = await fetch(API_URL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let messageText = 'The A2A service is unavailable.';
        try {
          const bodyJson = await response.json();
          if (typeof bodyJson.error === 'string') messageText = bodyJson.error;
        } catch { /* Keep the safe fallback for non-JSON API errors. */ }
        setError(messageText);
        return;
      }
      if (!response.body) {
        setError('The A2A service returned no response stream.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const processFrames = (final = false) => {
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = readEvent(frame);
          if (parsed) handleEvent(parsed.event, parsed.payload);
          boundary = buffer.indexOf('\n\n');
        }
        if (final && buffer.trim()) {
          const parsed = readEvent(buffer);
          if (parsed) handleEvent(parsed.event, parsed.payload);
          buffer = '';
        }
      };

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processFrames();
      }
      buffer += decoder.decode();
      processFrames(true);
    } catch (requestError) {
      if (controller.signal.aborted) setError('Request cancelled.');
      else setError(requestError instanceof Error ? requestError.message : 'The A2A request failed.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const cancelRequest = () => abortRef.current?.abort();

  return (
    <section className="privilege-a2a" aria-labelledby="privilege-a2a-title">
      <header className="privilege-a2a__header">
        <div>
          <h2 id="privilege-a2a-title">A2A access review</h2>
          <p>Ask about an entitlement. The main agent delegates the lookup to an analyst, who checks access data through MCP.</p>
        </div>
        <ol className="privilege-a2a__path" aria-label="Agent request path">
          <li>Main agent</li>
          <li>A2A</li>
          <li>Analyst</li>
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
          {DEMO_QUESTIONS.map(question => <option key={question} value={question}>{question}</option>)}
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
