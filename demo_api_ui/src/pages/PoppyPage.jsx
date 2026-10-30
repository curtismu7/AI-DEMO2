// /poppy: AI-DEMO2 as the Company side of the Personal Agent Protocol (Poppy). Public, no live call: it explains and simulates.
// The diagram is SequenceFlowDiagram (React Flow): Simulate, step speed, Reset and the movie reel.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  POPPY_DETAILS, POPPY_DOCS, POPPY_HOST, POPPY_LANES, POPPY_PAYLOADS, POPPY_SCOPES, POPPY_SOURCE, POPPY_SPEC, POPPY_STATUS,
} from '../config/poppyPage';
import './PoppyPage.css';

export default function PoppyPage() {
  return (
    <main className="poppy-page" data-testid="poppy-page">
      <PageHeader
        eyebrow="Diagrams · Agents"
        title="Poppy: the Personal Agent Protocol"
        summary="A person's own agent can use a Company's APIs without the Company registering that agent first. The agent names itself with a URL, signs in through PingFederate, and signs every request. This is how AI-DEMO2 plays the Company."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />

      <section className="poppy-card" aria-labelledby="poppy-status">
        <h2 id="poppy-status">Where this stands</h2>
        <ul className="poppy-status">
          {POPPY_STATUS.map((s) => (
            <li key={s.text}><span className={`poppy-tag poppy-tag--${s.label === 'Proven' ? 'ok' : 'todo'}`}>{s.label}</span> {s.text}</li>
          ))}
        </ul>
        <p className="poppy-muted">Spec: <a href={POPPY_SPEC} target="_blank" rel="noreferrer">{POPPY_SPEC}</a> (Draft 0.3).</p>
      </section>

      <section className="poppy-card" aria-labelledby="poppy-flow">
        <h2 id="poppy-flow">The flow</h2>
        <SequenceFlowDiagram
          source={POPPY_SOURCE}
          payloads={POPPY_PAYLOADS}
          details={POPPY_DETAILS}
          lanes={POPPY_LANES}
          label="Poppy: discover, sign in, call the API"
        />
      </section>

      <section className="poppy-card" aria-labelledby="poppy-docs">
        <h2 id="poppy-docs">What the Company serves</h2>
        <p className="poppy-muted">All on <code>https://{POPPY_HOST}</code>, a separate host because the spec needs the resource to be exactly that origin.</p>
        <table className="poppy-table" aria-label="Poppy documents and API">
          <thead><tr><th>Path</th><th>What it is</th></tr></thead>
          <tbody>
            {POPPY_DOCS.map((d) => (
              <tr key={d.path}><td><a href={`https://${POPPY_HOST}${d.path}`} target="_blank" rel="noreferrer"><code>{d.path}</code></a></td><td>{d.what}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="poppy-card" aria-labelledby="poppy-scopes">
        <h2 id="poppy-scopes">Scopes</h2>
        <table className="poppy-table" aria-label="Poppy scopes">
          <thead><tr><th>Scope</th><th>Changes</th><th>Note</th></tr></thead>
          <tbody>
            {POPPY_SCOPES.map((s) => (
              <tr key={s.scope}><td><code>{s.scope}</code></td><td>{s.changes}</td><td>{s.note}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
