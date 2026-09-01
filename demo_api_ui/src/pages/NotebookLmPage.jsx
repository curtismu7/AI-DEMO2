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

/**
 * Starter questions, matched to a notebook by a substring of its title.
 *
 * These are per-notebook rather than global on purpose. A notebook only answers
 * from its own sources, and when a question has no grounding NotebookLM does not
 * say so — it silently falls back to web research and returns a confident answer
 * with an EMPTY references array. Asking a PingOne question against the privilege
 * notebook therefore looks like it worked. Offering only questions the selected
 * notebook can actually ground makes that failure mode hard to trigger by accident.
 */
const EXAMPLES = [
  {
    match: 'pingone',
    questions: [
      'What MFA methods does PingOne support?',
      'How do I configure FIDO2 passkeys in PingOne?',
      'What is the difference between PingID and PingOne MFA?',
      'How do I create a worker application for the Management API?',
      'How does PingOne Protect risk scoring work?',
    ],
  },
  {
    match: 'privilege',
    questions: [
      'What is the difference between agent-based and agentless deployment?',
      'How do I register an MCP server with the Privilege gateway?',
      'What is PCLI and when do I use it?',
    ],
  },
];

function examplesFor(notebook) {
  if (!notebook) return [];
  const title = String(notebook.title || '').toLowerCase();
  const hit = EXAMPLES.find((e) => title.includes(e.match));
  return hit ? hit.questions : [];
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
  const [elapsed, setElapsed] = useState(0);

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
      .then((res) => {
        setSources((res.data && res.data.sources) || []);
        setUnavailable(null);
      })
      .catch((err) => setUnavailable(reasonFor(err)));
  }, []);

  const ask = useCallback(
    (event) => {
      event.preventDefault();
      if (!selected || !question.trim()) return;
      setAsking(true);
      setElapsed(0);
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

  // Measured 15-45s per ask against the live service. Without a running counter a
  // slow success is indistinguishable from a hung page, which is how the first
  // demo of this page got read as broken.
  useEffect(() => {
    if (!asking) return undefined;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [asking]);

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

  const exampleQuestions = examplesFor(selected);

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
      {selected && exampleQuestions.length > 0 && (
        <div className="nlm-examples">
          <span className="nlm-label">Try one</span>
          {exampleQuestions.map((q) => (
            <button
              key={q}
              type="button"
              className="nlm-example"
              disabled={asking}
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {selected && exampleQuestions.length === 0 && (
        <p className="nlm-no-examples">
          No starter questions for this notebook — it answers only from its own sources, and
          anything they do not cover comes back as uncited web research.
        </p>
      )}
      <button type="submit" className="nlm-submit" disabled={!selected || asking}>
        {asking ? 'Asking…' : 'Ask'}
      </button>
      {asking && (
        <div className="nlm-progress" role="status" aria-live="polite">
          <span className="nlm-spinner" aria-hidden="true" />
          <span>
            Searching the sources… {elapsed}s
            {elapsed >= 20 ? ' — long answers can take up to a minute' : ''}
          </span>
        </div>
      )}
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
