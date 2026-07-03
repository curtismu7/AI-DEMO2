import React, { useState } from 'react';

export default function CodeSearchAsk({ codebaseId }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true); setError(''); setAnswer(null); setSources([]); setMeta(null);
    try {
      const r = await fetch('/api/code-search/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, codebase_id: codebaseId }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'assistant unavailable');
      setAnswer(body.answer);
      setSources(body.sources || []);
      setMeta({ toolCalls: body.toolCalls, mode: body.mode });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="code-search-ask">
      <div className="ask-input-group">
        <input
          className="search-input"
          placeholder="Ask the agent about this codebase…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          disabled={loading}
        />
        <button className="search-button" onClick={ask} disabled={loading || !codebaseId}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {error && <div className="search-error">{error}</div>}
      {answer && (
        <div className="ask-answer">
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
          {meta && (
            <div className="ask-meta">
              mode: {meta.mode} · tool calls: {meta.toolCalls}
            </div>
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div className="ask-sources">
          <h4>Sources</h4>
          {sources.map((s, i) => (
            <div key={i} className="ask-source">
              <code>{s.file}:{s.line_start}-{s.line_end}</code>
              <pre className="edu-code">{s.snippet}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
