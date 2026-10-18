import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import CallDetail, { Chip, Wrapped, formatTime } from './CallDetail.jsx';
import { SRC_LABEL, isProblem } from './inspectorCalls.js';
import './Inspector.css';

export default function InspectorLayout({
  eyebrow, title, lede, related = [], mode, source, heroExtra, send,
  calls, callsNote, callsToggle, selectedId, onSelect, onResend, onEdit, nodeSubs,
}) {
  const [filter, setFilter] = useState('all');
  const list = filter === 'all' ? calls : calls.filter(isProblem);
  const selected = calls.find((c) => c.id === selectedId);
  return (
    <main className="insp">
      <header className="insp-hero">
        <div>
          <p className="insp-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="insp-lede">{lede}</p>
          {related.length > 0 && (
            <p className="insp-related">More tools: {related.map((r, i) => (
              <React.Fragment key={r.to}>{i > 0 && ' · '}<Link to={r.to}>{r.label}</Link></React.Fragment>
            ))}</p>
          )}
        </div>
        <div className="insp-hero-meta">
          <Chip chip={mode} />
          {source && (
            <>
              <label htmlFor="insp-source">{source.label}</label>
              <select id="insp-source" value={source.value} disabled={source.disabled} onChange={(e) => source.onChange(e.target.value)}>
                {source.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          )}
          {heroExtra}
        </div>
      </header>

      {send && <section className="insp-card insp-send" aria-label="Send a call">{send}</section>}

      <div className="insp-work">
        <aside className="insp-card insp-calls" aria-label="Calls">
          <div className="insp-calls-head">
            <h2 className="insp-label">Calls <span className="insp-count">{calls.length}</span></h2>
            <div className="insp-seg" role="group" aria-label="Filter calls">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              <button type="button" aria-pressed={filter === 'problems'} onClick={() => setFilter('problems')}>Problems</button>
            </div>
          </div>
          {callsToggle}
          {list.length ? (
            <ol className="insp-call-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="insp-call" aria-current={c.id === selectedId} onClick={() => onSelect(c.id)}>
                    <span className="insp-call-num">{calls.length - calls.indexOf(c)}</span>
                    <span className="insp-call-main">
                      <span className="insp-call-title"><Wrapped text={c.title} /></span>
                      <span className="insp-call-sub">{c.kind} · {SRC_LABEL[c.src]}</span>
                    </span>
                    <span className="insp-call-meta"><Chip chip={c.status} /><span>{c.ms == null ? 'open' : `${c.ms} ms`} · {formatTime(c.at)}</span></span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="insp-empty">{calls.length ? 'No failed calls. Switch to All to see every call.' : 'No calls yet. Send one above, or use the AI agent.'}</p>
          )}
          <p className="insp-calls-note">{callsNote}</p>
        </aside>
        {selected && <CallDetail call={selected} calls={calls} nodeSubs={nodeSubs} onResend={onResend} onEdit={onEdit} />}
      </div>
    </main>
  );
}
