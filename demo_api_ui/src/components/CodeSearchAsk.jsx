import React, { useEffect, useRef, useState } from 'react';

const PROMPT_GROUPS = [
  {
    label: 'Codebase questions',
    prompts: [
      'How does authentication work in this code?',
      'Where is the main entry point?',
      'Summarize the architecture',
      'What external services does this call?',
      'Where is authorization enforced?',
      'Trace the request path from the UI to the backend.',
      'Which files handle error recovery?',
      'What tests cover this behavior?',
    ],
  },
  {
    label: 'Learning Hub questions',
    prompts: [
      'Which Learning Hub lessons explain OAuth token exchange?',
      'What Learning Hub material explains protecting MCP tools?',
      'Summarize the Learning Hub guidance for RAG security.',
    ],
  },
];

const PROMPTS = PROMPT_GROUPS.flatMap((group) => group.prompts);

// Chat panel for the code-search agent, modeled on OAuthAcademyPage: an
// append-only message thread with typing dots, starter chips on the empty
// state, and a Stop button that aborts the in-flight request. Networking is
// unchanged from the original single-shot version: one POST
// /api/code-search/ask per turn with { question, codebase_id }.
export default function CodeSearchAsk({ codebaseId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  // Monotonic id for stable React keys — messages are append-only.
  const nextIdRef = useRef(0);
  const promptHistoryRef = useRef([]);
  const promptHistoryIndexRef = useRef(-1);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const mkMsg = (role, content, extra = {}) => ({
    id: nextIdRef.current++,
    role,
    content,
    ...extra,
  });

  const setLastAssistant = (patch) => {
    setMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], ...patch };
      return updated;
    });
  };

  const sendQuestion = async (question) => {
    if (!question.trim() || isSending || !codebaseId) return;
    promptHistoryRef.current.push(question.trim());
    promptHistoryIndexRef.current = -1;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Don't let a hung agent leave the typing dots up forever.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, 245000);

    setIsSending(true);
    setInput('');
    setMessages((prev) => [
      ...prev,
      mkMsg('user', question),
      mkMsg('assistant', '', { pending: true }),
    ]);

    try {
      const r = await fetch('/api/code-search/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, codebase_id: codebaseId }),
        signal: ctrl.signal,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // BFF/MCP use message|error; FastAPI (llamaindex-agent) uses detail.
        const detail = Array.isArray(body.detail)
          ? body.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
          : body.detail;
        throw new Error(body.message || body.error || detail || `assistant unavailable (status ${r.status})`);
      }
      setLastAssistant({
        content: body.answer || '(no answer)',
        pending: false,
        sources: body.sources || [],
        meta: { toolCalls: body.toolCalls, mode: body.mode },
      });
    } catch (e) {
      const message =
        e.name === 'AbortError'
          ? timedOut
            ? 'The agent took too long to respond.'
            : 'Stopped.'
          : e.message;
      setLastAssistant({ content: message, pending: false, error: true });
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      setIsSending(false);
    }
  };

  const handleStop = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendQuestion(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(promptHistoryIndexRef.current + 1, promptHistoryRef.current.length - 1);
      if (next >= 0) {
        promptHistoryIndexRef.current = next;
        setInput(promptHistoryRef.current[promptHistoryRef.current.length - 1 - next]);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  const isEmpty = messages.length === 0;

  const renderPromptMenu = () => (
    <details className="prompt-menu">
        <summary><span aria-hidden="true">📚</span> Prompt library <span>{PROMPTS.length} prompts</span></summary>
      <div className="prompt-menu-panel">
        {PROMPT_GROUPS.map((group) => (
          <section key={group.label} className="prompt-group">
            <h3>{group.label}</h3>
            <div className="prompt-options">
              {group.prompts.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  className="starter-chip"
                  onClick={() => sendQuestion(prompt)}
                  disabled={isSending || !codebaseId}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );

  const clearConversation = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setInput('');
    setIsSending(false);
  };

  return (
    <div className="code-search-ask">
      {isEmpty ? (
        <div className="ask-empty">
          <h2>Ask the agent</h2>
          <p>
            {codebaseId
              ? 'Ask a question about the selected codebase, or start with one of these:'
              : 'Upload or select a codebase on the left, then ask the agent about it.'}
          </p>
          {renderPromptMenu()}
        </div>
      ) : (
        <div className="messages-container">
          {messages.map((msg, idx) => {
            const showTyping =
              msg.role === 'assistant' &&
              idx === messages.length - 1 &&
              msg.pending &&
              msg.content === '';

            if (showTyping) {
              return (
                <div key={msg.id} className="message-row assistant">
                  <div className="msg-avatar">AI</div>
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`message-row ${msg.role}`}>
                <div className="msg-avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
                <div className="msg-body">
                  <div className={`message-bubble${msg.error ? ' error' : ''}`}>
                    {msg.content}
                  </div>
                  {msg.meta && (msg.meta.mode || msg.meta.toolCalls != null) && (
                    <div className="ask-meta">
                      mode: {msg.meta.mode} · tool calls: {msg.meta.toolCalls}
                    </div>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="ask-sources">
                      <h4>Sources</h4>
                      {msg.sources.map((s) => (
                        <div key={`${s.file}:${s.line_start}`} className="ask-source">
                          <code>
                            {s.file}:{s.line_start}-{s.line_end}
                          </code>
                          <pre>{s.snippet}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {!isEmpty && <div className="quick-chip-bar">{renderPromptMenu()}</div>}

      <form className="input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
           onChange={(e) => {
             setInput(e.target.value);
             promptHistoryIndexRef.current = -1;
           }}
          onKeyDown={handleKeyDown}
          placeholder={
            codebaseId
              ? 'Ask the agent about this codebase…'
              : 'Upload or select a codebase first…'
          }
          disabled={isSending || !codebaseId}
        />
        {!isEmpty && (
          <button type="button" className="clear-btn" onClick={clearConversation}>
            Clear
          </button>
        )}
        {isSending ? (
          <button type="button" className="send-btn stop-btn" onClick={handleStop}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              role="img"
              aria-label="Stop"
            >
              <title>Stop</title>
              <rect x="2" y="2" width="10" height="10" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className="send-btn"
            disabled={!input.trim() || !codebaseId}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="Send"
            >
              <title>Send</title>
              <line x1="8" y1="13" x2="8" y2="3" />
              <polyline points="4,7 8,3 12,7" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
