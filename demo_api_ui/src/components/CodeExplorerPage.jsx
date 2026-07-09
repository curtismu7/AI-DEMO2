import React, { useState, useEffect, useRef } from 'react';
import { spinner } from '../services/spinnerService';
import { HeroSection } from './HeroSection';
import { HERO_VARIANTS } from '../config/heroVariants';
import './CodeExplorerPage.css';

const STARTER_CHIPS = [
  'How does the MCP gateway work?',
  'Trace the token chain flow',
  'What calls the authorize endpoint?',
  'How is delegation implemented?',
  'Show me the OAuth login flow',
  'What tools does the LangChain agent have?',
];

const CodeExplorerPage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexStatus, setReindexStatus] = useState('');
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const sendQuestion = async (question) => {
    if (!question.trim() || isStreaming) return;

    const historySnapshot = messages.map(({ role, content }) => ({ role, content }));

    const abort = new AbortController();
    abortRef.current = abort;

    setIsStreaming(true);
    setInput('');
    setReindexStatus('');
    setMessages(prev => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '', streaming: true },
    ]);

    // Drive the global spinner modal manually: the SSE endpoint returns headers
    // immediately, so the window.fetch wrapper would auto-hide it before the
    // answer arrives. `_silent` opts out of that wrapper's spinner; we keep the
    // modal up through the wait and hide it once the first token streams in.
    let spinnerActive = true;
    spinner.increment('POST', '/api/codegraph/query');
    const stopSpinner = () => {
      if (!spinnerActive) return;
      spinnerActive = false;
      spinner.decrement(false, '/api/codegraph/query');
    };

    try {
      const response = await fetch('/api/codegraph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: historySnapshot }),
        signal: abort.signal,
        _silent: true,
      });

      if (!response.ok) {
        let detail = `CodeGraph service error: ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) detail = errBody.error;
        } catch {
          // keep status-based message when body is not JSON
        }
        throw new Error(detail);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (data.type === 'token') {
            stopSpinner();
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + data.text,
              };
              return updated;
            });
          } else if (data.type === 'status') {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                status: data.text,
              };
              return updated;
            });
          } else if (data.type === 'done') {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
              return updated;
            });
            break;
          } else if (data.type === 'error') {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: 'assistant',
                content: `Error: ${data.text}`,
                streaming: false,
              };
              return updated;
            });
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, streaming: false };
          return updated;
        });
      } else {
        const message = err?.message
          ? `Error: ${err.message}`
          : 'Failed to reach the CodeGraph service. Is the langchain_agent running?';
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: message,
            streaming: false,
          };
          return updated;
        });
      }
    } finally {
      stopSpinner();
      abortRef.current = null;
      setIsStreaming(false);
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  // Rebuild the symbol index from the live source tree so answers reflect the
  // current code instead of the snapshot baked in at container build.
  const handleReindex = async () => {
    if (isReindexing) return;
    setIsReindexing(true);
    setReindexStatus('Re-indexing the codebase…');
    try {
      const res = await fetch('/api/codegraph/reindex', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReindexStatus(`Re-index failed: ${data.error || res.status}`);
        return;
      }
      const parts = [];
      if (data.files != null) parts.push(`${data.files} files`);
      if (data.nodes != null) parts.push(`${data.nodes} symbols`);
      const detail = parts.length ? ` (${parts.join(', ')})` : '';
      setReindexStatus(`Index refreshed${detail}`);
    } catch {
      setReindexStatus('Re-index failed: CodeGraph service unreachable.');
    } finally {
      setIsReindexing(false);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="code-explorer-page">

      {/* Toolbar — refresh the index so answers reflect current code */}
      <div className="code-explorer-toolbar">
        {reindexStatus && (
          <span className="reindex-status">{reindexStatus}</span>
        )}
        <button
          type="button"
          className="reindex-btn"
          onClick={handleReindex}
          disabled={isReindexing}
          title="Rebuild the code index from the current source"
        >
          <svg
            aria-hidden="true"
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={isReindexing ? 'reindex-spin' : undefined}
          >
            <polyline points="13.5,2.5 13.5,6.5 9.5,6.5" />
            <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 6.5" />
            <polyline points="2.5,13.5 2.5,9.5 6.5,9.5" />
            <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 9.5" />
          </svg>
          {isReindexing ? 'Refreshing…' : 'Refresh index'}
        </button>
      </div>

      {isEmpty && (
        <HeroSection
          avatar="</>"
          title="Code Explorer"
          description="Powered by CodeGraph — A semantic code knowledge graph that indexes every symbol, file, and dependency in your codebase for instant AI-powered exploration."
          subtitle="Ask about flows, architecture, patterns, implementation details, and how features work — with real, current code context"
          size="full"
          backgroundColor={HERO_VARIANTS['code-explorer'].backgroundColor}
        />
      )}

      {/* Messages — scrollable, fills available space */}
      {!isEmpty && (
        <div className="messages-container">
          {messages.map((msg, idx) => {
            const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1;
            const showTyping = isLastAssistant && msg.streaming && msg.content === '';

            if (showTyping) {
              return (
                <div key={idx} className="message-row assistant">
                  <div className="msg-avatar">&lt;&gt;</div>
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    {msg.status && <span className="typing-status">{msg.status}</span>}
                  </div>
                </div>
              );
            }

            return (
              <div key={idx} className={`message-row ${msg.role}`}>
                <div className="msg-avatar">{msg.role === 'user' ? 'You' : '<>'}</div>
                <div className="message-bubble">{msg.content}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input + Clear */}
      <div className="input-wrapper">
        <form className="input-area" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the codebase…"
            disabled={isStreaming}
          />
          {!isEmpty && (
            <button type="button" className="clear-btn" onClick={() => setMessages([])}>
              Clear
            </button>
          )}
          {isStreaming ? (
            <button type="button" className="send-btn stop-btn" onClick={handleStop}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="10" height="10" rx="2"/>
              </svg>
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="13" x2="8" y2="3"/>
                <polyline points="4,7 8,3 12,7"/>
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Chips — always visible */}
      <div className="starter-chips">
        {STARTER_CHIPS.map((chip) => (
          <button
            key={chip}
            className="starter-chip"
            onClick={() => sendQuestion(chip)}
            disabled={isStreaming}
          >
            {chip}
          </button>
        ))}
      </div>

    </div>
  );
};

export default CodeExplorerPage;
