// demo_api_ui/src/pages/JevLearningPage.jsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  SYSTEM_COMPARE,
  SCENARIOS,
  BAKEOFF,
  POLICY_RULES,
  decide,
} from './jevLessons';
import './JevLearningPage.css';

/**
 * Jev walkthrough — System 1 vs System 2, a live side-by-side, the
 * "confidence is not permission" threshold lesson, and a small guardrail bake-off.
 *
 * Raw `fetch` on purpose (same as A2AProtocolLearningPage): the page renders
 * signed out and a 429/502 here is an expected state shown inline, not a
 * session-expired event.
 */

async function evaluate(scenario, state) {
  const res = await fetch('/api/demo/jev/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, state }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

/** One number a column can show for any answer type. */
function headline(answer) {
  if (!answer) return '';
  if (answer.type === 'choice') return `${answer.choice} (${Math.round((answer.confidence ?? 0) * 100)}% confident)`;
  return `P(yes) = ${answer.probability.toFixed(2)}`;
}

/** Plain-language reading of a live answer, shown under the number. */
function explainJev(answer) {
  if (!answer) return '';
  if (answer.type === 'choice') {
    return 'The model read the meaning of the text, picked the best-fitting option, and reports how confident it is in that pick.';
  }
  const pct = Math.round(answer.probability * 100);
  return `The model read the meaning of the text and scored how likely the answer to the question above is "yes": about ${pct}%. Unlike the rules, it can say "probably" or "not sure", and a score near 50% means it is unsure.`;
}

function ModeBadge({ mode, model }) {
  return mode === 'live' ? (
    <span className="jev-badge jev-badge--live">{`Live: ${model}`}</span>
  ) : (
    <span className="jev-badge jev-badge--sim">Simulated - not configured</span>
  );
}

function LivePanel({ onRisk }) {
  const [scenario, setScenario] = useState('injection');
  const [text, setText] = useState(SCENARIOS.injection.examples[0]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (key) => {
    setScenario(key);
    setText(SCENARIOS[key].examples[0]);
    setResult(null);
    setError('');
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await evaluate(scenario, text);
      setResult(r);
      if (scenario === 'risk' && r.jev.answer.type === 'noul') onRisk(r.jev.answer.probability);
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [scenario, text, onRisk]);

  return (
    <section className="jev-card" aria-labelledby="jev-live">
      <h2 id="jev-live" className="jev-h2">Same input, two deciders</h2>
      <p className="jev-lead">{SCENARIOS[scenario].question}</p>
      <div className="jev-tabs" role="tablist">
        {Object.entries(SCENARIOS).map(([key, s]) => (
          <button
            key={key}
            role="tab"
            aria-selected={scenario === key}
            className={`jev-tab${scenario === key ? ' jev-tab--on' : ''}`}
            onClick={() => pick(key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="jev-examples">
        {SCENARIOS[scenario].examples.map((ex) => (
          <button key={ex} className="jev-chip" onClick={() => setText(ex)}>{ex}</button>
        ))}
      </div>
      <textarea
        className="jev-input"
        aria-label="Text to judge"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={run}>
        {busy ? 'Deciding...' : 'Decide'}
      </button>
      {error && <p className="jev-error" role="alert">{error}</p>}
      {result && (
        <div className="jev-cols">
          <div className="jev-col">
            <h3 className="jev-h3">Keyword rules</h3>
            <p className="jev-big">{headline(result.heuristic.answer)}</p>
            <p className="jev-explain">
              Scans for a fixed list of trigger words and phrases. Finds one: 1.00 (yes). Finds none: 0.00 (no).
              It never reads the meaning and never says "maybe", so a reworded attack slips through and a
              harmless message that contains a trigger word gets flagged.
            </p>
            <p className="jev-meta">{result.heuristic.latencyMs} ms - always 0 or 1, never unsure</p>
          </div>
          <div className="jev-col">
            <h3 className="jev-h3">Jev <ModeBadge mode={result.jev.mode} model={result.jev.model} /></h3>
            <p className="jev-big">{headline(result.jev.answer)}</p>
            {result.jev.mode === 'live' && <p className="jev-explain">{explainJev(result.jev.answer)}</p>}
            <p className="jev-meta">{result.jev.latencyMs} ms - model {result.jev.model}</p>
            {result.jev.mode === 'simulated' && (
              <p className="jev-meta">
                No OPENROUTER_API_KEY or JEV_ENDPOINT on the server, so this column is the same keyword rules. It says nothing about Jev.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ThresholdLesson({ probability, setProbability }) {
  const [stepUpAt, setStepUpAt] = useState(0.4);
  const [denyAt, setDenyAt] = useState(0.9);
  const outcome = decide(probability, stepUpAt, denyAt);
  return (
    <section className="jev-card" aria-labelledby="jev-thresh">
      <h2 id="jev-thresh" className="jev-h2">Confidence is not permission</h2>
      <p className="jev-lead">
        Jev answers "how likely is this risky?". Whether that means allow, step up or deny is a
        policy decision. In this demo that belongs to PingOne Authorize and the gateway - the model
        score is one attribute they can read, not the verdict. Drag the lines to see the same
        score flip outcome. Run the Step-up risk example above to load a real score.
      </p>
      <label className="jev-slider">
        Jev P(yes risky): <strong>{probability.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={probability}
          onChange={(e) => setProbability(Number(e.target.value))} />
      </label>
      <label className="jev-slider">
        Step-up at: <strong>{stepUpAt.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={stepUpAt}
          onChange={(e) => setStepUpAt(Math.min(Number(e.target.value), denyAt))} />
      </label>
      <label className="jev-slider">
        Deny at: <strong>{denyAt.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={denyAt}
          onChange={(e) => setDenyAt(Math.max(Number(e.target.value), stepUpAt))} />
      </label>
      <ul className="jev-outcomes">
        {POLICY_RULES.map((r) => (
          <li key={r.id} className={`jev-outcome jev-outcome--${r.id}${outcome === r.id ? ' jev-outcome--on' : ''}`}>
            <strong>{r.label}</strong> - {r.detail}
          </li>
        ))}
      </ul>
      <p className="jev-meta">
        Two failure modes to discuss: a confident wrong score (0.02 on a real attack) sails through
        every threshold, and a score near a line flips with tiny changes. Keep a deterministic
        floor - amount caps, consent, scope checks - that no model score can lower.
      </p>
    </section>
  );
}

function Bakeoff() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setRows(null);
    try {
      const out = [];
      for (const item of BAKEOFF) {
        const r = await evaluate('injection', item.text);
        out.push({ ...item, rules: r.heuristic.answer.probability >= 0.5, jev: r.jev.answer.probability, mode: r.jev.mode, model: r.jev.model });
      }
      setRows(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const score = useMemo(() => {
    if (!rows) return null;
    const rulesRight = rows.filter((r) => r.rules === r.bad).length;
    const jevRight = rows.filter((r) => (r.jev >= 0.5) === r.bad).length;
    return { rulesRight, jevRight, total: rows.length, mode: rows[0].mode, model: rows[0].model };
  }, [rows]);

  return (
    <section className="jev-card" aria-labelledby="jev-bake">
      <h2 id="jev-bake" className="jev-h2">Guardrail bake-off</h2>
      <p className="jev-lead">
        Eight hand-labelled messages, four hostile and four harmless but containing trigger words. The
        score covers only these eight - it is a teaching exercise, not a benchmark of Jev, and it is
        separate from the gateway guardrail measurements.
      </p>
      <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Running...' : 'Run bake-off'}</button>
      {error && <p className="jev-error" role="alert">{error}</p>}
      {rows && (
        <>
          <table className="jev-table">
            <thead>
              <tr><th>Message</th><th>Truth</th><th>Rules</th><th>Jev P(yes)</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.text}>
                  <td>{r.text}</td>
                  <td>{r.bad ? 'hostile' : 'harmless'}</td>
                  <td className={r.rules === r.bad ? 'jev-right' : 'jev-wrong'}>{r.rules ? 'block' : 'allow'}</td>
                  <td className={(r.jev >= 0.5) === r.bad ? 'jev-right' : 'jev-wrong'}>{r.jev.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-big">
            Rules {score.rulesRight}/{score.total} - Jev {score.jevRight}/{score.total} <ModeBadge mode={score.mode} model={score.model} />
          </p>
        </>
      )}
    </section>
  );
}

export default function JevLearningPage() {
  const [risk, setRisk] = useState(0.62);
  return (
    <div className="jev-page">
      <h1 className="jev-h1">Jev: a fast decision model for agents</h1>
      <p className="jev-sub">
        Jev (TypeSafe) is a "System One" model: you send it text and a typed question in plain
        English, and it returns a choice, a score, or a yes/no probability instead of prose. Think of it as
        an if-statement that can read.
      </p>

      <section className="jev-card" aria-labelledby="jev-s1s2">
        <h2 id="jev-s1s2" className="jev-h2">System One vs System Two</h2>
        <table className="jev-table">
          <thead><tr><th /><th>System One (Jev)</th><th>System Two (generative LLM)</th></tr></thead>
          <tbody>
            {SYSTEM_COMPARE.map((r) => (
              <tr key={r.row}><th scope="row">{r.row}</th><td>{r.one}</td><td>{r.two}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="jev-meta">Speed and cost rows are TypeSafe's published claims, not measurements from this demo.</p>
      </section>

      <LivePanel onRisk={setRisk} />
      <ThresholdLesson probability={risk} setProbability={setRisk} />
      <Bakeoff />
    </div>
  );
}
