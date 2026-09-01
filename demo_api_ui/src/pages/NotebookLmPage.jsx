import React, { useCallback, useEffect, useState } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import apiClient from '../services/apiClient';
import './NotebookLmPage.css';

/**
 * NotebookLM docs oracle — read-only.
 *
 * The sidecar that backs this page holds host-local Google cookies, so it is
 * absent everywhere except a developer laptop. Unavailability is a normal
 * state, not an error: every failure names its cause rather than spinning.
 */

const REASON_TEXT = {
  sidecar_unreachable: 'The NotebookLM sidecar is not running.',
  auth_expired: 'Host auth expired — run `notebooklm login --browser chrome` on the host.',
  upstream_timeout: 'NotebookLM timed out.',
  upstream_error: 'NotebookLM returned an error.',
};

function reasonFor(err) {
  const reason = err && err.response && err.response.data && err.response.data.reason;
  return REASON_TEXT[reason] || 'NotebookLM is unavailable.';
}

export default function NotebookLmPage() {
  const [notebooks, setNotebooks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sources, setSources] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [tab, setTab] = useState('answer');
  const [unavailable, setUnavailable] = useState(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/notebooklm/notebooks')
      .then((res) => {
        if (cancelled) return;
        setNotebooks((res.data && res.data.notebooks) || []);
        setUnavailable(null);
      })
      .catch((err) => {
        if (!cancelled) setUnavailable(reasonFor(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectNotebook = useCallback((nb) => {
    setSelected(nb);
    setSources([]);
    apiClient
      .get(`/api/notebooklm/notebooks/${encodeURIComponent(nb.id)}/sources`)
      .then((res) => setSources((res.data && res.data.sources) || []))
      .catch((err) => setUnavailable(reasonFor(err)));
  }, []);

  const ask = useCallback(
    (event) => {
      event.preventDefault();
      if (!selected || !question.trim()) return;
      setAsking(true);
      setAnswer(null);
      apiClient
        .post('/api/notebooklm/ask', { notebookId: selected.id, question })
        .then((res) => {
          setAnswer(res.data);
          setTab('answer');
          setUnavailable(null);
        })
        .catch((err) => setUnavailable(reasonFor(err)))
        .finally(() => setAsking(false));
    },
    [selected, question],
  );

  const left = (
    <nav className="nlm-tree" aria-label="Notebooks">
      {notebooks.map((nb) => (
        <button
          key={nb.id}
          type="button"
          className={`nlm-tree-item${selected && selected.id === nb.id ? ' is-selected' : ''}`}
          onClick={() => selectNotebook(nb)}
        >
          {nb.title}
        </button>
      ))}
      {selected && sources.length > 0 && (
        <ul className="nlm-sources">
          {sources.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      )}
    </nav>
  );

  const middle = (
    <form className="nlm-ask" onSubmit={ask}>
      <label className="nlm-label" htmlFor="nlm-question">
        Question
      </label>
      <textarea
        id="nlm-question"
        className="nlm-input"
        rows={5}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What is the agentless MCP gateway?"
      />
      <button type="submit" className="nlm-submit" disabled={!selected || asking}>
        {asking ? 'Asking…' : 'Ask'}
      </button>
    </form>
  );

  const right = (
    <div className="nlm-output">
      <div className="nlm-tabs" role="tablist">
        {['answer', 'sources', 'raw'].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`nlm-tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'answer' && answer && (
        <div className="nlm-answer">
          <p className="nlm-answer-text">{answer.answer}</p>
          <ol className="nlm-refs">
            {(answer.references || []).map((r) => (
              <li key={r.citationNumber}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.url}
                  </a>
                ) : (
                  <span className="nlm-ref-unresolved">source page not identified</span>
                )}
                <span className="nlm-ref-excerpt">{r.citedText}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === 'sources' && (
        <ul className="nlm-source-list">
          {sources.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      )}

      {tab === 'raw' && <pre className="nlm-raw">{JSON.stringify(answer, null, 2)}</pre>}
    </div>
  );

  return (
    <InspectorShell
      title="NotebookLM Docs Oracle"
      statusOn={!unavailable}
      statusText={unavailable ? 'Unavailable' : 'Connected'}
      banner={unavailable ? <div className="nlm-unavailable">{unavailable}</div> : null}
      left={left}
      middle={middle}
      right={right}
    />
  );
}
